import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TailoringProgress } from "./tailoring";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

describe("TailoringProgress", () => {
  it("waiting on the shared key: offers a free key of their own", () => {
    render(<TailoringProgress state="queued" waitingForQuota shared />);
    expect(
      screen.getByText(/Shipmate's shared free AI is busy/),
    ).toBeInTheDocument();
    expect(screen.getByTestId("own-key-nudge")).toHaveTextContent(
      "about 2 minutes, still $0",
    );
    expect(
      screen.getByRole("link", { name: "Add your own free key" }),
    ).toHaveAttribute("href", "/profile/ai");
  });

  it("waiting on their own key: says so, and doesn't blame or advertise the shared one", () => {
    render(<TailoringProgress state="queued" waitingForQuota shared={false} />);
    expect(screen.getByRole("status")).toHaveTextContent(
      /^Waiting: your AI key is rate-limited/,
    );
    expect(screen.queryByText(/shared free AI/)).toBeNull();
    expect(screen.queryByTestId("own-key-nudge")).toBeNull();
  });

  it("not waiting: no nudge", () => {
    render(
      <TailoringProgress state="running" waitingForQuota={false} shared />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(/Charting course/);
    expect(screen.queryByTestId("own-key-nudge")).toBeNull();
  });
});
