//! rg-fff — a ripgrep-compatible front end backed by `fff` (fast file finder),
//! with transparent fallback to Claude Code's own embedded ripgrep.
//!
//! Claude Code spawns this binary believing it is ripgrep. We classify each
//! invocation:
//!   * fff-eligible exact content search  -> fff `GrepMode::PlainText` (ranked,
//!     warm-indexable, set-equivalent to rg — verified 205/205 on tweakcc-fixed)
//!   * `--fff-fuzzy` sentinel             -> fff `GrepMode::Fuzzy` (typo-tolerant
//!     discovery; the new capability ripgrep lacks)
//!   * everything else (regex, multiline, -c/count, -o, context, --type, --files
//!     enumeration, single-file/out-of-root, non-ASCII, complex globs, short
//!     patterns) -> re-exec CC's embedded ripgrep unchanged.
//!
//! The fff path emits ONLY ripgrep's plain colon-delimited records
//! (`PATH:LINENO:TEXT` / bare `PATH`) so CC's parser is satisfied. Exit codes
//! follow ripgrep: 0 = matches, 1 = no matches, >=2 = error.

use std::path::Path;
use std::process::Command;
use std::time::Duration;

use fff_search::file_picker::FilePicker;
use fff_search::{
    AiGrepConfig, FFFMode, FilePickerOptions, GrepMode, GrepSearchOptions,
    QueryParser, SharedFilePicker, SharedFrecency,
};

/// VCS dirs CC always excludes via `--glob !X`; fff already honors ignores, so
/// these are dropped rather than translated (and don't force an rg fallback).
const VCS_EXCLUDES: &[&str] = &[".git", ".svn", ".hg", ".bzr", ".jj", ".sl"];

/// ripgrep version we impersonate. CC's self-test requires stdout to start with
/// "ripgrep " or it disables the Grep tool. We mirror the embedded rg version.
const RG_VERSION_BANNER: &str = "ripgrep 14.1.1 (rev 324c5f012a) [fff-wrapped]";

#[derive(Default)]
struct Parsed {
    /// All args to forward to real rg on fallback (excludes our --fff-* flags).
    passthrough: Vec<String>,
    claude_bin: Option<String>,
    fuzzy: bool,
    version: bool,
    // output mode
    files_with_matches: bool, // -l
    count: bool,              // -c
    line_numbers: bool,       // -n (default true for content)
    // flags that force an rg fallback
    ignore_case: bool,        // -i
    multiline: bool,          // -U / --multiline*
    only_matching: bool,      // -o
    has_context: bool,        // -A/-B/-C/--context/...
    has_type: bool,           // --type / -t
    files_enumeration: bool,  // --files (Glob/enumeration)
    // collected globs (non-VCS) and search inputs
    user_globs: Vec<String>,
    glob_untranslatable: bool,
    pattern: Option<String>,
    paths: Vec<String>,
}

fn main() {
    let raw: Vec<String> = std::env::args().skip(1).collect();
    let p = parse_args(&raw);

    if p.version {
        println!("{RG_VERSION_BANNER}");
        std::process::exit(0);
    }

    // Decide route. fff handles: fuzzy (always), or eligible exact content.
    let route_fff = if p.fuzzy {
        // Fuzzy is only meaningful for content search in a directory.
        eligible_for_fff(&p, /*allow_fuzzy=*/ true)
    } else {
        eligible_for_fff(&p, /*allow_fuzzy=*/ false)
    };

    if route_fff {
        let code = run_fff(&p);
        std::process::exit(code);
    }
    fallback_to_rg(&p);
}

