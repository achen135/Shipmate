/**
 * Tailoring in the worker: drain the queue, one row at a time.
 *
 * Who runs this: tailor.yml (started by the database the moment a row is
 * queued, or an edited copy needs its PDF again; worker/tailor-main.ts),
 * and every 30-minute Watch run after matching (worker/run.ts), so a lost
 * dispatch is never a dead end.
 *
 * One at a time, never in parallel (M7 handoff §0.5): that's what keeps a
 * burst of new matches under the shared Gemini key's per-minute limit.
 * Two workers at once (a Watch run and a tailor run) can't take the same
 * row: claim_tailoring() uses SKIP LOCKED.
 *
 * Outcomes per row:
 * - done: the pipeline ran (lib/tailor/pipeline.ts); the PDF is at
 *   pdfs/{user_id}/{posting_id}/{stamp}.pdf. Every print gets a new path and
 *   is never overwritten, so an application's resume_used names the exact
 *   file sent; older prints of the posting go once nothing points at them.
 * - rate limited on the shared key's main model (Flash): a 429 (out of
 *   quota) or a 503 (overloaded), both coded `rate_limited`
 *   (lib/ai/errors.ts). This row is tried again at once on the shared
 *   key's backup model (Flash-Lite, its own free quota and a less contested
 *   model), and so is every later shared-key row this run. The SDK has
 *   already retried once, so it's a repeated one. Each run starts on Flash
 *   again. Scoring and the edit step are on Flash; research and the second
 *   look are already on Flash-Lite (lib/ai/models.ts), so a 429 from one
 *   of those comes back again on the backup, and the row waits as below
 *   (one wasted call).
 * - rate limited otherwise (the backup too, or the user's own key): back to
 *   queued with rate_limited_at set, never shown as a failure. Once the
 *   backup says 429 or 503, no other shared-key row is tried this run.
 *   One still waiting after GIVE_UP_WAITING_MS is failed, with a message
 *   that says why, so a 503 that never clears doesn't wait forever.
 * - a problem the user must fix (no structured resume, a rejected key, no
 *   credit): failed, with a message they can act on.
 * - anything else transient (a crash, a timeout, the provider's other 5xx): back to
 *   queued for the next run, failed after the 3rd attempt.
 *
 * Logging: ids, codes and counts only. Never resume text, posting text,
 * keys, or an SDK error object.
 */

import {
  AiError,
  type AiProvider,
  type KeySources,
  NoKeyError,
  getProvider,
} from "@/lib/ai";
import { callCostUsd } from "@/lib/ai/models";
import { KeyDecryptError, MasterKeyError } from "@/lib/ai/crypto";
import { type BoardHint } from "@/lib/questions/locate";
import { parseContent } from "@/lib/resume/structured";
import { factFromRow, type Fact } from "@/lib/schemas/fact-bank";
import { reviewWarnings } from "@/lib/review/warnings";
import type { Json } from "@/lib/supabase/database.types";
import { BATCH_SIZE, tailorBatch } from "@/lib/tailor/batch";
import { tailoringDay } from "@/lib/tailor/mass";
import { type TailorResult, tailor } from "@/lib/tailor/pipeline";
import { fetchPostingText } from "@/lib/tailor/posting-text";
import {
  type CompanyResearch,
  isFresh,
  researchCompany,
  researchSchema,
} from "@/lib/tailor/research";
import { MIN_POSTING_CHARS } from "@/lib/tailor/score";

import type { Db } from "./db";
import type { Printer } from "./pdf";

export const MAX_ATTEMPTS = 3;
/** A row the shared key kept turning away this long is failed, not kept forever. */
const GIVE_UP_WAITING_MS = 48 * 60 * 60 * 1000;
/** A 'running' row older than this belonged to a run that died. */
const STALE_RUNNING_MS = 20 * 60 * 1000;

export type TailorStats = {
  done: number;
  /** Of those, how many ran on the shared key's backup model. */
  onBackup: number;
  failed: number;
  requeued: number;
  rateLimited: number;
  /** Shared-key rows left for the next run after the shared key said 429. */
  deferred: number;
  rendered: number;
};

