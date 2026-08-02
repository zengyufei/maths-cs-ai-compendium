import { rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const root = process.cwd();
const mkdocs = process.platform === "win32" ? "mkdocs.exe" : "mkdocs";

function run(args) {
  const result = spawnSync(mkdocs, args, { cwd: root, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

await rm(join(root, "site"), { recursive: true, force: true });
const prepare = spawnSync("node", ["scripts/prepare-docs.mjs"], { cwd: root, stdio: "inherit" });
if (prepare.status !== 0) process.exit(prepare.status ?? 1);
run(["build", "--strict", "--config-file", "mkdocs.yml", "--site-dir", "site"]);
run(["build", "--strict", "--config-file", "mkdocs.zh.yml", "--site-dir", "site/zh"]);
