/**
 * Observe every turn: the auto cycle's observe step and the removal brake (src/commands/auto.ts).
 *
 *   - the cycle observes BEFORE it collects, drafts, warms up or publishes;
 *   - a 429 or block page while observing ends the turn with nothing published;
 *   - a removal observed in this turn ends the turn too (the brake), and an observe that throws
 *     does not.
 *
 * Due selection is tested in observe-due.test.ts. No database rows: every seam is stubbed.
 * observe-brake.test.ts drives the real health path.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { HealthVerdict, HealthCounters } from '../health.js';
import { observeStep, cycle, removalBrake, type ObserveStepDeps, type CycleDeps } from '../commands/auto.js';

const NOW = new Date('2026-10-22T12:00:00.000Z');
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();

