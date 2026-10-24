const SRC = /\ssrc=["']([^"']+)["']/i;
const ALT = /alt=["']([^"']*)["']/i;
const KEPT_OUT = new Set(["p", "div", "a", "br", "picture", "source", "h1", "h2", "h3", "h4", "h5", "h6", "sup", "sub", "details", "summary", "b", "strong", "em", "i", "span", "table", "tr", "td", "th", "tbody", "thead", "kbd", "code", "hr"]);

function imagesAsMarkdown(text: string): string {
  const lower = text.toLowerCase();
  let out = "";
  let at = 0;
  for (;;) {
    const open = lower.indexOf("<img", at);
    if (open < 0) return out + text.slice(at);
    const close = text.indexOf(">", open);
    if (close < 0) return out + text.slice(at);
    const tag = text.slice(open, close + 1);
    const src = /\s/.test(tag[4] ?? "") ? SRC.exec(tag)?.[1] : undefined;
    out += text.slice(at, open) + (src ? `![${ALT.exec(tag)?.[1] ?? ""}](${src})` : tag);
    at = close + 1;
  }
}

function withoutTags(text: string): string {
  let out = "";
  let at = 0;
  let from = 0;
  for (;;) {
    const open = text.indexOf("<", from);
    if (open < 0) return out + text.slice(at);
    let i = open + 1;
    if (text[i] === "/") i++;
    let end = i;
    while (end < text.length && /[a-zA-Z0-9]/.test(text[end] as string)) end++;
    const name = text.slice(i, end).toLowerCase();
    const next = text[end];
    const kept = KEPT_OUT.has(name) && (next === ">" || next === "/" || (next !== undefined && /\s/.test(next)));
    const close = kept ? text.indexOf(">", end) : -1;
    if (kept && close < 0) return out + text.slice(at);
    if (close < 0) {
      from = open + 1;
      continue;
    }
    out += text.slice(at, open);
    at = from = close + 1;
  }
}

function withoutComments(text: string): string {
  let out = "";
  let at = 0;
  for (;;) {
    const open = text.indexOf("<!--", at);
    if (open < 0) return out + text.slice(at);
    out += text.slice(at, open);
    const close = text.indexOf("-->", open + 4);
    if (close < 0) return out;
    at = close + 3;
  }
}

/** Markdown with the bits of HTML READMEs lean on made plain: images as Markdown images, other tags dropped, so nothing is shown as raw markup. */
export function plainMarkdown(text: string): string {
  return withoutTags(imagesAsMarkdown(withoutComments(text))).replaceAll("<!--", "&lt;!--");
}
