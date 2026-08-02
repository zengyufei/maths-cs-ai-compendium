import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export const LOCALES = ["en", "zh"] as const;
export type Locale = (typeof LOCALES)[number];

const CHAPTER_RE = /^chapter (\d{2})(?:\:| -) (.+)$/;
const SECTION_RE = /^(\d{2})\. (.+)\.md$/;

export interface Chapter {
  number: number;
  name: string;
  path: string;
}

export interface Section {
  number: number;
  name: string;
  path: string;
}

export interface SectionMeta {
  chapter: number;
  chapterName: string;
  section: number;
  sectionName: string;
  description: string;
}

export function contentRoot(root: string, locale: Locale): string {
  return locale === "zh" ? join(root, "zh") : root;
}

export async function getChapters(root: string, locale: Locale): Promise<Chapter[]> {
  const base = contentRoot(root, locale);
  const entries = await readdir(base);
  return entries
    .map((entry) => {
      const match = entry.match(CHAPTER_RE);
      if (!match) return null;
      return { number: parseInt(match[1], 10), name: match[2], path: join(base, entry) };
    })
    .filter((chapter): chapter is Chapter => chapter !== null)
    .sort((a, b) => a.number - b.number);
}

export async function getSections(chapterPath: string): Promise<Section[]> {
  const entries = await readdir(chapterPath);
  return entries
    .map((entry) => {
      const match = entry.match(SECTION_RE);
      if (!match) return null;
      return { number: parseInt(match[1], 10), name: match[2], path: join(chapterPath, entry) };
    })
    .filter((section): section is Section => section !== null)
    .sort((a, b) => a.number - b.number);
}

export async function parseLlmsTxt(root: string, locale: Locale): Promise<SectionMeta[]> {
  const content = await readFile(join(contentRoot(root, locale), "llms.txt"), "utf-8");
  const results: SectionMeta[] = [];
  let currentChapter = 0;
  let currentChapterName = "";

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trimEnd();
    const chapterMatch = line.match(/^### (?:Chapter|第)\s*(\d+)\s*(?:章)?\s*[:：]\s*(.+)$/);
    if (chapterMatch) {
      currentChapter = parseInt(chapterMatch[1], 10);
      currentChapterName = chapterMatch[2];
      continue;
    }

    const sectionMatch = line.match(/^- \[(.+?)\]\(.+?\)\s*[:：]\s*(.+)$/);
    if (sectionMatch && currentChapter > 0) {
      results.push({
        chapter: currentChapter,
        chapterName: currentChapterName,
        section: results.filter((result) => result.chapter === currentChapter).length + 1,
        sectionName: sectionMatch[1],
        description: sectionMatch[2],
      });
    }
  }
  return results;
}

const ENGLISH_STOP_WORDS = new Set([
  "the", "and", "for", "are", "but", "not", "you", "all", "can", "had", "her", "was", "one",
  "our", "out", "has", "how", "its", "may", "who", "did", "get", "got", "let", "say", "she",
  "too", "use", "what", "why", "when", "where", "which", "with", "would", "could", "should",
  "about", "after", "been", "being", "between", "both", "does", "doing", "during", "each", "from",
  "have", "into", "just", "know", "like", "make", "more", "most", "much", "need", "only", "other",
  "over", "some", "such", "take", "than", "that", "them", "then", "there", "these", "they", "this",
  "very", "want", "well", "were", "will", "work", "your", "understand", "learn", "explain", "tell", "help",
]);

export function extractKeywords(query: string, locale: Locale): string[] {
  const english = query
    .toLowerCase()
    .split(/[^a-z0-9+#.-]+/)
    .filter((word) => word.length > 2 && !ENGLISH_STOP_WORDS.has(word));

  if (locale !== "zh") return [...new Set(english)];

  const chinese = [...query.matchAll(/[\u4e00-\u9fff]{2,}/g)].flatMap(([phrase]) => {
    const ngrams = [phrase];
    for (let size = 2; size <= Math.min(4, phrase.length); size++) {
      for (let index = 0; index <= phrase.length - size; index++) ngrams.push(phrase.slice(index, index + size));
    }
    return ngrams;
  });
  return [...new Set([...english, ...chinese])];
}

export function recommendSections(meta: SectionMeta[], query: string, locale: Locale): SectionMeta[] {
  const keywords = extractKeywords(query, locale);
  if (keywords.length === 0) return [];

  return meta
    .map((entry) => {
      const description = entry.description.toLowerCase();
      const name = `${entry.chapterName} ${entry.sectionName}`.toLowerCase();
      let score = 0;
      for (const keyword of keywords) {
        if (description.includes(keyword)) score += 2;
        if (name.includes(keyword)) score += 3;
      }
      return { ...entry, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.chapter - b.chapter || a.section - b.section)
    .slice(0, 15)
    .map(({ score: _score, ...entry }) => entry);
}