export type DrainOptions = {
  keys: KeySources;
  printer: Printer;
  fetch: typeof fetch;
  /** Stop claiming new rows after this time (ms since epoch). */
  deadline: number;
  warn: (message: string) => void;
};

/** Something the user has to fix; shown to them as is. */
class UserFixable extends Error {}

const FIX = {
  noResume:
    "Shipmate needs your resume in its own layout first. Import it in Profile → Structured resume, then tailor again.",
  notAi: "AI mode is off. Turn it on in Profile → AI to tailor.",
  gone: "This posting is no longer in your Inbox.",
  sharedBusyTooLong:
    "Shipmate's shared free AI stayed busy for two days, so this tailoring was dropped. Try again, or add your own key in Profile → AI.",
  crashed: "Something went wrong while tailoring. Try again.",
};

/** AI errors the user (not time) has to fix. */
const PERMANENT = new Set<AiError["code"]>([
  "invalid_key",
  "no_access",
  "out_of_credit",
  "refused",
  "too_long",
]);

type Row = {
  id: string;
  user_id: string;
  user_posting_id: string;
  posting_id: string | null;
  attempts: number;
  created_at: string;
  rate_limited_at: string | null;
  rate_limit_hits: number;
};

function check(label: string, error: { message: string } | null) {
  if (error) throw new Error(`${label}: ${error.message}`);
}

/** Rows a crashed run left 'running', and ones the shared key never let through. */
async function tidyQueue(db: Db, now: number): Promise<void> {
  const stale = new Date(now - STALE_RUNNING_MS).toISOString();
  const { data: stuck, error } = await db
    .from("tailorings")
    .select("id, attempts")
    .eq("state", "running")
    .lt("started_at", stale);
  check("load stuck tailorings", error);
  for (const row of stuck ?? []) {
    const give = row.attempts >= MAX_ATTEMPTS;
    check(
      "tidy stuck tailoring",
      (
        await db
          .from("tailorings")
          .update(
            give
              ? {
                  state: "failed",
                  error: FIX.crashed,
                  finished_at: new Date(now).toISOString(),
                }
              : { state: "queued" },
          )
          .eq("id", row.id)
          .eq("state", "running")
      ).error,
    );
  }
  check(
    "give up waiting tailorings",
    (
      await db
        .from("tailorings")
        .update({
          state: "failed",
          error: FIX.sharedBusyTooLong,
          finished_at: new Date(now).toISOString(),
        })
        .eq("state", "queued")
        .not("rate_limited_at", "is", null)
        .lt("created_at", new Date(now - GIVE_UP_WAITING_MS).toISOString())
        // Counted from the row's own day: one "Tailor all" queued for a
        // later day has been waiting since that day, not since it was made.
        .lt("run_on", tailoringDay(now - GIVE_UP_WAITING_MS))
    ).error,
  );
}

async function claim(db: Db, skip: string[]): Promise<Row | null> {
  const { data, error } = await db.rpc("claim_tailoring", { p_skip: skip });
  check("claim tailoring", error);
  return (data?.[0] as Row | undefined) ?? null;
}

async function loadResearch(
  db: Db,
  provider: AiProvider,
  company: {
    id: string;
    name: string;
    website: string | null;
    careers_url: string | null;
  },
  boards: BoardHint[],
  fetchImpl: typeof fetch,
) {
  const { data: cached } = await db
    .from("company_research")
    .select("content, fetched_at")
    .eq("company_id", company.id)
    .maybeSingle();
  const parsed = researchSchema.safeParse(cached?.content);
  if (cached && parsed.success && isFresh(cached.fetched_at, Date.now())) {
    return { research: parsed.data, usage: null };
  }
  const { research, usage } = await researchCompany(
    provider,
    company,
    boards,
    fetchImpl,
  );
  check(
    "save company research",
    (
      await db.from("company_research").upsert({
        company_id: company.id,
        content: research as unknown as NonNullable<Json>,
        fetched_at: new Date().toISOString(),
      })
    ).error,
  );
  return { research, usage };
}

