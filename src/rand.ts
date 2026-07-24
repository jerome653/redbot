/**
 * Randomness, made reproducible.
 *
 * The behaviour engine (src/behavior.ts) is deliberately irregular — variable dwell, partial
 * scrolls, sometimes leaving a thread without acting. Irregular behaviour that cannot be
 * replayed is untestable, and an untestable behaviour model is a guess.
 *
 * So every random decision in redbot goes through this module. In production the stream is
 * seeded from the clock and each session records its seed; in tests the seed is fixed and the
 * whole session is deterministic. That is the engineering principle "prefer deterministic
 * behavior over heuristics" applied to the one subsystem that has to be non-deterministic.
 *
 * mulberry32: 32-bit state, uniform output, ~4 lines. Not cryptographic — nothing here
 * protects a secret, it only shapes timing.
 */

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** The seed this stream started from, so a session can be replayed. */
  readonly seed: number;
}

export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  return {
    seed: seed >>> 0,
    next() {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
  };
}

/**
 * A seed for a fresh session. `REDBOT_SEED` pins it, which is how a reported session gets
 * replayed later without guessing what the timings were.
 */
export function sessionSeed(): number {
  const pinned = process.env.REDBOT_SEED;
  if (pinned && /^\d+$/.test(pinned)) return Number(pinned) >>> 0;
  return (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
}

/* ---------- shaping helpers ---------- */

/** Uniform integer in [min, max). */
export function uniformInt(rng: Rng, min: number, max: number): number {
  return Math.floor(min + rng.next() * (max - min));
}

/** True with probability p. */
export function chance(rng: Rng, p: number): boolean {
  return rng.next() < p;
}

/** Pick one element. Throws on an empty list rather than returning undefined. */
export function pick<T>(rng: Rng, items: readonly T[]): T {
  if (!items.length) throw new Error('pick() from an empty list');
  return items[uniformInt(rng, 0, items.length)] as T;
}

/**
 * Approximately normal, via the mean of three uniforms (Bates n=3). Clamped to ±1 of the
 * mean in units of `spread`.
 *
 * Uniform jitter is what makes automated timing recognisable: the distribution is flat, so
 * every delay in the window is equally likely and the mean sits dead centre of the range.
 * Human pauses cluster around a typical value with a long tail. This is the cheap way to get
 * that shape without pretending to model attention.
 */
export function aroundMean(rng: Rng, mean: number, spread: number): number {
  const u = (rng.next() + rng.next() + rng.next()) / 3;   // centred on 0.5, bell-ish
  return mean + (u - 0.5) * 2 * spread;
}

/**
 * Positive-skewed delay: mostly near `base`, occasionally much longer.
 *
 * A person reading a thread pauses for a few seconds most of the time and once in a while
 * stops for half a minute. `heavyTailP` is how often the long pause happens.
 */
export function skewedDelay(rng: Rng, baseMs: number, opts?: { spread?: number; heavyTailP?: number; tailMult?: number }): number {
  const spread = opts?.spread ?? baseMs * 0.35;
  const heavyTailP = opts?.heavyTailP ?? 0.12;
  const tailMult = opts?.tailMult ?? 3.5;
  const body = Math.max(250, aroundMean(rng, baseMs, spread));
  if (!chance(rng, heavyTailP)) return Math.round(body);
  return Math.round(body * (1 + rng.next() * (tailMult - 1)));
}
