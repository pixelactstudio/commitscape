import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import type * as THREE from "three";
import { FOV, type Cam, type Insets } from "./camera";
import type { Feed } from "./feed";
import type { Look } from "./look";
import type { FrameAnswer, Summary } from "./protocol";
import { TIERS, type Detail } from "./pipeline";
import { AtlasRenderer, type Caption, type Hooks, type StageApi, type StageClock } from "./renderer";

export type { StageApi, StageClock, Target } from "./renderer";

export type DetailChoice = Detail | "auto";

const AUTO_KEY = "commitscape.universe.auto";

function remembered(): Detail {
  try {
    const v = sessionStorage.getItem(AUTO_KEY);
    return v === "balanced" || v === "low" ? v : "high";
  } catch {
    return "high";
  }
}

export type StageProps = {
  summary: Summary;
  feed: Feed<FrameAnswer | null>;
  clock: MutableRefObject<StageClock>;
  look: Look;
  lens: number;
  focus: [number, number] | null;
  roleMask: number;
  selected: number | null;
  solo: boolean;
  soloSlot: number | null;
  detail: DetailChoice;
  top: boolean;
  reduced: boolean;
  initialCam: Cam | null;
  insets: Insets;
  avatars: Hooks["avatars"];
  onHover: Hooks["onHover"];
  onPick: Hooks["onPick"];
  onFolder: Hooks["onFolder"];
  onPerson: Hooks["onPerson"];
  onCam: Hooks["onCam"];
  onApi: (api: StageApi) => void;
  onLost: () => void;
};

type Layer = MutableRefObject<HTMLDivElement | null>;