/** Everything a row's tailoring needs before the AI's edit work. */
type Prepared = Awaited<ReturnType<typeof prepareRow>>;

/** Load what the row needs, fetch the posting's text, research the company. */
async function prepareRow(
  db: Db,
  row: Row,
  provider: AiProvider,
  options: DrainOptions,
) {
  const [profile, resume, facts, item] = await Promise.all([
    db
      .from("profiles")
      .select("name, mode, grad_month, grad_year, degree, needs_sponsorship")
      .eq("user_id", row.user_id)
      .maybeSingle(),
    db
      .from("resumes")
      .select("content")
      .eq("user_id", row.user_id)
      .maybeSingle(),
    db
      .from("fact_bank")
      .select("id, kind, content, source")
      .eq("user_id", row.user_id)
      .order("created_at"),
    db
      .from("postings")
      .select(
        "id, title, url, canonical_url, terms, degrees, sponsorship, description, fetched_description, company:companies(id, name, website, careers_url)",
      )
      .eq("id", row.posting_id ?? "")
      .maybeSingle(),
  ]);
  check("load profile", profile.error);
  check("load resume", resume.error);
  check("load facts", facts.error);
  check("load posting", item.error);
  if (!profile.data || profile.data.mode !== "ai") {
    throw new UserFixable(FIX.notAi);
  }
  const person = profile.data;
  const master = parseContent(resume.data?.content);
  if (!master) throw new UserFixable(FIX.noResume);
  const posting = item.data;
  if (!posting) throw new UserFixable(FIX.gone);
  const company = posting.company;
  const factList = (facts.data ?? [])
    .map(factFromRow)
    .filter((f): f is Fact => f !== null);

  const { data: boardRows } = await db.rpc("posting_boards", {
    p_posting_id: posting.id,
  });
  const boards = (boardRows ?? []) as BoardHint[];

  // 1. The full text: the source's, else fetched once and cached for all.
  let text = posting.description ?? "";
  if (text.length < MIN_POSTING_CHARS) {
    text = posting.fetched_description ?? "";
  }
  if (text.length < MIN_POSTING_CHARS) {
    const fetched = await fetchPostingText(
      {
        url: posting.url,
        canonical_url: posting.canonical_url,
        company: company?.name ?? "",
      },
      boards,
      options.fetch,
    );
    check(
      "save fetched description",
      (
        await db
          .from("postings")
          .update({
            fetched_description: fetched,
            description_fetched_at: new Date().toISOString(),
          })
          .eq("id", posting.id)
      ).error,
    );
    text = fetched ?? text;
  }

  // 3. Company research (cached per company, 30 days).
  let research: CompanyResearch | null = null;
  let researchUsage = null;
  if (company && text.length >= MIN_POSTING_CHARS) {
    const loaded = await loadResearch(
      db,
      provider,
      company,
      boards,
      options.fetch,
    );
    research = loaded.research.status === "ok" ? loaded.research : null;
    researchUsage = loaded.usage;
  }

  return {
    row,
    person,
    posting,
    text,
    researchUsage,
    input: {
      master,
      facts: factList,
      posting: {
        title: posting.title,
        company: company?.name ?? "",
        text,
      },
      research,
    },
  };
}

