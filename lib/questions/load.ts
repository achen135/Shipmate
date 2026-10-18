import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { withE2eOrigin } from "@/lib/e2e-origin";
import type { Database } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

import { questionsAreFresh } from "./cache";
import { fetchQuestions } from "./fetch";
import { type BoardHint, locateForm } from "./locate";
import {
  type QuestionsStatus,
  type RawQuestion,
  readStoredQuestions,
} from "./types";

/**
 * The posting's application questions, fetched lazily (CLAUDE.md "Question
 * fetch"): the cached copy on the posting row if it's fresh, otherwise a
 * fetch from the ATS, cached for everyone through save_posting_questions().
 * The 30-minute worker never does this; most postings are never opened.
 */

export type LoadedQuestions = {
  status: QuestionsStatus;
  questions: RawQuestion[];
};

export type PostingForQuestions = {
  id: string;
  url: string;
  canonical_url: string;
  company: { name: string } | null;
  questions: unknown;
  questions_status: string | null;
  questions_fetched_at: string | null;
};

const boardsSchema = z.array(
  z.object({ kind: z.string(), slug: z.string(), eu: z.boolean() }),
);

const isStatus = (value: string | null): value is QuestionsStatus =>
  value === "ok" || value === "unknown" || value === "failed";

export async function loadQuestions(
  posting: PostingForQuestions,
  // A client made earlier in the request: prefetch.ts runs after the response
  // has gone, when the cookies it would read are no longer there.
  client?: SupabaseClient<Database>,
): Promise<LoadedQuestions> {
  const status = isStatus(posting.questions_status)
    ? posting.questions_status
    : null;
  if (
    status &&
    questionsAreFresh(status, posting.questions_fetched_at, Date.now())
  ) {
    return {
      status,
      questions: status === "ok" ? readStoredQuestions(posting.questions) : [],
    };
  }

  const supabase = client ?? (await createClient());
  const { data } = await supabase.rpc("posting_boards", {
    p_posting_id: posting.id,
  });
  const boards: BoardHint[] = boardsSchema.safeParse(data).data ?? [];

  const location = locateForm({
    urls: [posting.url, posting.canonical_url],
    company: posting.company?.name ?? "",
    boards,
  });
  const result = await fetchQuestions(
    location,
    withE2eOrigin(fetch, process.env),
  );

  // Cache it for the next person. A refusal ("skipped": someone else just
  // did) is fine; this visitor still uses what they fetched.
  const { error } = await supabase.rpc("save_posting_questions", {
    p_posting_id: posting.id,
    p_status: result.status,
    p_questions: result.status === "ok" ? result.questions : null,
  });
  if (error) console.error("[questions] cache failed:", error.message);

  return {
    status: result.status,
    questions: result.status === "ok" ? result.questions : [],
  };
}
