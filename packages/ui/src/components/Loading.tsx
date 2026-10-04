import { Skeleton } from "@astryxdesign/core/Skeleton";
import { Figure } from "../charts/common";

function Note() {
  return (
    <div className="note figure-note" aria-hidden>
      <Skeleton height={14} width="45%" radius={1} />
    </div>
  );
}

export function TilesSkeleton({ count = 6, className }: { count?: number; className?: string }) {
  return (
    <section className={className ? `tiles ${className}` : "tiles"}>
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className="tile-skeleton" height={104} index={i} />
      ))}
    </section>
  );
}

export function OverviewSkeleton() {
  return (
    <div className="screen" aria-busy="true" aria-label="Loading">
      <TilesSkeleton />
      <Figure title="Commits over time" note={<Skeleton height={14} width="30%" radius={1} />}>
        <div className="overview-chart">
          <Skeleton height="100%" index={6} />
        </div>
      </Figure>
      <div className="two">
        <Figure title="Contributors" note={<Skeleton height={14} width="40%" radius={1} />}>
          <div className="contributors">
            <Skeleton height="100%" index={7} />
          </div>
        </Figure>
        <Figure title="Languages" note="Lines of code at HEAD">
          <Skeleton height={160} index={8} />
        </Figure>
      </div>
    </div>
  );
}

export function PeopleSkeleton() {
  return (
    <div className="screen" aria-busy="true" aria-label="Loading">
      <Figure title="People">
        <Note />
        <Skeleton height={560} index={1} />
      </Figure>
    </div>
  );
}

export function ActivitySkeleton() {
  return (
    <div className="screen" aria-busy="true" aria-label="Loading">
      <Figure title="Commits over time, by person">
        <Note />
        <div className="overview-chart">
          <Skeleton height="100%" index={1} />
        </div>
      </Figure>
      <div className="two">
        <Skeleton height={300} index={2} />
        <Skeleton height={300} index={3} />
      </div>
    </div>
  );
}

export function MapSkeleton() {
  return (
    <div className="screen" aria-busy="true" aria-label="Loading">
      <Skeleton height={40} width="50%" index={1} />
      <Skeleton height={560} index={2} />
    </div>
  );
}

export function CommitsSkeleton() {
  return (
    <div className="screen" aria-busy="true" aria-label="Loading">
      <Figure title="Commits">
        <Note />
        <Skeleton height={680} index={1} />
      </Figure>
    </div>
  );
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
