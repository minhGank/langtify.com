import { execFileSync, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { backendConfiguration, DEV_URL, PRODUCTION_URL } from '../src/lib/backend-environment';
import configure from '../app.config';

const key = 'sb_publishable_release_test_fixture';
it('development accepts Dev and defaults to Dev when only a key is supplied', () => {
  expect(backendConfiguration('development', DEV_URL, key).config?.url).toBe(DEV_URL);
  expect(backendConfiguration(undefined, undefined, key).config?.url).toBe(DEV_URL);
});
it('development supports explicit local overrides for tests and CI', () => {
  expect(backendConfiguration('development', 'http://127.0.0.1:54321', key).config).not.toBeNull();
});
it('production accepts only the exact Production URL and publishable configuration', () => {
  expect(backendConfiguration('production', PRODUCTION_URL, key, true).config?.url).toBe(
    PRODUCTION_URL,
  );
});
it.each([
  DEV_URL,
  'http://localhost:54321',
  'http://127.0.0.1:54321',
  undefined,
  '',
  `${PRODUCTION_URL}/wrong`,
  `${PRODUCTION_URL}.attacker.test`,
  'https://other.supabase.co',
])('production rejects wrong or missing URL %s', (url) => {
  expect(() => backendConfiguration('production', url, key)).toThrow('Production requires');
});
it.each([undefined, '', 'sb_secret_fixture', 'service_role', 'header.payload.signature'])(
  'production rejects missing/non-publishable key %s',
  (value) => {
    expect(() => backendConfiguration('production', PRODUCTION_URL, value)).toThrow(
      'Production requires',
    );
  },
);
it('native release cannot fall back to development even with a valid Production URL', () => {
  expect(() => backendConfiguration(undefined, PRODUCTION_URL, key, true)).toThrow(
    'Release requires',
  );
  expect(() => backendConfiguration('development', DEV_URL, key, true)).toThrow('Release requires');
  expect(() => backendConfiguration('typo', DEV_URL, key)).toThrow('Invalid backend environment');
});
it('EAS production configuration fails before bundling even when mode is omitted', () => {
  const original = { ...process.env };
  try {
    process.env.EAS_BUILD_PROFILE = 'production';
    delete process.env.EXPO_PUBLIC_BACKEND_ENV;
    expect(() =>
      configure({
        config: { name: 'Langtify', slug: 'langtify' },
        projectRoot: process.cwd(),
        staticConfigPath: null,
        packageJsonPath: null,
      }),
    ).toThrow('Release requires');
  } finally {
    process.env = original;
  }
});
it('native guard fails safely for Dev, missing, skipped bundling and Personal Team inputs', () => {
  const env = {
    ...process.env,
    EXPO_NO_DOTENV: '1',
    EXPO_PUBLIC_BACKEND_ENV: 'production',
    EXPO_PUBLIC_SUPABASE_URL: PRODUCTION_URL,
    EXPO_PUBLIC_SUPABASE_ANON_KEY: key,
    SKIP_BUNDLING: '',
    LANGTIFY_DISABLE_IOS_PUSH: '',
  };
  const invoke = (override: Partial<NodeJS.ProcessEnv>) =>
    spawnSync(process.execPath, ['scripts/check-release-env.cjs'], {
      encoding: 'utf8',
      env: { ...env, ...override },
    });
  expect(invoke({}).status).toBe(0);
  for (const override of [
    { EXPO_PUBLIC_SUPABASE_URL: DEV_URL },
    { EXPO_NO_DOTENV: '' },
    { EXPO_PUBLIC_SUPABASE_ANON_KEY: '' },
    { EXPO_PUBLIC_BACKEND_ENV: 'development' },
    { SKIP_BUNDLING: '1' },
    { LANGTIFY_DISABLE_IOS_PUSH: '1' },
  ]) {
    const result = invoke(override);
    expect(result.status).toBe(1);
    expect(result.stderr).not.toContain(key);
  }
});
it('iOS guard is installed at the native bundle boundary and is idempotent', () => {
  const output = execFileSync(
    process.execPath,
    [
      '-e',
      `
    const {guardIosProject}=require('./plugins/with-release-environment');
    const phase={name:'"Bundle React Native code and images"',shellScript:JSON.stringify('source .xcode.env.local\\n\u0060"$NODE_BINARY" --print "bundle"\u0060')};
    const project={hash:{project:{objects:{PBXShellScriptBuildPhase:{phase}}}}};
    guardIosProject(project);const once=phase.shellScript;guardIosProject(project);
    console.log(JSON.stringify({script:JSON.parse(phase.shellScript),idempotent:once===phase.shellScript}));
  `,
    ],
    { cwd: resolve('.'), encoding: 'utf8' },
  );
  const result: { script: string; idempotent: boolean } = JSON.parse(output);
  expect(result.idempotent).toBe(true);
  expect(result.script).toContain('check-release-env.cjs" || exit 1');
  expect(result.script.indexOf('source .xcode.env.local')).toBeLessThan(
    result.script.indexOf('check-release-env'),
  );
});
it('EAS store profile selects Production and disables dotenv fallback; development uses Debug', () => {
  const profiles = JSON.parse(readFileSync('eas.json', 'utf8')).build;
  expect(profiles.production.distribution).toBe('store');
  expect(profiles.production.env.EXPO_PUBLIC_BACKEND_ENV).toBe('production');
  expect(profiles.production.env.EXPO_PUBLIC_SUPABASE_URL).toBe(PRODUCTION_URL);
  expect(profiles.production.env.EXPO_NO_DOTENV).toBe('1');
  expect(profiles.development.ios.buildConfiguration).toBe('Debug');
  expect(profiles.development.android.gradleCommand).toBe(':app:assembleDebug');
});
it('the Android config mod installs one release-task guard and rejects unsupported Gradle syntax', () => {
  const output = execFileSync(
    process.execPath,
    [
      '-e',
      `
    (async()=>{
      const plugin=require('./plugins/with-release-environment');
      const config=plugin({name:'Fixture',slug:'fixture'});
      const run=config.mods.android.appBuildGradle;
      const first=await run({modResults:{language:'groovy',contents:'android {}'},modRequest:{}});
      const second=await run({...first,modRequest:{}});
      let rejected=false;
      try{await run({modResults:{language:'kotlin',contents:''},modRequest:{}})}catch{rejected=true}
      console.log(JSON.stringify({contents:first.modResults.contents,idempotent:first.modResults.contents===second.modResults.contents,rejected}));
    })().catch(()=>process.exit(1));
  `,
    ],
    { encoding: 'utf8' },
  );
  const result: { contents: string; idempotent: boolean; rejected: boolean } = JSON.parse(output);
  expect(result.idempotent).toBe(true);
  expect(result.rejected).toBe(true);
  expect(result.contents).toContain('pre.*ReleaseBuild');
  expect(result.contents).toContain('scripts/check-release-env.cjs');
  expect(result.contents).toContain('assertNormalExitValue()');
});
