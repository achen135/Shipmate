import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { QueueItem } from "@/lib/tailor/review-queue";

import { FastReview } from "./fast-review";

const { changeStatus, toastError } = vi.hoisted(() => ({
  changeStatus: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock("@/app/(app)/postings/actions", () => ({ changeStatus }));
vi.mock("sonner", () => ({ toast: { error: toastError } }));

function item(n: number, over: Partial<QueueItem> = {}): QueueItem {
  return {
    id: `up${n}`,
    status: "new",
    posting: {
      id: `p${n}`,
      title: `Role ${n}`,
      company: `Company ${n}`,
      locations: ["Boston, MA"],
      closed: false,
    },
    onBackupModel: false,
    tailoring: {
      id: `t${n}`,
      state: "done",
      createdAt: "2026-10-18T12:00:00Z",
      rateLimitedAt: null,
      scoreBefore: 40 + n,
      scoreAfter: 70 + n,
      matched: ["Python"],
      missing: ["Go"],
      changes: [
        { what: `Moved Python up (${n})`, why: "the posting asks for it" },
        { what: `Reworded a bullet (${n})`, why: "uses its words" },
        { what: `Added Redis (${n})`, why: "it's in your facts" },
      ],
      suggestions: [],
      notes: [],
      warnings: [],
      hasPdf: true,
      pdfPending: false,
      edited: false,
      keySource: "shared",
      model: "flash",
      estCost: 0,
      error: null,
    },
    ...over,
  };
}

const press = (key: string, init: KeyboardEventInit = {}) =>
  act(() => {
    fireEvent.keyDown(window, { key, ...init });
  });
const flush = () => act(async () => {});
const rows = () => screen.getAllByTestId("queue-item");
const currentIndex = () =>
  rows().findIndex((r) => r.getAttribute("aria-current") === "true");

beforeEach(() => {
  changeStatus.mockReset().mockResolvedValue({ ok: true });
  toastError.mockReset();
});

describe("FastReview: what each item shows", () => {
  it("scores it and shows what changed without opening anything", () => {
    render(<FastReview items={[item(1)]} />);
    expect(screen.getByTestId("queue-score")).toHaveTextContent("41% → 71%");
    const changes = screen.getByTestId("queue-changes");
    expect(within(changes).getAllByRole("listitem")).toHaveLength(2);
    expect(changes).toHaveTextContent("Moved Python up (1)");
    expect(screen.getByText("+1 more")).toBeInTheDocument();
    expect(screen.queryByTestId("queue-detail")).toBeNull();
  });

  it("expands in place for the rest, and links to the full review page", () => {
    render(<FastReview items={[item(1)]} />);
    fireEvent.click(screen.getByRole("button", { name: /Role 1/ }));
    expect(screen.getByTestId("queue-detail")).toHaveTextContent("Go");
    expect(screen.getByText("Added Redis (1)")).toBeInTheDocument();
    expect(screen.getByText("Why: it's in your facts.")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open the tailored PDF" }),
    ).toHaveAttribute("href", "/api/tailorings/t1/pdf");
    expect(screen.getByRole("link", { name: "Open" })).toHaveAttribute(
      "href",
      "/postings/p1",
    );
  });

  it("says so when there was nothing to change, and when there is no score", () => {
    const quiet = item(1);
    quiet.tailoring.changes = [];
    quiet.tailoring.scoreAfter = null;
    render(<FastReview items={[quiet]} />);
    expect(screen.getByTestId("queue-score")).toHaveTextContent("No score");
    expect(screen.getByText(/No edits made/)).toBeInTheDocument();
  });

  it("flags warnings and the backup model", () => {
    const flagged = item(1, { onBackupModel: true });
    flagged.tailoring.warnings = [
      { kind: "low_score", message: "A weak match." },
    ];
    render(<FastReview items={[flagged]} />);
    expect(screen.getByText("1 warning")).toBeInTheDocument();
    expect(screen.getByText("Backup model")).toBeInTheDocument();
  });
});

describe("FastReview: keyboard", () => {
  it("j/k and the arrow keys move, and stop at the ends", () => {
    render(<FastReview items={[item(1), item(2), item(3)]} />);
    expect(currentIndex()).toBe(0);
    press("j");
    expect(currentIndex()).toBe(1);
    press("ArrowDown");
    press("ArrowDown");
    expect(currentIndex()).toBe(2);
    press("k");
    press("ArrowUp");
    press("ArrowUp");
    expect(currentIndex()).toBe(0);
  });

  it("e and Enter expand and collapse the current item", () => {
    render(<FastReview items={[item(1), item(2)]} />);
    press("e");
    expect(screen.getAllByTestId("queue-detail")).toHaveLength(1);
    press("Enter");
    expect(screen.queryByTestId("queue-detail")).toBeNull();
    press("j");
    press("e");
    expect(within(rows()[1]).getByTestId("queue-detail")).toBeInTheDocument();
  });

  it("Enter on a focused button leaves it to the button", () => {
    render(<FastReview items={[item(1)]} />);
    const save = screen.getByRole("button", { name: "Save" });
    save.focus();
    act(() => {
      fireEvent.keyDown(save, { key: "Enter" });
    });
    expect(screen.queryByTestId("queue-detail")).toBeNull();
  });

  it("s saves it, and moves on to the next one", async () => {
    render(<FastReview items={[item(1), item(2)]} />);
    press("s");
    await flush();
    expect(changeStatus).toHaveBeenCalledExactlyOnceWith({
      id: "up1",
      status: "saved",
    });
    expect(within(rows()[0]).getByTestId("queue-decision")).toHaveTextContent(
      "Saved to To Apply",
    );
    expect(currentIndex()).toBe(1);
    expect(screen.getByTestId("queue-count")).toHaveTextContent(
      "1 of 2 left to review.",
    );
  });

  it("x skips it, with no reason, and moves on", async () => {
    render(<FastReview items={[item(1), item(2)]} />);
    press("x");
    await flush();
    expect(changeStatus).toHaveBeenCalledExactlyOnceWith({
      id: "up1",
      status: "skipped",
    });
    expect(within(rows()[0]).getByTestId("queue-decision")).toHaveTextContent(
      "Skipped",
    );
    expect(currentIndex()).toBe(1);
  });

  it("moves on past ones already decided", async () => {
    render(<FastReview items={[item(1), item(2), item(3)]} />);
    press("j");
    press("x"); // item 2, on to 3
    await flush();
    press("k");
    press("k");
    expect(currentIndex()).toBe(0);
    press("s"); // item 1: next undecided is 3, not the skipped 2
    await flush();
    expect(currentIndex()).toBe(2);
  });

  it("u puts it back as it was, on the server too", async () => {
    render(<FastReview items={[item(1), item(2)]} />);
    press("x");
    await flush();
    press("k");
    press("u");
    await flush();
    expect(changeStatus).toHaveBeenLastCalledWith({ id: "up1", status: "new" });
    expect(within(rows()[0]).queryByTestId("queue-decision")).toBeNull();
    expect(screen.getByTestId("queue-count")).toHaveTextContent(
      "2 of 2 left to review.",
    );
  });

  it("o opens the full review page in a new tab", () => {
    render(<FastReview items={[item(1), item(2)]} />);
    press("j");
    const link = within(rows()[1]).getByRole("link", { name: "Open" });
    expect(link).toHaveAttribute("target", "_blank");
    const click = vi.spyOn(link, "click");
    press("o");
    expect(click).toHaveBeenCalledOnce();
  });

  it("ignores keys typed into a field, and with a modifier held", async () => {
    render(
      <>
        <input aria-label="note" />
        <FastReview items={[item(1), item(2)]} />
      </>,
    );
    const input = screen.getByLabelText("note");
    act(() => {
      fireEvent.keyDown(input, { key: "s" });
      fireEvent.keyDown(input, { key: "j" });
    });
    press("s", { metaKey: true });
    press("x", { ctrlKey: true });
    await flush();
    expect(changeStatus).not.toHaveBeenCalled();
    expect(currentIndex()).toBe(0);
  });
});

describe("FastReview: Save and Skip", () => {
  it("the buttons do the same as the keys, on the row they're in", async () => {
    render(<FastReview items={[item(1), item(2)]} />);
    fireEvent.click(within(rows()[1]).getByRole("button", { name: "Skip" }));
    await flush();
    expect(changeStatus).toHaveBeenCalledExactlyOnceWith({
      id: "up2",
      status: "skipped",
    });
  });

  it("keeping one already in To Apply changes nothing on the server", async () => {
    render(<FastReview items={[item(1, { status: "saved" })]} />);
    expect(screen.getByText("In To Apply")).toBeInTheDocument();
    press("s");
    await flush();
    expect(changeStatus).not.toHaveBeenCalled();
    expect(screen.getByTestId("queue-decision")).toHaveTextContent(
      "Kept in To Apply",
    );
  });

  it("skipping one in To Apply and undoing puts it back to saved", async () => {
    render(<FastReview items={[item(1, { status: "saved" })]} />);
    press("x");
    await flush();
    press("u");
    await flush();
    expect(changeStatus.mock.calls.map(([c]) => c.status)).toEqual([
      "skipped",
      "saved",
    ]);
  });

  it("a failed update puts the row back and says so", async () => {
    changeStatus.mockResolvedValue({ ok: false, message: "Couldn't update." });
    render(<FastReview items={[item(1), item(2)]} />);
    press("x");
    await flush();
    expect(toastError).toHaveBeenCalledWith("Couldn't update.");
    expect(within(rows()[0]).queryByTestId("queue-decision")).toBeNull();
    expect(screen.getByTestId("queue-count")).toHaveTextContent(
      "2 of 2 left to review.",
    );
  });

  it("Save then Skip pressed quickly reach the server in that order", async () => {
    const order: string[] = [];
    let release: (() => void) | undefined;
    changeStatus.mockImplementationOnce(async (change) => {
      await new Promise<void>((resolve) => (release = resolve));
      order.push(change.status);
      return { ok: true };
    });
    changeStatus.mockImplementationOnce(async (change) => {
      order.push(change.status);
      return { ok: true };
    });
    render(<FastReview items={[item(1), item(2)]} />);
    press("s");
    press("k");
    press("x");
    await flush();
    expect(changeStatus).toHaveBeenCalledTimes(1); // the second waits
    release?.();
    await flush();
    await flush();
    expect(order).toEqual(["saved", "skipped"]);
  });
});