/** The Atlas drawn in 3D: the canvas, and above it the HTML layers for labels, beacons, the selected file's pin and passing captions. */
export default function Stage(props: StageProps) {
  const labels = useRef<HTMLDivElement>(null);
  const beacons = useRef<HTMLDivElement>(null);
  const pin = useRef<HTMLDivElement>(null);
  const [captions, setCaptions] = useState<Caption[]>([]);
  useEffect(() => {
    if (captions.length === 0) return;
    const next = Math.min(...captions.map((c) => c.until)) - performance.now() / 1000;
    const id = setTimeout(() => setCaptions((cs) => cs.filter((c) => c.until > performance.now() / 1000 + 0.05)), Math.max(50, next * 1000));
    return () => clearTimeout(id);
  }, [captions]);
  const { onLost } = props;
  const [stepped, setStepped] = useState<Detail>(remembered);
  const detail: Detail = props.detail === "auto" ? stepped : props.detail;
  const onSlow = (next: Detail) => {
    setStepped(next);
    try {
      sessionStorage.setItem(AUTO_KEY, next);
    } catch {
      return;
    }
  };
  return (
    <div className="absolute inset-0 overflow-hidden" style={{ background: props.look.css.skyBottom }}>
      <Canvas
        flat
        dpr={props.top ? [1, Math.min(1.5, TIERS[detail].dpr)] : [1, TIERS[detail].dpr]}
        frameloop="demand"
        camera={{ fov: FOV, near: 1, far: 5000, position: [0, 200, 200] }}
        gl={{ antialias: false, alpha: false, stencil: false, depth: true, powerPreference: "high-performance" }}
        style={{ position: "absolute", inset: 0, touchAction: "none" }}
        aria-hidden
        onCreated={({ gl }) => gl.domElement.addEventListener("webglcontextlost", onLost)}
      >
        <World {...props} level={detail} auto={props.detail === "auto"} onSlow={onSlow} labels={labels} beacons={beacons} pin={pin} onCaption={(c) => setCaptions((cs) => [...cs.slice(-2), c])} />
      </Canvas>
      <div className="pointer-events-none absolute inset-0" style={{ background: `radial-gradient(120% 95% at 50% 46%, transparent 58%, color-mix(in oklch, ${props.look.css.skyTop} ${props.look.night ? 70 : 45}%, transparent) 100%)` }} aria-hidden />
      <div ref={labels} className="pointer-events-none absolute inset-0" />
      <div ref={beacons} className="pointer-events-none absolute inset-0" />
      <div ref={pin} className="pointer-events-none absolute top-0 left-0 hidden will-change-transform" aria-hidden>
        <span className="absolute -top-7 -left-px h-7 w-0.5 rounded-full bg-primary" />
        <span className="absolute -top-2 -left-2 size-4 rounded-full border-2 border-primary bg-brand" />
      </div>
      <div className="pointer-events-none absolute inset-x-0 flex flex-col items-center gap-2" style={{ top: props.insets.top }} aria-live="polite">
        {captions.map((c) => (
          <div key={c.key} className="flex items-baseline gap-2 rounded-full bg-surface/90 px-3 py-1 shadow-(--shadow-sm) backdrop-blur-sm">
            <span className="mono type-label text-primary">{c.text}</span>
            {c.detail && <span className="type-caption text-secondary">{c.detail}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

function World(props: StageProps & { level: Detail; auto: boolean; onSlow: (d: Detail) => void; labels: Layer; beacons: Layer; pin: Layer; onCaption: (c: Caption) => void }) {
  const { gl, camera, size, invalidate, viewport } = useThree();
  const renderer = useRef<AtlasRenderer | null>(null);
  const latest = useRef(props);
  useLayoutEffect(() => {
    latest.current = props;
  });
  const hooks = useMemo<Hooks>(
    () => ({
      onHover: (r, x, y) => latest.current.onHover(r, x, y),
      onPick: (r, d) => latest.current.onPick(r, d),
      onFolder: (f) => latest.current.onFolder(f),
      onPerson: (p) => latest.current.onPerson(p),
      onCam: (c) => latest.current.onCam(c),
      onCaption: (c) => latest.current.onCaption(c),
      onSlow: (d) => latest.current.onSlow(d),
      avatars: (p) => latest.current.avatars(p),
    }),
    [],
  );
  const { lens, focus, roleMask, selected, solo, soloSlot, top, reduced, insets, summary, feed, look, level, auto } = props;
  const view = useMemo(() => ({ lens, focus, roleMask, selected, solo, soloSlot, top, reduced, insets }), [lens, focus, roleMask, selected, solo, soloSlot, top, reduced, insets]);
  const firstView = useRef(view);
  const firstSize = useRef(size);
  const firstDetail = useRef({ level, auto });

  useEffect(() => {
    const p = latest.current;
    const labels = p.labels.current;
    const beacons = p.beacons.current;
    const pin = p.pin.current;
    if (!labels || !beacons || !pin) return;
    const r = new AtlasRenderer({ gl, camera: camera as THREE.PerspectiveCamera, summary, layers: { labels, beacons, pin }, hooks, clock: p.clock, view: firstView.current, width: firstSize.current.width, height: firstSize.current.height, initial: p.initialCam, wake: invalidate, detail: firstDetail.current.level, auto: firstDetail.current.auto });
    r.setLook(p.look);
    renderer.current = r;
    p.onApi(r.api);
    const stop = feed.listen((f) => r.applyFrame(f));
    r.applyFrame(feed.value);
    invalidate();
    return () => {
      stop();
      r.dispose();
      renderer.current = null;
    };
  }, [gl, camera, summary, feed, hooks, invalidate]);

  useEffect(() => {
    renderer.current?.setLook(look);
  }, [look]);

  useEffect(() => {
    renderer.current?.setView(view);
  }, [view]);

  useEffect(() => {
    renderer.current?.setSize(size.width, size.height);
  }, [size.width, size.height, viewport.dpr]);

  useEffect(() => {
    renderer.current?.setDetail(level, auto);
  }, [level, auto]);

  useFrame((_, delta) => {
    if (renderer.current?.frame(delta)) invalidate();
  }, 1);

  return null;
}
