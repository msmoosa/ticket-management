const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

// Plain-text version of an HTML email body, for emails sent without a text part.
// Deliberately simple: tickets store text, and the HTML is never rendered.
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr|blockquote)\s*>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "- ")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
      if (code[0] === "#") {
        const point =
          code[1] === "x" || code[1] === "X"
            ? Number.parseInt(code.slice(2), 16)
            : Number.parseInt(code.slice(1), 10);
        return Number.isFinite(point) && point <= 0x10ffff ? String.fromCodePoint(point) : entity;
      }
      return ENTITIES[code.toLowerCase()] ?? entity;
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Lines where a mail client starts quoting the earlier conversation in a reply.
const QUOTE_HEADERS = [
  // Gmail / Apple Mail: "On Mon, 4 May 2026 at 10:00, Sam <sam@example.com> wrote:" (may wrap).
  /^On\b[\s\S]{0,300}\bwrote:$/,
  // Outlook.
  /^-{2,}\s*Original Message\s*-{2,}$/i,
  /^_{10,}$/,
];

// The new text of an emailed reply, without the quoted conversation that mail clients append:
// everything from the first quote header ("On … wrote:", Outlook's separator) is dropped, then any
// trailing "> " quoted lines. Falls back to the whole text if nothing would be left.
export function stripQuotedReply(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");

  let end = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    // A wrapped "On … wrote:" header spans two lines.
    const joined = `${line} ${lines[i + 1]?.trim() ?? ""}`.trim();
    if (QUOTE_HEADERS.some((header) => header.test(line) || header.test(joined))) {
      end = i;
      break;
    }
  }
  while (end > 0 && /^\s*(>.*)?$/.test(lines[end - 1]!)) end--;

  const reply = lines.slice(0, end).join("\n").trim();
  return reply || text.trim();
}
