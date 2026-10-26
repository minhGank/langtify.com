import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import {
  LEVELS,
  planLevels,
  simulateSupply,
  measureCoverage,
} from '../lib/vocabulary-coverage.mjs';

test('all six preferred patterns and finite exhaustion', () => {
  LEVELS.forEach((l, i) =>
    assert.deepEqual(planLevels(l, [6, 6, 6, 6, 6, 6]), [
      LEVELS[Math.max(0, i - 1)],
      l,
      LEVELS[Math.min(5, i + 1)],
    ]),
  );
  assert.equal(simulateSupply('A1', [3, 0, 0, 0, 0, 0]).fullCompletionDays, 1);
  assert.equal(simulateSupply('A1', [1, 30, 0, 0, 0, 0]).fullCompletionDays, 0);
  assert.deepEqual(planLevels('B2', [0, 0, 1, 2, 0, 0]), ['B1', 'B2', 'B2']);
  assert.deepEqual(planLevels('C2', [0, 0, 0, 9, 2, 0]), ['B2', 'C1', 'C1']);
  assert.deepEqual(planLevels('C2', [0, 0, 0, 9, 3, 0]), ['C1', 'C1', 'C1']);
  assert.equal(planLevels('C2', [0, 0, 30, 2, 0, 0]), null);
});
test('all small count combinations respect bounds, distinct capacity and one stretch', () => {
  for (let code = 0; code < 4096; code++) {
    const counts = LEVELS.map((_, i) => (code >> (2 * i)) & 3);
    LEVELS.forEach((l, i) => {
      const plan = planLevels(l, counts);
      const low = i === 5 ? 3 : Math.max(0, i - 1);
      const belowOrSame = counts.slice(low, i + 1).reduce((sum, n) => sum + n, 0);
      const capacity = belowOrSame + (i < 5 ? Math.min(1, counts[i + 1]) : 0);
      assert.equal(plan !== null, capacity >= 3, 'Never report a shortage for a legal triple');
      if (!plan) return;
      assert.equal(plan.length, 3);
      assert.ok(plan.filter((p) => LEVELS.indexOf(p) > i).length <= 1);
      assert.ok(
        plan.every(
          (p) =>
            LEVELS.indexOf(p) >= (i === 5 ? 3 : Math.max(0, i - 1)) &&
            LEVELS.indexOf(p) <= Math.min(5, i + 1),
        ),
      );
      LEVELS.forEach((level, n) => assert.ok(plan.filter((p) => p === level).length <= counts[n]));
    });
  }
});
test('pilot reports provisional supply separately from reviewed release inventory', () => {
  const pilot = JSON.parse(
    readFileSync(new URL('../../data/vocabulary/pilot.v0.2.0.json', import.meta.url)),
  );
  const result = measureCoverage(pilot.concepts);
  assert.equal(result.provisional.en.B2.fullCompletionDays, 5);
  assert.equal(result.provisional.fr.B2.fullCompletionDays, 1);
  for (const lang of ['en', 'fr']) {
    if (lang === 'fr') assert.equal(result.provisional[lang].C2.firstDay, null);
    else assert.deepEqual(result.provisional[lang].C2.firstDay, ['B2', 'B2', 'C1']);
    for (const level of LEVELS) assert.equal(result.reviewed[lang][level].fullCompletionDays, 0);
  }
  const changed = structuredClone(pilot.concepts);
  changed[0].terms.fr.cefr = null;
  const measured = measureCoverage(changed);
  assert.ok(
    measured.provisional.en.A1.fullCompletionDays <= result.provisional.en.A1.fullCompletionDays,
  );
});
test('invalid counts and unsupported levels fail closed', () => {
  for (const counts of [
    [1, 2],
    [-1, 0, 0, 0, 0, 0],
    [null, 0, 0, 0, 0, 0],
    [1.5, 0, 0, 0, 0, 0],
  ])
    assert.throws(() => planLevels('A1', counts), /Invalid selection/);
  assert.throws(() => planLevels('C3', [3, 3, 3, 3, 3, 3]), /Invalid selection/);
});
