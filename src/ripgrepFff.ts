import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { CONFIG_DIR } from './config';

const FETCH_TIMEOUT_MS = 30_000;

/**
 * Map the running platform/arch to the Rust target triple we publish a
 * `rg-fff` binary for. Returns null on unsupported platforms (patch no-ops).
 */
export function getFffTriple(): string | null {
  const { platform, arch } = process;
  if (platform === 'darwin' && arch === 'arm64') return 'aarch64-apple-darwin';
  if (platform === 'darwin' && arch === 'x64') return 'x86_64-apple-darwin';
  if (platform === 'linux' && arch === 'arm64')
    return 'aarch64-unknown-linux-musl';
  if (platform === 'linux' && arch === 'x64')
    return 'x86_64-unknown-linux-musl';
  return null;
}

/** Walk up from this module to the repo root (the dir with package.json). */
function findRepoRoot(): { root: string; version: string } | null {
  try {
    let dir = path.dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 6; i++) {
      const pkg = path.join(dir, 'package.json');
      if (fsSync.existsSync(pkg)) {
        try {
          const v = JSON.parse(fsSync.readFileSync(pkg, 'utf-8')).version;
          if (typeof v === 'string') return { root: dir, version: v };
        } catch {
          /* keep walking */
        }
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    /* import.meta.url unavailable */
  }
  return null;
}

async function isExecutable(p: string): Promise<boolean> {
  try {
    await fs.access(p, fsSync.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function install(src: string, dest: string): Promise<void> {
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.copyFile(src, dest);
  await fs.chmod(dest, 0o755);
}

/**
 * Ensure the `rg-fff` wrapper exists for this platform and return its absolute
 * path, or null if unavailable (caller then keeps ripgrep — never half-applies).
 *
 * Resolution order, mirroring downloadStringsFile:
 *   1. already installed at ~/.tweakcc/fff/<triple>/rg-fff
 *   2. repo-local build (checkout dev: tools/rg-fff/target/{release,debug}/rg-fff)
 *   3. GitHub release asset rg-fff-<triple> (+ .sha256), for npx installs
 */
export async function ensureRgFffWrapper(): Promise<string | null> {
  const triple = getFffTriple();
  if (!triple) return null;

  // Computed lazily (not at module top-level) so test files that vi.mock
  // './config' don't trip over an undefined CONFIG_DIR during mock hoisting.
  const dest = path.join(CONFIG_DIR, 'fff', triple, 'rg-fff');
  if (await isExecutable(dest)) return dest;

  // 2. Repo-local build (developing from the checkout).
  const repo = findRepoRoot();
  if (repo) {
    for (const profile of ['release', 'debug']) {
      const local = path.join(
        repo.root,
        'tools',
        'rg-fff',
        'target',
        profile,
        'rg-fff'
      );
      if (fsSync.existsSync(local)) {
        await install(local, dest);
        return dest;
      }
    }
  }

  // 3. GitHub release asset (published builds).
  const version = repo?.version;
  if (!version) return null;
  const base = `https://github.com/skrabe/tweakcc-fixed/releases/download/v${version}`;
  try {
    const binResp = await fetch(`${base}/rg-fff-${triple}`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!binResp.ok) return null;
    const bin = Buffer.from(await binResp.arrayBuffer());

    // Verify SHA256 against the published .sha256 (first whitespace-delimited token).
    const shaResp = await fetch(`${base}/rg-fff-${triple}.sha256`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (shaResp.ok) {
      const want = (await shaResp.text()).trim().split(/\s+/)[0]?.toLowerCase();
      const got = crypto.createHash('sha256').update(bin).digest('hex');
      if (want && want !== got) {
        console.error(
          `patch: swap-ripgrep-for-fff: rg-fff-${triple} checksum mismatch — keeping ripgrep`
        );
        return null;
      }
    }

    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, bin);
    await fs.chmod(dest, 0o755);
    return dest;
  } catch {
    return null;
  }
}
