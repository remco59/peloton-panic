// Tiny seeded RNG (mulberry32) whose state lives inside the game state, so the
// whole game is a deterministic function of (seed, actions).

export function nextRand(s: { rng: number }): number {
  s.rng = (s.rng + 0x6d2b79f5) | 0;
  let t = s.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function randInt(s: { rng: number }, n: number): number {
  return Math.floor(nextRand(s) * n);
}

export function pick<T>(s: { rng: number }, arr: readonly T[]): T {
  return arr[randInt(s, arr.length)];
}

export function shuffle<T>(s: { rng: number }, arr: readonly T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(s, i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
