import { Button } from "@astryxdesign/core/Button";
import { Switch } from "@astryxdesign/core/Switch";
import { Link } from "@tanstack/react-router";
import { PRODUCT } from "@commitscape/data";
import { useAnalytics } from "#/integrations/posthog";

/** The bottom-left choice between all usage data and basic counting, until the visitor makes it. */
export function ConsentBanner() {
  const a = useAnalytics();
  if (!a?.on || a.choice !== null) return null;
  const asks = a.region.before === "basic";
  return (
    <section aria-label="Usage data" className="fixed bottom-4 start-4 z-50 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-3 surface p-4 shadow-lg">
      <p className="m-0 type-description text-pretty">
        {asks
          ? `We count visits to make ${PRODUCT} better. Allow all to also share how you use it: clicks, recordings of your visits with what you type hidden, and how fast pages are for you. Only basic counts pages without cookies.`
          : `${PRODUCT} looks at how it is used, with what you type hidden, to get better for you. Choose Only basic to be counted without cookies.`}{" "}
        <Link to="/privacy" hash="analytics" className="font-medium text-primary">
          What we keep
        </Link>
      </p>
      <div className="flex flex-wrap gap-2">
        <Button label="Allow all" variant="primary" size="sm" onClick={() => a.choose("all")} />
        <Button label="Only basic" variant="secondary" size="sm" onClick={() => a.choose("basic")} />
      </div>
    </section>
  );
}

/** A switch for the visitor's choice, for Settings and the privacy page. */
export function AnalyticsChoice() {
  const a = useAnalytics();
  if (!a?.on) return null;
  return (
    <Switch
      label="Share how you use the Site"
      description="On: clicks, heatmaps, recordings of your visits with what you type and source code hidden, and speed, tied to your account. Off: pages, speed and moments are counted without cookies or your account."
      value={a.level === "full"}
      onChange={(on) => a.choose(on ? "all" : "basic")}
      labelPosition="start"
      labelSpacing="spread"
      width="100%"
    />
  );
}
