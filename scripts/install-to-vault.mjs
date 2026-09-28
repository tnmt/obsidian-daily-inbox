import { cp, mkdir, access } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";

const vaultFlag = process.argv.indexOf("--vault");
const vault = vaultFlag >= 0 ? process.argv[vaultFlag + 1] : process.env.OBSIDIAN_VAULT;
if (!vault) {
  console.error("Usage: pnpm dev:install --vault /path/to/vault");
  console.error("Or set OBSIDIAN_VAULT to a local Vault path.");
  process.exit(1);
}
const vaultPath = resolve(vault);
await access(vaultPath);
await access(resolve(vaultPath, ".obsidian"));
await access("main.js");
await access("manifest.json");
await access("styles.css");
const target = resolve(vaultPath, ".obsidian", "plugins", "daily-inbox");
await mkdir(target, { recursive: true });
await Promise.all([
  cp("main.js", resolve(target, "main.js")),
  cp("manifest.json", resolve(target, "manifest.json")),
  cp("styles.css", resolve(target, "styles.css")),
]);
console.log(`Installed Daily Inbox into ${target}`);
