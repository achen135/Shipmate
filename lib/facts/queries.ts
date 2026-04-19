import "server-only";

import { type Fact, factFromRow } from "@/lib/schemas/fact-bank";
import { createClient } from "@/lib/supabase/server";

/** The signed-in user's fact bank, oldest first within each kind. */
export async function listFacts(): Promise<Fact[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("fact_bank")
    .select("id, kind, content, source")
    .order("created_at")
    .order("id");
  if (error) throw new Error(`fact bank: ${error.message}`);
  return data.map(factFromRow).filter((f): f is Fact => f !== null);
}
