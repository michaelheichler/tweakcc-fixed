//! rg-fff — a multicall search front end backed by `fff` (fast file finder),
//! transparently replacing Claude Code's embedded `ugrep`/`bfs`/ripgrep for
//! content/file search, with a re-exec fallback to the real embedded tool.
//!
//! Claude Code shadows the shell `grep`/`find` with its embedded `ugrep`/`bfs`
//! (and offers `rg` separately). We get installed in their place and dispatch on
//! argv0:
//!   * argv0 = ugrep | grep   -> fff content search (literal), else embedded ugrep
//!   * argv0 = rg             -> fff content search (literal), else embedded rg
//!   * argv0 = bfs  | find    -> embedded bfs (fff find_files is a roadmap item)
//!   * argv0 = fff            -> explicit fff content search
//!
//! Levers:
//!   * `--fuzzy`            -> typo-tolerant, relevance-ranked fff (labeled approximate)
//!   * `--no-fallback`      -> error instead of re-execing the embedded tool (CI)
//!   * `--fff-claude-bin=P` -> claude binary for fallback (set by the rg resolver)
//!   * `--daemon <root>`    -> run the warm-index daemon for <root> (see daemon.rs)
//!
//! A per-root warm-index daemon (daemon.rs) answers repeat searches without a
//! cold scan; if it is absent or fails, we cold-scan and lazily spawn one. The
//! daemon is purely a latency optimization — correctness never depends on it.

mod daemon;

use std::collections::BTreeMap;
use std::fmt::Write as _;
use std::io::Write as _;
use std::path::Path;
use std::process::Command;
use std::time::Duration;

use fff_search::file_picker::FilePicker;
use fff_search::{
    AiGrepConfig, FFFMode, FilePickerOptions, GrepMode, GrepSearchOptions,
    QueryParser, SharedFilePicker, SharedFrecency,
};

#[derive(Clone, Copy, PartialEq, Eq)]
enum Tool {
    Ugrep, // grep shadow
    Rg,    // ripgrep
    Bfs,   // find shadow
    Fff,   // explicit
}

impl Tool {
    fn from_argv0(a0: &str) -> Tool {
        let base = Path::new(a0)
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or(a0);
        match base {
            "ugrep" | "grep" => Tool::Ugrep,
            "rg" => Tool::Rg,
            "bfs" | "find" => Tool::Bfs,
            _ => Tool::Fff, // "fff", "rg-fff", anything else
        }
    }
    /// The argv0 to use when re-execing the real embedded tool.
    fn embedded_argv0(self) -> &'static str {
        match self {
            Tool::Ugrep => "ugrep",
            Tool::Rg => "rg",
            Tool::Bfs => "bfs",
            Tool::Fff => "rg",
        }
    }
}

struct Opts {
    tool: Tool,
    raw: Vec<String>, // every arg after argv0 (for verbatim fallback)
    pattern: Option<String>,
    paths: Vec<String>,
    ignore_case: bool,
    line_numbers: bool, // emit PATH:LINE:TEXT vs PATH:TEXT
    files_only: bool,   // -l
    count: bool,        // -c
    recursive: bool,    // -r / -R (grep)
    fuzzy: bool,        // --fuzzy (explicit, typo-tolerant ranked discovery)
    no_fallback: bool,  // --no-fallback (error instead of embedded re-exec)
    claude_bin: Option<String>, // --fff-claude-bin= (from the rg resolver)
    // any flag that means "fff cannot serve this faithfully" -> fall back
    force_fallback: bool,
}

/// The minimal, serializable search request shared by the cold path and the
/// daemon (daemon.rs reconstructs this from the wire and calls format_results).
pub struct SearchReq {
    pub pattern: String,
    pub dir: Option<String>,
    pub line_numbers: bool,
    pub files_only: bool,
    pub count: bool,
    pub fuzzy: bool,
    pub ignore_case: bool,
}