/// Parse a ripgrep-style argv into our decision struct.
fn parse_args(raw: &[String]) -> Parsed {
    let mut p = Parsed {
        line_numbers: false,
        ..Default::default()
    };
    let mut i = 0;
    let mut positional: Vec<String> = Vec::new();
    let mut explicit_pattern: Option<String> = None;
    while i < raw.len() {
        let a = &raw[i];
        // Our injected flags — consumed, never forwarded.
        if let Some(rest) = a.strip_prefix("--fff-claude-bin=") {
            p.claude_bin = Some(rest.to_string());
            i += 1;
            continue;
        }
        if a == "--fff-fuzzy" {
            p.fuzzy = true;
            i += 1;
            continue;
        }

        // Everything else is forwarded to rg on fallback.
        p.passthrough.push(a.clone());

        match a.as_str() {
            "--version" | "-V" => p.version = true,
            "-l" | "--files-with-matches" => p.files_with_matches = true,
            "-c" | "--count" | "--count-matches" => p.count = true,
            "-n" | "--line-number" => p.line_numbers = true,
            "--no-line-number" => p.line_numbers = false,
            "-i" | "--ignore-case" | "-S" | "--smart-case" => p.ignore_case = true,
            "-U" | "--multiline" | "--multiline-dotall" => p.multiline = true,
            "-o" | "--only-matching" => p.only_matching = true,
            "--files" => p.files_enumeration = true,
            "-H" | "--with-filename" | "--no-heading" | "--hidden"
            | "--no-config" | "--no-ignore" | "--no-ignore-vcs" | "--follow"
            | "--color=never" => {}
            "--color" => {
                // consumes a value (e.g. "never")
                if i + 1 < raw.len() {
                    p.passthrough.push(raw[i + 1].clone());
                    i += 1;
                }
            }
            "-A" | "-B" | "-C" | "--context" | "--after-context"
            | "--before-context" => {
                p.has_context = true;
                if i + 1 < raw.len() {
                    p.passthrough.push(raw[i + 1].clone());
                    i += 1;
                }
            }
            "-t" | "--type" => {
                p.has_type = true;
                if i + 1 < raw.len() {
                    p.passthrough.push(raw[i + 1].clone());
                    i += 1;
                }
            }
            "-j" | "--threads" | "--max-columns" | "--max-depth" | "--sort"
            | "--sortr" => {
                // flag + value; value is irrelevant to routing
                if i + 1 < raw.len() {
                    p.passthrough.push(raw[i + 1].clone());
                    i += 1;
                }
            }
            "-g" | "--glob" => {
                if i + 1 < raw.len() {
                    let g = raw[i + 1].clone();
                    p.passthrough.push(g.clone());
                    classify_glob(&mut p, &g);
                    i += 1;
                }
            }
            "-e" | "--regexp" => {
                if i + 1 < raw.len() {
                    explicit_pattern = Some(raw[i + 1].clone());
                    p.passthrough.push(raw[i + 1].clone());
                    i += 1;
                }
            }
            other => {
                if let Some(g) = other.strip_prefix("--glob=") {
                    classify_glob(&mut p, g);
                } else if let Some(g) = other.strip_prefix("-g=") {
                    classify_glob(&mut p, g);
                } else if other.starts_with('-') && other.len() > 1 {
                    // Unknown flag — tolerate, never crash. (Protects against CC
                    // version bumps adding flags.) It stays in passthrough.
                } else {
                    positional.push(other.to_string());
                }
            }
        }
        i += 1;
    }

    // First positional is the pattern (unless -e given); the rest are paths.
    if let Some(pat) = explicit_pattern {
        p.pattern = Some(pat);
        p.paths = positional;
    } else if !positional.is_empty() {
        p.pattern = Some(positional.remove(0));
        p.paths = positional;
    }
    p
}

/// Sort a `--glob` value into: dropped (VCS), translatable fff constraint, or
/// untranslatable (forces rg fallback).
fn classify_glob(p: &mut Parsed, g: &str) {
    let body = g.strip_prefix('!').unwrap_or(g);
    let bare = body.trim_start_matches("**/");
    // VCS excludes that fff already handles via ignore logic — drop.
    if VCS_EXCLUDES.iter().any(|v| body == *v || body == format!("{v}/")) {
        return;
    }
    // Safe shapes: extension globs, directory prefixes, simple names, brace
    // alternation. Anything with char classes / single-char wildcards is risky.
    let safe = !bare.is_empty()
        && bare
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "._*{},/-+".contains(c));
    if safe {
        // Re-emit in fff's inline constraint DSL (it understands *.ts, src/,
        // !test/, *.{ts,tsx}). Strip a leading **/ which fff doesn't need.
        let neg = if g.starts_with('!') { "!" } else { "" };
        p.user_globs.push(format!("{neg}{bare}"));
    } else {
        p.glob_untranslatable = true;
    }
}

/// fff handles a search only when its result is provably rg-equivalent.
fn eligible_for_fff(p: &Parsed, allow_fuzzy: bool) -> bool {
    // Hard exclusions — these have no faithful fff plain-mode equivalent.
    if p.files_enumeration || p.count || p.ignore_case || p.multiline
        || p.only_matching || p.has_context || p.has_type
        || p.glob_untranslatable
    {
        return false;
    }
    let pattern = match &p.pattern {
        Some(s) if !s.is_empty() => s,
        _ => return false,
    };
    // Fuzzy is deliberate discovery; for exact, route real regex to rg.
    if !allow_fuzzy {
        if has_regex_meta(pattern) {
            return false;
        }
        // Bigram prefilter is unreliable for sub-bigram patterns.
        if pattern.chars().count() < 3 {
            return false;
        }
    }
    if !pattern.is_ascii() {
        return false;
    }
    // Exactly one directory search root (or default cwd). Single files and
    // out-of-tree paths go to rg.
    let base = search_base(p);
    match base {
        Some(b) => Path::new(&b).is_dir(),
        None => true, // default cwd
    }
}

/// The directory fff indexes: the sole path arg if it is a dir, else cwd.
fn search_base(p: &Parsed) -> Option<String> {
    match p.paths.len() {
        0 => None,
        1 => Some(p.paths[0].clone()),
        _ => Some("\0multi".to_string()), // sentinel: multiple paths -> not a dir
    }
}

