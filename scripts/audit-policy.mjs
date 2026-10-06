import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const levels = ['info', 'low', 'moderate', 'high', 'critical'];
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const requireThat = (condition, message) => {
  if (!condition) throw new Error(message);
};
export const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

// npm's nonzero vulnerability exit is data, not success. Every other error is fatal.
export function parseAuditResult(result) {
  requireThat(
    !result.error && !result.signal && [0, 1].includes(result.status),
    'npm audit failed',
  );
  const audit = JSON.parse(result.stdout);
  requireThat(
    record(audit) && !audit.error && audit.auditReportVersion === 2,
    'Invalid audit report',
  );
  requireThat(record(audit.vulnerabilities), 'Missing vulnerabilities');
  const counts = Object.fromEntries(levels.map((level) => [level, 0]));
  for (const [name, item] of Object.entries(audit.vulnerabilities)) {
    requireThat(
      record(item) && item.name === name && levels.includes(item.severity),
      'Invalid finding',
    );
    requireThat(
      Array.isArray(item.nodes) &&
        item.nodes.length > 0 &&
        item.nodes.every((n) => typeof n === 'string'),
      'Invalid finding paths',
    );
    requireThat(Array.isArray(item.via) && item.via.length > 0, 'Missing advisory causes');
    for (const cause of item.via) {
      if (typeof cause === 'string') {
        requireThat(Object.hasOwn(audit.vulnerabilities, cause), 'Unresolved advisory cause');
      } else {
        requireThat(
          record(cause) &&
            cause.name === name &&
            cause.dependency === name &&
            levels.includes(cause.severity) &&
            /^https:\/\/github\.com\/advisories\/GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/.test(
              cause.url,
            ),
          'Unrecognized advisory',
        );
      }
    }
    counts[item.severity]++;
  }
  requireThat(record(audit.metadata?.vulnerabilities), 'Missing audit totals');
  for (const level of levels)
    requireThat(
      counts[level] === audit.metadata.vulnerabilities[level],
      'Inconsistent audit totals',
    );
  requireThat(
    Object.values(counts).reduce((a, b) => a + b, 0) === audit.metadata.vulnerabilities.total,
    'Inconsistent audit total',
  );
  requireThat(
    result.status === (counts.high + counts.critical > 0 ? 1 : 0),
    'Unexpected npm audit exit status',
  );
  return audit;
}

// Record immediate importing package paths as well as the complete reviewed lock hash.
// The lock hash freezes all ancestor paths, versions and peer/optional relationships.
export function dependencyParents(lock, name) {
  return Object.entries(lock.packages)
    .flatMap(([path, value]) =>
      ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'].flatMap(
        (kind) =>
          value[kind]?.[name]
            ? [{ path, version: value.version, kind, range: value[kind][name] }]
            : [],
      ),
    )
    .sort((a, b) => `${a.path}:${a.kind}`.localeCompare(`${b.path}:${b.kind}`));
}

export function verifyScope(policy, { scope, env, files }) {
  requireThat(
    policy.schemaVersion === 1 && scope === 'unsigned-ci' && policy.scope === scope,
    'Exceptions require explicit unsigned-ci scope',
  );
  if (env.GITHUB_ACTIONS === 'true') {
    requireThat(
      env.GITHUB_JOB === 'app' &&
        env.GITHUB_WORKFLOW === 'CI' &&
        /^.+\/\.github\/workflows\/ci\.yml@refs\//.test(env.GITHUB_WORKFLOW_REF ?? ''),
      'Exceptions are not authorized for this workflow/job',
    );
  }
  requireThat(
    record(policy.reviewedFiles) && Object.keys(policy.reviewedFiles).length >= 4,
    'Missing reviewed workflow/configuration',
  );
  for (const file of ['.github/workflows/ci.yml', 'package.json', 'app.json', 'app.config.js']) {
    requireThat(
      typeof files[file] === 'string' && sha256(files[file]) === policy.reviewedFiles[file],
      `Scope changed; re-review required: ${file}`,
    );
  }
}

