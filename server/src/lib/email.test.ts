import { expect, test } from "bun:test";
import { htmlToText } from "./email.ts";

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
