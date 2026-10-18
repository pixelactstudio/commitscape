import type { ReactNode } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Lookup } from "#/components/Lookup";
import { Notice } from "#/components/Notice";

/** A page with nothing to show: why, a way back, and, unless it is about something that cannot be looked up, the lookup to find what was meant. */
export function Missing({ title, words, back, eyebrow = "Not found", lookup = true, note }: { title: string; words: string; back?: { label: string; href: string }; eyebrow?: string; lookup?: boolean; note?: ReactNode }) {
  return (
    <Notice eyebrow={eyebrow} title={title} words={words} actions={back ? <Button label={back.label} href={back.href} variant="secondary" /> : undefined}>
      {lookup && (
        <div className="w-full max-w-lg pt-1">
          <Lookup label="Look" />
        </div>
      )}
      {note && <p className="m-0 type-caption">{note}</p>}
    </Notice>
  );
}
