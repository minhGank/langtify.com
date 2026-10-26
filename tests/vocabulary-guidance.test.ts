import { execFileSync } from 'node:child_process';
import path from 'node:path';
test('localized vocabulary guidance and scoped approval gates', () => {
  execFileSync(
    process.execPath,
    [
      '--test',
      'scripts/tests/vocabulary-guidance.test.mjs',
      'scripts/tests/vocabulary-catalog.test.mjs',
    ],
    {
      cwd: path.resolve(__dirname, '..'),
      stdio: 'pipe',
      timeout: 30_000,
    },
  );
});
