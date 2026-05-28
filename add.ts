import { join } from "node:path";
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { spawn } from "bun";
import { encode as encodeMacro } from "../src/pap.ts" with { type: 'macro' };
import { mergeHelp } from "../src/help.ts" with { type: 'macro' };
import { encode } from "../src/pap.ts";

const papHelp = encodeMacro(mergeHelp({
  usage: "add <tool> [options]",
  command_desc: "Download and install Pakakas tools",
  flag: ["--source", "--dev", "-i", "--ascii"],
  desc: [
    "Download clean source code (degit style, removes .git)",
    "Download for development (git clone, keeps .git)",
    "Interactive mode with checklist",
    "Display formatted output"
  ]
}));

export function help(decoder?: (pap: string) => void) {
  if (decoder) decoder(papHelp);
  else process.stdout.write(papHelp + '\n');
}

/**
 * Downloads a single binary file.
 */
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

/**
 * Downloads and extracts source code using tarball (Mini-Degit style).
 */
async function downloadSource(tool: string, dest: string): Promise<boolean> {
    const tarUrl = `https://github.com/pakakas/${tool}/archive/refs/heads/main.tar.gz`;
    const tempFile = join(dest, `${tool}.tar.gz`);

    try {
        if (!existsSync(dest)) mkdirSync(dest, { recursive: true });

        const res = await fetch(tarUrl);
        if (!res.ok) return false;

        const buffer = await res.arrayBuffer();
        writeFileSync(tempFile, new Uint8Array(buffer));

        const proc = spawn(["tar", "-xzf", tempFile, "--strip-components=1", "-C", dest]);
        await proc.exited;
        
        unlinkSync(tempFile);
        return proc.exitCode === 0;
    } catch (e) {
        if (existsSync(tempFile)) unlinkSync(tempFile);
        return false;
    }
}

/**
 * Clones repository for development (keeps .git).
 */
async function cloneDev(tool: string, dest: string): Promise<boolean> {
    const url = `git@github.com:pakakas/${tool}.git`;
    try {
        const proc = spawn(["git", "clone", "--depth", "1", url, dest], { stdout: "inherit", stderr: "inherit" });
        await proc.exited;
        return proc.exitCode === 0;
    } catch (e) {
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

  const isSource = args.includes("--source");
  const isDev = args.includes("--dev");
  const isInteractive = args.includes("-i");
  const isAscii = args.includes("--ascii") || args.includes('--a') || isHumanHelp;

  const toolsToInstall: string[] = args.filter(a => !a.startsWith("-"));

  if (isInteractive) {
      console.log("Interactive mode not fully implemented. Use 'add <tool>' for now.");
      return;
  }

  if (toolsToInstall.length === 0) {
      help();
      return;
  }

  const results: any[] = [];

  for (const tool of toolsToInstall) {
    const toolDir = join(process.cwd(), tool);
    if (existsSync(toolDir)) {
        console.warn(`⚠️ Tool '${tool}' already exists. Skipping.`);
        results.push({ tool, status: "SKIPPED", error: "Already exists" });
        continue;
    }

    try {
        let mode = "binary";
        if (isDev) {
            console.log(`🛠️ Cloning development source for ${tool}...`);
            const success = await cloneDev(tool, toolDir);
            if (!success) throw new Error(`Failed to clone via SSH.`);
            mode = "dev";
        } else if (isSource) {
            console.log(`🌿 Scavenging source for ${tool}...`);
            const success = await downloadSource(tool, toolDir);
            if (!success) throw new Error(`Failed to download source via tarball.`);
            mode = "source";
        } else {
            console.log(`📦 Downloading binary for ${tool}...`);
            const data = await downloadBinary(tool);
            if (!data) throw new Error(`Could not find binary on NPM or GitHub.`);
            
            mkdirSync(toolDir, { recursive: true });
            writeFileSync(join(toolDir, "ⓟ.js"), data);
        }

        // Save Metadata
        writeFileSync(join(toolDir, "ⓟ.json"), JSON.stringify({
            tool,
            mode,
            installed_at: new Date().toISOString()
        }, null, 2));

        results.push({ tool, mode, status: "INSTALLED" });
    } catch (e) {
        results.push({ tool, status: "FAILED", error: (e as Error).message });
    }
  }

  if (results.length > 0) {
      const papData = encode([results]);
      if (isAscii && !decoder) console.table(results);
      else if (decoder) decoder(papData);
      else process.stdout.write(papData + '\n');
  }
}

if (import.meta.main) {
  run(process.argv.slice(2));
}
