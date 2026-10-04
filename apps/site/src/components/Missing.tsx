import { Button } from "@astryxdesign/core/Button";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { SearchX } from "lucide-react";
import { Page } from "@commitscape/ui";
import { Lookup } from "#/components/Lookup";

/** A page with nothing to show: why, and a way on. */
export function Missing({ title, words, back }: { title: string; words: string; back?: { label: string; href: string } }) {
  return (
    <Page width="narrow" className="flex flex-col items-center gap-8 py-20">
      <EmptyState title={title} description={words} headingLevel={1} icon={<SearchX size={32} />} actions={back ? <Button label={back.label} href={back.href} variant="secondary" /> : undefined} />
      <div className="w-full max-w-lg">
        <Lookup label="Look" />
      </div>
    </Page>
  );
}
