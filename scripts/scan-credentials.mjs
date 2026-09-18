// Current source/config/bundle scan; never print matched credential values.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
const paths = new Set(
  execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    encoding: 'utf8',
  })
    .split('\0')
    .filter(Boolean),
);
function walk(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path);
    else paths.add(path);
  }
}
walk('dist');
if (existsSync('.env.local')) paths.add('.env.local');
let scanned = 0,
  native = 0;
const failures = [];
for (const path of paths) {
  if (
    !existsSync(path) ||
    (!/\.(?:[cm]?[jt]sx?|json|lock|md|toml|sql|html|map|hbc|ya?ml)$/.test(path) &&
      !/(^|\/)\.env(?:\.|$)/.test(path))
  )
    continue;
  let source;
  if (path.endsWith('.hbc')) {
    const host =
      process.platform === 'darwin'
        ? 'osx-bin'
        : process.platform === 'linux'
          ? 'linux64-bin'
          : 'win64-bin';
    const compiler = join(
      'node_modules/hermes-compiler/hermesc',
      host,
      process.platform === 'win32' ? 'hermesc.exe' : 'hermesc',
    );
    // Raw Hermes string-table entries abut: scanning binary as text invents fake
    // keys by concatenating the SDK's prefix check with unrelated next strings.
    source = execFileSync(compiler, ['-b', '-dump-bytecode', path], {
      encoding: 'utf8',
      maxBuffer: 96 * 1024 * 1024,
    });
    native++;
  } else source = readFileSync(path, 'utf8');
  scanned++;
  const secret =
    /GOCSPX_[A-Za-z0-9_-]{20,}|sb_secret_[A-Za-z0-9_-]{20,}|-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/;
  if (secret.test(source)) failures.push(`${path}: secret/private-key pattern`);
  for (const match of source.matchAll(/eyJ[A-Za-z0-9_-]+\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+/g)) {
    try {
      const payload = JSON.parse(atob(match[1].replaceAll('-', '+').replaceAll('_', '/')));
      if ((payload.role && payload.role !== 'anon') || (payload.url && payload.exp))
        failures.push(`${path}: non-public JWT/capability`);
    } catch {
      /* Not a complete JSON JWT; no credential material is printed. */
    }
  }
  if (
    path.startsWith('dist/') &&
    /SUPABASE_SERVICE_ROLE_KEY|attest_submission_photo|photo_verification_target|get_moderation_photo_target|NOTIFICATION_JOB_SECRET|prepare_due_notifications|claim_notification_attempts|authorize_notification_attempt|claim_notification_receipts|EXPO_ACCESS_TOKEN/.test(
      source,
    )
  )
    failures.push(`${path}: server-only implementation in app bundle`);
}
if (failures.length) {
  console.error([...new Set(failures)].join('\n'));
  process.exitCode = 1;
} else
  console.log(
    `PASS: ${scanned} current source/config/bundle files; ${native} decoded Hermes bundles; no privileged credentials or server implementation in app exports`,
  );
