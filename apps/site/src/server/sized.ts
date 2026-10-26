import "@tanstack/react-start/server-only";

/** Values kept in memory by key, the least recently used dropped first once their sizes pass the budget. */
export class Sized<V> {
  private readonly map = new Map<string, V>();
  private readonly budget: number;
  private readonly size: (v: V) => number;
  constructor(budget: number, size: (v: V) => number) {
    this.budget = budget;
    this.size = size;
  }
  get(k: string): V | undefined {
    const v = this.map.get(k);
    if (v !== undefined) {
      this.map.delete(k);
      this.map.set(k, v);
    }
    return v;
  }
  peek(k: string): V | undefined {
    return this.map.get(k);
  }
  set(k: string, v: V): void {
    this.map.delete(k);
    this.map.set(k, v);
    this.trim();
  }
  delete(k: string): void {
    this.map.delete(k);
  }
  trim(): void {
    let total = this.bytes();
    for (const [k, v] of this.map) {
      if (total <= this.budget || this.map.size <= 1) break;
      total -= this.size(v);
      this.map.delete(k);
    }
  }
  bytes(): number {
    let total = 0;
    for (const v of this.map.values()) total += this.size(v);
    return total;
  }
}
