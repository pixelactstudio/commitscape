export const whole = (n: number) => Math.round(n).toLocaleString("en-US");

export const compact = (n: number) => (n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k` : `${Math.round(n)}`);

export const short = (n: number) => (n >= 10_000 ? compact(n) : whole(n));
