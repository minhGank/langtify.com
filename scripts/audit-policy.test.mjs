import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dependencyParents, evaluateAudit, parseAuditResult, sha256 } from './audit-policy.mjs';

const advisory = 'GHSA-vfj7-8cjw-p6xm';
function finding(name, severity, via) {
  return { name, severity, nodes: [`node_modules/${name}`], via };
}
function cause(name, severity, id = advisory) {
  return { name, dependency: name, severity, url: `https://github.com/advisories/${id}` };
}
function auditResult(vulnerabilities) {
  const counts = { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 };
  for (const item of Object.values(vulnerabilities)) {
    counts[item.severity]++;
    counts.total++;
  }
  return {
    status: counts.high + counts.critical > 0 ? 1 : 0,
    stdout: JSON.stringify({
      auditReportVersion: 2,
      vulnerabilities,
      metadata: { vulnerabilities: counts },
    }),
  };
}
function fixture() {
  const lock = {
    packages: {
      'node_modules/braces': { version: '3.0.3' },
      'node_modules/micromatch': { version: '4.0.8', dependencies: { braces: '^3.0.3' } },
      'node_modules/tool': { version: '1.0.0', dependencies: { micromatch: '^4.0.8' } },
      'node_modules/decode-uri-component': { version: '0.2.2' },
    },
  };
  const files = Object.fromEntries(
    ['.github/workflows/ci.yml', 'package.json', 'app.json', 'app.config.js'].map((p) => [
      p,
      p === 'package.json' ? '{}' : `fixture:${p}`,
    ]),
  );
  const lockText = JSON.stringify(lock);
  const policy = {
    schemaVersion: 1,
    scope: 'unsigned-ci',
    lockSha256: sha256(lockText),
    reviewedFiles: Object.fromEntries(Object.entries(files).map(([p, text]) => [p, sha256(text)])),
    exceptions: [
      {
        advisory,
        package: 'braces',
        version: '3.0.3',
        severity: 'high',
        scope: 'unsigned-ci',
        reason: 'Fixture of reviewed tooling-only exception',
        expires: '2026-10-13',
        nodes: [{ path: 'node_modules/braces', version: '3.0.3' }],
        parents: dependencyParents(lock, 'braces'),
      },
    ],
  };
  const vulnerabilities = {
    braces: finding('braces', 'high', [cause('braces', 'high')]),
    micromatch: finding('micromatch', 'high', ['braces', 'tool']),
    tool: finding('tool', 'high', ['micromatch']),
    'decode-uri-component': finding('decode-uri-component', 'moderate', [
      cause('decode-uri-component', 'moderate', 'GHSA-vcc3-ghjq-m6fr'),
    ]),
  };
  const context = {
    policy,
    lock,
    lockText,
    files,
    now: Date.parse('2026-10-06T00:00:00Z'),
    scope: 'unsigned-ci',
    env: {},
    maps: ['ios', 'android', 'web'].map((p) => ({
      path: `_expo/static/js/${p}/index.map`,
      bundleExists: true,
      map: { version: 3, sources: ['/node_modules/decode-uri-component/index.js', '/src/app.ts'] },
    })),
  };
  return { vulnerabilities, context };
}
function evaluate(f) {
  return evaluateAudit(parseAuditResult(auditResult(f.vulnerabilities)), f.context);
}