/** The PDF, the warnings and the saved result, for a tailored row. */
async function finishRow(
  db: Db,
  prepared: Prepared,
  result: TailorResult,
  provider: AiProvider,
  options: DrainOptions,
  how: "alone" | "batch",
) {
  const { row, person, posting, text, researchUsage } = prepared;
  if (result.blocked.length > 0) {
    // A bug in the edit checks, caught by the final one: loud, never shown.
    options.warn(
      `tailoring ${row.id}: the final check caught ${result.blocked.length} untraceable item(s); shipped the master resume`,
    );
  }

  const pdf = await options.printer.pdf(result.content);
  const pdfPath = pdfPathFor(row.user_id, posting.id);
  check(
    "upload pdf",
    (
      await db.storage.from("pdfs").upload(pdfPath, pdf, {
        contentType: "application/pdf",
        upsert: true,
      })
    ).error,
  );

  const warnings = [
    ...reviewWarnings({
      posting: {
        title: posting.title,
        terms: posting.terms,
        degrees: posting.degrees,
        sponsorship: posting.sponsorship,
        description: text,
      },
      profile: {
        gradMonth: person.grad_month,
        gradYear: person.grad_year,
        degree: person.degree,
        needsSponsorship: person.needs_sponsorship,
      },
      previous: [],
    }),
    ...result.warnings,
  ];

  const inTokens = result.usage.inputTokens + (researchUsage?.inputTokens ?? 0);
  const outTokens =
    result.usage.outputTokens + (researchUsage?.outputTokens ?? 0);
  const cost =
    result.usage.costUsd +
    (researchUsage ? callCostUsd(researchUsage, "fast", provider.shared) : 0);

  check(
    "save tailoring",
    (
      await db
        .from("tailorings")
        .update({
          state: "done",
          finished_at: new Date().toISOString(),
          score_before: result.scoreBefore,
          score_after: result.scoreAfter,
          matched: result.matched,
          missing: result.missing,
          changes: result.changes as unknown as NonNullable<Json>,
          suggestions: result.suggestions as unknown as NonNullable<Json>,
          warnings: warnings as unknown as NonNullable<Json>,
          notes: result.notes as unknown as NonNullable<Json>,
          resume_content: result.content as unknown as NonNullable<Json>,
          pdf_path: pdfPath,
          pdf_requested_at: null,
          provider:
            result.usage.provider ?? researchUsage?.provider ?? provider.name,
          // The edit step's model (research and scoring run on the fast tier).
          model: result.usage.model,
          key_source: provider.shared ? "shared" : "own",
          tokens_in: inTokens,
          tokens_out: outTokens,
          est_cost: Math.round(cost * 10_000) / 10_000,
          error: null,
        })
        .eq("id", row.id)
    ).error,
  );
  await removeOldPrints(db, row.user_id, posting.id, pdfPath);
  console.log(
    `[tailor] ${row.id}: done, ${result.scoreBefore ?? "-"} → ${result.scoreAfter ?? "-"}, ${result.changes.length} changes, ${result.dropped.length} edits dropped, second look ${result.secondLook} (${result.suggestions.length}), ${inTokens}/${outTokens} tokens (${provider.shared ? (provider.backup ? "shared backup" : "shared") : "own"} ${provider.name}, ${how})`,
  );
}

/** One row on its own: prepare, the pipeline, finish. */
async function tailorOne(
  db: Db,
  row: Row,
  provider: AiProvider,
  options: DrainOptions,
) {
  const prepared = await prepareRow(db, row, provider, options);
  const result = await tailor(prepared.input, {
    provider,
    measure: options.printer.measure,
  });
  await finishRow(db, prepared, result, provider, options, "alone");
}

/** A new path for every print: {user}/{posting}/{stamp}.pdf. */
export function pdfPathFor(
  userId: string,
  postingId: string,
  now = Date.now(),
) {
  return `${userId}/${postingId}/${now.toString(36)}.pdf`;
}

/**
 * Remove this posting's earlier prints, keeping the one just written and
 * any an application recorded as the resume it was sent with. Best effort:
 * a leftover file is only storage, never shown.
 */
async function removeOldPrints(
  db: Db,
  userId: string,
  postingId: string,
  keep: string,
): Promise<void> {
  const folder = `${userId}/${postingId}`;
  const { data: files, error } = await db.storage.from("pdfs").list(folder);
  if (error || !files) return;
  const { data: used } = await db
    .from("user_postings")
    .select("resume_used")
    .eq("user_id", userId)
    .eq("posting_id", postingId);
  const referenced = new Set(
    (used ?? [])
      .map((r) => (r.resume_used as { path?: unknown } | null)?.path)
      .filter((p): p is string => typeof p === "string"),
  );
  const stale = files
    .map((f) => `${folder}/${f.name}`)
    .filter((path) => path !== keep && !referenced.has(path));
  if (stale.length > 0) await db.storage.from("pdfs").remove(stale);
}

