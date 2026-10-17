import { describe, expect, test } from "bun:test";
import { htmlToText, stripQuotedReply } from "./email.ts";

test("strips tags and keeps paragraph and line breaks", () => {
  expect(htmlToText("<p>Hello <b>there</b>,</p><p>Line one<br>Line two</p>")).toBe(
    "Hello there,\nLine one\nLine two",
  );
});

test("drops script, style and head contents", () => {
  expect(
    htmlToText(
      "<head><title>x</title></head><style>p{color:red}</style><script>alert(1)</script><p>Body</p>",
    ),
  ).toBe("Body");
});

test("turns list items into dashes", () => {
  expect(htmlToText("<ul><li>One</li><li>Two</li></ul>")).toBe("- One\n- Two");
});

test("decodes named and numeric entities", () => {
  expect(htmlToText("Tom &amp; Jerry &lt;3 &quot;hi&quot; &#39;x&#39; &#x263A;&nbsp;!")).toBe(
    "Tom & Jerry <3 \"hi\" 'x' ☺ !",
  );
});

test("leaves unknown or out-of-range entities alone", () => {
  expect(htmlToText("&bogus; &#99999999;")).toBe("&bogus; &#99999999;");
});

test("collapses runs of blank lines", () => {
  expect(htmlToText("<p>A</p><p></p><p></p><p>B</p>")).toBe("A\n\nB");
});

describe("stripQuotedReply", () => {
  test("drops a Gmail-style quote, including a wrapped header", () => {
    expect(
      stripQuotedReply(
        "Still broken, sorry.\n\nOn Mon, 4 May 2026 at 10:00, Help Desk\n<support@example.com> wrote:\n> Have you tried another browser?\n",
      ),
    ).toBe("Still broken, sorry.");
    expect(
      stripQuotedReply("Thanks!\r\n\r\nOn Mon, May 4, 2026 at 10:00 AM Sam <s@x.com> wrote:\r\n> hi"),
    ).toBe("Thanks!");
  });

  test("drops an Outlook-style quote", () => {
    expect(
      stripQuotedReply("That worked.\n\n-----Original Message-----\nFrom: Help Desk\nHi Sam"),
    ).toBe("That worked.");
    expect(stripQuotedReply("That worked.\n\n________________________________\nFrom: Help Desk")).toBe(
      "That worked.",
    );
  });

  test("drops trailing > quoted lines but keeps inline ones", () => {
    expect(stripQuotedReply("> You said:\n> try again\nI did.\n\n> earlier\n> text")).toBe(
      "> You said:\n> try again\nI did.",
    );
  });

  test("keeps text with no quote, and keeps everything if only a quote is sent", () => {
    expect(stripQuotedReply("  Line one\nLine two  ")).toBe("Line one\nLine two");
    expect(stripQuotedReply("> only quoted")).toBe("> only quoted");
  });
});
