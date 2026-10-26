import { renderToStaticMarkup } from "react-dom/server";
import { PRODUCT } from "@commitscape/data";
import { themeCss } from "@commitscape/ui/theme";
import { LANDING_URL } from "./env";
import { Page } from "./page/Page";

export const TITLE = `${PRODUCT}: what you have built, in numbers worth sharing`;

export const DESCRIPTION = "Your pull requests, reviews and the lines of yours that still run. Where you stand in every repository you work on. And Cards for your README, LinkedIn and X.";

const escape = (text: string) => text.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/** The page's head (title, description, Open Graph), its theme's CSS and its body, drawn as static HTML. */
export function render(): { head: string; theme: string; body: string } {
  const og = `${LANDING_URL}/og.png`;
  const meta: [string, string, string][] = [
    ["name", "description", DESCRIPTION],
    ["property", "og:type", "website"],
    ["property", "og:site_name", PRODUCT],
    ["property", "og:title", TITLE],
    ["property", "og:description", DESCRIPTION],
    ["property", "og:url", `${LANDING_URL}/`],
    ["property", "og:image", og],
    ["property", "og:image:width", "1200"],
    ["property", "og:image:height", "630"],
    ["property", "og:image:alt", "commitscape: what you’ve built, in numbers worth sharing."],
    ["name", "twitter:card", "summary_large_image"],
    ["name", "twitter:title", TITLE],
    ["name", "twitter:description", DESCRIPTION],
    ["name", "twitter:image", og],
  ];
  const head = [
    `<title>${escape(TITLE)}</title>`,
    `<link rel="canonical" href="${escape(`${LANDING_URL}/`)}">`,
    ...meta.map(([key, name, content]) => `<meta ${key}="${name}" content="${escape(content)}">`),
  ].join("\n    ");
  return { head, theme: `<style>${themeCss()}</style>`, body: renderToStaticMarkup(<Page />) };
}
