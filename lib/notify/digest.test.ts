import { describe, expect, it } from "vitest";

import {
  type MatchedPosting,
  digestBody,
  emailContent,
  planDigests,
  pushPayload,
} from "./digest";

const postings = new Map<string, MatchedPosting>([
  ["p1", { companyId: "c-stripe", company: "Stripe" }],
  ["p2", { companyId: "c-stripe", company: "Stripe" }],
  ["p3", { companyId: "c-ramp", company: "Ramp" }],
  ["p4", { companyId: "c-acme", company: "Acme" }],
]);
const none = new Map<string, Set<string>>();
const m = (userId: string, postingId: string) => ({ userId, postingId });

describe("digestBody", () => {
  it("names the company when there is exactly one match", () => {
    expect(digestBody(1, ["Stripe"], [])).toBe("1 new match at Stripe");
  });

  it("names the company when every match is at one company", () => {
    expect(digestBody(3, ["Stripe"], [])).toBe("3 new matches at Stripe");
  });

  it("is just a count across several companies", () => {
    expect(digestBody(4, ["Stripe", "Ramp"], [])).toBe("4 new matches");
  });

  it("names priority companies, even among many", () => {
    expect(digestBody(5, ["Ramp", "Stripe", "Acme"], ["Ramp"])).toBe(
      "5 new matches, including Ramp",
    );
    expect(digestBody(1, ["Ramp"], ["Ramp"])).toBe("1 new match at Ramp");
  });

  it("names at most two, and counts the rest", () => {
    expect(digestBody(9, ["A", "B", "C", "D"], ["A", "B", "C", "D"])).toBe(
      "9 new matches, including A, B +2 more",
    );
  });
});

describe("planDigests", () => {
  it("makes one digest per user, however many postings matched", () => {
    const digests = planDigests(
      [m("u1", "p1"), m("u1", "p2"), m("u1", "p3"), m("u2", "p4")],
      postings,
      none,
    );
    expect(digests).toHaveLength(2);
    const u1 = digests.find((d) => d.userId === "u1")!;
    expect(u1).toMatchObject({
      count: 3,
      companies: ["Stripe", "Ramp"],
      body: "3 new matches",
    });
    expect(digests.find((d) => d.userId === "u2")?.body).toBe(
      "1 new match at Acme",
    );
  });

  it("puts priority companies first and names them", () => {
    const [digest] = planDigests(
      [m("u1", "p1"), m("u1", "p2"), m("u1", "p3")],
      postings,
      new Map([["u1", new Set(["c-ramp"])]]),
    );
    expect(digest.companies).toEqual(["Ramp", "Stripe"]);
    expect(digest.priority).toEqual(["Ramp"]);
    expect(digest.body).toBe("3 new matches, including Ramp");
  });

  it("only counts a user's own priorities", () => {
    const digests = planDigests(
      [m("u1", "p3"), m("u2", "p3")],
      postings,
      new Map([["u1", new Set(["c-ramp"])]]),
    );
    expect(digests.find((d) => d.userId === "u1")?.priority).toEqual(["Ramp"]);
    expect(digests.find((d) => d.userId === "u2")?.priority).toEqual([]);
  });

  it("makes nothing when there are no matches", () => {
    expect(planDigests([], postings, none)).toEqual([]);
  });

  it("skips a match whose posting can't be found", () => {
    expect(planDigests([m("u1", "gone")], postings, none)).toEqual([]);
  });
});

describe("what is sent", () => {
  const [digest] = planDigests([m("u1", "p1")], postings, none);

  it("sends the body and opens the Inbox", () => {
    expect(pushPayload(digest)).toEqual({
      title: "Shipmate",
      body: "1 new match at Stripe",
      url: "/inbox",
    });
  });

  it("sends the same line by email, with a link and how to stop", () => {
    const email = emailContent(digest, "https://shipmate-jobs.vercel.app/");
    expect(email.subject).toBe("Shipmate: 1 new match at Stripe");
    expect(email.text).toContain("https://shipmate-jobs.vercel.app/inbox");
    expect(email.text).toContain("Profile → Notifications");
  });

  it("never carries more than counts and company names", () => {
    const payload = JSON.stringify(pushPayload(digest));
    expect(Object.keys(JSON.parse(payload)).sort()).toEqual([
      "body",
      "title",
      "url",
    ]);
  });
});
