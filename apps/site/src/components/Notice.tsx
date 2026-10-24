import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Page } from "@commitscape/ui";

const WAYS = [
  { to: "/", label: "Home" },
  { to: "/leaderboards", label: "Leaderboards" },
  { to: "/vs", label: "Versus" },
  { to: "/races", label: "Races" },
  { to: "/crews", label: "Crews" },
] as const;

/** A page that says one thing: what it is, why, and the next step. On the page frame, with a real h1 and, when there is one, something beside it. */
export function Notice({ eyebrow, title, words, actions, children, ways = false, aside }: { eyebrow: ReactNode; title: ReactNode; words?: ReactNode; actions?: ReactNode; children?: ReactNode; ways?: boolean; aside?: ReactNode }) {
  return (
    <Page className="pt-page-top pb-section">
      <div className={`grid items-center gap-10 pt-section ${aside ? "lg:grid-cols-[minmax(0,1fr)_26rem]" : ""}`}>
        <div className="flex min-w-0 max-w-2xl flex-col gap-5">
          <span className="type-eyebrow text-brand">{eyebrow}</span>
          <h1 tabIndex={-1} className="m-0 type-page outline-offset-4">
            {title}
          </h1>
          {words && <p className="m-0 max-w-xl type-lead">{words}</p>}
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
          {children}
          {ways && (
            <nav aria-label="Pages" className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-separator pt-5">
              {WAYS.map((w) => (
                <Link key={w.to} to={w.to} className="type-label text-secondary no-underline hover:text-primary hover:underline">
                  {w.label}
                </Link>
              ))}
            </nav>
          )}
        </div>
        {aside}
      </div>
    </Page>
  );
}
