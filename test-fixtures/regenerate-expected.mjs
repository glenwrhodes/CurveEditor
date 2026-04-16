/**
 * Regenerate test-fixtures/expected_results.json by running the current
 * test_curves.curve.json through the JS runtime library. Python tests
 * then verify parity against the same file.
 *
 * Run from the repo root:
 *   node test-fixtures/regenerate-expected.mjs
 *
 * Requires the JS library to be built first (node packages/curve-eval-js/build.mjs).
 */

import { evaluate, evaluateState } from '../packages/curve-eval-js/dist/index.mjs';
import fs from 'fs';

const fixturesPath = 'test-fixtures/test_curves.curve.json';
const expectedPath = 'test-fixtures/expected_results.json';

const fixtures = JSON.parse(fs.readFileSync(fixturesPath, 'utf8'));
const expected = JSON.parse(fs.readFileSync(expectedPath, 'utf8'));

let updated = 0;
let preserved = 0;
let missing = 0;

for (const t of expected.tests) {
  const opts = t.normalized ? { normalized: true } : undefined;

  if ('expected_state' in t) {
    const r = evaluateState(fixtures, t.curve, t.time, opts);
    if (r === null) { missing++; continue; }
    t.expected_state = r.label !== undefined
      ? { index: r.index, label: r.label }
      : { index: r.index };
    updated++;
  } else if ('expected_vec' in t) {
    const r = evaluate(fixtures, t.curve, t.time, opts);
    if (r === null) { missing++; continue; }
    t.expected_vec = r;
    updated++;
  } else if ('expected_color' in t) {
    const r = evaluate(fixtures, t.curve, t.time, opts);
    if (r === null) { missing++; continue; }
    t.expected_color = r;
    updated++;
  } else if ('expected' in t) {
    // Preserve intentional nulls (e.g. empty_keys case)
    if (t.expected === null) { preserved++; continue; }
    const r = evaluate(fixtures, t.curve, t.time, opts);
    t.expected = r;
    updated++;
  }
}

fs.writeFileSync(expectedPath, JSON.stringify(expected, null, 2) + '\n');
console.log(`Regenerated: ${updated} tests updated, ${preserved} preserved (null), ${missing} missing curves skipped`);
