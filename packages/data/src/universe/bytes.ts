const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class ByteWriter {
  private buf = new Uint8Array(1 << 16);
  private at = 0;

  private room(n: number): void {
    if (this.at + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.at + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.at));
    this.buf = next;
  }

  byte(v: number): void {
    this.room(1);
    this.buf[this.at++] = v & 0xff;
  }

  uint(v: number): void {
    if (!(v >= 0) || !Number.isFinite(v)) throw new Error(`not a whole number: ${v}`);
    this.room(8);
    let n = Math.floor(v);
    while (n >= 0x80) {
      this.buf[this.at++] = (n % 0x80) | 0x80;
      n = Math.floor(n / 0x80);
    }
    this.buf[this.at++] = n;
  }

  int(v: number): void {
    this.uint(v < 0 ? -2 * v - 1 : 2 * v);
  }

  text(s: string): void {
    const b = encoder.encode(s);
    this.uint(b.length);
    this.room(b.length);
    this.buf.set(b, this.at);
    this.at += b.length;
  }

  bytes(): Uint8Array {
    return this.buf.slice(0, this.at);
  }
}

export class ByteReader {
  at = 0;
  private readonly buf: Uint8Array;
  constructor(buf: Uint8Array) {
    this.buf = buf;
  }

  byte(): number {
    if (this.at >= this.buf.length) throw new Error("the payload ended early");
    return this.buf[this.at++] as number;
  }

  uint(): number {
    let n = 0;
    let scale = 1;
    for (;;) {
      const b = this.byte();
      n += (b & 0x7f) * scale;
      if (b < 0x80) return n;
      scale *= 0x80;
    }
  }

  int(): number {
    const u = this.uint();
    return u % 2 === 1 ? -(u + 1) / 2 : u / 2;
  }

  text(): string {
    const n = this.uint();
    if (this.at + n > this.buf.length) throw new Error("the payload ended early");
    const s = decoder.decode(this.buf.subarray(this.at, this.at + n));
    this.at += n;
    return s;
  }

  get done(): boolean {
    return this.at >= this.buf.length;
  }
}
