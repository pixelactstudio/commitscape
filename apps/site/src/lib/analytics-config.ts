export type Level = "basic" | "full";

export type Choice = "all" | "basic";

export type Feature = {
  label: string;
  says: string;
  events?: readonly string[];
  cookies?: true;
};

/** Every kind of usage data the Site, its server and the command can collect, as the privacy page describes it. */
export const FEATURES = {
  pageviews: { label: "Pages opened", says: "Which pages are opened and from where: the site or campaign that linked to us, the browser, the operating system and the kind of device.", events: ["$pageview"] },
  pageleaves: { label: "Time on a page", says: "How long a page stays open and how far down it is read.", events: ["$pageleave"] },
  webVitals: { label: "Speed", says: "How quickly pages load and answer a click (Web Vitals).", events: ["$web_vitals"] },
  moments: { label: "Moments", says: "Moments such as signing in, asking for a Build, opening a Profile or a Shared Report, and copying or serving a Card." },
  location: { label: "Country and region", says: "Your country and region, worked out from your address with its last part removed, which is all we send." },
  autocapture: { label: "Clicks", says: "What is clicked, copied and sent from a form, never what is typed.", events: ["$autocapture", "$copy_autocapture"], cookies: true },
  rageclicks: { label: "Frustrated clicks", says: "Clicks repeated in anger, so we find what does not answer.", events: ["$rageclick"], cookies: true },
  deadclicks: { label: "Clicks that do nothing", says: "Clicks on things that look clickable but are not.", events: ["$dead_click"], cookies: true },
  heatmaps: { label: "Heatmaps", says: "Where on a page people click, move and scroll, added up across everyone.", events: ["$$heatmap"], cookies: true },
  replay: { label: "Session recordings", says: "Recordings of how the Site is used: the pages as you saw them, moving, clicking and scrolling. What you type and every line of source code are hidden.", cookies: true },
  replayConsole: { label: "Browser messages", says: "The browser console's messages during a recording.", cookies: true },
  replayNetwork: { label: "Requests", says: "During a recording, which requests a page made, how long each took and how it ended; never their contents, cookies or sign-in.", cookies: true },
  replayCanvas: { label: "The Universe", says: "The 3D Universe as it was drawn, in recordings.", cookies: true },
  person: { label: "Your account", says: "All of the above tied to your account: your GitHub username, name and picture, and a cookie that knows your browser on later visits.", events: ["$identify", "$set", "$create_alias"], cookies: true },
  preciseLocation: { label: "City", says: "Your city, worked out from your full address.", cookies: true },
} as const satisfies Record<string, Feature>;

export type FeatureId = keyof typeof FEATURES;

export type Region = {
  id: string;
  name: string;
  countries: readonly string[] | "*";
  before: Level;
  basic: readonly FeatureId[];
  full: readonly FeatureId[];
};

const BASIC: readonly FeatureId[] = ["pageviews", "pageleaves", "webVitals", "moments", "location"];

const ALL = Object.keys(FEATURES) as FeatureId[];

const EUROPE = ["AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE", "IS", "LI", "NO", "GB", "CH"];

/** Where visitors are and what is collected from them: `before` is what runs until they choose, `basic` and `full` what each choice allows. The first region that lists a country wins; `"*"` is everywhere else. */
export const REGIONS: readonly Region[] = [
  { id: "ask", name: "the European Union, the EEA, the United Kingdom, Switzerland and India", countries: [...EUROPE, "IN"], before: "basic", basic: BASIC, full: ALL },
  { id: "tell", name: "everywhere else", countries: "*", before: "full", basic: BASIC, full: ALL },
];

/** The region for a visitor whose country is not known. */
export const UNKNOWN_REGION = "ask";

/** What a browser that sends Do Not Track or Global Privacy Control gets until its visitor chooses. */
export const SIGNALLED: Level = "basic";

export const CONSENT_COOKIE = "commitscape.analytics";

/** Text on the page that is hidden in session recordings: source code, diffs and anything marked private. */
export const MASKED_TEXT = ".code-lines, pre, code, [data-private]";

