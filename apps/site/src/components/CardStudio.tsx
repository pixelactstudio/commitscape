import { Panel } from "@commitscape/ui";
import { Outputs } from "#/components/studio/Outputs";
import { Picker } from "#/components/studio/Picker";
import { Stage } from "#/components/studio/Stage";
import { Styler } from "#/components/studio/Styler";
import type { CardChoice, StudioState } from "#/components/studio/types";
import { useStudio } from "#/components/studio/useStudio";

export type { CardChoice, StudioState };

/** The Card studio page: the chosen Card on a living stage that stays in view, the Cards to pick from, the style controls, and the ways to take it out. */
export function CardStudio({ choices, state, onChange, origin }: { choices: CardChoice[]; state: StudioState; onChange: (next: StudioState) => void; origin: string }) {
  const s = useStudio(choices, state, onChange);
  if (!s.choice) return null;
  return (
    <div className="grid items-start gap-x-8 gap-y-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
      <div className="flex flex-col gap-6 lg:contents">
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
          className="sticky top-[calc(var(--header-height)-0.25rem)] z-[var(--z-sticky)] -mx-4 sm:top-[var(--header-height)] [--card-h:21dvh] sm:mx-0 sm:rounded-xl sm:[--card-h:28dvh] lg:top-[calc(var(--header-height)+1rem)] lg:row-span-2 lg:h-[min(38rem,calc(100dvh-var(--header-height)-2rem))] lg:min-h-[28rem] lg:[--card-h:min(24rem,calc(100dvh-17rem))]"
        />
        <div className="flex min-w-0 flex-col gap-6 lg:col-start-2">
          {choices.length > 1 && (
            <Panel title="Pick a Card">
              <Picker choices={choices} value={s.choice.id} query={s.query} mode={state.mode} onPick={s.pick} />
            </Panel>
          )}
          <Panel title="Style it">
            <Styler style={state.style} mode={state.mode} set={s.set} />
          </Panel>
        </div>
      </div>
      <div className="min-w-0 lg:col-start-2">
        <Outputs choice={s.choice} query={s.query} origin={origin} />
      </div>
    </div>
  );
}
