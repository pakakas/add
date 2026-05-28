import { join } from "node:path";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { encode as encodeMacro } from "../src/pap.ts" with { type: 'macro' };
import { mergeHelp } from "../src/help.ts" with { type: 'macro' };
import { encode } from "../src/pap.ts";

const papHelp = encodeMacro(mergeHelp({
  usage: "add <tool> [options]",
  command_desc: "Download and install Pakakas tools",
  flag: ["--source", "-i", "--ascii"],
  desc: [
    "Download TypeScript source instead of binary",
    "Interactive mode with checklist",
    "Display formatted output"
  ]
}));

export function help(decoder?: (pap: string) => void) {
  if (decoder) decoder(papHelp);
  else process.stdout.write(papHelp + '\n');
}

const OFFICIAL_TOOLS = ["ls", "cat", "grep", "head", "tail", "wc", "cut", "dirname", "which", "rm", "lnwd", "unzip", "xargs", "timeout", "at", "sed", "psql", "powershell", "token-counter", "bun-link-g", "pakakasb", "gh"];

async function downloadFile(tool: string, fileName: string): Promise<Uint8Array | null> {
    const urls = [
        `https://unpkg.com/@pakakas/${tool}/${fileName}`,
        `https://raw.githubusercontent.com/pakakas/${tool}/main/${fileName}`
    ];

    for (const url of urls) {
        try {
            console.log(`🔍 Trying ${url}...`);
            const res = await fetch(url);
            if (res.ok) {
                console.log(`✅ Found at ${url}`);
                return new Uint8Array(await res.arrayBuffer());
            }
        } catch (e) {}
    }
    return null;
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
  const isInteractive = args.includes("-i");
  const isAscii = args.includes("--ascii") || args.includes("--a") || isHumanHelp;

  const toolsToInstall: string[] = args.filter(a => !a.startsWith("-"));

  if (isInteractive) {
      // In a real agent environment, we would use ask_user here.
      // For now, let's assume the user wants everything if no tools specified.
      console.log("Interactive mode not fully implemented in CLI yet. Use 'add <tool>' for now.");
      return;
  }

  if (toolsToInstall.length === 0) {
      help();
      return;
  }

  const results: any[] = [];

  for (const tool of toolsToInstall) {
    try {
        const fileName = isSource ? `${tool}.ts` : "ⓟ.js";
        console.log(`Box Installing ${tool} (${fileName})...`);
        
        const data = await downloadFile(tool, fileName);
        if (!data) throw new Error(`Could not find ${fileName} for tool '${tool}' on NPM or GitHub.`);

        const toolDir = join(process.cwd(), tool);
        if (!existsSync(toolDir)) mkdirSync(toolDir);

        const targetPath = join(toolDir, fileName);
        writeFileSync(targetPath, data);

        // Also try to download package.json if in source mode
        if (isSource) {
            const pkgData = await downloadFile(tool, "package.json");
            if (pkgData) writeFileSync(join(toolDir, "package.json"), pkgData);
        }

        results.push({ tool, file: fileName, status: "INSTALLED" });
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
