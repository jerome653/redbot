import { config } from './config.js';

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Uniform-random delay in a range. */
export function between(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min));
}

/** Pause between browser actions so we are not hammering the site. */
export async function pause(): Promise<void> {
  await sleep(between(config.pacing.minActionMs, config.pacing.maxActionMs));
}

/** Per-character delays for typing into a real editor. */
export function typingDelay(): number {
  return between(config.pacing.typeCharMinMs, config.pacing.typeCharMaxMs);
}
