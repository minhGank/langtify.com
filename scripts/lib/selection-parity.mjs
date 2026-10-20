import assert from 'node:assert/strict';
import { execute } from './local-db.mjs';
import { LEVELS, planLevels } from './vocabulary-coverage.mjs';

// Every 0..3 capacity combination in each learner's bounded three-level window.
// Executes only against the local Docker database, without fixture writes.
export async function testSelectionParity() {
  const cases = [];
  for (const [rank, learner] of LEVELS.entries()) {
    const low = rank === 5 ? 3 : Math.max(0, rank - 1);
    const high = Math.min(5, rank + 1);
    for (let code = 0; code < 4 ** (high - low + 1); code++) {
      const counts = LEVELS.map((_, n) =>
        n < low || n > high ? 0 : (code >> (2 * (n - low))) & 3,
      );
      cases.push({ learner, counts, expected: planLevels(learner, counts) });
    }
  }
  const values = cases
    .map(({ learner, counts }, i) => `(${i},'${learner}',array[${counts.join(',')}])`)
    .join(',');
  const actual = JSON.parse(
    await execute(
      `select json_agg(private.challenge_level_plan(learner,counts) order by i) from (values ${values}) p(i,learner,counts);`,
    ),
  );
  assert.deepEqual(
    actual,
    cases.map((c) => c.expected),
  );
  console.log(`PASS: SQL/catalog planner parity for ${cases.length} bounded capacity cases`);
}
