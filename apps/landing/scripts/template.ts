/** The HTML template with the page drawn into it: its head where the template marks it, its theme after the stylesheet (so the theme's layers fall in the order Astryx declares them) and its body. */
export function fillTemplate(template: string, page: { head: string; theme: string; body: string }): string {
  return template
    .replace("<!--head-->", () => page.head)
    .replace("</head>", () => `  ${page.theme}\n  </head>`)
    .replace("<!--body-->", () => page.body);
}
