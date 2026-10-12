import { execFileSync } from 'node:child_process';
import path from 'node:path';

test('server-only Production cleanup regression suite', () => {
  execFileSync(process.execPath, ['--test', 'scripts/tests/production-cleanup.test.mjs'], {
    cwd: path.resolve(__dirname, '..'),
    stdio: 'pipe',
    timeout: 30_000,
  });
});
