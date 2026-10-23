import { WEEK_SECONDS } from "@commitscape/data/universe";
import type { AtlasClient } from "./client";
import type { Clock } from "./clock";
import type { Feed } from "./feed";
import type { FrameAnswer } from "./protocol";

export type FrameAsk = { from: number | null; to: number | null; solo: number | null };

export class FrameRequester {
  private readonly client: AtlasClient;
  private readonly clock: Clock;
  private readonly feed: Feed<FrameAnswer | null>;
  private readonly origin: number;
  private readonly onFrame: (f: FrameAnswer) => void;
  private ask: FrameAsk = { from: null, to: null, solo: null };
  private busy = false;
  private again = false;
  private key = "";
  private lastAt: number | null = null;
  private version = 0;

  constructor(client: AtlasClient, clock: Clock, feed: Feed<FrameAnswer | null>, origin: number, onFrame: (f: FrameAnswer) => void) {
    this.client = client;
    this.clock = clock;
    this.feed = feed;
    this.origin = origin;
    this.onFrame = onFrame;
  }

  start(): () => void {
    const stop = this.clock.listen(() => this.request());
    this.key = "";
    this.request();
    return stop;
  }

  set(ask: FrameAsk): void {
    this.ask = ask;
    this.key = "";
    this.request();
  }

  refresh(): void {
    this.version++;
    this.key = "";
    this.request();
  }

  request(): void {
    if (this.busy) {
      this.again = true;
      return;
    }
    const c = this.clock.state.current;
    const { from, to, solo } = this.ask;
    const at = from !== null && to !== null ? to : c.at;
    const key = `${Math.floor((at - this.origin) / WEEK_SECONDS)}|${from}|${solo}|${this.version}|${c.playing ? 0 : Math.round(at / 86_400)}`;
    if (key === this.key) return;
    this.key = key;
    this.busy = true;
    const after = c.playing && !c.intro ? this.lastAt : null;
    void this.client.ask("frame", { at, from, solo, after }).then((f) => {
      this.busy = false;
      this.lastAt = f.at;
      this.feed.set(f);
      this.onFrame(f);
      if (this.again) {
        this.again = false;
        this.request();
      }
    });
  }
}