/** Edited copies ("Edit this copy") whose PDF needs printing again. */
async function renderRequested(db: Db, options: DrainOptions): Promise<number> {
  const { data, error } = await db
    .from("tailorings")
    .select("id, user_id, posting_id, resume_content, pdf_requested_at")
    .eq("state", "done")
    .not("pdf_requested_at", "is", null)
    .order("pdf_requested_at")
    .limit(50);
  check("load renders", error);
  let rendered = 0;
  for (const row of data ?? []) {
    if (Date.now() > options.deadline) break;
    const content = parseContent(row.resume_content);
    if (!content || !row.posting_id) continue;
    const path = pdfPathFor(row.user_id, row.posting_id);
    const pdf = await options.printer.pdf(content);
    check(
      "upload edited pdf",
      (
        await db.storage
          .from("pdfs")
          .upload(path, pdf, { contentType: "application/pdf", upsert: true })
      ).error,
    );
    // Only clear the request this print answered: a newer edit asks again
    // (and its print tidies this one away).
    const marked = await db
      .from("tailorings")
      .update({ pdf_path: path, pdf_requested_at: null })
      .eq("id", row.id)
      .eq("pdf_requested_at", row.pdf_requested_at!)
      .select("id");
    check("mark rendered", marked.error);
    if (marked.data?.length) {
      await removeOldPrints(db, row.user_id, row.posting_id, path);
    }
    rendered += 1;
  }
  return rendered;
}

/**
 * Which shared-key model this run can still use. Flash until it says 429 or
 * 503, then Flash-Lite until that does too, then neither: rows wait for the
 * next run.
 */
export type SharedQuota = { mainBusy: boolean; backupBusy: boolean };

export function sharedModel(quota: SharedQuota): "main" | "backup" | "wait" {
  if (!quota.mainBusy) return "main";
  if (!quota.backupBusy) return "backup";
  return "wait";
}

const isRateLimited = (error: unknown): error is AiError =>
  error instanceof AiError && error.code === "rate_limited";

