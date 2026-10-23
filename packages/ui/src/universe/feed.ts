export class Feed<T> {
  value: T;
  private listeners = new Set<(v: T) => void>();

  constructor(value: T) {
    this.value = value;
  }

  set(v: T): void {
    this.value = v;
    for (const l of this.listeners) l(v);
  }

  listen(l: (v: T) => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
}
