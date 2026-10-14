import { describe, expect, it } from "vitest";

import { pdfFileName } from "./pdf-name";

describe("pdfFileName", () => {
  it("First_Last_Resume_Company.pdf, ASCII-safe", () => {
    expect(pdfFileName("Jordan Lee", "Jane Street")).toBe(
      "Jordan_Lee_Resume_Jane_Street.pdf",
    );
    expect(pdfFileName("José Núñez", "AT&T, Inc.")).toBe(
      "Jose_Nunez_Resume_AT_T_Inc.pdf",
    );
    expect(pdfFileName("", "")).toBe("My_Resume.pdf");
  });
});
