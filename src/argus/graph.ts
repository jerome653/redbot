/**
 * Phase 6 — the claim dependency graph.
 *
 * A technical reply is an argument, not a list. HRC-001's structure was:
 *
 *     A  "exceeding max_allowed_packet truncates the row silently"        ← FALSE
 *     B  "Custom CSS is one large serialized row"                          ← unverified
 *     C  "so that is why your Custom CSS came back blank"                  ← rests on A and B
 *     D  "check max_allowed_packet before the next restore"                ← rests on C
 *
 * A is false, so C and D are worthless regardless of how reasonable they sound in isolation.
 * Scoring claims independently would have marked three of four "plausible" and produced a
 * passing average. Averages are how invalid reasoning survives review.
 *
 * So: when a claim fails, everything downstream of it fails with it. There is no partial
 * salvage. Deterministic graph traversal, no model involved.
 */
import type { Claim } from './types.js';

export interface GraphIssue {
  kind: 'missing-dependency' | 'cycle';
  claimId: string;
  detail: string;
}

/** Structural problems in the declared graph. A cycle means the reasoning is circular. */
export function validateGraph(claims: Claim[]): GraphIssue[] {
  const ids = new Set(claims.map((c) => c.id));
  const issues: GraphIssue[] = [];

  for (const c of claims) {
    for (const dep of c.dependsOn) {
      if (!ids.has(dep)) {
        issues.push({
          kind: 'missing-dependency',
          claimId: c.id,
          detail: `${c.id} depends on ${dep}, which was never extracted`
        });
      }
    }
  }

  /* cycle detection — an argument that assumes its own conclusion */
  const state = new Map<string, 'open' | 'closed'>();
  const byId = new Map(claims.map((c) => [c.id, c]));

  const walk = (id: string, trail: string[]): void => {
    const mark = state.get(id);
    if (mark === 'closed') return;
    if (mark === 'open') {
      issues.push({
        kind: 'cycle',
        claimId: id,
        detail: `circular reasoning: ${[...trail, id].join(' → ')}`
      });
      return;
    }
    state.set(id, 'open');
    for (const dep of byId.get(id)?.dependsOn ?? []) {
      if (byId.has(dep)) walk(dep, [...trail, id]);
    }
    state.set(id, 'closed');
  };

  for (const c of claims) walk(c.id, []);
  return issues;
}

/**
 * Propagate failure downstream.
 *
 * `failed` is the set of claim ids that failed on their own merits (fatal contradiction, no
 * provenance, whatever). Returns every claim invalidated as a consequence, with the specific
 * upstream claim that took it down — so a reviewer is told "C is dead because A is false"
 * rather than being handed four independent complaints.
 */
export function propagateFailure(
  claims: Claim[],
  failed: ReadonlySet<string>
): Array<{ claimId: string; becauseOf: string }> {
  const byId = new Map(claims.map((c) => [c.id, c]));
  const invalidated = new Map<string, string>();

  const rootCause = (id: string, seen = new Set<string>()): string | null => {
    if (seen.has(id)) return null;         // cycles are reported separately
    seen.add(id);
    for (const dep of byId.get(id)?.dependsOn ?? []) {
      if (failed.has(dep)) return dep;
      const deeper = rootCause(dep, seen);
      if (deeper) return deeper;
    }
    return null;
  };

  for (const c of claims) {
    if (failed.has(c.id)) continue;        // failed on its own merits, not invalidated by another
    const cause = rootCause(c.id);
    if (cause) invalidated.set(c.id, cause);
  }

  return [...invalidated.entries()].map(([claimId, becauseOf]) => ({ claimId, becauseOf }));
}

/** Claims nothing else depends on — the reply's actual conclusions. */
export function terminalClaims(claims: Claim[]): Claim[] {
  const depended = new Set(claims.flatMap((c) => c.dependsOn));
  return claims.filter((c) => !depended.has(c.id));
}
