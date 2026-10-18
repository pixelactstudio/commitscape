import { Link, useRouteContext } from "@tanstack/react-router";
import { PRODUCT } from "@commitscape/data";
import { Logo } from "@commitscape/ui";

const YEAR = new Date().getUTCFullYear();
const SOURCE = "https://github.com/pixelactstudio/commitscape";

type Column = { title: string; links: [string, string][] };

/** Every page's footer: what commitscape is, who makes it, and where to go next; one line under a workspace. */
export function Footer({ compact = false }: { compact?: boolean }) {
  const { user } = useRouteContext({ from: "__root__" });
  if (compact)
    return (
      <footer className="border-t border-line px-(--frame-inset) py-4">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 type-micro">
          <span>
            © {YEAR} Dev Talan · Numbers from GitHub and git history, never guessed.
          </span>
          <nav aria-label="Footer" className="flex flex-wrap items-center gap-x-5 gap-y-1">
            <Link to="/privacy" className="text-secondary no-underline hover:text-primary">
              What we keep
            </Link>
            <a href={SOURCE} className="text-secondary no-underline hover:text-primary">
              Source
            </a>
            <a href={`${SOURCE}/blob/main/CHANGELOG.md`} className="text-secondary no-underline hover:text-primary">
              Changelog
            </a>
          </nav>
        </div>
      </footer>
    );
  const me = user?.login ? `/u/${user.login}` : null;
  const columns: Column[] = [
    { title: "Explore", links: [["/leaderboards", "Leaderboards"], ["/vs", "Versus"], ["/races", "Races"], ["/crews", "Crews"]] },
    {
      title: "You",
      links: [
        [me ?? "/me", me ? "Your Profile" : user ? "Settings" : "Sign in"],
        [me ? `${me}/cards` : "/me", "Your Cards"],
        [me ? `${me}/work` : "/me", "Proof of Work"],
        [me ? `${me}/wrapped/${YEAR}` : "/me", `Wrapped ${YEAR}`],
        ["/privacy", "What we keep"],
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
  return (
    <footer className="overflow-hidden border-t border-line">
      <div className="grid gap-12 px-(--frame-inset) pt-section pb-10 lg:grid-cols-[1.1fr_2fr]">
        <div className="flex max-w-sm flex-col gap-4">
          <Link to="/" className="flex w-fit items-center gap-2 type-panel text-primary no-underline">
            <Logo size={24} />
            {PRODUCT}
          </Link>
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
        <nav aria-label="Footer" className="grid grid-cols-2 gap-x-8 gap-y-10 text-sm sm:grid-cols-4">
          {columns.map((c) => (
            <div key={c.title} className="flex flex-col gap-2.5">
              <span className="type-label">{c.title}</span>
              {c.links.map(([to, label]) =>
                to.startsWith("http") ? (
                  <a key={label} href={to} className="w-fit py-0.5 text-secondary no-underline transition-colors duration-(--duration-instant) hover:text-primary">
                    {label}
                  </a>
                ) : (
                  <Link key={label} to={to as "/"} className="w-fit py-0.5 text-secondary no-underline transition-colors duration-(--duration-instant) hover:text-primary">
                    {label}
                  </Link>
                ),
              )}
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
