import { createHmac } from "node:crypto";

/** The id PostHog knows a signed-in person by: a keyed hash of their account id, the same on the Site and the Builder, from which neither the id nor their login can be worked back without the server's secret. */
export function analyticsId(userId: string, secret: string): string {
  return createHmac("sha256", secret).update(`posthog\n${userId}`).digest("hex").slice(0, 32);
}