export async function drainTailorings(
  db: Db,
  options: DrainOptions,
): Promise<TailorStats> {
  const stats: TailorStats = {
    done: 0,
    onBackup: 0,
    failed: 0,
    requeued: 0,
    rateLimited: 0,
    deferred: 0,
    rendered: 0,
  };
  await tidyQueue(db, Date.now());

  const skip: string[] = [];
  const quota: SharedQuota = { mainBusy: false, backupBusy: false };

  const update = async (label: string, id: string, values: object) =>
    check(
      label,
      (await db.from("tailorings").update(values).eq("id", id)).error,
    );
  const requeue = (row: Row, extra: Record<string, unknown> = {}) =>
    update("requeue tailoring", row.id, {
      state: "queued",
      started_at: null,
      ...extra,
    });
  const fail = async (row: Row, message: string) => {
    stats.failed += 1;
    await update("fail tailoring", row.id, {
      state: "failed",
      error: message.slice(0, 500),
      finished_at: new Date().toISOString(),
    });
  };

  /** What a row's error means: failed, queued again, or left to wait. */
  const settle = async (
    row: Row,
    error: unknown,
    provider: AiProvider | null,
  ) => {
    if (isRateLimited(error)) {
      stats.rateLimited += 1;
      if (provider?.shared) {
        // Main and backup both: no more shared-key rows this run.
        quota.mainBusy = true;
        quota.backupBusy = true;
      }
      options.warn(
        `tailoring ${row.id}: ${provider?.shared ? "shared (main and backup)" : "own"} ${provider?.name ?? ""} key rate-limited (${error.status ?? ""}); left queued for the next run`,
      );
      await requeue(row, {
        attempts: Math.max(0, row.attempts - 1),
        rate_limited_at: new Date().toISOString(),
        rate_limit_hits: row.rate_limit_hits + 1,
        key_source: provider?.shared ? "shared" : "own",
      });
      return;
    }
    if (error instanceof MasterKeyError) {
      // The worker's setup, not the user's problem: wait for the secret.
      options.warn(
        `tailoring ${row.id}: ${error.message} Add it as a repository secret; left queued.`,
      );
      stats.deferred += 1;
      await requeue(row, { attempts: Math.max(0, row.attempts - 1) });
      return;
    }
    if (error instanceof UserFixable) return fail(row, error.message);
    if (error instanceof NoKeyError || error instanceof KeyDecryptError) {
      return fail(row, error.message);
    }
    if (error instanceof AiError && PERMANENT.has(error.code)) {
      console.warn(`[tailor] ${row.id}: ${error.code} ${error.status ?? ""}`);
      return fail(row, error.message);
    }
    const label =
      error instanceof AiError
        ? `${error.code} ${error.status ?? ""}`
        : error instanceof Error
          ? `${error.name}: ${error.message.slice(0, 200)}`
          : "unknown";
    console.error(
      `[tailor] ${row.id}: attempt ${row.attempts} failed: ${label}`,
    );
    if (row.attempts >= MAX_ATTEMPTS) {
      await fail(row, error instanceof AiError ? error.message : FIX.crashed);
    } else {
      stats.requeued += 1;
      await requeue(row);
    }
  };

  /**
   * Run `work` on the provider; if the shared key's main model says 429 or
   * 503, once more on its backup (its own quota), now. Returns the provider
   * that finished it.
   */
  const withBackup = async (
    provider: AiProvider,
    row: Row,
    work: (provider: AiProvider) => Promise<void>,
  ): Promise<AiProvider> => {
    try {
      await work(provider);
      return provider;
    } catch (error) {
      if (!(isRateLimited(error) && provider.shared && !provider.backup)) {
        throw error;
      }
      quota.mainBusy = true;
      options.warn(
        `tailoring ${row.id}: shared key's main model rate-limited (${error.status ?? ""}); trying the backup model for the rest of this run`,
      );
      const backup = await getProvider(options.keys, row.user_id, {
        sharedBackup: true,
      });
      await work(backup);
      return backup;
    }
  };

  /**
   * Several of one user's rows on Gemini (M9): each prepared on its own,
   * then one batched edit request (lib/tailor/batch.ts), then each finished
   * on its own. A row that fails to prepare or finish is settled alone; an
   * error in the batch's requests settles every row in it.
   */
  const tailorGroup = async (rows: Row[], provider: AiProvider) => {
    const prepared: Prepared[] = [];
    for (const row of rows) {
      try {
        prepared.push(await prepareRow(db, row, provider, options));
      } catch (error) {
        await settle(row, error, provider);
      }
    }
    if (prepared.length === 0) return;
    let results: TailorResult[] = [];
    let used = provider;
    try {
      used = await withBackup(provider, prepared[0].row, async (p) => {
        const run = await tailorBatch(
          {
            master: prepared[0].input.master,
            facts: prepared[0].input.facts,
            postings: prepared.map((x) => ({
              id: x.row.id,
              posting: x.input.posting,
              research: x.input.research,
            })),
          },
          { provider: p, measure: options.printer.measure },
        );
        if (run.problems.length > 0) {
          options.warn(
            `tailoring batch of ${prepared.length}: ${run.problems.join("; ")} (asked alone instead)`,
          );
        }
        results = run.outcomes.map((o) => {
          // Keywords are asked per posting, so every outcome is done.
          if (o.status !== "done") throw new Error(`batch: ${o.reason}`);
          return o.result;
        });
      });
    } catch (error) {
      for (const x of prepared) await settle(x.row, error, used);
      return;
    }
    for (const [i, x] of prepared.entries()) {
      try {
        await finishRow(db, x, results[i], used, options, "batch");
        stats.done += 1;
        if (used.backup) stats.onBackup += 1;
      } catch (error) {
        await settle(x.row, error, used);
      }
    }
  };

  while (Date.now() < options.deadline) {
    const row = await claim(db, skip);
    if (!row) break;
    skip.push(row.id);

    let provider: AiProvider | null = null;
    let group: Row[] = [row];
    try {
      provider = await getProvider(options.keys, row.user_id, {
        sharedBackup: sharedModel(quota) === "backup",
      });
      if (provider.shared && sharedModel(quota) === "wait") {
        // Not this run: put it back without spending an attempt.
        stats.deferred += 1;
        await requeue(row, { attempts: Math.max(0, row.attempts - 1) });
        continue;
      }
      // Gemini: the user's other runnable rows go in the same batch. Only
      // Gemini, where it was measured and where requests a day are the
      // limit (Design Decisions "Mass apply": measured and decided).
      if (provider.name === "google") {
        const { data, error } = await db.rpc("claim_user_tailorings", {
          p_user: row.user_id,
          p_skip: skip,
          p_limit: BATCH_SIZE - 1,
        });
        check("claim more tailorings", error);
        const more = (data ?? []) as Row[];
        skip.push(...more.map((m) => m.id));
        group = [row, ...more];
      }
    } catch (error) {
      for (const r of group) await settle(r, error, provider);
      continue;
    }

    if (group.length > 1) {
      await tailorGroup(group, provider);
      continue;
    }
    try {
      const used = await withBackup(provider, row, (p) =>
        tailorOne(db, row, p, options),
      );
      stats.done += 1;
      if (used.backup) stats.onBackup += 1;
    } catch (error) {
      // A 429 from the backup reaches here with the main provider in hand;
      // the shared key is marked busy for the rest of the run either way.
      await settle(row, error, provider);
    }
  }

  stats.rendered = await renderRequested(db, options);
  return stats;
}

