import { execFileSync } from 'node:child_process';
import path from 'node:path';

test('offline vocabulary manifest and editorial gates', () => {
  execFileSync(process.execPath, ['--test', 'scripts/tests/vocabulary-manifest.test.mjs'], {
    cwd: path.resolve(__dirname, '..'),
    stdio: 'pipe',
    timeout: 30_000,
  });
});
