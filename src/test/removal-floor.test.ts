import { test } from "node:test";
import assert from "node:assert/strict";
import { flooredSubsFromRemovals, subredditOfPermalink } from "../removal-floor.js";

const rm = (permalink: string | null) => ({ permalink });

test("parses the subreddit from a permalink, lower-cased, like the publish gate", () => {
  assert.equal(subredditOfPermalink("/r/WordPress/comments/1/x/"), "wordpress");
  assert.equal(subredditOfPermalink("/r/webdev/comments/2/y/"), "webdev");
  assert.equal(subredditOfPermalink("/r/node/"), "node");
  for (const bad of [null, undefined, "", "https://example.com/x", "no-sub-here"]) {
    assert.equal(subredditOfPermalink(bad as string | null), null, String(bad));
  }
});

test("floors a sub only once its removals reach the threshold", () => {
  const removals = [rm("/r/WordPress/comments/1/a/"), rm("/r/wordpress/comments/2/b/"), rm("/r/webdev/comments/3/c/")];
  assert.deepEqual([...flooredSubsFromRemovals(removals, 2)], ["wordpress"]);
});

test("case variants of one sub count as the same sub", () => {
  assert.deepEqual([...flooredSubsFromRemovals([rm("/r/WebDev/c/1/"), rm("/r/webdev/c/2/")], 2)], ["webdev"]);
});

test("unparseable permalinks are ignored, not counted as a sub", () => {
  assert.equal(flooredSubsFromRemovals([rm(null), rm(""), rm("garbage"), rm("garbage2")], 1).size, 0);
});

test("an empty removal history floors nothing", () => {
  assert.equal(flooredSubsFromRemovals([], 2).size, 0);
});

test("threshold 1 floors any sub with a single removal", () => {
  assert.deepEqual([...flooredSubsFromRemovals([rm("/r/onlyonce/c/1/")], 1)], ["onlyonce"]);
});