fn main() {
    let argv: Vec<String> = std::env::args().collect();

    // Daemon mode: `rg-fff --daemon <root>` (spawned detached by the client).
    if argv.get(1).map(|s| s == "--daemon").unwrap_or(false) {
        let root = argv.get(2).cloned().unwrap_or_else(|| ".".to_string());
        daemon::serve(&root);
        return;
    }

    let a0 = argv.first().cloned().unwrap_or_default();
    let tool = Tool::from_argv0(&a0);
    let raw: Vec<String> = argv[1..].to_vec();

    // --version / -V: impersonate the real tool exactly (re-exec embedded).
    if raw.iter().any(|a| a == "--version" || a == "-V") {
        let cb = claude_bin_from(&raw);
        fallback(tool, &strip_custom(&raw), cb.as_deref());
    }

    // find/bfs: fff find_files is a roadmap item; for now route to embedded bfs.
    if tool == Tool::Bfs {
        let cb = claude_bin_from(&raw);
        fallback(tool, &strip_custom(&raw), cb.as_deref());
    }

    let opts = parse(tool, raw);
    if eligible(&opts) {
        std::process::exit(run_search(&opts));
    }
    if opts.no_fallback {
        eprintln!("rg-fff: query is not fff-eligible and --no-fallback is set");
        std::process::exit(2);
    }
    fallback(
        opts.tool,
        &strip_custom(&opts.raw),
        opts.claude_bin.as_deref(),
    );
}

fn claude_bin_from(args: &[String]) -> Option<String> {
    args.iter()
        .find_map(|a| a.strip_prefix("--fff-claude-bin=").map(String::from))
}

/// Remove our private flags before re-execing the real embedded tool.
fn strip_custom(args: &[String]) -> Vec<String> {
    args.iter()
        .filter(|a| {
            *a != "--fuzzy"
                && *a != "--no-fallback"
                && *a != "--daemon"
                && !a.starts_with("--fff-claude-bin=")
        })
        .cloned()
        .collect()
}

/// Parse grep/ugrep/rg/fff argv into our decision struct. Conservative: anything
/// we don't confidently understand sets force_fallback so we defer to the real
/// tool rather than return a wrong result.
fn parse(tool: Tool, raw: Vec<String>) -> Opts {
    let mut o = Opts {
        tool,
        raw: raw.clone(),
        pattern: None,
        paths: Vec::new(),
        ignore_case: false,
        // grep emits PATH:LINE:TEXT only with -n; rg/fff default to line numbers.
        line_numbers: !matches!(tool, Tool::Ugrep),
        files_only: false,
        count: false,
        recursive: false,
        fuzzy: false,
        no_fallback: false,
        claude_bin: None,
        force_fallback: false,
    };
    let mut explicit_pattern: Option<String> = None;
    let mut positionals: Vec<String> = Vec::new();
    let mut i = 0;
    while i < raw.len() {
        let a = &raw[i];
        match a.as_str() {
            "--fuzzy" => o.fuzzy = true,
            "--no-fallback" => o.no_fallback = true,
            "-i" | "--ignore-case" => o.ignore_case = true,
            "-l" | "--files-with-matches" | "-L" | "--files-without-match" => {
                o.files_only = true;
                if a == "-L" || a == "--files-without-match" {
                    o.force_fallback = true; // inverse — fff can't do
                }
            }
            "-c" | "--count" => o.count = true,
            "-n" | "--line-number" => o.line_numbers = true,
            "-h" | "--no-filename" | "-H" | "--with-filename" | "--color"
            | "--color=never" | "--color=always" | "--color=auto" => {}
            "-r" | "-R" | "--recursive" | "--dereference-recursive" => {
                o.recursive = true
            }
            // CC-injected ugrep flags — fff already honors ignores/hidden/binary.
            "-G" | "--basic-regexp" | "--ignore-files" | "--hidden" | "-I"
            | "--no-ignore" | "--include-dir" => {}
            // capability gaps fff can't faithfully serve -> defer to real tool.
            "-P" | "--perl-regexp" | "-E" | "--extended-regexp" | "-o"
            | "--only-matching" | "-v" | "--invert-match" | "-x"
            | "--line-regexp" | "-w" | "--word-regexp" | "-z" | "--null-data"
            | "-U" | "--multiline" | "--multiline-dotall" | "-f" | "--file"
            | "-A" | "--after-context" | "-B" | "--before-context" | "-C"
            | "--context" | "-m" | "--max-count" | "-t" | "--type" => {
                o.force_fallback = true;
                // value-taking ones: skip their value too
                if matches!(
                    a.as_str(),
                    "-f" | "--file"
                        | "-A"
                        | "--after-context"
                        | "-B"
                        | "--before-context"
                        | "-C"
                        | "--context"
                        | "-m"
                        | "--max-count"
                        | "-t"
                        | "--type"
                ) {
                    i += 1;
                }
            }
            "-e" | "--regexp" | "--pattern" => {
                if i + 1 < raw.len() {
                    explicit_pattern = Some(raw[i + 1].clone());
                    i += 1;
                }
            }
            "--exclude-dir" | "--exclude" | "--include" | "-g" | "--glob" => {
                // value-taking; skip value. (exclude-dir is CC's VCS list, fine.)
                if i + 1 < raw.len() {
                    i += 1;
                }
            }
            other => {
                if let Some(cb) = other.strip_prefix("--fff-claude-bin=") {
                    o.claude_bin = Some(cb.to_string());
                } else if let Some(rest) = other.strip_prefix("--exclude-dir=") {
                    let _ = rest; // CC VCS excludes — fff handles ignores
                } else if other.starts_with("--exclude=")
                    || other.starts_with("--include=")
                {
                    o.force_fallback = true; // glob filters -> defer
                } else if other.starts_with("--color=") {
                    // cosmetic; ignore
                } else if let Some(combined) = other.strip_prefix('-') {
                    if combined.is_empty() {
                        positionals.push(other.to_string()); // lone "-" (stdin)
                        o.force_fallback = true;
                    } else if combined.starts_with('-') {
                        o.force_fallback = true; // unknown long flag -> be safe
                    } else {
                        // bundled short flags like -rn, -ri, -rln
                        for ch in combined.chars() {
                            match ch {
                                'i' => o.ignore_case = true,
                                'n' => o.line_numbers = true,
                                'l' => o.files_only = true,
                                'c' => o.count = true,
                                'r' | 'R' => o.recursive = true,
                                'H' | 'h' | 'I' | 'G' => {}
                                _ => o.force_fallback = true,
                            }
                        }
                    }
                } else {
                    positionals.push(other.to_string());
                }
            }
        }
        i += 1;
    }

    if let Some(p) = explicit_pattern {
        o.pattern = Some(p);
        o.paths = positionals;
    } else if !positionals.is_empty() {
        o.pattern = Some(positionals.remove(0));
        o.paths = positionals;
    }
    o
}

