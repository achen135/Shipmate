import "server-only";

import type { createClient } from "@/lib/supabase/server";

type Client = Awaited<ReturnType<typeof createClient>>;

export type FollowedCompany = {
  companyId: string;
  name: string;
  priority: boolean;
  boardKind: string | null;
  boardRef: string | null;
};

/** Priority companies first, then A to Z. */
export async function listFollowed(
  supabase: Client,
): Promise<FollowedCompany[]> {
  const { data, error } = await supabase
    .from("follows")
    .select(
      "company_id, priority, board_kind, board_ref, company:companies(name)",
    );
  if (error) throw new Error(`follows: ${error.message}`);
  return data
    .map((row) => ({
      companyId: row.company_id,
      name: row.company?.name ?? "Unknown company",
      priority: row.priority,
      boardKind: row.board_kind,
      boardRef: row.board_ref,
    }))
    .sort(
      (a, b) =>
        Number(b.priority) - Number(a.priority) || a.name.localeCompare(b.name),
    );
}

export const MIN_SEARCH = 2;

/** `%` and `_` are wildcards in ILIKE; a person searching means the letters. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export async function searchCompanies(
  supabase: Client,
  query: string,
): Promise<{ id: string; name: string }[]> {
  const q = query.trim();
  if (q.length < MIN_SEARCH) return [];
  const { data, error } = await supabase
    .from("companies")
    .select("id, name")
    .ilike("name", `%${escapeLike(q)}%`)
    .order("name")
    .limit(20);
  if (error) throw new Error(`company search: ${error.message}`);
  return data;
}
