import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SecondLook } from "./second-look";

describe("SecondLook", () => {
  it("lists the notes apart from what changed, and says none were applied", () => {
    render(
      <SecondLook
        suggestions={[
          { what: "“Built a caching layer” could name Redis." },
          { what: "Two bullets start with “Built”." },
        ]}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "A second look" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText(/didn't change anything here/)).toBeInTheDocument();
    // No second "Edit this copy" link: the one above the changes is enough.
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("renders nothing without notes", () => {
    const { container } = render(<SecondLook suggestions={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