/// fff serves a query only when its result is faithfully tool-equivalent.
fn eligible(o: &Opts) -> bool {
    if o.force_fallback {
        return false;
    }
    let pat = match &o.pattern {
        Some(p) if !p.is_empty() => p,
        _ => return false,
    };
    // Explicit fuzzy always serves; otherwise require plain literal ASCII.
    if !o.fuzzy {
        if has_regex_meta(pat, o.tool) {
            return false; // genuinely regex for this tool -> let it do it
        }
        if pat.chars().count() < 3 {
            return false; // bigram prefilter unreliable on sub-3-char
        }
    }
    if !pat.is_ascii() {
        return false;
    }
    // fff's query DSL reinterprets these as operators (whitespace = multiple
    // terms, '/' = path constraint, ':' = line:col location, '!' = negation),
    // which silently diverges from a literal grep. Only DSL-safe single tokens go
    // to fff (verified safe: foo(), kebab-case, <T>); everything else defers.
    // Applies to fuzzy too — the fuzzy query runs through the same parser.
    if pat.chars().any(|c| matches!(c, ' ' | '\t' | '/' | ':' | '!')) {
        return false;
    }
    if o.ignore_case {
        // fff emulates case-insensitivity via smart_case, which only ignores
        // case when the pattern has no uppercase. So `-i` is byte-equivalent to
        // the real tool only for an all-lowercase pattern; otherwise defer.
        if pat.chars().any(|c| c.is_ascii_uppercase()) {
            return false;
        }
    }
    // fff always searches the whole tree. grep/ugrep do that ONLY with -r/-R
    // (without it: stdin for no path, or the top-level dir only) — so for the
    // ugrep shadow, require -r or we'd over-match. rg/fff recurse by default, so
    // no -r is needed there. (Fuzzy is fff-only discovery, so -r is moot.)
    if !o.fuzzy && o.tool == Tool::Ugrep && !o.recursive {
        return false;
    }
    // path target: cwd (no path) or a single dir. A single file or multiple
    // paths -> defer (grep/ugrep handle those precisely; fff is tree-oriented).
    match o.paths.len() {
        0 => true,
        1 => {
            let p = &o.paths[0];
            // The query builder turns the dir into a path constraint, so it must
            // itself be DSL-safe ('/' is fine — it IS a path; whitespace/':'/'!'
            // would misparse).
            Path::new(p).is_dir()
                && !p.chars().any(|c| matches!(c, ' ' | '\t' | ':' | '!'))
        }
        _ => false,
    }
}

