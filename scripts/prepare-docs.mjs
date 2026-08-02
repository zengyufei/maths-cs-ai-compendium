import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const docsRoot = join(root, "docs");

async function copy(source, destination) {
  await cp(join(root, source), join(docsRoot, destination), {
    recursive: true,
    force: true,
  });
}

async function prepareEnglish() {
  const target = "en";
  await mkdir(join(docsRoot, target), { recursive: true });
  await writeFile(
    join(docsRoot, target, "index.md"),
    await readFile(join(root, "README.md")),
  );

  for (let chapter = 1; chapter <= 20; chapter++) {
    const prefix = `chapter ${String(chapter).padStart(2, "0")} - `;
    const { readdir } = await import("node:fs/promises");
    const directories = await readdir(root, { withFileTypes: true });
    const source = directories.find((entry) => entry.isDirectory() && entry.name.startsWith(prefix));
    if (!source) throw new Error(`Missing English chapter directory: ${prefix}`);
    await copy(source.name, join(target, source.name));
  }

  await copy("images", join(target, "images"));
  await copy("javascripts", join(target, "javascripts"));
  await copy("stylesheets", join(target, "stylesheets"));
}

async function prepareChinese() {
  await copy("zh", "zh");
  await copy("javascripts", join("zh", "javascripts"));
  await copy("stylesheets", join("zh", "stylesheets"));
}

await rm(docsRoot, { recursive: true, force: true });
await prepareEnglish();
await prepareChinese();