// ---------------------------------------------------------------- auto-tailor

/**
 * After matching: queue tailoring for the new Inbox rows of users who turned
 * on auto-tailor (AI mode, a structured resume), as many as their daily cap
 * has room for. The database enforces the cap too; reaching it just stops
 * the queuing for that user, it's not an error.
 */
export async function queueAutoTailor(
  db: Db,
  newRows: { userId: string; postingId: string }[],
): Promise<{ queued: number; capped: number }> {
  const stats = { queued: 0, capped: 0 };
  const users = [...new Set(newRows.map((r) => r.userId))];
  if (users.length === 0) return stats;

  const { data: profiles, error } = await db
    .from("profiles")
    .select("user_id")
    .in("user_id", users)
    .eq("auto_tailor", true)
    .eq("mode", "ai");
  check("load auto-tailor users", error);
  const { data: resumes, error: resumeError } = await db
    .from("resumes")
    .select("user_id")
    .in(
      "user_id",
      (profiles ?? []).map((p) => p.user_id),
    )
    .not("content", "is", null);
  check("load auto-tailor resumes", resumeError);
  const ready = new Set((resumes ?? []).map((r) => r.user_id));

  for (const userId of ready) {
    const postings = newRows
      .filter((r) => r.userId === userId)
      .map((r) => r.postingId);
    const { data: items, error: itemsError } = await db
      .from("user_postings")
      .select("id")
      .eq("user_id", userId)
      .in("posting_id", postings);
    check("load auto-tailor rows", itemsError);
    for (const item of items ?? []) {
      const { error: insertError } = await db
        .from("tailorings")
        .insert({ user_id: userId, user_posting_id: item.id, auto: true });
      if (!insertError) {
        stats.queued += 1;
        continue;
      }
      if (/Daily cap reached/.test(insertError.message)) {
        stats.capped += 1;
        break;
      }
      // Already queued (unique index) or similar: skip that one.
      console.warn(`[tailor] auto-queue skipped: ${insertError.code}`);
    }
  }
  return stats;
}
