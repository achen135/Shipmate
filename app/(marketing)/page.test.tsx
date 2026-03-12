import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import HomePage from "./page";

describe("HomePage", () => {
  it("names the app and states it never submits for you", () => {
    render(<HomePage />);
    expect(
      screen.getByRole("heading", { level: 1, name: /internship season/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("ShipMate")).toBeInTheDocument();
    expect(
      screen.getByText(/never submits anything for you/i),
    ).toBeInTheDocument();
  });

  it("links to sign-in", () => {
    render(<HomePage />);
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/sign-in",
    );
  });
});
