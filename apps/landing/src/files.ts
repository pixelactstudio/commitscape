import { LANDING_URL } from "./env";

/** The sitemap: the one page there is. */
export function sitemap(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${LANDING_URL}/</loc></url>\n</urlset>\n`;
}

/** What crawlers may read: everything, with the sitemap's address. */
export function robots(): string {
  return `User-agent: *\nAllow: /\n\nSitemap: ${LANDING_URL}/sitemap.xml\n`;
}