/// Does `t` contain a regex metacharacter *for the tool being impersonated*?
/// ugrep runs in basic-regex mode (`-G`/BRE): only `. * [ ] ^ $ \` are special;
/// `+ ? ( ) { } |` (and `- # & ~ _`) are LITERAL — so `foo()`, `foo-bar`,
/// `a|b` are plain literals fff can serve identically. rg/fff use ERE where
/// `+ ? ( ) { } |` are also special, so those defer. Matching the tool keeps
/// fff strictly result-equivalent while serving far more real queries.
fn has_regex_meta(t: &str, tool: Tool) -> bool {
    let ere = matches!(tool, Tool::Rg | Tool::Fff);
    t.chars().any(|c| match c {
        '\\' | '.' | '*' | '[' | ']' | '^' | '$' => true,
        '+' | '?' | '(' | ')' | '{' | '}' | '|' => ere,
        _ => false,
    })
}

impl Opts {
    fn to_req(&self) -> SearchReq {
        SearchReq {
            pattern: self.pattern.clone().unwrap_or_default(),
            dir: self.paths.first().cloned(),
            line_numbers: self.line_numbers,
            files_only: self.files_only,
            count: self.count,
            fuzzy: self.fuzzy,
            ignore_case: self.ignore_case,
        }
    }
}

/// Run an fff-eligible search: try the warm daemon first; on a miss, cold-scan
/// and lazily spawn a daemon for next time. Returns the process exit code.
fn run_search(o: &Opts) -> i32 {
    let req = o.to_req();
    let daemon_enabled = std::env::var_os("RG_FFF_NO_DAEMON").is_none();
    let root = std::env::current_dir()
        .ok()
        .and_then(|c| std::fs::canonicalize(c).ok());

    if daemon_enabled {
        if let Some(root) = &root {
            if let Some((out, code)) = daemon::query(root, &req) {
                if std::env::var_os("RG_FFF_DEBUG").is_some() {
                    eprintln!("rg-fff: daemon hit");
                }
                let mut w = std::io::stdout().lock();
                let _ = w.write_all(out.as_bytes());
                let _ = w.flush();
                return code;
            }
        }
    }
    if std::env::var_os("RG_FFF_DEBUG").is_some() {
        eprintln!("rg-fff: cold scan");
    }

    // Cold scan.
    let shared = SharedFilePicker::default();
    let frecency = SharedFrecency::default();
    if FilePicker::new_with_shared_state(
        shared.clone(),
        frecency.clone(),
        FilePickerOptions {
            base_path: ".".into(),
            mode: FFFMode::Ai,
            ..Default::default()
        },
    )
    .is_err()
    {
        if o.no_fallback {
            std::process::exit(2);
        }
        fallback(o.tool, &strip_custom(&o.raw), o.claude_bin.as_deref());
    }
    shared.wait_for_scan(Duration::from_secs(15));
    {
        let guard = match shared.read() {
            Ok(g) => g,
            Err(_) => {
                fallback(o.tool, &strip_custom(&o.raw), o.claude_bin.as_deref())
            }
        };
        let picker = match guard.as_ref() {
            Some(p) => p,
            None => {
                fallback(o.tool, &strip_custom(&o.raw), o.claude_bin.as_deref())
            }
        };
        let (out, code) = format_results(picker, &req);
        let mut w = std::io::stdout().lock();
        let _ = w.write_all(out.as_bytes());
        let _ = w.flush();
        // Warm a daemon for the next search in this root.
        if daemon_enabled {
            if let Some(root) = &root {
                daemon::spawn_detached(root);
            }
        }
        code
    }
}

