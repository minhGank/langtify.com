// Offline mirror of private.challenge_level_plan. SQL parity is tested locally.
export const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
export function planLevels(learner, counts) {
  const l = LEVELS.indexOf(learner);
  if (
    l < 0 ||
    !Array.isArray(counts) ||
    counts.length !== 6 ||
    counts.some((n) => !Number.isSafeInteger(n) || n < 0)
  )
    throw new Error('Invalid selection pool');
  const patterns = [];
  const low = l === 5 ? 3 : Math.max(0, l - 1);
  const high = Math.min(5, l + 1);
  for (let a = low; a <= high; a++)
    for (let b = a; b <= high; b++)
      for (let c = b; c <= high; c++) {
        const ranks = [a, b, c];
        if (
          ranks.filter((n) => n > l).length > 1 ||
          counts.some((count, n) => ranks.filter((r) => r === n).length > count)
        )
          continue;
        patterns.push({
          ranks,
          score: [
            l === 5 ? ranks.filter((n) => n === 3).length : 0,
            Math.abs(a - Math.max(0, l - 1)) + Math.abs(b - l) + Math.abs(c - Math.min(5, l + 1)),
            -ranks.filter((n) => n === l).length,
            a + b + c,
            a,
            b,
            c,
          ],
        });
      }
  patterns.sort((a, b) => {
    for (let i = 0; i < a.score.length; i++)
      if (a.score[i] !== b.score[i]) return a.score[i] - b.score[i];
    return 0;
  });
  return patterns[0]?.ranks.map((n) => LEVELS[n]) ?? null;
}

export function simulateSupply(learner, counts) {
  const remaining = [...counts];
  const l = LEVELS.indexOf(learner);
  const preferred = [LEVELS[Math.max(0, l - 1)], learner, LEVELS[Math.min(5, l + 1)]];
  const firstDay = planLevels(learner, remaining);
  let fullCompletionDays = 0,
    fallbackDays = 0,
    consolidationDays = 0;
  for (let plan = firstDay; plan; plan = planLevels(learner, remaining)) {
    fullCompletionDays++;
    if (plan.some((level, i) => level !== preferred[i])) fallbackDays++;
    if (learner === 'C2' && plan.includes('B2')) consolidationDays++;
    for (const level of plan) remaining[LEVELS.indexOf(level)]--;
  }
  return { firstDay, fullCompletionDays, fallbackDays, consolidationDays, remaining };
}

export function measureCoverage(concepts) {
  const paired = concepts.filter(
    (c) =>
      c?.photography?.photographable === true &&
      ['en', 'fr'].every(
        (language) =>
          typeof c.terms?.[language]?.lemma === 'string' &&
          c.terms[language].lemma.trim() &&
          LEVELS.includes(c.terms[language].cefr),
      ),
  );
  const reviewed = paired.filter(
    (c) => c.editorial?.status === 'approved' && c.photography.availability === 'everyday',
  );
  const report = (pool) =>
    Object.fromEntries(
      ['en', 'fr'].map((language) => {
        const counts = LEVELS.map(
          (level) => pool.filter((c) => c.terms[language].cefr === level).length,
        );
        return [
          language,
          Object.fromEntries(LEVELS.map((learner) => [learner, simulateSupply(learner, counts)])),
        ];
      }),
    );
  return {
    policyVersion: 2,
    assumptions:
      'Fresh user; completes all three daily; no replacements, prior completions or access exclusions. Draft counts are not release approval. Supply is finite, not a guaranteed launch horizon.',
    provisional: report(paired),
    reviewed: report(reviewed),
  };
}
