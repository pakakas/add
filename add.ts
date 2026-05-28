import { join, dirname, basename, resolve } from "node:path";
import { existsSync, mkdirSync, writeFileSync, unlinkSync, readFileSync, rmSync } from "node:fs";
import { spawn } from "bun";
import { encode as encodeMacro } from "../src/pap.ts" with { type: 'macro' };
import { mergeHelp } from "../src/help.ts" with { type: 'macro' };
import { encode, decode } from "../src/pap.ts";

const papHelp = encodeMacro(mergeHelp({
  usage: "add <src> [dest] [options]",
  command_desc: "Scaffold tools or projects with MarkZero directives",
  flag: ["--source", "--dev", "-f", "-i", "--ascii"],
  desc: [
    "Download clean source (removes .git)",
    "Download for development (keeps .git)",
    "Force overwrite existing directory",
    "Interactive tool selection",
    "Display formatted output"
  ]
}));

export function help(decoder?: (pap: string) => void) {
  if (decoder) decoder(papHelp);
  else process.stdout.write(papHelp + '\n');
}

type RepoInfo = {
    site: string;
    user: string;
    name: string;
    ref: string;
    subdir: string | null;
    url: string;
};

/**
 * Parses source string into structured repo info.
 */
function parseSrc(src: string): RepoInfo {
    const match = /^(?:(?:https:\/\/)?([^/]+\.[^:/]+)\/|git@([^:/]+)[:/]|([^/]+):)?([^/\s]+)\/([^/\s#]+)(?:((?:\/[^/\s#]+)+))?(?:\/)?(?:#(.+))?/.exec(src);
    if (!match) throw new Error(`Could not parse source: ${src}`);

    const site = match[1] || match[2] || match[3] || 'github.com';
    const user = match[4];
    const name = match[5].replace(/\.git$/, '');
    const subdir = match[6] || null;
    const ref = match[7] || 'main';

    const url = `https://${site}/${user}/${name}`;
    return { site, user, name, ref, subdir, url };
}

/**
 * Handles directives from pakakas.json (MARKZERO format).
 */
async function runDirectives(dest: string): Promise<any[]> {
    const configPath = join(dest, "ⓟ.mz");
    if (!existsSync(configPath)) return [];

    const logs: any[] = [];
    try {
        const rawMz = readFileSync(configPath, "utf-8").trim();
        // Decode MarkZero directives
        const blocks = decode(rawMz);
        
        // Directives are expected to be a Grid/Set of actions
        for (const block of blocks) {
            if (Array.isArray(block)) {
                for (const item of block) {
                    if (item.action === "remove") {
                        const files = Array.isArray(item.files) ? item.files : [item.files];
                        for (const file of files) {
                            const filePath = resolve(dest, file);
                            if (existsSync(filePath)) {
                                rmSync(filePath, { recursive: true, force: true });
                                logs.push({ action: "remove", target: file, status: "DONE" });
                            }
                        }
                    }
                }
            }
        }
        unlinkSync(configPath);
    } catch (e) {
        logs.push({ action: "directives", status: "FAILED", error: (e as Error).message });
    }
    return logs;
}

async function downloadBinary(tool: string): Promise<Uint8Array | null> {
    const urls = [
        `https://unpkg.com/@pakakas/${tool}/ⓟ.js`,
        `https://raw.githubusercontent.com/pakakas/${tool}/main/ⓟ.js`
    ];
    for (const url of urls) {
        try {
            const res = await fetch(url);
            if (res.ok) return new Uint8Array(await res.arrayBuffer());
        } catch (e) {}
    }
    return null;
}

async function fetchTarball(repo: RepoInfo, dest: string): Promise<boolean> {
    const tarUrl = `${repo.url}/archive/refs/heads/${repo.ref}.tar.gz`;
    const tempFile = join(dest, `temp-${Date.now()}.tar.gz`);

    try {
        if (!existsSync(dest)) mkdirSync(dest, { recursive: true });
        const res = await fetch(tarUrl);
        if (!res.ok) return false;

        await Bun.write(tempFile, await res.arrayBuffer());

        const strip = 1 + (repo.subdir ? repo.subdir.split('/').filter(Boolean).length : 0);
        const tarArgs = ["-xzf", tempFile, `--strip-components=${strip}`, "-C", dest];
        if (repo.subdir) {
            const internalPath = `${repo.name}-${repo.ref}${repo.subdir.startsWith('/') ? '' : '/'}${repo.subdir}`;
            tarArgs.push(internalPath);
        }

        const proc = spawn(["tar", ...tarArgs]);
        await proc.exited;
        unlinkSync(tempFile);
        return proc.exitCode === 0;
    } catch (e) {
        if (existsSync(tempFile)) unlinkSync(tempFile);
        return false;
    }
}

export async function run(args: string[], decoder?: (pap: string) => void) {
  const isHumanHelp = args.includes('--h') || args.includes('--ha') || args.includes('--ah') || args.includes('-hasci') || args.includes('-hascii') || args.includes('--hasci') || args.includes('--hascii');

  if (args.includes('--help') || args.includes('-h') || isHumanHelp) {
    if (isHumanHelp && !decoder) {
      const { mark0ToAscii } = await import('../.internal/pakakas-konsep/markzero-ascii.ts');
      help(mark0ToAscii);
    } else {
      help(decoder);
    }
    return;
  }

  const flags = {
      source: args.includes("--source"),
      dev: args.includes("--dev"),
      force: args.includes("-f") || args.includes("--force"),
      interactive: args.includes("-i"),
      ascii: args.includes("--ascii") || args.includes("--a") || isHumanHelp
  };

  const positional = args.filter(a => !a.startsWith("-"));
  if (positional.length === 0 && !flags.interactive) {
      help();
      return;
  }

  const src = positional[0];
  const dest = positional[1] || (src ? basename(src.split('#')[0]!.split('/')[0] === src ? src : src.split('/')[1]!) : ".");
  const results: any[] = [];

  const performInstall = async (sourceStr: string, targetDir: string) => {
      const targetPath = resolve(process.cwd(), targetDir);
      
      if (existsSync(targetPath) && !flags.force) {
          throw new Error(`Directory not empty. Use -f to override.`);
      }

      let mode = "binary";
      let logPayload: any[] = [];

      if (!sourceStr.includes("/") && !flags.source && !flags.dev) {
          console.log(`📦 Downloading binary for ${sourceStr}...`);
          const data = await downloadBinary(sourceStr);
          if (data) {
              if (!existsSync(targetPath)) mkdirSync(targetPath, { recursive: true });
              writeFileSync(join(targetPath, "ⓟ.js"), data);
          } else {
              // fallback to source
              flags.source = true;
          }
      }

      if (flags.dev) {
          console.log(`🛠️ Cloning ${sourceStr} for development...`);
          const repo = sourceStr.includes("/") ? sourceStr : `pakakas/${sourceStr}`;
          const url = repo.startsWith("git@") ? repo : `git@github.com:${repo}.git`;
          const proc = spawn(["git", "clone", "--depth", "1", url, targetPath], { stdout: "inherit", stderr: "inherit" });
          await proc.exited;
          if (proc.exitCode !== 0) throw new Error("Git clone failed.");
          mode = "dev";
      } else if (flags.source) {
          console.log(`🌿 Scavenging ${sourceStr}...`);
          const repoPath = sourceStr.includes("/") ? sourceStr : `pakakas/${sourceStr}`;
          const info = parseSrc(repoPath);
          const success = await fetchTarball(info, targetPath);
          if (!success) throw new Error("Extraction failed.");

          // Run MarkZero Directives
          logPayload = await runDirectives(targetPath);
          mode = "source";
      }

      // Save Metadata
      writeFileSync(join(targetPath, "ⓟ.json"), JSON.stringify({
          tool: sourceStr,
          mode,
          installed_at: new Date().toISOString()
      }, null, 2));

      return { tool: sourceStr, mode, status: "INSTALLED", directives: logPayload.length > 0 ? logPayload : "NONE" };
  };

  try {
      const res = await performInstall(src, dest);
      results.push(res);
  } catch (e) {
      results.push({ tool: src, status: "FAILED", error: (e as Error).message });
  }

  if (results.length > 0) {
      const papData = encode([results]);
      if (flags.ascii && !decoder) console.table(results);
      else if (decoder) decoder(papData);
      else process.stdout.write(papData + '\n');
  }
}

if (import.meta.main) {
  run(process.argv.slice(2));
}
