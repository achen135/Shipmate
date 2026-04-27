import { z } from "zod";

import { getInvited } from "@/lib/auth/viewer";
import { parseContent } from "@/lib/resume/structured";
import { createClient } from "@/lib/supabase/server";

/**
 * "Tailor this": POST { postingId } → queue a tailoring for the signed-in
 * user's Inbox row for that posting. The database inserts the row only
 * within the daily cap and in AI mode (tailorings_before_insert), and starts
 * the tailor workflow (dispatch_tailor); this checks the same things first
 * so the user gets a clear message instead of a constraint error, and
 * nothing is spent past the cap.
 */

const bodySchema = z.object({ postingId: z.uuid() });

const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { "cache-control": "private, no-store" },
  });

export async function POST(request: Request) {
  const viewer = await getInvited();
  if (!viewer) return json({ message: "Sign in first." }, 401);

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ message: "Which posting?" }, 400);

  const supabase = await createClient();
  const [profile, resume, item] = await Promise.all([
    supabase.from("profiles").select("mode, daily_cap").maybeSingle(),
    supabase.from("resumes").select("content").maybeSingle(),
    supabase
      .from("user_postings")
      .select("id")
      .eq("posting_id", parsed.data.postingId)
      .maybeSingle(),
  ]);
  if (profile.error || resume.error || item.error) {
    console.error("[tailor] queue: load failed");
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
  if (!item.data) {
    return json(
      { message: "Only postings in your Inbox can be tailored." },
      404,
    );
  }

  const { data, error } = await supabase
    .from("tailorings")
    .insert({ user_posting_id: item.data.id })
    .select("id")
    .single();
  if (error) {
    if (/Daily cap reached/.test(error.message)) {
      const cap = profile.data.daily_cap;
      return json(
        {
          message: `You've reached your daily cap of ${cap} tailored posting${cap === 1 ? "" : "s"}. It resets at midnight Eastern, or raise it in Profile → AI.`,
        },
        429,
      );
    }
    if (error.code === "23505") {
      return json({ message: "Already tailoring this one." }, 409);
    }
    console.error("[tailor] queue failed:", error.code);
    return json({ message: "Couldn't start tailoring. Try again." }, 500);
  }
  return json({ id: data.id }, 201);
}
