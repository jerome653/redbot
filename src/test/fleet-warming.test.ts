import { test } from "node:test";
import assert from "node:assert/strict";
import { assessFleetWarming } from "../fleet-warming.js";
import type { AccountRecord } from "../config.js";
import type { Observation } from "../health.js";

const acct = (handle: string, subreddits?: string[]): AccountRecord =>
  ({ handle, subreddits } as AccountRecord);

const karmaObs = (account: string, value: number, ts: string): Observation =>
  ({ ts, account, kind: "karma", vector: "signed-in", value } as Observation);

const FLOOR = new Set(["wordpress"]);

test("PASS when every account has subs and is not trapped", () => {
  const r = assessFleetWarming({
    accounts: [acct("a", ["webdev"]), acct("b", ["wordpress", "seo"])],
    observations: [karmaObs("a", 1, "2026-10-24T00:00:00Z")],
    floorSubs: FLOOR,
    cautionKarmaBelow: 10,
  });
  assert.equal(r.status, "PASS");
  assert.deepEqual(r.emptySubs, []);
  assert.deepEqual(r.trapped, []);
});

test("flags an account with no subreddits as emptySubs", () => {
  const r = assessFleetWarming({
    accounts: [acct("a", []), acct("b", undefined), acct("c", ["webdev"])],
    observations: [],
    floorSubs: FLOOR,
    cautionKarmaBelow: 10,
  });
  assert.equal(r.status, "WARN");
  assert.deepEqual(r.emptySubs.sort(), ["a", "b"]);
});

test("flags under-floor account whose every sub is karma-floored as trapped", () => {
  const r = assessFleetWarming({
    accounts: [acct("stuck", ["wordpress"])],
    observations: [karmaObs("stuck", 2, "2026-10-24T00:00:00Z")],
    floorSubs: FLOOR,
    cautionKarmaBelow: 10,
  });
  assert.equal(r.status, "WARN");
  assert.deepEqual(r.trapped, ["stuck"]);
});

test("NOT trapped once karma reaches the floor", () => {
  const r = assessFleetWarming({
    accounts: [acct("ok", ["wordpress"])],
    observations: [karmaObs("ok", 10, "2026-10-24T00:00:00Z")],
    floorSubs: FLOOR,
    cautionKarmaBelow: 10,
  });
  assert.deepEqual(r.trapped, []);
  assert.equal(r.status, "PASS");
});

test("NOT trapped when at least one declared sub is not floored", () => {
  const r = assessFleetWarming({
    accounts: [acct("ok", ["wordpress", "webdev"])],
    observations: [karmaObs("ok", 1, "2026-10-24T00:00:00Z")],
    floorSubs: FLOOR,
    cautionKarmaBelow: 10,
  });
  assert.deepEqual(r.trapped, []);
});

test("missing karma counts as under floor (never measured)", () => {
  const r = assessFleetWarming({
    accounts: [acct("new", ["wordpress"])],
    observations: [],
    floorSubs: FLOOR,
    cautionKarmaBelow: 10,
  });
  assert.deepEqual(r.trapped, ["new"]);
});

test("latest karma wins by newest ts, not observation order", () => {
  const r = assessFleetWarming({
    accounts: [acct("x", ["wordpress"])],
    observations: [
      karmaObs("x", 12, "2026-10-24T02:00:00Z"),
      karmaObs("x", 1, "2026-10-24T01:00:00Z"),
    ],
    floorSubs: FLOOR,
    cautionKarmaBelow: 10,
  });
  // newest ts (02:00) is karma 12 -> at/above floor -> not trapped
  assert.deepEqual(r.trapped, []);
});

test("handle match is case-insensitive", () => {
  const r = assessFleetWarming({
    accounts: [acct("MixedCase", ["wordpress"])],
    observations: [karmaObs("mixedcase", 11, "2026-10-24T00:00:00Z")],
    floorSubs: FLOOR,
    cautionKarmaBelow: 10,
  });
  assert.deepEqual(r.trapped, []);
});
