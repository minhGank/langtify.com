import { spawnSync } from 'node:child_process';
import path from 'node:path';

test('offline vocabulary manifest and editorial gates', () => {
  const result = spawnSync(
    process.execPath,
    [
      '--test',
      'scripts/tests/vocabulary-manifest.test.mjs',
      'scripts/tests/vocabulary-coverage.test.mjs',
    ],
    {
      cwd: path.resolve(__dirname, '..'),
      stdio: 'pipe',
      timeout: 30_000,
    },
  );
  expect(result.error).toBeUndefined();
  if (result.status !== 0)
    throw new Error(`${result.stdout?.toString()}${result.stderr?.toString()}`);
});
