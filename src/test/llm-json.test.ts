import test from 'node:test';
import assert from 'node:assert/strict';
import { extractJson } from '../llm.js';

test('plain JSON', () => {
  assert.deepEqual(extractJson<{ a: number }>('{"a":1}'), { a: 1 });
});

test('fenced JSON', () => {
  const out = extractJson<{ worthwhile: boolean }>('```json\n{"worthwhile": true}\n```');
  assert.equal(out.worthwhile, true);
});

test('JSON with a preamble', () => {
  const out = extractJson<{ score: number }>('Here you go:\n{"score": 72}\nthanks');
  assert.equal(out.score, 72);
});

test('nested braces and braces inside strings', () => {
  const out = extractJson<{ a: { b: string } }>('{"a":{"b":"} not the end {"}}');
  assert.equal(out.a.b, '} not the end {');
});

test('no object throws', () => {
  assert.throws(() => extractJson('nothing here'), /no JSON value/);
});

test('unterminated object throws', () => {
  assert.throws(() => extractJson('{"a": 1'), /unterminated/);
});

test('JSON array (batched analyze response)', () => {
  const out = extractJson<Array<{ index: number; score: number }>>(
    '```json\n[{"index":0,"score":80},{"index":1,"score":12}]\n```'
  );
  assert.equal(out.length, 2);
  assert.equal(out[0]!.score, 80);
});

test('array wins when it appears before an object', () => {
  const out = extractJson<Array<{ a: number }>>('[{"a":1}] trailing {"b":2}');
  assert.ok(Array.isArray(out));
  assert.equal(out[0]!.a, 1);
});
