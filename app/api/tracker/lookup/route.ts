import { z } from "zod";

import { getMember } from "@/lib/auth/viewer";
import { withE2eOrigin } from "@/lib/e2e-origin";
import { fetchAtsJob } from "@/lib/tracker/ats-fetch";
import { type LookupResult, findExistingPosting } from "@/lib/tracker/lookup";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/tracker/lookup { url } → what Shipmate knows about a job link
 * (Tracker → Add): an existing posting, company/title/location read from a
 * Greenhouse / Lever / Ashby API, or nothing (the user fills in a form).
 * The ATS request runs here, server-side, with a short timeout.
 */

const bodySchema = z.object({
  url: z
    .string()
    .trim()
    .max(2000)
    .regex(/^https?:\/\/\S+$/i),
});

export async function POST(request: Request) {
  if (!(await getMember())) {
    return Response.json({ message: "Sign in first." }, { status: 401 });
  }
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return Response.json(
      { message: "Paste a full link (https://…)." },
      { status: 400 },
    );
  }
  const { url } = body.data;
  const supabase = await createClient();

  const posting = await findExistingPosting(url, async (key) => {
    const query = supabase
      .from("postings")
      .select("id, title, url, locations, status, company:companies(name)");
    const { data, error } = await (
      key.by === "ats"
        ? query.eq("ats", key.ats).eq("ats_job_id", key.jobId)
        : query.eq("canonical_url", key.canonicalUrl)
    )
      .order("first_seen_at")
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`lookup: ${error.message}`);
    return data;
  });

  if (posting) {
    const { data: row, error } = await supabase
      .from("user_postings")
      .select("id, status")
      .eq("posting_id", posting.id)
      .maybeSingle();
    if (error) throw new Error(`lookup row: ${error.message}`);
    return Response.json({
      kind: "posting",
      posting: {
        id: posting.id,
        company: posting.company?.name ?? "Unknown company",
        title: posting.title,
        location: posting.locations.join(" · ") || null,
        url: posting.url,
        closed: posting.status === "closed",
      },
      row,
    } satisfies LookupResult);
  }

  const job = await fetchAtsJob(url, withE2eOrigin(fetch, process.env));
  return Response.json(
    (job
      ? { kind: "fetched", job }
      : { kind: "unknown", url }) satisfies LookupResult,
  );
}
