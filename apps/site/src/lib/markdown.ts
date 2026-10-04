/** The README Markdown for a Card: GitHub picks the dark one when the reader's theme is dark. */
export function markdownOf(url: string, alt: string, link: string): string {
  return [
    `<a href="${link}">`,
    "  <picture>",
    `    <source media="(prefers-color-scheme: dark)" srcset="${url}.svg?theme=dark">`,
    `    <img alt="${alt}" src="${url}.svg">`,
    "  </picture>",
    "</a>",
  ].join("\n");
}
