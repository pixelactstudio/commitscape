import type { StageClock } from "./Stage";

export const SPEEDS = [
  { value: 7 * 86_400, label: "1 week/s", short: "1 wk/s", words: "a week a second" },
  { value: 30.44 * 86_400, label: "1 month/s", short: "1 mo/s", words: "a month a second" },
  { value: 91.3 * 86_400, label: "1 quarter/s", short: "1 qtr/s", words: "a quarter a second" },
  { value: 365.25 * 86_400, label: "1 year/s", short: "1 yr/s", words: "a year a second" },
] as const;

export class Clock {
  readonly state: { current: StageClock };
  private listeners = new Set<() => void>();
  private frame = 0;
  private last = 0;
  private stepper: ReturnType<typeof setInterval> | null = null;
  private readonly first: number;
  private readonly end: number;
  private ended: (() => void) | null = null;

  constructor(at: number, first: number, end: number) {
    this.first = first;
    this.end = end;
    this.state = { current: { at, playing: false, speed: SPEEDS[1].value, intro: false } };
  }

  get at(): number {
    return this.state.current.at;
  }

  get playing(): boolean {
    return this.state.current.playing;
  }

  listen(l: () => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private tell(): void {
    for (const l of this.listeners) l();
  }

  set(at: number): void {
    this.state.current.at = Math.max(this.first, Math.min(this.end, at));
    this.tell();
  }

  speed(seconds: number): void {
    this.state.current.speed = seconds;
    this.tell();
  }

  play(steps = false, intro = false): void {
    const s = this.state.current;
    if (s.at >= this.end - 3600) s.at = this.first;
    s.playing = true;
    s.intro = intro;
    this.last = performance.now();
    if (steps) {
      this.stepper = setInterval(() => this.advance(30.44 * 86_400), 600);
    } else {
      const tick = (t: number) => {
        const dt = Math.min(0.1, (t - this.last) / 1000);
        this.last = t;
        this.advance(dt * s.speed);
        if (s.playing) this.frame = requestAnimationFrame(tick);
      };
      this.frame = requestAnimationFrame(tick);
    }
    this.tell();
  }

  private advance(by: number): void {
    const s = this.state.current;
    s.at = Math.min(this.end, s.at + by);
    if (s.at >= this.end) {
      this.pause();
      const ended = this.ended;
      this.ended = null;
      ended?.();
    }
    this.tell();
  }

  atEnd(then: () => void): void {
    this.ended = then;
  }

  pause(): void {
    const s = this.state.current;
    s.playing = false;
    s.intro = false;
    cancelAnimationFrame(this.frame);
    if (this.stepper) clearInterval(this.stepper);
    this.stepper = null;
    this.tell();
  }
}
