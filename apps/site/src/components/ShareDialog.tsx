import { useState, useSyncExternalStore } from "react";
import { BottomSheet } from "@astryxdesign/core/BottomSheet";
import { Button } from "@astryxdesign/core/Button";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { Icon } from "@astryxdesign/core/Icon";
import { useRouteContext } from "@tanstack/react-router";
import { Share2 } from "lucide-react";
import { DEFAULT_STYLE } from "@commitscape/ui";
import { QuickOutputs } from "#/components/studio/Outputs";
import { Picker } from "#/components/studio/Picker";
import { Stage } from "#/components/studio/Stage";
import { Styler } from "#/components/studio/Styler";
import type { CardChoice, StudioState } from "#/components/studio/types";
import { useStudio } from "#/components/studio/useStudio";

const WIDE = "(min-width: 48rem)";
const wide = () => window.matchMedia(WIDE).matches;
const listen = (on: () => void) => {
  const q = window.matchMedia(WIDE);
  q.addEventListener("change", on);
  return () => q.removeEventListener("change", on);
};

/** A Share button that opens the Card on a stage over the page, with a few styles and the ways to take it out; a sheet on a phone. */
export function ShareButton({ choices, origin, label = "Share", title = "Share a Card", variant = "primary" }: { choices: CardChoice[]; origin: string; label?: string; title?: string; variant?: "primary" | "secondary" }) {
  const { mode } = useRouteContext({ from: "__root__" });
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<StudioState>({ card: choices[0]?.id ?? "", style: DEFAULT_STYLE, mode: mode === "light" ? "light" : "dark" });
  const [opened, setOpened] = useState(false);
  const show = () => {
    if (!opened && mode !== "light" && mode !== "dark") setState((s) => ({ ...s, mode: window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark" }));
    setOpened(true);
    setOpen(true);
  };
  const large = useSyncExternalStore(listen, wide, () => true);
  if (choices.length === 0) return null;
  return (
    <>
      <Button label={label} variant={variant} icon={<Icon icon={Share2} size="sm" />} onClick={show} />
      {large ? (
        <Dialog isOpen={open} onOpenChange={setOpen} width="min(1120px, 94vw)" maxHeight="min(800px, 92dvh)" padding={0}>
          {open && <Share choices={choices} state={state} onChange={setState} origin={origin} title={title} onClose={() => setOpen(false)} large />}
        </Dialog>
      ) : (
        <BottomSheet isOpen={open} onOpenChange={setOpen} label={title} height="tall">
          {open && <Share choices={choices} state={state} onChange={setState} origin={origin} title={title} onClose={() => setOpen(false)} large={false} />}
        </BottomSheet>
      )}
    </>
  );
}

function Share({ choices, state, onChange, origin, title, onClose, large }: { choices: CardChoice[]; state: StudioState; onChange: (next: StudioState) => void; origin: string; title: string; onClose: () => void; large: boolean }) {
  const s = useStudio(choices, state, onChange);
  if (!s.choice) return null;
  const stage = (
    <Stage
      choice={s.choice}
      mode={state.mode}
      style={state.style}
      query={s.query}
      spin={s.spin}
      changed={s.changed}
      onMode={s.mode}
      onSurprise={s.surprise}
      onReset={s.reset}
      className={large ? "h-full rounded-lg [--card-h:min(26rem,calc(min(800px,92dvh)-13rem))]" : "sticky top-0 z-[var(--z-sticky)] rounded-lg [--card-h:24dvh]"}
    />
  );
  const controls = (
    <div className="flex flex-col gap-6">
      {choices.length > 1 && (
        <Block label="Card">
          <Picker choices={choices} value={s.choice.id} query={s.query} mode={state.mode} onPick={s.pick} />
        </Block>
      )}
      <Block label="Take it with you">
        <QuickOutputs choice={s.choice} query={s.query} origin={origin} />
      </Block>
      <Block label="Style">
        <Styler style={state.style} mode={state.mode} set={s.set} compact />
      </Block>
    </div>
  );
  if (!large)
    return (
      <div className="flex flex-col gap-5 px-4 pt-2 pb-6">
        {stage}
        {controls}
      </div>
    );
  return (
    <div className="grid h-[min(800px,92dvh)] grid-cols-[minmax(0,1fr)_23rem]">
      <div className="min-h-0 p-3 pe-0">{stage}</div>
      <div className="flex min-h-0 flex-col">
        <div className="px-5 pt-4 pb-2">
          <DialogHeader title={title} onOpenChange={(o) => !o && onClose()} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-2 pb-5 [scrollbar-width:thin]">{controls}</div>
      </div>
    </div>
  );
}

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section aria-label={label} className="flex flex-col gap-3">
      <h3 className="m-0 type-eyebrow">{label}</h3>
      {children}
    </section>
  );
}
