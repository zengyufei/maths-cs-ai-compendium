import assert from "node:assert/strict";
import test from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { contentRoot, extractKeywords, getChapters, getSections, parseLlmsTxt, recommendSections } from "./content.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("completed Chinese chapters expose matching English section numbers", async () => {
  const [english, chinese] = await Promise.all([getChapters(root, "en"), getChapters(root, "zh")]);
  for (const chineseChapter of chinese) {
    const chapter = english.find((item) => item.number === chineseChapter.number);
    assert.ok(chapter);
    const [englishSections, chineseSections] = await Promise.all([getSections(chapter.path), getSections(chineseChapter.path)]);
    for (const chineseSection of chineseSections) {
      assert.ok(englishSections.some((section) => section.number === chineseSection.number));
    }
  }
});

test("Chinese recommendation keywords include searchable CJK n-grams", () => {
  const keywords = extractKeywords("我想理解向量空间", "zh");
  assert.ok(keywords.includes("向量空间"));
  assert.ok(keywords.includes("空间"));
});

test("Chinese recommendation index is parsed and searchable", async () => {
  assert.equal(contentRoot(root, "zh"), join(root, "zh"));
  const matches = recommendSections(await parseLlmsTxt(root, "zh"), "向量空间", "zh");
  assert.ok(matches.some((section) => section.chapter === 1));
});

test("English remains at the repository root and is searchable", async () => {
  assert.equal(contentRoot(root, "en"), root);
  const matches = recommendSections(await parseLlmsTxt(root, "en"), "vector spaces", "en");
  assert.ok(matches.some((section) => section.chapter === 1));
});
