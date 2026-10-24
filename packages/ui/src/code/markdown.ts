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
const IMG_TAG = /<img\s[^>]*src=["']([^"']+)["'][^>]*>/gi;
const ALT = /alt=["']([^"']*)["']/i;
const TAGS = /<\/?(?:p|div|a|br|picture|source|h[1-6]|sup|sub|details|summary|b|strong|em|i|span|table|tr|td|th|tbody|thead|kbd|code|hr)(?:\s[^>]*)?\/?>/gi;

/** Markdown with the bits of HTML READMEs lean on made plain: images as Markdown images, other tags dropped, so nothing is shown as raw markup. */
export function plainMarkdown(text: string): string {
  return withoutComments(text)
    .replace(IMG_TAG, (tag, src: string) => `![${ALT.exec(tag)?.[1] ?? ""}](${src})`)
    .replace(TAGS, "")
    .replaceAll("<!--", "&lt;!--");
}
