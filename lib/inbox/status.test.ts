// @vitest-environment node
import { describe, expect, it } from "vitest";

import { statusChangeSchema, statusUpdate } from "./status";

const ID = "6d1c4a3e-6c39-4f61-9d55-2a9e7c1b0f11";

describe("statusChangeSchema / statusUpdate", () => {
  it("skipping keeps the reason, anything else clears it", () => {
    expect(
      statusUpdate(
        statusChangeSchema.parse({
          id: ID,
          status: "skipped",
          skipReason: "location",
        }),
      ),
    ).toEqual({ status: "skipped", skip_reason: "location" });
    expect(
      statusUpdate(statusChangeSchema.parse({ id: ID, status: "skipped" })),
    ).toEqual({ status: "skipped", skip_reason: null });
    expect(
      statusUpdate(statusChangeSchema.parse({ id: ID, status: "saved" })),
    ).toEqual({ status: "saved", skip_reason: null });
  });

  it("rejects tracker statuses (M3) and unknown reasons", () => {
    expect(
      statusChangeSchema.safeParse({ id: ID, status: "applied" }).success,
    ).toBe(false);
    expect(
      statusChangeSchema.safeParse({
        id: ID,
        status: "skipped",
        skipReason: "boring",
      }).success,
    ).toBe(false);
    expect(
      statusChangeSchema.safeParse({ id: "nope", status: "saved" }).success,
    ).toBe(false);
  });
});
