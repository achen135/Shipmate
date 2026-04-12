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

export function emailContent(digest: Digest, appUrl: string) {
  return {
    subject: `Shipmate: ${digest.body}`,
    text:
      `${digest.body}.\n\n` +
      `Open your Inbox: ${appUrl.replace(/\/$/, "")}/inbox\n\n` +
      "You're getting this by email because notifications aren't turned on " +
      "for any of your devices. Turn on push, or switch these emails off, " +
      "in Profile → Notifications.\n",
  };
}
