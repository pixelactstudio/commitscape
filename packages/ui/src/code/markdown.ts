const SRC = /\ssrc=["']([^"']+)["']/i;
const ALT = /alt=["']([^"']*)["']/i;
const TAGS = /<\/?(?:p|div|a|br|picture|source|h[1-6]|sup|sub|details|summary|b|strong|em|i|span|table|tr|td|th|tbody|thead|kbd|code|hr)(?:\s[^>]*)?\/?>/gi;

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
  return imagesAsMarkdown(withoutComments(text))
    .replace(TAGS, "")
    .replaceAll("<!--", "&lt;!--");
}