export function verifyBundles(maps, exceptions) {
  const platforms = new Set();
  requireThat(Array.isArray(maps) && maps.length > 0, 'Missing production source maps');
  function inspect(map) {
    requireThat(record(map) && map.version === 3, 'Invalid production source map');
    if (Array.isArray(map.sections)) {
      requireThat(map.sections.length > 0, 'Empty indexed source map');
      for (const section of map.sections) inspect(section.map);
      return;
    }
    requireThat(
      Array.isArray(map.sources) &&
        map.sources.length > 0 &&
        map.sources.every((s) => typeof s === 'string'),
      'Missing source map modules',
    );
    for (const source of map.sources) {
      const normalized = `/${map.sourceRoot ?? ''}/${source}`.replaceAll('\\', '/');
      for (const entry of exceptions)
        requireThat(
          !normalized.includes(`/node_modules/${entry.package}/`),
          `Excepted package ships in bundle: ${entry.package}`,
        );
    }
  }
  for (const { path, map, bundleExists } of maps) {
    requireThat(bundleExists, `Missing compiled bundle for ${path}`);
    const platform = /(?:^|\/)js\/(ios|android|web)\//.exec(path)?.[1];
    requireThat(platform, `Unknown bundle platform: ${path}`);
    platforms.add(platform);
    inspect(map);
  }
  requireThat(
    ['ios', 'android', 'web'].every((p) => platforms.has(p)),
    'Require iOS, Android and web bundle evidence',
  );
}

export function evaluateAudit(audit, { policy, lock, lockText, now, maps, scope, env, files }) {
  verifyScope(policy, { scope, env, files });
  requireThat(
    sha256(lockText) === policy.lockSha256,
    'Dependency graph changed; re-review required',
  );
  requireThat(
    Array.isArray(policy.exceptions) && policy.exceptions.length > 0,
    'Missing explicit exceptions',
  );
  requireThat(Number.isFinite(now), 'Invalid review clock');
  const keys = new Set();
  for (const entry of policy.exceptions) {
    const key = `${entry.advisory}:${entry.package}`;
    requireThat(!keys.has(key), 'Duplicate exception');
    keys.add(key);
    requireThat(
      entry.scope === 'unsigned-ci' &&
        entry.severity === 'high' &&
        typeof entry.reason === 'string' &&
        entry.reason.length > 0,
      'Invalid exception scope',
    );
    requireThat(
      /^\d{4}-\d{2}-\d{2}$/.test(entry.expires) && now < Date.parse(`${entry.expires}T00:00:00Z`),
      `Exception expired: ${entry.advisory}`,
    );
    const installed = Object.entries(lock.packages)
      .filter(
        ([path]) =>
          path === `node_modules/${entry.package}` ||
          path.endsWith(`/node_modules/${entry.package}`),
      )
      .map(([path, value]) => ({ path, version: value.version }))
      .sort((a, b) => a.path.localeCompare(b.path));
    requireThat(
      same(installed, entry.nodes) &&
        installed.length > 0 &&
        installed.every((n) => n.version === entry.version),
      `Exception version/path changed: ${entry.package}`,
    );
    requireThat(
      same(dependencyParents(lock, entry.package), entry.parents),
      `Exception dependency parents changed: ${entry.package}`,
    );
  }
  verifyBundles(maps, policy.exceptions);
  const findings = audit.vulnerabilities;
  // Propagate unique causes to a fixed point. npm's peer dependency graph contains
  // cycles; enumerating every root-to-leaf path would be exponential.
  const causes = new Map(
    Object.entries(findings).map(([name, item]) => [
      name,
      new Map(
        item.via
          .filter((v) => typeof v !== 'string')
          .map((v) => [`${v.name}:${v.url}:${v.severity}`, v]),
      ),
    ]),
  );
  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, item] of Object.entries(findings)) {
      for (const via of item.via.filter((v) => typeof v === 'string')) {
        for (const [key, value] of causes.get(via)) {
          if (!causes.get(name).has(key)) {
            causes.get(name).set(key, value);
            changed = true;
          }
        }
      }
    }
  }
  const used = new Set();
  const failures = [];
  const reports = [];
  for (const [name, item] of Object.entries(findings)) {
    requireThat(
      item.nodes.every((path) => lock.packages[path]),
      `Audit path missing from lock: ${name}`,
    );
    const roots = [...causes.get(name).values()];
    requireThat(roots.length > 0, `No resolved advisories: ${name}`);
    let status = 'REPORTED';
    if (item.severity === 'critical' || roots.some((c) => c.severity === 'critical')) {
      status = 'BLOCKED';
    } else {
      const highs = roots.filter((c) => c.severity === 'high');
      if (item.severity === 'high' && highs.length === 0) status = 'BLOCKED';
      for (const cause of highs) {
        const id = cause.url.split('/').at(-1);
        const entry = policy.exceptions.find((e) => e.advisory === id && e.package === cause.name);
        const paths = [...findings[cause.name].nodes].sort();
        if (!entry || !same(paths, entry.nodes.map((n) => n.path).sort())) status = 'BLOCKED';
        else {
          used.add(entry.advisory);
          if (status !== 'BLOCKED') status = 'EXCEPTED (unsigned CI only)';
        }
      }
    }
    if (status === 'BLOCKED') failures.push(name);
    reports.push({
      package: name,
      severity: item.severity,
      status,
      advisories: roots.map((c) => c.url),
      runtimeNotice:
        name === 'decode-uri-component' || name === 'query-string' || name === 'expo-router'
          ? 'Runtime URL parsing: unresolved moderate; release review required'
          : undefined,
    });
  }
  for (const entry of policy.exceptions)
    requireThat(used.has(entry.advisory), `Stale exception; remove/re-review: ${entry.advisory}`);
  return { pass: failures.length === 0, failures, reports };
}

