import { describe, expect, it } from "vitest";

import { detectBoard } from "./detect";

const board = (input: string) => {
  const result = detectBoard(input);
  if (!result.ok) throw new Error(`not detected: ${input} (${result.reason})`);
  return result.board;
};

describe("detectBoard", () => {
  describe("Greenhouse", () => {
    it.each([
      "https://boards.greenhouse.io/stripe",
      "https://job-boards.greenhouse.io/stripe",
      "https://job-boards.greenhouse.io/stripe/jobs/8194287",
      "boards.greenhouse.io/stripe/",
      "https://boards.greenhouse.io/embed/job_board?for=stripe",
      "https://job-boards.eu.greenhouse.io/stripe",
    ])("%s", (input) => {
      expect(board(input)).toEqual({
        kind: "greenhouse",
        config: { slug: "stripe" },
        ref: "stripe",
        suggestedName: "Stripe",
      });
    });

    it("rejects the embed form without a company", () => {
      expect(
        detectBoard("https://boards.greenhouse.io/embed/job_board"),
      ).toEqual({
        ok: false,
        reason: "unsupported",
      });
    });
  });

  it("Lever, including the EU host", () => {
    expect(board("https://jobs.lever.co/palantir")).toMatchObject({
      kind: "lever",
      config: { slug: "palantir" },
    });
    expect(
      board(
        "https://jobs.lever.co/palantir/774cf5c9-bf6a-4d77-bf60-d50ef1beb1a0",
      ),
    ).toMatchObject({ config: { slug: "palantir" } });
    expect(board("https://jobs.eu.lever.co/acme-robotics").config).toEqual({
      slug: "acme-robotics",
      eu: true,
    });
    expect(board("https://jobs.eu.lever.co/acme-robotics").suggestedName).toBe(
      "Acme Robotics",
    );
  });

  it("Ashby", () => {
    expect(board("https://jobs.ashbyhq.com/ramp")).toMatchObject({
      kind: "ashby",
      config: { slug: "ramp" },
      suggestedName: "Ramp",
    });
    expect(board("https://jobs.ashbyhq.com/ramp/b39ceb08-a0a7")).toMatchObject({
      config: { slug: "ramp" },
    });
  });

  describe("SmartRecruiters", () => {
    it.each([
      "https://jobs.smartrecruiters.com/AbbVie",
      "https://jobs.smartrecruiters.com/AbbVie/3743990016066061-intern",
      "https://careers.smartrecruiters.com/AbbVie",
      "https://www.smartrecruiters.com/jobs?company=AbbVie",
    ])("%s", (input) => {
      expect(board(input)).toMatchObject({
        kind: "smartrecruiters",
        config: { slug: "AbbVie" },
      });
    });

    it("other smartrecruiters.com pages are unsupported", () => {
      expect(detectBoard("https://www.smartrecruiters.com/pricing")).toEqual({
        ok: false,
        reason: "unsupported",
      });
    });
  });

  describe("Workday", () => {
    it("reads tenant, number, and site", () => {
      expect(
        board("https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite"),
      ).toEqual({
        kind: "workday",
        config: {
          tenant: "nvidia",
          wdNumber: 5,
          site: "NVIDIAExternalCareerSite",
        },
        ref: "nvidia / NVIDIAExternalCareerSite",
        suggestedName: "Nvidia",
      });
    });

    it("skips a language folder and ignores the rest of the path", () => {
      expect(
        board(
          "https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/job/US-CA/Intern_JR1",
        ).config,
      ).toEqual({
        tenant: "nvidia",
        wdNumber: 5,
        site: "NVIDIAExternalCareerSite",
      });
    });

    it("needs a site", () => {
      expect(detectBoard("https://nvidia.wd5.myworkdayjobs.com/")).toEqual({
        ok: false,
        reason: "unsupported",
      });
      expect(detectBoard("https://nvidia.wd5.myworkdayjobs.com/en-US")).toEqual(
        {
          ok: false,
          reason: "unsupported",
        },
      );
    });
  });

  describe("anything else is unsupported, not a crash", () => {
    it.each([
      "https://www.stripe.com/jobs",
      "https://careers.google.com/jobs",
      "https://example.icims.com/jobs",
      "https://jobs.lever.co/",
      "https://boards.greenhouse.io/",
      "https://evil.example/boards.greenhouse.io/stripe",
      "https://jobs.lever.co.evil.example/palantir",
    ])("%s", (input) => {
      expect(detectBoard(input)).toEqual({ ok: false, reason: "unsupported" });
    });

    it.each([
      "",
      "   ",
      "stripe",
      "hello world",
      "javascript:alert(1)",
      "ftp://x.io/a",
      "https://",
    ])("%j is not a link", (input) => {
      expect(detectBoard(input)).toEqual({ ok: false, reason: "not_a_link" });
    });

    it("a slug with odd characters is unsupported", () => {
      expect(detectBoard("https://boards.greenhouse.io/a%20b")).toEqual({
        ok: false,
        reason: "unsupported",
      });
    });
  });
});
