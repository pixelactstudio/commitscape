const query = (theme: "light" | "dark", style: string) => [theme === "dark" ? "theme=dark" : "", style].filter(Boolean).join("&");

/** The README Markdown for a Card in a style: GitHub picks the dark one when the reader's theme is dark. */
export function markdownOf(url: string, alt: string, link: string, style = ""): string {
  const light = query("light", style);
  return [
    `<a href="${link}">`,
    "  <picture>",
    `    <source media="(prefers-color-scheme: dark)" srcset="${url}.svg?${query("dark", style)}">`,
    `    <img alt="${alt}" src="${url}.svg${light ? `?${light}` : ""}">`,
    "  </picture>",
    "</a>",
  ].join("\n");
}

/** A Card's image address in a theme and style. */
export function cardSrc(url: string, format: "svg" | "png", theme: "light" | "dark", style = ""): string {
  const q = query(theme, style);
  return `${url}.${format}${q ? `?${q}` : ""}`;
}
