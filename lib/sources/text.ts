/**
 * Job descriptions arrive as HTML (Ashby), or as HTML that was entity-escaped
 * a second time (Greenhouse `content`). The review page wants plain text, and
 * the tag-strip below is all that takes; no HTML library needed.
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  bull: "•",
  middot: "·",
  copy: "©",
  reg: "®",
  trade: "™",
};

export function decodeEntities(text: string): string {
  return text.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,
    (whole, entity: string) => {
      if (entity[0] === "#") {
        const code =
          entity[1].toLowerCase() === "x"
            ? Number.parseInt(entity.slice(2), 16)
            : Number.parseInt(entity.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : whole;
      }
      return NAMED_ENTITIES[entity.toLowerCase()] ?? whole;
    },
  );
}

/**
 * HTML (or escaped HTML) → plain text: block tags become line breaks, list
 * items get a dash, every other tag disappears, entities are decoded, and
 * blank runs collapse.
 */
export function htmlToText(html: string): string {
  // Greenhouse sends "&lt;p&gt;…" with no real tag in sight: unescape once.
  const markup = /<[a-z!/]/i.test(html) ? html : decodeEntities(html);
  const text = markup
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<br\s*\/?>|<\/(p|div|h[1-6]|ul|ol|tr)>/gi, "\n")
    .replace(/<[^>]*>/g, "");
  return decodeEntities(text)
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
