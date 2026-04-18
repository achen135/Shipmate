import { describe, expect, it } from "vitest";

import { IMPORT_CASES } from "./__fixtures__/import-cases";
import { fromEditor, toEditor } from "./editor";
import { fromImported } from "./structured";

describe("toEditor / fromEditor", () => {
  it.each(IMPORT_CASES)("round-trips $name unchanged", ({ faithful }) => {
    const content = fromImported(faithful);
    expect(fromEditor(toEditor(content))).toEqual(content);
  });

  it("bullets are one per line; blank lines and spaces don't become bullets", () => {
    const state = toEditor(fromImported(IMPORT_CASES[0].faithful));
    const experience = state.sections[1];
    if (experience.layout !== "entries") throw new Error("fixture");
    experience.items[0].bullets = "  First thing \n\n Second thing\n";
    const out = fromEditor(state).sections[1];
    expect(out.layout === "entries" && out.items[0].bullets).toEqual([
      "First thing",
      "Second thing",
    ]);
  });

  it("list values are comma-separated", () => {
    const state = toEditor(fromImported(IMPORT_CASES[0].faithful));
    const skills = state.sections[3];
    if (skills.layout !== "list") throw new Error("fixture");
    skills.items[0].values = "Rust,  Go ,, Zig";
    const out = fromEditor(state).sections[3];
    expect(out.layout === "list" && out.items[0].values).toEqual([
      "Rust",
      "Go",
      "Zig",
    ]);
  });

  it("gives every section its own key, even with repeated titles", () => {
    const state = toEditor({
      header: { name: "", email: "", phone: "", links: [] },
      sections: [
        { title: "", layout: "text", text: "a" },
        { title: "", layout: "text", text: "b" },
      ],
    });
    expect(state.sections[0].key).not.toBe(state.sections[1].key);
  });
});
