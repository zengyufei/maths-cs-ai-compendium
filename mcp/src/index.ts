import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  LOCALES,
  type Locale,
  getChapters,
  getSections,
  parseLlmsTxt,
  recommendSections,
} from "./content.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.COMPENDIUM_ROOT || join(__dirname, "..", "..");
const localeSchema = z.enum(LOCALES).optional().default("en").describe("Content language: en (default) or zh");
const languageName = (locale: Locale) => (locale === "zh" ? "中文" : "English");
const chapterLabel = (locale: Locale, number: number) => (locale === "zh" ? `第 ${number} 章` : `Chapter ${number}`);

const server = new McpServer({ name: "compendium", version: "1.1.0" });

server.registerTool(
  "list_topics",
  {
    description: "List all chapters and sections in the compendium, optionally in English or Chinese",
    inputSchema: {
      chapter: z.number().optional().describe("Filter to a specific chapter number (1-20)"),
      locale: localeSchema,
    },
  },
  async ({ chapter, locale }) => {
    const chapters = await getChapters(ROOT, locale);
    const filtered = chapter ? chapters.filter((item) => item.number === chapter) : chapters;
    if (filtered.length === 0) {
      return { content: [{ type: "text", text: `${chapterLabel(locale, chapter ?? 0)} not found. Valid chapters: 1-${chapters.length}.` }] };
    }

    const lines: string[] = [];
    for (const item of filtered) {
      const sections = await getSections(item.path);
      lines.push(`\n## ${chapterLabel(locale, item.number)}: ${item.name}`);
      for (const section of sections) lines.push(`  ${section.number}. ${section.name}`);
    }
    return { content: [{ type: "text", text: lines.join("\n").trim() }] };
  },
);

server.registerTool(
  "read_section",
  {
    description: "Read a complete section from the compendium in English or Chinese",
    inputSchema: {
      chapter: z.number().describe("Chapter number (1-20)"),
      section: z.number().describe("Section number (typically 0-7, varies by chapter)"),
      locale: localeSchema,
    },
  },
  async ({ chapter, section, locale }) => {
    const chapters = await getChapters(ROOT, locale);
    const selectedChapter = chapters.find((item) => item.number === chapter);
    if (!selectedChapter) return { content: [{ type: "text", text: `${chapterLabel(locale, chapter)} not found.` }] };
    const sections = await getSections(selectedChapter.path);
    const selectedSection = sections.find((item) => item.number === section);
    if (!selectedSection) {
      return { content: [{ type: "text", text: `Section ${section} not found in ${chapterLabel(locale, chapter)}: ${selectedChapter.name}.` }] };
    }
    const content = await readFile(selectedSection.path, "utf-8");
    return { content: [{ type: "text", text: `# ${chapterLabel(locale, chapter)}: ${selectedChapter.name} - ${selectedSection.name}\n\n${content}` }] };
  },
);

server.registerTool(
  "search",
  {
    description: "Search across all compendium sections in the selected language",
    inputSchema: { query: z.string().describe("Search term or phrase"), locale: localeSchema },
  },
  async ({ query, locale }) => {
    const chapters = await getChapters(ROOT, locale);
    const results: string[] = [];
    const lowerQuery = query.toLowerCase();
    for (const chapter of chapters) {
      const sections = await getSections(chapter.path);
      for (const section of sections) {
        const lines = (await readFile(section.path, "utf-8")).split("\n");
        const matches: string[] = [];
        for (let index = 0; index < lines.length; index++) {
          if (!lines[index].toLowerCase().includes(lowerQuery)) continue;
          matches.push(`  Line ${index + 1}:\n${lines.slice(Math.max(0, index - 2), Math.min(lines.length, index + 3)).join("\n")}`);
        }
        if (matches.length > 0) results.push(`### ${chapterLabel(locale, chapter.number)}: ${chapter.name} - ${section.name}\n${matches.slice(0, 3).join("\n\n")}`);
      }
      if (results.length >= 20) break;
    }
    const text = results.length === 0
      ? `No ${languageName(locale)} results found for "${query}".`
      : `Found matches in ${results.length} sections:\n\n${results.join("\n\n")}`;
    return { content: [{ type: "text", text }] };
  },
);

server.registerTool(
  "recommend",
  {
    description: "Recommend sections in reading order for a learning goal, in English or Chinese",
    inputSchema: { query: z.string().describe("Learning goal or question"), locale: localeSchema },
  },
  async ({ query, locale }) => {
    const matches = recommendSections(await parseLlmsTxt(ROOT, locale), query, locale);
    if (matches.length === 0) return { content: [{ type: "text", text: `No relevant ${languageName(locale)} sections found for "${query}".` }] };

    const lines = [locale === "zh" ? "推荐阅读顺序：\n" : "Recommended sections (in suggested reading order):\n"];
    let chapter = -1;
    for (const section of matches.sort((a, b) => a.chapter - b.chapter || a.section - b.section)) {
      if (section.chapter !== chapter) {
        chapter = section.chapter;
        lines.push(`## ${chapterLabel(locale, chapter)}: ${section.chapterName}`);
      }
      lines.push(`  ${section.section}. ${section.sectionName} - ${section.description}`);
    }
    return { content: [{ type: "text", text: lines.join("\n") }] };
  },
);

server.registerTool(
  "get_examples",
  {
    description: "Extract code examples with surrounding explanation from the selected language edition",
    inputSchema: {
      query: z.string().optional().describe("Topic to find examples for"),
      language: z.string().optional().describe("Programming language, for example python, cpp, or bash"),
      chapter: z.number().optional().describe("Filter to a specific chapter number (1-20)"),
      locale: localeSchema,
    },
  },
  async ({ query, language, chapter, locale }) => {
    const chapters = await getChapters(ROOT, locale);
    const filtered = chapter ? chapters.filter((item) => item.number === chapter) : chapters;
    const lowerQuery = query?.toLowerCase();
    const results: string[] = [];
    for (const item of filtered) {
      for (const section of await getSections(item.path)) {
        const lines = (await readFile(section.path, "utf-8")).split("\n");
        for (let index = 0; index < lines.length; index++) {
          const open = lines[index].match(/^```(\w*)$/);
          if (!open) continue;
          const codeLanguage = open[1] || "text";
          if (language && language !== codeLanguage) continue;
          let end = index + 1;
          while (end < lines.length && lines[end] !== "```") end++;
          const code = lines.slice(index + 1, end).join("\n");
          const context = lines.slice(Math.max(0, index - 3), index).filter((line) => line.trim()).join("\n");
          if (!code.trim() || (lowerQuery && !`${context} ${code}`.toLowerCase().includes(lowerQuery))) continue;
          results.push(`### ${chapterLabel(locale, item.number)}: ${item.name} - ${section.name}\n${context ? `${context}\n\n` : ""}\`\`\`${codeLanguage}\n${code}\n\`\`\``);
          if (results.length >= 10) break;
          index = end;
        }
        if (results.length >= 10) break;
      }
      if (results.length >= 10) break;
    }
    const text = results.length === 0 ? `No code examples found for ${query ?? "the given filters"}.` : `Found ${results.length} code examples:\n\n${results.join("\n\n---\n\n")}`;
    return { content: [{ type: "text", text }] };
  },
);

async function main() {
  await server.connect(new StdioServerTransport());
  console.error("Compendium MCP server running on stdio");
}

main().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