test('approved root permits inherited tooling highs, including cycles, while reporting every package', () => {
  const result = evaluate(fixture());
  assert.equal(result.pass, true);
  assert.equal(result.reports.length, 4);
  assert.match(result.reports.find((r) => r.package === 'tool').status, /EXCEPTED/);
  const runtime = result.reports.find((r) => r.package === 'decode-uri-component');
  assert.equal(runtime.status, 'REPORTED');
  assert.match(runtime.runtimeNotice, /Runtime/);
});
test('critical always blocks, including an approved advisory escalated to critical', () => {
  for (const severity of ['root', 'parent']) {
    const f = fixture();
    if (severity === 'root') {
      f.vulnerabilities.braces.severity = 'critical';
      f.vulnerabilities.braces.via[0].severity = 'critical';
    } else f.vulnerabilities.tool.severity = 'critical';
    // A stale exception error also fails closed when every use becomes critical.
    try {
      assert.equal(evaluate(f).pass, false);
    } catch (error) {
      assert.match(error.message, /Stale exception/);
    }
  }
});
test('a new high advisory on an already-excepted package blocks', () => {
  const f = fixture();
  f.vulnerabilities.braces.via.push(cause('braces', 'high', 'GHSA-aaaa-bbbb-cccc'));
  assert.equal(evaluate(f).pass, false);
});
test('a new high on an inherited parent blocks; inherited exceptions do not allowlist packages', () => {
  const f = fixture();
  f.vulnerabilities.tool.via.push(cause('tool', 'high', 'GHSA-aaaa-bbbb-cccc'));
  assert.equal(evaluate(f).pass, false);
});
test('high with only moderate causes fails rather than inferring a tooling exception', () => {
  const f = fixture();
  f.vulnerabilities['decode-uri-component'].severity = 'high';
  assert.equal(evaluate(f).pass, false);
});
test('expires at the start of October 13 UTC, with no grace period', () => {
  const f = fixture();
  f.context.now = Date.parse('2026-10-12T23:59:59Z');
  assert.equal(evaluate(f).pass, true);
  f.context.now = Date.parse('2026-10-13T00:00:00Z');
  assert.throws(() => evaluate(f), /expired/);
});
test('changed lockfile requires review even when immediate exception nodes are unchanged', () => {
  const f = fixture();
  f.context.lockText += '\n';
  assert.throws(() => evaluate(f), /Dependency graph changed/);
});
test('version, extra installation and parent path changes fail even after refreshing the lock hash', () => {
  for (const change of [
    (l) => {
      l.packages['node_modules/braces'].version = '3.0.4';
    },
    (l) => {
      l.packages['node_modules/other/node_modules/braces'] = { version: '3.0.3' };
    },
    (l) => {
      l.packages['node_modules/tool'].dependencies.braces = '^3.0.3';
    },
  ]) {
    const f = fixture();
    change(f.context.lock);
    f.context.lockText = JSON.stringify(f.context.lock);
    f.context.policy.lockSha256 = sha256(f.context.lockText);
    assert.throws(() => evaluate(f), /version\/path changed|parents changed/);
  }
});
test('changed audited occurrence paths cannot inherit an exception', () => {
  const f = fixture();
  f.vulnerabilities.braces.nodes = ['node_modules/tool'];
  assert.throws(() => evaluate(f), /Stale exception/);
});
test('signing/release scopes and other workflows/jobs cannot use exceptions', () => {
  const valid = {
    GITHUB_ACTIONS: 'true',
    GITHUB_JOB: 'app',
    GITHUB_WORKFLOW: 'CI',
    GITHUB_WORKFLOW_REF: 'owner/repo/.github/workflows/ci.yml@refs/heads/main',
  };
  const f = fixture();
  f.context.env = valid;
  assert.equal(evaluate(f).pass, true);
  for (const override of [
    { GITHUB_JOB: 'release' },
    { GITHUB_WORKFLOW: 'Publish' },
    { GITHUB_WORKFLOW_REF: 'owner/repo/.github/workflows/release.yml@refs/heads/main' },
  ]) {
    f.context.env = { ...valid, ...override };
    assert.throws(() => evaluate(f), /not authorized/);
  }
  f.context.env = {};
  f.context.scope = 'signing';
  assert.throws(() => evaluate(f), /unsigned-ci scope/);
});
test('workflow, scripts and app configuration changes require scope re-review', () => {
  for (const path of ['.github/workflows/ci.yml', 'package.json', 'app.json', 'app.config.js']) {
    const f = fixture();
    f.context.files[path] += '\nnew signing configuration';
    assert.throws(() => evaluate(f), /Scope changed/);
  }
});
test('missing platforms, maps, compiled bundles and malformed maps fail', () => {
  for (const change of [
    (c) => {
      c.maps = [];
    },
    (c) => {
      c.maps.pop();
    },
    (c) => {
      c.maps[0].bundleExists = false;
    },
    (c) => {
      c.maps[0].map = {};
    },
    (c) => {
      c.maps[0].map.sources = [];
    },
  ]) {
    const f = fixture();
    change(f.context);
    assert.throws(() => evaluate(f));
  }
});
test('an excepted package in any platform or indexed source map blocks', () => {
  for (const platform of [0, 1, 2]) {
    const f = fixture();
    f.context.maps[platform].map = {
      version: 3,
      sections: [
        { map: { version: 3, sourceRoot: '../node_modules/braces', sources: ['index.js'] } },
      ],
    };
    assert.throws(() => evaluate(f), /ships in bundle/);
  }
});
test('fixed/removed advisories require deleting stale exceptions', () => {
  const f = fixture();
  for (const n of ['braces', 'micromatch', 'tool']) delete f.vulnerabilities[n];
  assert.throws(() => evaluate(f), /Stale exception/);
});
test('network, subprocess, parsing and schema errors fail closed', () => {
  const good = auditResult(fixture().vulnerabilities);
  for (const raw of [
    { ...good, status: 2 },
    { ...good, error: new Error('network') },
    { ...good, signal: 'SIGTERM' },
    { ...good, stdout: 'not json' },
    { ...good, stdout: '{}' },
    { ...good, status: 0 },
    { ...good, stdout: JSON.stringify({ ...JSON.parse(good.stdout), error: { code: 'E503' } }) },
  ])
    assert.throws(() => parseAuditResult(raw));
});
test('unknown severity, advisory format, dangling causes and inconsistent totals fail', () => {
  for (const change of [
    (a) => {
      a.vulnerabilities.braces.severity = 'unknown';
    },
    (a) => {
      a.vulnerabilities.braces.via[0].url = 'https://unreviewed.example/advisory';
    },
    (a) => {
      a.vulnerabilities.braces.via = ['absent'];
    },
    (a) => {
      a.metadata.vulnerabilities.high = 0;
    },
  ]) {
    const raw = auditResult(fixture().vulnerabilities);
    const a = JSON.parse(raw.stdout);
    change(a);
    raw.stdout = JSON.stringify(a);
    assert.throws(() => parseAuditResult(raw));
  }
});
test('unresolved cycles fail instead of treating missing evidence as exemption', () => {
  const f = fixture();
  f.vulnerabilities.braces.via = ['tool'];
  assert.throws(() => evaluate(f), /No resolved advisories/);
});

