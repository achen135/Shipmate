import { describe, expect, it } from "vitest";

import { describeResumeUsed, parseResumeUsed } from "./resume-used";

const tailored = {
  kind: "tailored",
  bucket: "pdfs",
  path: "u/p/abc.pdf",
  tailoring_id: "t1",
  edited: false,
  recorded_at: "2026-05-07T10:00:00Z",
};

describe("resume_used", () => {
  it("parses what record_resume_used writes, and nothing else", () => {
    expect(parseResumeUsed(tailored)?.path).toBe("u/p/abc.pdf");
    expect(parseResumeUsed(null)).toBeNull();
    expect(parseResumeUsed({ ...tailored, bucket: "avatars" })).toBeNull();
    expect(parseResumeUsed({ kind: "tailored" })).toBeNull();
  });

  it("says which resume went", () => {
    expect(describeResumeUsed(parseResumeUsed(tailored)!)).toBe(
      "Your tailored resume for this posting",
    );
    expect(
      describeResumeUsed(parseResumeUsed({ ...tailored, edited: true })!),
    ).toBe("Your tailored resume for this posting, as you edited it");
    expect(
      describeResumeUsed(
        parseResumeUsed({
          kind: "uploaded",
          bucket: "uploads",
          path: "u/resume-x.pdf",
          file_name: "Me.pdf",
          recorded_at: "2026-05-07T10:00:00Z",
        })!,
      ),
    ).toBe("Your uploaded resume (Me.pdf)");
  });
});
