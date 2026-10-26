export const DEFAULT_APP_URL = "https://app.commitscape.com";

export const DEFAULT_LANDING_URL = "https://commitscape.com";

/** An absolute address without a trailing slash, from a setting or its default. */
export function baseOf(value: string | undefined, fallback: string): string {
  const url = new URL(value?.trim() || fallback);
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

export const APP_URL = baseOf(import.meta.env.PUBLIC_APP_URL, DEFAULT_APP_URL);

export const LANDING_URL = baseOf(import.meta.env.PUBLIC_LANDING_URL, DEFAULT_LANDING_URL);

/** An address on the app: the Site people sign in to. */
export const app = (path: string): string => `${APP_URL}${path}`;

export const SIGN_IN = app("/sign-in");

export const SOURCE = "https://github.com/pixelactstudio/commitscape";

export const THEME_KEY = "commitscape-theme";
