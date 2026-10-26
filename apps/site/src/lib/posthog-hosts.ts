export const INGEST = "/ingest";

const CLOUD = /^(us|eu)\.i\.posthog\.com$/;

/** Where PostHog serves its scripts and remote settings for an API host: its regional assets host on PostHog Cloud, else the host itself. */
export function assetsHostOf(apiHost: string): string {
  const url = new URL(apiHost);
  const cloud = CLOUD.exec(url.hostname);
  return cloud ? `https://${cloud[1]}-assets.i.posthog.com` : url.origin;
}

/** PostHog's own app for an API host, which its links and toolbar open. */
export function uiHostOf(apiHost: string): string {
  const url = new URL(apiHost);
  const cloud = CLOUD.exec(url.hostname);
  return cloud ? `https://${cloud[1]}.posthog.com` : url.origin;
}
