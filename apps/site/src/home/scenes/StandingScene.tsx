import { BEAT, DURATION, GSAP_EASE, useScene } from "@commitscape/ui/motion";
import { Face } from "@commitscape/ui";
import { STANDING_FOCUS, STANDING_PEOPLE, STANDING_VIEWS } from "./data";
import { compact, count, point, press } from "./kit";
import { Cursor, Mini } from "./parts";

const ROW = 30;

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
      const unit = q("[data-unit]")[0];
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
          if (unit) unit.textContent = STANDING_VIEWS[view]?.unit ?? "";
          if (rank) rank.textContent = ORDINAL[slots(view)[focus] ?? 0] ?? "";
        }, undefined, `view${view}`);
        const to = slots(view);
        rows.forEach((row, i) => {
          tl.to(row, { y: ((to[i] ?? 0) - (FIRST[i] ?? 0)) * ROW, duration: DURATION.slow, ease: GSAP_EASE.inOut }, `view${view}`);
          const a = STANDING_PEOPLE[i]?.values[from] ?? 0;
          const b = STANDING_PEOPLE[i]?.values[view] ?? 0;
          count(tl, nums[i], a, b, `view${view}`, { format: compact, duration: DURATION.slow, prime: false });
          tl.to(bars[i] ?? {}, { scaleX: b / widest(view), duration: DURATION.slow, ease: GSAP_EASE.inOut }, `view${view}`);
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
        <div className="flex items-center justify-between gap-2 px-3.5 pt-3 text-[0.72rem]">
          <span className="font-medium text-primary">react/react</span>
          <span className="text-secondary">
            gaearon is <span data-rank className="font-semibold text-brand">5th</span>
          </span>
        </div>
        <div className="relative mx-3.5 mt-2.5 grid grid-cols-3 rounded-[8px] bg-[var(--color-background-muted)] p-[3px] text-[0.7rem]">
          <span data-pill className="absolute inset-y-[3px] start-[3px] w-[calc((100%-6px)/3)] rounded-[6px] bg-[var(--color-background-surface)] shadow-[0_1px_2px_rgb(0_0_0/0.18)]" />
          {STANDING_VIEWS.map((v, i) => (
            <span key={v.id} data-tab data-on={i === 0 ? "" : undefined} className="relative z-[1] py-1 text-center text-secondary transition-colors data-[on]:font-medium data-[on]:text-primary">
              {v.label}
            </span>
          ))}
        </div>
        <div className="relative mx-3.5 mt-2.5 mb-1 flex">
          <ol className="m-0 flex w-5 flex-none list-none flex-col p-0 text-[0.68rem] text-secondary tnum">
            {STANDING_PEOPLE.map((_, i) => (
              <li key={i} className="flex items-center" style={{ height: ROW }}>
                {i + 1}
              </li>
            ))}
          </ol>
          <div className="relative flex-1" style={{ height: ROW * STANDING_PEOPLE.length }}>
            {STANDING_PEOPLE.map((p, i) => {
              const me = p.login === STANDING_FOCUS;
              return (
                <div key={p.login} data-row className={`absolute inset-x-0 flex items-center gap-2 rounded-[7px] px-1.5 [will-change:transform] ${me ? "bg-brand-soft" : ""}`} style={{ top: (FIRST[i] ?? 0) * ROW, height: ROW }}>
                  <span
                    data-bar
                    className={`absolute start-1.5 end-1.5 bottom-[2px] h-[2px] origin-left rounded-full ${me ? "bg-brand" : "bg-[var(--color-border-emphasized)]"}`}
                    style={{ transform: `scaleX(${(p.values[0] ?? 0) / widest(0)})` }}
                  />
                  <span className="relative">
                    <Face login={p.login} name={p.name} size={20} />
                  </span>
                  <span className={`relative truncate text-[0.74rem] ${me ? "font-semibold text-primary" : "text-primary"}`}>{p.login}</span>
                  <span data-num className={`relative ms-auto text-[0.72rem] tnum ${me ? "font-semibold text-primary" : "text-secondary"}`}>
                    {compact(p.values[0] ?? 0)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
        <div data-unit className="px-3.5 pb-3 text-end text-[0.66rem] text-secondary">
          {STANDING_VIEWS[0].unit}
        </div>
      </Mini>
      <Cursor />
    </div>
  );
}
