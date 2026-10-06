import { Outputs } from "#/components/studio/Outputs";
import { Shelf } from "#/components/studio/Shelf";
import { Stage } from "#/components/studio/Stage";
import { Style } from "#/components/studio/Style";
import type { CardChoice, StudioState } from "#/components/studio/types";
import { useStudio } from "#/components/studio/useStudio";

export type { CardChoice, StudioState };

/** The Card studio page: the chosen Card on a living stage with the strip of Cards under it, the style beside them, and every way to use it below. */
export function CardStudio({ choices, state, onChange, origin }: { choices: CardChoice[]; state: StudioState; onChange: (next: StudioState) => void; origin: string }) {
  const s = useStudio(choices, state, onChange);
  if (!s.choice) return null;
  return (
    <div className="flex flex-col gap-section">
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_24rem] xl:grid-cols-[minmax(0,1fr)_26rem]">
        <div className="studio-dock flex min-w-0 flex-col gap-4 max-lg:contents">
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
            step={{ at: s.at, of: choices.length, go: s.step }}
            className="sticky top-[calc(var(--header-height)-0.25rem)] z-[var(--z-sticky)] -mx-4 rounded-none [--card-h:21dvh] sm:top-[var(--header-height)] sm:mx-0 sm:rounded-xl sm:[--card-h:15rem] lg:relative lg:top-auto lg:z-auto lg:h-[26rem] lg:[--card-h:15.5rem]"
          />
          {choices.length > 1 && (
            <section aria-label="Pick a Card" className="min-w-0 rounded-xl border border-line bg-surface p-4">
              <Shelf choices={choices} value={s.choice.id} query={s.query} mode={state.mode} onPick={s.pick} />
            </section>
          )}
        </div>
        <section aria-labelledby="studio-style" className="min-w-0 rounded-xl border border-line bg-surface p-5">
          <div className="flex flex-col gap-1 pb-5">
            <h2 id="studio-style" className="m-0 type-panel">
              Style it
            </h2>
            <p className="m-0 type-description">A preset to start from, then any colour, background and corners.</p>
          </div>
          <Style style={state.style} mode={state.mode} set={s.set} />
        </section>
      </div>
      <Outputs choice={s.choice} query={s.query} origin={origin} />
    </div>
  );
}
