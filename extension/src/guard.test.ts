// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Hard rules 1 and 4 in the extension, checked in its source: nothing
 * submits a form, and the only click is fill.ts toggle() on a radio or
 * checkbox. A new way of doing either fails here and gets a deliberate look.
 */

const files = readdirSync(__dirname)
  .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
  .map((name) => ({
    name,
    // Code only: the comments describe these rules in the same words.
    text: readFileSync(join(__dirname, name), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, ""),
  }));

describe("the extension never submits", () => {
  it("has no submit(), requestSubmit() or submit event anywhere", () => {
    for (const { name, text } of files) {
      expect(text, name).not.toMatch(/\.submit\s*\(|requestSubmit|SubmitEvent/);
      expect(text, name).not.toMatch(
        /new\s+(Mouse|Pointer)?Event\(\s*["'](submit|click)/,
      );
    }
  });

  it("clicks only in toggle(), which refuses anything but a radio or checkbox", () => {
    const clicks = files.flatMap(({ name, text }) =>
      [...text.matchAll(/\.click\(\)/g)].map(() => name),
    );
    expect(clicks).toEqual(["fill.ts"]);
    const fill = files.find((f) => f.name === "fill.ts")!.text;
    const toggle = fill.slice(fill.indexOf("export function toggle"));
    expect(toggle.indexOf(".click()")).toBeLessThan(toggle.indexOf("\n}"));
    expect(toggle).toMatch(
      /input\.type !== "radio" && input\.type !== "checkbox"/,
    );
  });

  it("never sends its key anywhere but Shipmate", () => {
    const withAuth = files.filter(({ text }) => /authorization/i.test(text));
    expect(withAuth.map((f) => f.name).sort()).toEqual([
      "background.ts",
      "options.ts",
    ]);
    for (const { text } of withAuth) {
      // Every fetch goes to the configured Shipmate origin.
      for (const [call] of text.matchAll(/fetch\([^,)]*/g)) {
        expect(call).toMatch(/settings\.origin|next\.origin/);
      }
    }
  });
});
