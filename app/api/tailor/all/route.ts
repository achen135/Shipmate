import { getInvited } from "@/lib/auth/viewer";
import { parseContent } from "@/lib/resume/structured";
import { createClient } from "@/lib/supabase/server";
import type { TailorAllResult } from "@/lib/tailor/mass";

/**
 * "Tailor all" (M9 §1): POST → queue a tailoring for every open posting in
 * the signed-in user's To Apply that has none yet. The database does the
 * scheduling (tailor_all(): today up to the daily cap, then each later day
 * up to it, priority companies first) and enforces the cap and AI mode;
 * this checks the same things first so the user gets a clear message.
 */

const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { "cache-control": "private, no-store" },
  });

export async function POST() {
  const viewer = await getInvited();
  if (!viewer) return json({ message: "Sign in first." }, 401);

  const supabase = await createClient();
  const [profile, resume] = await Promise.all([
    supabase.from("profiles").select("mode, daily_cap").maybeSingle(),
    supabase.from("resumes").select("content").maybeSingle(),
  ]);
  if (profile.error || resume.error) {
    console.error("[tailor] all: load failed");
    return json({ message: "Something went wrong. Try again." }, 500);
  }
  if (profile.data?.mode !== "ai") {
    return json({ message: "Turn on AI mode in Profile → AI first." }, 400);
  }
  if (!parseContent(resume.data?.content)) {
    return json(
      {
        message:
          "Import your resume into Shipmate's layout first (Profile → Structured resume).",
      },
      400,
    );
  }
  if (!profile.data.daily_cap) {
    return json(
      {
        message:
          "Your daily cap is 0, so nothing can be tailored. Raise it in Profile → AI.",
      },
      400,
    );
  }

  const { data, error } = await supabase.rpc("tailor_all");
  const row = data?.[0];
  if (error || !row) {
    console.error("[tailor] all: queue failed:", error?.code);
    return json({ message: "Couldn't start tailoring. Try again." }, 500);
  }
  const result: TailorAllResult = {
    queuedToday: row.queued_today,
    queuedLater: row.queued_later,
    lastDay: row.last_day,
    already: row.already,
    dailyCap: row.daily_cap,
  };
  return json(result, 201);
}