function readMaps(directory) {
  const maps = [];
  function walk(path) {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const file = join(path, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (file.endsWith('.map'))
        maps.push({
          path: file.replaceAll('\\', '/'),
          map: JSON.parse(readFileSync(file, 'utf8')),
          bundleExists: existsSync(file.slice(0, -4)),
        });
      else if (/\.(js|hbc)$/.test(file))
        requireThat(existsSync(`${file}.map`), `Bundle missing source map: ${file}`);
    }
  }
  walk(directory);
  return maps;
}

export function main(args = process.argv.slice(2), env = process.env) {
  // Always emit the full report before policy validation, including on policy failure.
  const raw = spawnSync(
    'npm',
    [
      'audit',
      '--json',
      '--audit-level=high',
      '--include=dev',
      '--include=optional',
      '--include=peer',
    ],
    { encoding: 'utf8', timeout: 120_000, maxBuffer: 16 * 1024 * 1024 },
  );
  try {
    console.log(JSON.stringify(JSON.parse(raw.stdout), null, 2));
  } catch {
    console.error(JSON.stringify({ auditOutput: raw.stdout, auditError: raw.stderr }));
  }
  try {
    const audit = parseAuditResult(raw);
    requireThat(
      args.length === 4 && args[0] === '--scope' && args[2] === '--bundles',
      'Usage: --scope unsigned-ci --bundles dist',
    );
    const policy = JSON.parse(readFileSync('scripts/audit-exceptions.json', 'utf8'));
    const lockText = readFileSync('package-lock.json', 'utf8');
    const files = Object.fromEntries(
      Object.keys(policy.reviewedFiles).map((file) => [file, readFileSync(file, 'utf8')]),
    );
    const result = evaluateAudit(audit, {
      policy,
      lock: JSON.parse(lockText),
      lockText,
      now: Date.now(),
      maps: readMaps(args[3]),
      scope: args[1],
      env,
      files,
    });
    for (const report of result.reports) console.log(JSON.stringify(report));
    console.log(
      result.pass
        ? 'PASS: unsigned CI audit policy. Not signing/publishing/release authorization.'
        : `FAIL: unexcepted high/critical findings: ${result.failures.join(', ')}`,
    );
    return result.pass ? 0 : 1;
  } catch (error) {
    console.error(JSON.stringify({ auditPolicyFailure: error.message }));
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  process.exitCode = main();
