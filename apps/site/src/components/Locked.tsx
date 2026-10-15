import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import { Lock, LogIn } from "lucide-react";
import { Panel } from "@commitscape/ui";
import { Notice } from "#/components/Notice";
import { signIn } from "#/lib/auth-client";
import { GATES, type Gate } from "#/lib/gates";

const ROWS = [72, 58, 84, 46, 66, 52];

/** A section kept for people signed in: made-up rows under a blur, never the real data, and a way to sign in. */
export function Locked({ gate, height = 260, title }: { gate: Gate; height?: number; title?: string }) {
  const g = GATES[gate];
  const here = typeof window === "undefined" ? "/" : `${window.location.pathname}${window.location.search}`;
  return (
    <Panel title={title} padding={0}>
      <div className="relative overflow-hidden rounded-lg" style={{ minHeight: height }}>
        <div aria-hidden className="pointer-events-none flex select-none flex-col gap-4 p-5 blur-sm">
          {ROWS.map((w, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="size-8 shrink-0 rounded-full bg-active" />
              <div className="flex flex-1 flex-col gap-1.5">
                <div className="h-2.5 rounded-full bg-active" style={{ width: `${w * 0.5}%` }} />
                <div className="h-1.5 rounded-full bg-brand/40" style={{ width: `${w}%` }} />
              </div>
              <div className="h-3 w-12 rounded-full bg-active" />
            </div>
          ))}
        </div>
        <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-b from-transparent via-surface/60 to-surface p-6">
          <div className="flex max-w-md flex-col items-center gap-3 text-center">
            <span className="flex size-10 items-center justify-center rounded-full border border-line bg-raised text-brand">
              <Icon icon={Lock} size="sm" />
            </span>
            <p className="m-0 type-panel">{g.title}</p>
            <p className="m-0 type-description text-secondary">{g.words}</p>
            <Button label="Sign in with GitHub" variant="primary" icon={<Icon icon={LogIn} size="sm" />} onClick={() => signIn(here)} />
          </div>
        </div>
      </div>
    </Panel>
  );
}

/** A sign-in prompt the size of two number cells, for the small part of a row kept for people signed in. */
export function LockedLine({ gate, what }: { gate: Gate; what: string }) {
  const here = typeof window === "undefined" ? "/" : `${window.location.pathname}${window.location.search}`;
  return (
    <button type="button" onClick={() => signIn(here)} className="plain-button group col-span-2 flex items-center gap-3 bg-surface px-4 py-4 text-start sm:px-5 lg:min-h-34">
      <span className="grid size-8 flex-none place-items-center rounded-full border border-line bg-sunken text-brand">
        <Icon icon={Lock} size="sm" />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="type-label group-hover:underline">{GATES[gate].title}</span>
        <span className="type-description text-pretty">{what}</span>
      </span>
    </button>
  );
}

function PreviewRows() {
  return (
    <div className="flex flex-col gap-4 p-5">
      {ROWS.map((w, i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="size-8 shrink-0 rounded-full bg-active" />
          <div className="flex flex-1 flex-col gap-1.5">
            <div className="h-2.5 rounded-full bg-active" style={{ width: `${w * 0.5}%` }} />
            <div className="h-1.5 rounded-full bg-brand/40" style={{ width: `${w}%` }} />
          </div>
          <div className="h-3 w-12 rounded-full bg-active" />
        </div>
      ))}
    </div>
  );
}

function PreviewYear() {
  return (
    <div className="wrapped-hero flex h-72 flex-col justify-end gap-3 p-6 text-on-stage">
      <div className="h-16 w-2/3 rounded-xl bg-on-stage/40" />
      <div className="h-3 w-3/4 rounded-full bg-on-stage/30" />
      <div className="h-3 w-1/2 rounded-full bg-on-stage/20" />
    </div>
  );
}

function LockedPreview({ gate }: { gate: Gate }) {
  return (
    <div aria-hidden className="surface pointer-events-none relative hidden overflow-hidden select-none lg:block">
      <div className="blur-sm">{gate === "wrapped" ? <PreviewYear /> : <PreviewRows />}</div>
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-surface/40 to-surface" />
    </div>
  );
}

/** A whole page kept for people signed in. */
export function LockedPage({ gate }: { gate: Gate }) {
  const g = GATES[gate];
  const here = typeof window === "undefined" ? "/" : `${window.location.pathname}${window.location.search}`;
  return <Notice eyebrow="For people signed in" title={g.title} words={g.words} aside={<LockedPreview gate={gate} />} actions={<Button label="Sign in with GitHub" variant="primary" icon={<Icon icon={LogIn} size="sm" />} onClick={() => signIn(here)} />} />;
}
