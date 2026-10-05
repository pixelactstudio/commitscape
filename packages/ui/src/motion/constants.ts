export const DURATION = {
  instant: 0.12,
  fast: 0.2,
  base: 0.36,
  slow: 0.6,
  reveal: 0.8,
  scene: 1.2,
} as const;

export const EASE = {
  out: [0.22, 1, 0.36, 1],
  inOut: [0.65, 0, 0.35, 1],
  in: [0.55, 0, 1, 0.45],
  emphasized: [0.2, 0, 0, 1],
} as const;

export const GSAP_EASE = {
  out: "power3.out",
  inOut: "power2.inOut",
  in: "power2.in",
  soft: "sine.inOut",
  pop: "back.out(1.7)",
  snap: "expo.out",
} as const;

export const SPRING = {
  gentle: { type: "spring", stiffness: 170, damping: 26, mass: 1 },
  snappy: { type: "spring", stiffness: 420, damping: 32, mass: 0.8 },
  bouncy: { type: "spring", stiffness: 300, damping: 15, mass: 0.9 },
} as const;

export const STAGGER = {
  tight: 0.04,
  base: 0.07,
  loose: 0.12,
} as const;

export const DISTANCE = {
  nudge: 6,
  rise: 16,
  travel: 40,
} as const;

export const BLUR = {
  reveal: 8,
} as const;

export const BEAT = {
  short: 0.5,
  base: 1,
  long: 1.8,
  hold: 2.8,
} as const;

export const TYPING = {
  char: 0.045,
} as const;

export const VIEWPORT = { once: true, amount: 0.3, margin: "0px 0px -10% 0px" } as const;
