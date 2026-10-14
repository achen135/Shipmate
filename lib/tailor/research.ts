/**
 * Step 3: what a company says about itself, cached per company for 30 days
 * and shared by everyone tailoring to that company (company_research).
 *
 * Sources (hard rule 6: never LinkedIn): the company's own site and its
 * /about page when Shipmate knows the site, its careers page, and its
 * Greenhouse board intro when it has one. The model (fast tier) pulls out a
 * summary, stated values and named technologies; code then keeps only what
 * the pages actually say. The result steers what to emphasise; it is never
 * a source of resume content (lib/tailor/edits.ts doesn't read it).
 *
 * Few companies have a site on file yet (M9 seeds them), so "nothing found"
 * is the common case, cached like any other so it isn't retried every run.
 */

import { z } from "zod";

import type { AiProvider, AiUsage } from "@/lib/ai/types";
import { USER_AGENT } from "@/lib/http";
import type { BoardHint } from "@/lib/questions/locate";
import { htmlToText } from "@/lib/sources/text";

import { RESEARCH_SYSTEM } from "./prompts";
import {
  containsPhrase,
  hasWord,
  isFunctionWord,
  keySet,
  tokenize,
} from "./text";

export const RESEARCH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 10_000;
const MAX_CHARS_PER_PAGE = 8_000;
/** Less than this altogether and there's nothing to summarise. */
const MIN_CHARS = 300;

export const researchSchema = z.object({
  status: z.enum(["ok", "none"]),
  summary: z.string(),
  values: z.array(z.string()),
  tech: z.array(z.string()),
  sources: z.array(z.string()),
});
export type CompanyResearch = z.infer<typeof researchSchema>;

const extractSchema = z.object({
  summary: z.string(),
  values: z.array(z.string()),
  tech: z.array(z.string()),
});

export const NO_RESEARCH: CompanyResearch = {
  status: "none",
  summary: "",
  values: [],
  tech: [],
  sources: [],
};

export function isFresh(fetchedAt: string, now: number): boolean {
  return now - new Date(fetchedAt).getTime() < RESEARCH_TTL_MS;
}

const NEVER = /(^|\.)linkedin\.com$/i;

function pageUrls(
  company: { website: string | null; careers_url: string | null },
  boards: BoardHint[],
): string[] {
  const urls: string[] = [];
  const add = (raw: string | null | undefined) => {
    if (!raw) return;
    try {
      const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
      if (url.protocol !== "https:" || NEVER.test(url.hostname)) return;
      urls.push(url.toString());
    } catch {
      // Not a URL: skip it.
    }
  };
  if (company.website) {
    add(company.website);
    add(
      new URL(
        "/about",
        /^https?:\/\//i.test(company.website)
          ? company.website
          : `https://${company.website}`,
      ).toString(),
    );
  }
  add(company.careers_url);
  for (const board of boards) {
    if (board.kind === "greenhouse") {
      add(
        `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board.slug)}`,
      );
    }
  }
  return [...new Set(urls)].slice(0, 4);
}

async function pageText(fetchImpl: typeof fetch, url: string): Promise<string> {
  try {
    const response = await fetchImpl(url, {
      headers: { "user-agent": USER_AGENT },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "follow",
    });
    if (!response.ok) return "";
    const type = response.headers.get("content-type") ?? "";
    if (/json/i.test(type)) {
      // Greenhouse board: { name, content } where content is the intro.
      const json = (await response.json()) as { content?: unknown };
      return typeof json.content === "string" ? htmlToText(json.content) : "";
    }
    if (!/text\/html/i.test(type)) return "";
    return htmlToText(await response.text());
  } catch {
    return "";
  }
}

/** Keep only what the pages say: the code-side check of the model's answer. */
export function verifyResearch(
  data: z.infer<typeof extractSchema>,
  text: string,
): Pick<CompanyResearch, "summary" | "values" | "tech"> {
  const words = keySet(text);
  const traced = (line: string) => {
    const tokens = tokenize(line).filter((t) => !isFunctionWord(t.key));
    if (tokens.length === 0) return false;
    return (
      tokens.filter((t) => hasWord(words, t.key)).length / tokens.length >= 0.85
    );
  };
  const clean = (items: string[], max: number) =>
    [
      ...new Set(
        items
          .map((v) => v.trim().slice(0, 80))
          .filter((v) => v && containsPhrase(text, v)),
      ),
    ].slice(0, max);
  const summary = data.summary.trim().slice(0, 400);
  return {
    summary: traced(summary) ? summary : "",
    values: clean(data.values, 6),
    tech: clean(data.tech, 15),
  };
}

export async function researchCompany(
  provider: AiProvider,
  company: {
    name: string;
    website: string | null;
    careers_url: string | null;
  },
  boards: BoardHint[],
  fetchImpl: typeof fetch,
): Promise<{ research: CompanyResearch; usage: AiUsage | null }> {
  const urls = pageUrls(company, boards);
  const pages: { url: string; text: string }[] = [];
  for (const url of urls) {
    const text = (await pageText(fetchImpl, url)).slice(0, MAX_CHARS_PER_PAGE);
    if (text) pages.push({ url, text });
  }
  const text = pages.map((p) => p.text).join("\n\n");
  if (text.length < MIN_CHARS) return { research: NO_RESEARCH, usage: null };

  const { data, usage } = await provider.generateStructured({
    tier: "fast",
    system: RESEARCH_SYSTEM,
    input: `<company>${company.name}</company>\n\n<pages>\n${text}\n</pages>`,
    schema: extractSchema,
    name: "company_research",
    maxOutputTokens: 4_000,
  });
  const verified = verifyResearch(data, text);
  const found =
    verified.summary || verified.values.length || verified.tech.length;
  return {
    research: found
      ? { status: "ok", ...verified, sources: pages.map((p) => p.url) }
      : { ...NO_RESEARCH, sources: pages.map((p) => p.url) },
    usage,
  };
}
