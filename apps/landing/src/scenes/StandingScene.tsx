import { Face } from "@commitscape/ui/components/Face";
import { STANDING_FOCUS, STANDING_PEOPLE, STANDING_VIEWS } from "./data";
import { compact } from "./format";
import { Cursor, Mini } from "./parts";
import { FIRST, ROW, share } from "./standing";

/** A repository's people ranked view by view: the cursor picks a view and the rows trade places. */
export function StandingScene() {
  return (
    <div data-scene="standing" className="relative flex size-full items-center justify-center">
      <Mini className="w-full max-w-80 overflow-hidden">
        <div className="flex items-center justify-between gap-2 px-4 pt-3.5 text-xs">
          <span className="font-medium text-primary">react/react</span>
          <span className="text-secondary">
            gaearon is <span data-rank className="font-semibold text-brand">5th</span>
          </span>
        </div>
        <div className="relative mx-4 mt-3 grid h-7 grid-cols-3 rounded-md bg-sunken p-0.5 text-2xs">
          <span data-pill className="absolute inset-y-0.5 start-0.5 w-[calc((100%-0.25rem)/3)] rounded-sm bg-surface shadow-xs" />
          {STANDING_VIEWS.map((v, i) => (
            <span key={v.id} data-tab data-on={i === 0 ? "" : undefined} className="relative flex items-center justify-center text-secondary transition-colors data-[on]:font-medium data-[on]:text-primary">
              {v.label}
            </span>
          ))}
        </div>
        <div className="flex gap-2 px-4 pt-2.5 pb-3">
          <ol className="m-0 flex w-3 flex-none list-none flex-col p-0 text-2xs text-tertiary tnum">
            {STANDING_PEOPLE.map((_, i) => (
              <li key={i} className="flex items-center justify-end" style={{ height: ROW }}>
                {i + 1}
              </li>
            ))}
          </ol>
          <div className="relative flex-1" style={{ height: ROW * STANDING_PEOPLE.length }}>
            {STANDING_PEOPLE.map((p, i) => {
              const me = p.login === STANDING_FOCUS;
              return (
                <div key={p.login} data-row className="absolute inset-x-0 flex items-center gap-2 px-1.5 [will-change:transform]" style={{ top: (FIRST[i] ?? 0) * ROW, height: ROW }}>
                  <span data-bar className={`absolute inset-y-0.5 start-0 rounded-md ${me ? "bg-brand-soft" : "bg-sunken"}`} style={{ width: `${share(p.values[0] ?? 0, 0)}%` }} />
                  <span className="relative flex">
                    <Face login={p.login} name={p.name} size={20} />
                  </span>
                  <span className={`relative min-w-0 truncate text-xs ${me ? "font-semibold text-primary" : "text-primary"}`}>{p.login}</span>
                  <span data-num className={`relative ms-auto text-xs tnum ${me ? "font-semibold text-brand" : "text-secondary"}`}>
                    {compact(p.values[0] ?? 0)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </Mini>
      <Cursor />
    </div>
  );
}
