import { describe, expect, it } from "vitest";

import { decodeEntities, htmlToText } from "./text";

describe("decodeEntities", () => {
  it("decodes named and numeric entities, leaving unknown ones alone", () => {
    expect(decodeEntities("R&amp;D &#8211; it&rsquo;s &#x41; &bogus;")).toBe(
      "R&D – it’s A &bogus;",
    );
  });

  it("ignores impossible code points", () => {
    expect(decodeEntities("&#0; &#99999999;")).toBe("&#0; &#99999999;");
  });
});

describe("htmlToText", () => {
  it("turns Greenhouse's escaped HTML into text", () => {
    const text = htmlToText(
      "&lt;h2&gt;Who we are&lt;/h2&gt;\n&lt;p&gt;Stripe &amp;amp; friends&lt;/p&gt;&lt;ul&gt;&lt;li&gt;One&lt;/li&gt;&lt;li&gt;Two&lt;/li&gt;&lt;/ul&gt;",
    );
    expect(text).toBe("Who we are\n\nStripe & friends\n\n- One\n- Two");
  });

  it("strips real HTML and drops scripts and styles", () => {
    expect(
      htmlToText(
        '<style>p{color:red}</style><p style="x">Hello&nbsp;<b>world</b></p><script>alert(1)</script><br/>Bye',
      ),
    ).toBe("Hello world\n\nBye");
  });

  it("collapses blank runs", () => {
    expect(htmlToText("<p>a</p><p></p><p></p><p>b</p>")).toBe("a\n\nb");
  });
});
