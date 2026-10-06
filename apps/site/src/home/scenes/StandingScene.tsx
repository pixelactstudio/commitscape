import { BEAT, DURATION, GSAP_EASE, useScene } from "@commitscape/ui/motion";
import { Face } from "@commitscape/ui";
import { STANDING_FOCUS, STANDING_PEOPLE, STANDING_VIEWS } from "./data";
import { compact, count, point, press } from "./kit";
import { Cursor, Mini } from "./parts";

const ROW = 28;

const ORDINAL = ["1st", "2nd", "3rd", "4th", "5th"];

function slots(view: number) {
  const order = STANDING_PEOPLE.map((p, i) => ({ i, v: p.values[view] ?? 0 })).sort((a, b) => b.v - a.v);
  const out: number[] = [];
  order.forEach((o, slot) => (out[o.i] = slot));
  return out;
}

function widest(view: number) {
  return Math.max(...STANDING_PEOPLE.map((p) => p.values[view] ?? 0));
}

function share(value: number, view: number) {
  return Math.max(12, (value / widest(view)) * 100);
}

const FIRST = slots(0);

/** A repository's people ranked view by view: the cursor picks a view and the rows trade places. */
export function StandingScene() {
  const ref = useScene(
    (tl, q, root) => {
      const cursor = q("[data-cursor]")[0];
      const tabs = q("[data-tab]");
      const pill = q("[data-pill]")[0];
      const rows = q("[data-row]");
      const nums = q("[data-num]");
      const bars = q("[data-bar]");
      const rank = q("[data-rank]")[0];
      const focus = STANDING_PEOPLE.findIndex((p) => p.login === STANDING_FOCUS);
      const steps = [1, 2, 0];
      let from = 0;
      tl.set(cursor ?? {}, { x: () => root.clientWidth * 0.72, y: () => root.clientHeight * 0.9, opacity: 0 }, 0);
      steps.forEach((view, n) => {
        const at = n === 0 ? BEAT.base : `+=${BEAT.hold}`;
        point(tl, cursor, tabs[view], root, at);
        press(tl, cursor, tabs[view], ">");
        tl.addLabel(`view${view}`, ">");
        tl.to(pill ?? {}, { xPercent: view * 100, duration: DURATION.base, ease: GSAP_EASE.out }, `view${view}`);
        tl.call(() => {
          tabs.forEach((t, i) => t.toggleAttribute("data-on", i === view));
          if (rank) rank.textContent = ORDINAL[slots(view)[focus] ?? 0] ?? "";
        }, undefined, `view${view}`);
        const to = slots(view);
        rows.forEach((row, i) => {
          tl.to(row, { y: ((to[i] ?? 0) - (FIRST[i] ?? 0)) * ROW, duration: DURATION.slow, ease: GSAP_EASE.inOut }, `view${view}`);
          const a = STANDING_PEOPLE[i]?.values[from] ?? 0;
          const b = STANDING_PEOPLE[i]?.values[view] ?? 0;
          count(tl, nums[i], a, b, `view${view}`, { format: compact, duration: DURATION.slow, prime: false });
          tl.to(bars[i] ?? {}, { width: `${share(b, view)}%`, duration: DURATION.slow, ease: GSAP_EASE.inOut }, `view${view}`);
        });
        from = view;
      });
      tl.to(cursor ?? {}, { opacity: 0, duration: DURATION.base }, `+=${BEAT.base}`);
    },
    { still: 0 },
  );
  return (
    <div ref={ref} className="relative flex size-full items-center justify-center">
      <Mini className="w-full max-w-[20rem] overflow-hidden">
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
