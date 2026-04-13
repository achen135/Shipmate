/**
 * One notification per user per Watch run (CLAUDE.md M5): "N new matches",
 * naming the company when there is exactly one, or when any match is at a
 * company the user marked priority (follows.priority; this is where it is
 * finally read). Counts and company names only: nothing from a resume or an
 * answer sheet ever goes in a notification.
 */

export type Match = { userId: string; postingId: string };
export type MatchedPosting = { companyId: string; company: string };

export type Digest = {
  userId: string;
  count: number;
  /** Distinct companies, most matches first. */
  companies: string[];
  /** The priority ones among them, in the same order. */
  priority: string[];
  body: string;
};

const MAX_NAMED = 2;

export function digestBody(
  count: number,
  companies: string[],
  priority: string[],
): string {
  const noun = count === 1 ? "new match" : "new matches";
  if (priority.length > 0) {
    const named = priority.slice(0, MAX_NAMED).join(", ");
    const more = priority.length - MAX_NAMED;
    const including = `${named}${more > 0 ? ` +${more} more` : ""}`;
    return count === 1
      ? `1 new match at ${including}`
      : `${count} ${noun}, including ${including}`;
  }
  if (companies.length === 1) return `${count} ${noun} at ${companies[0]}`;
  return `${count} ${noun}`;
}

/** Pure: who gets told what, from the rows this run's matching inserted. */
export function planDigests(
  matches: Match[],
  postings: Map<string, MatchedPosting>,
  priorityByUser: Map<string, Set<string>>,
): Digest[] {
  const byUser = new Map<string, Match[]>();
  for (const match of matches) {
    // A match whose posting vanished can't be described; skip it.
    if (!postings.has(match.postingId)) continue;
    const list = byUser.get(match.userId) ?? [];
    list.push(match);
    byUser.set(match.userId, list);
  }

  const digests: Digest[] = [];
  for (const [userId, rows] of byUser) {
    const prioritized = priorityByUser.get(userId) ?? new Set<string>();
    const perCompany = new Map<
      string,
      { name: string; count: number; priority: boolean }
    >();
    for (const row of rows) {
      const posting = postings.get(row.postingId)!;
      const entry = perCompany.get(posting.companyId) ?? {
        name: posting.company,
        count: 0,
        priority: prioritized.has(posting.companyId),
      };
      entry.count += 1;
      perCompany.set(posting.companyId, entry);
    }
    const ordered = [...perCompany.values()].sort(
      (a, b) => b.count - a.count || a.name.localeCompare(b.name),
    );
    // Priority companies first, then the rest.
    const companies = [
      ...ordered.filter((c) => c.priority),
      ...ordered.filter((c) => !c.priority),
    ].map((c) => c.name);
    const priority = ordered.filter((c) => c.priority).map((c) => c.name);
    digests.push({
      userId,
      count: rows.length,
      companies,
      priority,
      body: digestBody(rows.length, companies, priority),
    });
  }
  return digests;
}

/** What goes to a device: the page it opens and a short body. */
export type PushPayload = { title: string; body: string; url: string };

export function pushPayload(digest: Digest): PushPayload {
  return { title: "Shipmate", body: digest.body, url: "/inbox" };
}

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/**
 * The fallback email, as plain text and as a small HTML version with the app
 * logo (hosted at /icons/icon-192.png on the app itself). Company names come
 * from job feeds, so they are escaped before going into the HTML.
 */
export function emailContent(digest: Digest, appUrl: string) {
  const base = appUrl.replace(/\/$/, "");
  const inbox = `${base}/inbox`;
  const why =
    "You're getting this by email because notifications aren't turned on " +
    "for any of your devices. Turn on push, or switch these emails off, " +
    "in Profile → Notifications.";
  return {
    subject: `Shipmate: ${digest.body}`,
    text: `${digest.body}.\n\nOpen your Inbox: ${inbox}\n\n${why}\n`,
    html:
      '<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1f2a4d">' +
      `<img src="${escapeHtml(base)}/icons/icon-192.png" width="48" height="48" alt="Shipmate" style="border-radius:10px;display:block;margin-bottom:16px">` +
      `<p style="font-size:18px;margin:0 0 16px">${escapeHtml(digest.body)}</p>` +
      `<p style="margin:0 0 24px"><a href="${escapeHtml(inbox)}" style="background:#1f2a4d;color:#f8f3e8;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block">Open your Inbox</a></p>` +
      `<p style="font-size:13px;color:#6b7280;margin:0">${escapeHtml(why)}</p>` +
      "</div>",
  };
}