const fallback = (): Region => REGIONS.find((r) => r.id === UNKNOWN_REGION) ?? (REGIONS[0] as Region);

/** The region a country (an ISO 3166 code, as Cloudflare sends it) is in; the unknown region for no country, Tor (`T1`) or an unknown one (`XX`). */
export function regionOf(country: string | null | undefined): Region {
  const code = country?.trim().toUpperCase();
  if (!code || code === "XX" || code === "T1") return fallback();
  return REGIONS.find((r) => r.countries === "*" || r.countries.includes(code)) ?? fallback();
}

/** A region by its id, else the unknown region. */
export function regionById(id: string | null | undefined): Region {
  return REGIONS.find((r) => r.id === id) ?? fallback();
}

/** A visitor's stored choice, from the cookie's value. */
export function choiceOf(value: string | null | undefined): Choice | null {
  return value === "all" || value === "basic" ? value : null;
}

/** What is collected from a visitor: what they chose, else basic for a browser that signals not to track, else what their region starts with. */
export function levelOf(region: Region, choice: Choice | null, signalled: boolean): Level {
  if (choice) return choice === "all" ? "full" : "basic";
  return signalled ? SIGNALLED : region.before;
}

/** The features a level allows in a region; basic never includes one that needs a cookie. */
export function featuresAt(region: Region, level: Level): ReadonlySet<FeatureId> {
  const listed = level === "full" ? region.full : region.basic;
  return new Set(level === "full" ? listed : listed.filter((f) => !("cookies" in FEATURES[f])));
}

const OWNER = new Map<string, FeatureId>(Object.entries(FEATURES).flatMap(([id, f]) => ("events" in f ? f.events.map((e) => [e, id as FeatureId] as const) : [])));

/** Whether an event the browser is about to send is allowed: PostHog's own by the feature that makes it, the Site's by Moments, and any other of PostHog's only at full. Exceptions never: Sentry has them. */
export function eventAllowed(event: string, features: ReadonlySet<FeatureId>, level: Level): boolean {
  if (event === "$exception") return false;
  const owner = OWNER.get(event);
  if (owner) return features.has(owner);
  if (!event.startsWith("$")) return features.has("moments");
  return level === "full";
}

/** The part of a visitor's address PostHog may see: all of it for their city, the first three parts of an IPv4 address or three groups of an IPv6 one for their country, else none. */
export function addressFor(address: string | null | undefined, features: ReadonlySet<FeatureId>): string | null {
  const raw = address?.trim();
  if (!raw || raw === "local") return null;
  if (features.has("preciseLocation")) return raw;
  if (!features.has("location")) return null;
  if (!raw.includes(":")) {
    const parts = raw.split(".");
    return parts.length === 4 ? `${parts.slice(0, 3).join(".")}.0` : null;
  }
  const [head = ""] = raw.toLowerCase().split("::");
  const groups = head.split(":").filter(Boolean);
  return `${[...groups, "0", "0", "0"].slice(0, 3).join(":")}::`;
}

/** The value of one cookie in a `Cookie` header. */
export function cookieValue(header: string | null | undefined, name: string): string | null {
  for (const part of (header ?? "").split(";")) {
    const at = part.indexOf("=");
    if (at > 0 && part.slice(0, at).trim() === name) return decodeURIComponent(part.slice(at + 1).trim());
  }
  return null;
}

export type Visitor = { region: Region; choice: Choice | null; level: Level; features: ReadonlySet<FeatureId> };

/** Who a request comes from, as far as analytics is concerned: their region from the country header, their choice from its cookie and whether their browser signals not to track. */
export function visitorOf(headers: Headers | null | undefined, countryHeader: string): Visitor {
  const region = regionOf(headers?.get(countryHeader));
  const choice = choiceOf(cookieValue(headers?.get("cookie"), CONSENT_COOKIE));
  const signalled = headers?.get("dnt") === "1" || headers?.get("sec-gpc") === "1";
  const level = levelOf(region, choice, signalled);
  return { region, choice, level, features: featuresAt(region, level) };
}
