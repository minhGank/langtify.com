// Local Docker fixture runner. Never connects to a linked or hosted project.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

export function query(sql, database = 'postgres') {
  let signalReady;
  const ready = new Promise((resolve) => {
    signalReady = resolve;
  });
  const result = new Promise((resolve, reject) => {
    const child = spawn('docker', [
      'exec',
      '-i',
      'supabase_db_langtify',
      'psql',
      '-U',
      'postgres',
      '-d',
      database,
      '-At',
      '-v',
      'ON_ERROR_STOP=1',
      '-v',
      'VERBOSITY=verbose',
    ]);
    let output = '';
    let error = '';
    const timeout = setTimeout(() => child.kill(), 20000);
    child.stdout.on('data', (data) => {
      output += data;
      if (output.includes('AUDIT_LOCKED')) signalReady(true);
    });
    child.stderr.on('data', (data) => {
      error += data;
    });
    child.on('error', (cause) => {
      clearTimeout(timeout);
      signalReady(false);
      reject(cause);
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      signalReady(false);
      resolve({ code, output, error });
    });
    child.stdin.end(sql);
  });
  return { ready, result };
}

export async function execute(sql, database = 'postgres') {
  const result = await query(sql, database).result;
  assert.equal(result.code, 0, result.error);
  return result.output.trim();
}
