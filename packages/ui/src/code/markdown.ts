const HTML_COMMENT = /<!--[\s\S]*?-->/g;
const IMG_TAG = /<img\s[^>]*src=["']([^"']+)["'][^>]*>/gi;
const ALT = /alt=["']([^"']*)["']/i;
const TAGS = /<\/?(?:p|div|a|br|picture|source|h[1-6]|sup|sub|details|summary|b|strong|em|i|span|table|tr|td|th|tbody|thead|kbd|code|hr)(?:\s[^>]*)?\/?>/gi;

/** Markdown with the bits of HTML READMEs lean on made plain: images as Markdown images, other tags dropped, so nothing is shown as raw markup. */
export function plainMarkdown(text: string): string {
  return text
    .replace(HTML_COMMENT, "")
    .replace(IMG_TAG, (tag, src: string) => `![${ALT.exec(tag)?.[1] ?? ""}](${src})`)
    .replace(TAGS, "");
}
