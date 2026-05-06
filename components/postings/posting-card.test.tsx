import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PostingCard, type PostingCardData } from "./posting-card";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("@/app/(app)/postings/actions", () => ({ changeStatus: vi.fn() }));

const base: PostingCardData = {
  id: "up1",
  unseen: false,
  posting: {
    id: "p1",
    title: "Backend Intern",
    url: "https://example.com/job",
    company: "Tidewater",
    locations: ["Boston, MA"],
    sourceNames: ["Greenhouse"],
    closed: false,
  },
  postedLabel: "posted 2h ago",
  tailoring: null,
};

describe("PostingCard: tailoring", () => {
  it("shows a spinner while the worker tailors it", () => {
    render(
      <PostingCard
        data={{ ...base, tailoring: { kind: "working" } }}
        mode="inbox"
      />,
    );
    expect(screen.getByTestId("card-tailoring")).toHaveTextContent(
      "Tailoring…",
    );
    expect(screen.queryByTestId("card-fit-score")).toBeNull();
  });

  it("shows the fit score once it's done", () => {
    render(
      <PostingCard
        data={{ ...base, tailoring: { kind: "score", score: 87 } }}
        mode="inbox"
      />,
    );
    expect(screen.getByTestId("card-fit-score")).toHaveTextContent("Fit 87%");
    expect(screen.queryByTestId("card-tailoring")).toBeNull();
  });

  it("shows neither without a tailoring", () => {
    render(<PostingCard data={base} mode="inbox" />);
    expect(screen.queryByTestId("card-fit-score")).toBeNull();
    expect(screen.queryByTestId("card-tailoring")).toBeNull();
  });
});
