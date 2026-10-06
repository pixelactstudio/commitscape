import { Skeleton } from "@astryxdesign/core/Skeleton";
import { Panel } from "../kit/layout";
import { CommitsLoading } from "../screens/Commits";
import { NARROW, WIDE } from "../screens/Map";
import { CONTRIBUTORS_SHOWN } from "../screens/Overview";
import { NumberCell, NumberStrip, ScreenFrame } from "../screens/kit";

function line(width: string | number, index: number, height = 14) {
  return <Skeleton height={height} width={width} radius={1} index={index} />;
}

function Cells({ labels }: { labels: string[] }) {
  return (
    <>
      {labels.map((l, i) => (
        <NumberCell key={l} id={l} value={<Skeleton height={26} width="55%" radius={2} index={i} />} label={l} note={<span className="flex h-4 items-center">{line("70%", i, 12)}</span>} />
      ))}
    </>
  );
}

function Bars({ count }: { count: number }) {
  return (
    <div className="flex flex-col gap-0.5">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex flex-col gap-1.5 px-2 py-2">
          <div className="flex h-5 items-center justify-between">
            {line(`${40 + ((i * 23) % 35)}%`, i, 12)}
            {line(70, i, 12)}
          </div>
          <Skeleton height={6} radius={3} index={i} />
        </div>
      ))}
    </div>
  );
}

export function OverviewSkeleton() {
  return (
    <ScreenFrame label="Loading">
      <NumberStrip columns={6}>
        <Cells labels={["commits", "people", "lines of code", "files", "of history", "active days"]} />
      </NumberStrip>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <Panel padding={0} title="Who built it" description={"\u00a0"}>
          <div>
            {Array.from({ length: CONTRIBUTORS_SHOWN }, (_, i) => (
              <div key={i} className="flex h-15 items-center gap-3 border-t border-line px-5">
                <span className="w-4" />
                <Skeleton height={36} width={36} radius="rounded" index={i} />
                <span className="flex flex-1 flex-col gap-2">
                  {line(`${30 + ((i * 17) % 30)}%`, i)}
                  <span className="max-w-72">
                    <Skeleton height={4} radius={2} index={i} />
                  </span>
                </span>
                {line(56, i, 12)}
              </div>
            ))}
          </div>
          <div className="flex h-[53px] items-center border-t border-line px-5">{line(220, 0, 11)}</div>
        </Panel>
        <div className="flex min-w-0 flex-col gap-4">
          <Panel title="Languages" description="Lines of code at HEAD">
            <div className="flex flex-col gap-4">
              <Skeleton height={10} radius="rounded" />
              <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                {Array.from({ length: 6 }, (_, i) => (
                  <div key={i} className="flex h-5 items-center">
                    {line("70%", i, 12)}
                  </div>
                ))}
              </div>
            </div>
          </Panel>
        </div>
      </div>
      <Panel title="Where the work is" description={"\u00a0"}>
        <div className="flex h-[30px] items-center">{line(120, 0, 14)}</div>
        <div className="grid items-center gap-x-10 gap-y-5 md:grid-cols-[minmax(0,19rem)_minmax(0,1fr)] lg:grid-cols-[minmax(0,21rem)_minmax(0,1fr)]">
          <div className="mx-auto aspect-square w-full max-w-[21rem]">
            <Skeleton height="100%" radius="rounded" index={1} />
          </div>
          <Bars count={6} />
        </div>
      </Panel>
      <Panel title="Commits over time" description={"\u00a0"}>
        <div className="flex flex-col gap-1">
          <Skeleton height={240} index={3} />
          <div className="h-5" />
        </div>
      </Panel>
    </ScreenFrame>
  );
}

export function PeopleSkeleton() {
  return (
    <ScreenFrame label="Loading">
      <Panel padding={0} title="Everyone" description={"\u00a0"}>
        <div>
          <div className="h-8" />
          {Array.from({ length: 12 }, (_, i) => (
            <div key={i} className="flex h-[53px] items-center gap-3 border-t border-line px-5">
              <Skeleton height={32} width={32} radius="rounded" index={i} />
              <span className="flex w-40 flex-col gap-2">
                {line("80%", i)}
                {line("50%", i, 4)}
              </span>
              <span className="flex flex-1 justify-end gap-8">
                {line(48, i, 12)}
                {line(48, i, 12)}
                {line(64, i, 12)}
              </span>
            </div>
          ))}
        </div>
      </Panel>
    </ScreenFrame>
  );
}

export function ActivitySkeleton() {
  return (
    <ScreenFrame label="Loading">
      <Panel title="Commits over time, by person" description={"\u00a0"}>
        <div className="flex flex-col gap-2">
          <div className="flex h-4 gap-4">
            {[0, 1, 2, 3, 4].map((i) => (
              <span key={i}>{line(72, i, 10)}</span>
            ))}
          </div>
          <Skeleton height={280} index={1} />
        </div>
      </Panel>
      <Panel title="When the work happens" description={"\u00a0"}>
        <Skeleton height={260} index={2} />
      </Panel>
    </ScreenFrame>
  );
}

export function MapSkeleton() {
  return (
    <ScreenFrame label="Loading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex h-[30px] items-center">{line(140, 0, 14)}</div>
        <Skeleton height={32} width={260} index={1} />
      </div>
      <div className="flex min-w-0 flex-col gap-3 rounded-lg border border-line bg-surface p-3 sm:p-panel">
        <div className="flex h-5 items-center">{line(320, 0, 12)}</div>
        <div className="hidden md:block" style={{ aspectRatio: `${WIDE.w} / ${WIDE.h}` }}>
          <Skeleton height="100%" index={2} />
        </div>
        <div className="md:hidden" style={{ aspectRatio: `${NARROW.w} / ${NARROW.h}` }}>
          <Skeleton height="100%" index={2} />
        </div>
        <div className="h-4" />
      </div>
    </ScreenFrame>
  );
}

export function CommitsSkeleton() {
  return <CommitsLoading />;
}

export function ScreenSkeleton() {
  return <OverviewSkeleton />;
}

export function LinesSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} height={14} width={i === lines - 1 ? "60%" : "100%"} radius={1} index={i} />
      ))}
    </div>
  );
}
