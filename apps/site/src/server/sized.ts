import "@tanstack/react-start/server-only";

const RECOUNT_EVERY = 256;

/** Values kept in memory by key, the least recently used dropped first once their sizes pass the budget. Sizes are added up as values come and go; a value changed in place is measured again with `refresh`, and every value is measured again now and then, for those that grow on their own. */
export class Sized<V> {
  private readonly map = new Map<string, { value: V; size: number }>();
  private readonly budget: number;
  private readonly size: (v: V) => number;
  private total = 0;
  private sets = 0;
  constructor(budget: number, size: (v: V) => number) {
    this.budget = budget;
    this.size = size;
  }
  get(k: string): V | undefined {
    const e = this.map.get(k);
    if (e !== undefined) {
      this.map.delete(k);
      this.map.set(k, e);
    }
    return e?.value;
  }
  peek(k: string): V | undefined {
    return this.map.get(k)?.value;
  }
  set(k: string, v: V): void {
    this.forget(k);
    const size = this.size(v);
    this.map.set(k, { value: v, size });
    this.total += size;
    this.sets += 1;
    if (this.sets % RECOUNT_EVERY === 0) this.recount();
    this.trim();
  }
  delete(k: string): void {
    this.forget(k);
  }
  refresh(k: string): void {
    const e = this.map.get(k);
    if (!e) return;
    const size = this.size(e.value);
    this.total += size - e.size;
    e.size = size;
    this.trim();
  }
  trim(): void {
    for (const [k, e] of this.map) {
      if (this.total <= this.budget || this.map.size <= 1) break;
      this.total -= e.size;
      this.map.delete(k);
    }
  }
  bytes(): number {
    return this.total;
  }
  private forget(k: string): void {
    const e = this.map.get(k);
    if (!e) return;
    this.total -= e.size;
    this.map.delete(k);
  }
  private recount(): void {
    this.total = 0;
    for (const e of this.map.values()) {
      e.size = this.size(e.value);
      this.total += e.size;
    }
  }
}
