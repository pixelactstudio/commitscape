import { Button } from "@astryxdesign/core/Button";
import { PRODUCT } from "@commitscape/data";
import { app } from "../env";

/** The bottom-left choice between all usage data and basic counting, drawn hidden; the page's script shows it to a visitor who has not chosen, with the words for their region. */
export function Consent() {
  return (
    <section data-consent hidden aria-label="Usage data" className="fixed bottom-4 start-4 z-50 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-3 surface p-4 shadow-lg">
      <p className="m-0 type-description text-pretty">
        <span data-consent-words="basic" hidden>
          We count visits to make {PRODUCT} better. Allow all to also share how you use it: clicks, recordings of your visits with what you type hidden, and how fast pages are for you. Only basic counts pages without cookies.
        </span>
        <span data-consent-words="full" hidden>
          {PRODUCT} looks at how it is used, with what you type hidden, to get better for you. Choose Only basic to be counted without cookies.
        </span>{" "}
        <a href={app("/privacy#analytics")} className="font-medium text-primary">
          What we keep
        </a>
      </p>
      <div className="flex flex-wrap gap-2">
        <span data-consent-choice="all" className="contents">
          <Button label="Allow all" variant="primary" size="sm" />
        </span>
        <span data-consent-choice="basic" className="contents">
          <Button label="Only basic" variant="secondary" size="sm" />
        </span>
      </div>
    </section>
  );
}