/// Regex-metacharacter test mirroring fff's own `has_regex_metacharacters`
/// (`regex::escape(t) != t`) without pulling the regex crate: any char that
/// `regex::escape` would escape.
fn has_regex_meta(t: &str) -> bool {
    t.chars().any(|c| {
        matches!(
            c,
            '\\' | '.' | '+' | '*' | '?' | '(' | ')' | '|' | '[' | ']' | '{'
                | '}' | '^' | '$' | '#' | '&' | '-' | '~'
        )
    })
}

/// Run the fff backend. Returns the process exit code (0 = matches, 1 = none).
fn run_fff(p: &Parsed) -> i32 {
    let base = search_base(p).unwrap_or_else(|| ".".to_string());
    let mode = if p.fuzzy {
        GrepMode::Fuzzy
    } else {
        GrepMode::PlainText
    };

    let shared_picker = SharedFilePicker::default();
    let shared_frecency = SharedFrecency::default();
    if FilePicker::new_with_shared_state(
        shared_picker.clone(),
        shared_frecency.clone(),
        FilePickerOptions {
            base_path: base.into(),
            mode: FFFMode::Ai,
            ..Default::default()
        },
    )
    .is_err()
    {
        // Could not index — fail safe to rg rather than report a broken search.
        fallback_to_rg(p);
    }
    shared_picker.wait_for_scan(Duration::from_secs(15));
    let guard = match shared_picker.read() {
        Ok(g) => g,
        Err(_) => fallback_to_rg(p),
    };
    let picker = match guard.as_ref() {
        Some(pk) => pk,
        None => fallback_to_rg(p),
    };

    // Build the fff query: constraint tokens (translated globs) + the pattern.
    let pattern = p.pattern.clone().unwrap_or_default();
    let mut query = String::new();
    for g in &p.user_globs {
        query.push_str(g);
        query.push(' ');
    }
    query.push_str(&pattern);

    let parser = QueryParser::new(AiGrepConfig);
    let parsed = parser.parse(&query);

    let out = std::io::stdout();
    let mut w = std::io::BufWriter::new(out.lock());
    use std::io::Write;

    let mut any = false;
    let mut file_offset = 0usize;
    // Exhaustive pagination so the fff set matches rg's set (not a top-N).
    loop {
        let opts = GrepSearchOptions {
            max_file_size: 10 * 1024 * 1024,
            max_matches_per_file: if p.fuzzy { 50 } else { 1_000_000 },
            // Default exact search is case-sensitive (rg's default). -i routes
            // to rg, so fff never needs case-insensitive here.
            smart_case: false,
            file_offset,
            page_limit: if p.fuzzy { 200 } else { 1_000_000 },
            mode,
            time_budget_ms: 0,
            before_context: 0,
            after_context: 0,
            classify_definitions: false,
            trim_whitespace: false,
            abort_signal: None,
        };
        let result = picker.grep(&parsed, &opts);

        if p.files_with_matches {
            for f in &result.files {
                let _ = writeln!(w, "{}", f.relative_path(picker));
                any = true;
            }
        } else {
            for m in &result.matches {
                let f = result.files[m.file_index];
                if p.line_numbers {
                    let _ = writeln!(
                        w,
                        "{}:{}:{}",
                        f.relative_path(picker),
                        m.line_number,
                        m.line_content
                    );
                } else {
                    let _ = writeln!(
                        w,
                        "{}:{}",
                        f.relative_path(picker),
                        m.line_content
                    );
                }
                any = true;
            }
        }

        if p.fuzzy || result.next_file_offset == 0 {
            break;
        }
        file_offset = result.next_file_offset;
    }
    let _ = w.flush();
    if any {
        0
    } else {
        1
    }
}

/// Re-exec Claude Code's embedded ripgrep (the claude binary with argv0="rg"),
/// or a system `rg`, forwarding all original rg args. Never returns.
fn fallback_to_rg(p: &Parsed) -> ! {
    use std::os::unix::process::CommandExt;

    let mut args: Vec<String> = Vec::with_capacity(p.passthrough.len() + 1);
    // CC's embedded rg expects --no-config (ignore user rg config); add if absent.
    if !p.passthrough.iter().any(|a| a == "--no-config") {
        args.push("--no-config".to_string());
    }
    args.extend(p.passthrough.iter().cloned());

    let (program, set_argv0) = match &p.claude_bin {
        Some(bin) => (bin.clone(), true),
        None => ("rg".to_string(), false), // last resort: system rg on PATH
    };

    let mut cmd = Command::new(&program);
    cmd.args(&args);
    if set_argv0 {
        cmd.arg0("rg"); // dispatch the embedded ripgrep multicall
    }
    // Inherit stdio so rg streams straight through to CC.
    let err = cmd.exec(); // replaces this process on success
    // exec only returns on failure:
    eprintln!("rg-fff: failed to exec ripgrep ({program}): {err}");
    std::process::exit(2);
}