test('CLI reports full audit and moderates, rejects failures, and never invokes a reduced audit', () => {
  const root = mkdtempSync(join(tmpdir(), 'langtify-audit-test-'));
  const f = fixture();
  const put = (path, value, options) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), value, options);
  };
  try {
    for (const [path, text] of Object.entries(f.context.files)) put(path, text);
    put('scripts/audit-exceptions.json', JSON.stringify(f.context.policy));
    put('package-lock.json', f.context.lockText);
    // Use future expiry only in this subprocess fixture, so the regression remains
    // useful after the real policy expires. Production has no clock override.
    f.context.policy.exceptions[0].expires = '2999-01-01';
    put('scripts/audit-exceptions.json', JSON.stringify(f.context.policy));
    for (const map of f.context.maps) {
      put(`dist/${map.path}`, JSON.stringify(map.map));
      put(`dist/${map.path.slice(0, -4)}`, 'fixture bundle');
    }
    put(
      'bin/npm',
      `#!${process.execPath}\nconst fs = require('node:fs');\nfs.writeFileSync('called-args.json', JSON.stringify(process.argv.slice(2)));\nconst r = JSON.parse(fs.readFileSync('audit-fixture.json', 'utf8'));\nprocess.stdout.write(r.stdout);\nprocess.exitCode = r.status;\n`,
      { mode: 0o755 },
    );
    const run = (raw) => {
      put('audit-fixture.json', JSON.stringify(raw));
      return spawnSync(
        process.execPath,
        [
          fileURLToPath(new URL('./audit-policy.mjs', import.meta.url)),
          '--scope',
          'unsigned-ci',
          '--bundles',
          'dist',
        ],
        {
          cwd: root,
          env: {
            ...process.env,
            GITHUB_ACTIONS: 'false',
            PATH: `${join(root, 'bin')}:${process.env.PATH}`,
          },
          encoding: 'utf8',
          timeout: 10_000,
        },
      );
    };
    const good = run(auditResult(f.vulnerabilities));
    assert.equal(good.status, 0, good.stderr);
    assert.match(good.stdout, /"auditReportVersion": 2/);
    assert.match(good.stdout, /Runtime URL parsing/);
    assert.deepEqual(JSON.parse(readFileSync(join(root, 'called-args.json'), 'utf8')), [
      'audit',
      '--json',
      '--audit-level=high',
      '--include=dev',
      '--include=optional',
      '--include=peer',
    ]);
    f.vulnerabilities.tool.via.push(cause('tool', 'high', 'GHSA-aaaa-bbbb-cccc'));
    const blocked = run(auditResult(f.vulnerabilities));
    assert.equal(blocked.status, 1);
    assert.match(blocked.stdout, /GHSA-aaaa-bbbb-cccc/);
    assert.match(blocked.stdout, /decode-uri-component/);
    assert.equal(run({ status: 1, stdout: JSON.stringify({ error: { code: 'E503' } }) }).status, 1);
    assert.equal(run({ status: 1, stdout: 'network response is not JSON' }).status, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
