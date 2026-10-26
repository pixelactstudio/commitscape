import { PRODUCT } from "@commitscape/data";
import { Logo } from "@commitscape/ui/components/Logo";
import { app, SIGN_IN, SOURCE } from "../env";
import { YEAR } from "../scenes/data";

type Column = { title: string; links: [string, string][] };

const COLUMNS: Column[] = [
  {
    title: "You",
    links: [
      [SIGN_IN, "Sign in"],
      [app("/dashboard"), "Open the app"],
      [app("/privacy"), "What we keep"],
    ],
  },
  {
    title: "Open source",
    links: [
      [SOURCE, "Source"],
      [`${SOURCE}#install`, "The command line"],
      [`${SOURCE}/blob/main/CHANGELOG.md`, "Changelog"],
      [`${SOURCE}/blob/main/LICENSE-MIT`, "MIT or Apache-2.0"],
    ],
  },
  {
    title: "Damn Labs",
    links: [
      ["https://damnlabs.com", "Damn Labs"],
      ["https://hexlode.damnlabs.com", "Hexlode"],
      ["https://envsift.damnlabs.com", "EnvSift"],
      ["https://pixelactstudio.com", "Pixelact Studio"],
    ],
  },
];

/** The page's footer, as the Site draws it for someone signed out: what commitscape is, who makes it, and where to go next. */
export function Footer() {
  return (
    <footer className="overflow-hidden border-t border-line">
      <div className="grid gap-12 px-(--frame-inset) pt-section pb-10 lg:grid-cols-[1.1fr_2fr]">
        <div className="flex max-w-sm flex-col gap-4">
          <a href="/" className="flex w-fit items-center gap-2 type-panel text-primary no-underline">
            <Logo size={24} />
            {PRODUCT}
          </a>
          <p className="m-0 type-description">What you have built on GitHub, where you stand among the people you build with, and Cards to share it. Every number says what it counts. Open source under MIT or Apache-2.0.</p>
          <p className="m-0 type-description">
            Built by{" "}
            <a href="https://damnlabs.com" className="inline-link">
              Damn Labs
            </a>
            , a{" "}
            <a href="https://pixelactstudio.com" className="inline-link">
              Pixelact Studio
            </a>{" "}
            product.
          </p>
        </div>
        <nav aria-label="Footer" className="grid grid-cols-2 gap-x-8 gap-y-10 text-sm sm:grid-cols-3">
          {COLUMNS.map((c) => (
            <div key={c.title} className="flex flex-col gap-2.5">
              <span className="type-label">{c.title}</span>
              {c.links.map(([to, label]) => (
                <a key={label} href={to} className="w-fit py-0.5 text-secondary no-underline transition-colors duration-(--duration-instant) hover:text-primary">
                  {label}
                </a>
              ))}
            </div>
          ))}
        </nav>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 px-(--frame-inset) pb-6 type-micro">
        <span>
          © {YEAR} Dev Talan
        </span>
        <span>Numbers from GitHub and git history, never guessed.</span>
      </div>
      <div aria-hidden className="wordmark -mb-[0.12em] text-center whitespace-nowrap">
        {PRODUCT}
      </div>
    </footer>
  );
}
