/**
 * The product's name and the Site's origin, each in one place, because the
 * name may change before launch (ADR-0014). The CLI reads `SITE_ORIGIN`
 * from this file when it is built; `COMMITSCAPE_SITE` overrides it.
 */

/** What the product is called, everywhere it names itself. */
export const PRODUCT = "commitscape";

/**
 * Where the Site is served. No domain is bought yet, so this is a name that
 * can never resolve: set it before the first deploy (DEPLOY.md).
 */
export const SITE_ORIGIN = "https://commitscape.invalid";