/// Grep `picker` per `req` and render tool-compatible output. Shared verbatim by
/// the cold path and the daemon so both produce byte-identical results.
pub fn format_results(picker: &FilePicker, req: &SearchReq) -> (String, i32) {
    let mode = if req.fuzzy {
        GrepMode::Fuzzy
    } else {
        GrepMode::PlainText
    };

    // A dir path becomes a query constraint so emitted paths stay cwd-relative
    // (matching `grep -r <dir>` output).
    let mut query = String::new();
    if let Some(dir) = &req.dir {
        let d = dir.trim_end_matches('/');
        if !d.is_empty() && d != "." {
            query.push_str(d);
            query.push('/');
            query.push(' ');
        }
    }
    query.push_str(&req.pattern);
    let parser = QueryParser::new(AiGrepConfig);
    let parsed = parser.parse(&query);

    let mut out = String::new();
    if req.fuzzy {
        let _ = writeln!(
            out,
            "# fff: approximate (fuzzy) matches, ranked by relevance — not exact"
        );
    }

    if req.count {
        let mut counts: BTreeMap<String, usize> = BTreeMap::new();
        let mut file_offset = 0usize;
        loop {
            let opts = grep_opts(mode, file_offset, false, req.ignore_case);
            let r = picker.grep(&parsed, &opts);
            for m in &r.matches {
                let f = r.files[m.file_index];
                *counts.entry(f.relative_path(picker)).or_insert(0) += 1;
            }
            if r.next_file_offset == 0 {
                break;
            }
            file_offset = r.next_file_offset;
        }
        let any = !counts.is_empty();
        for (f, c) in &counts {
            let _ = writeln!(out, "{f}:{c}");
        }
        return (out, if any { 0 } else { 1 });
    }

    let mut any = false;
    let mut file_offset = 0usize;
    loop {
        let opts =
            grep_opts(mode, file_offset, req.files_only, req.ignore_case);
        let result = picker.grep(&parsed, &opts);
        if req.files_only {
            for f in &result.files {
                let _ = writeln!(out, "{}", f.relative_path(picker));
                any = true;
            }
        } else {
            for m in &result.matches {
                let f = result.files[m.file_index];
                if req.line_numbers {
                    let _ = writeln!(
                        out,
                        "{}:{}:{}",
                        f.relative_path(picker),
                        m.line_number,
                        m.line_content
                    );
                } else {
                    let _ = writeln!(
                        out,
                        "{}:{}",
                        f.relative_path(picker),
                        m.line_content
                    );
                }
                any = true;
            }
        }
        if req.fuzzy || result.next_file_offset == 0 {
            break;
        }
        file_offset = result.next_file_offset;
    }
    (out, if any { 0 } else { 1 })
}

fn grep_opts(
    mode: GrepMode,
    file_offset: usize,
    files_only: bool,
    smart_case: bool,
) -> GrepSearchOptions {
    GrepSearchOptions {
        max_file_size: 10 * 1024 * 1024,
        max_matches_per_file: if files_only { 1 } else { 1_000_000 },
        smart_case,
        file_offset,
        page_limit: 1_000_000,
        mode,
        time_budget_ms: 0,
        before_context: 0,
        after_context: 0,
        classify_definitions: false,
        trim_whitespace: false,
        abort_signal: None,
    }
}

/// Re-exec the real embedded tool via the claude binary (argv0 multicall).
/// Never returns.
fn fallback(tool: Tool, args: &[String], claude_bin: Option<&str>) -> ! {
    use std::os::unix::process::CommandExt;

    let claude = claude_bin
        .map(String::from)
        .filter(|p| Path::new(p).exists())
        .or_else(|| {
            std::env::var("CLAUDE_CODE_EXECPATH")
                .ok()
                .filter(|p| Path::new(p).exists())
        })
        .or_else(|| {
            let h = std::env::var("HOME").ok()?;
            let p = format!("{h}/.local/bin/claude");
            Path::new(&p).exists().then_some(p)
        });

    let a0 = tool.embedded_argv0();
    if let Some(bin) = claude {
        let mut cmd = Command::new(&bin);
        // embedded ripgrep expects --no-config; ugrep/bfs take args as-is.
        if tool == Tool::Rg && !args.iter().any(|a| a == "--no-config") {
            cmd.arg("--no-config");
        }
        cmd.args(args);
        cmd.arg0(a0);
        let err = cmd.exec();
        eprintln!("rg-fff: failed to exec embedded {a0}: {err}");
    }
    // last resort: the system tool on PATH
    let sys = match tool {
        Tool::Bfs => "find",
        Tool::Ugrep => "grep",
        _ => "rg",
    };
    let err = Command::new(sys).args(args).exec();
    eprintln!("rg-fff: failed to exec {sys}: {err}");
    std::process::exit(2);
}
