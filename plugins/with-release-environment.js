const { withXcodeProject, withAppBuildGradle } = require('expo/config-plugins');

const marker = '# Langtify release backend guard';
function guardIosProject(project) {
  const phases = project.hash.project.objects.PBXShellScriptBuildPhase;
  const phase = Object.values(phases).find(
    (p) =>
      p.name === '"Bundle React Native code and images"' ||
      p.name === 'Bundle React Native code and images',
  );
  if (!phase) throw new Error('Cannot install release backend guard: missing iOS bundle phase.');
  const script = JSON.parse(phase.shellScript);
  if (script.includes(marker)) return project;
  const invoke = '`"$NODE_BINARY" --print';
  if (!script.includes(invoke)) throw new Error('Cannot locate Expo iOS bundle invocation.');
  phase.shellScript = JSON.stringify(
    script.replace(
      invoke,
      `${marker}
if [ "$CONFIGURATION" != "Debug" ]; then
  "$NODE_BINARY" "$PROJECT_ROOT/scripts/check-release-env.cjs" || exit 1
fi

${invoke}`,
    ),
  );
  return project;
}
const gradleGuard = `
// Langtify release backend guard
tasks.configureEach { task ->
    if (task.name ==~ /pre.*ReleaseBuild/) {
        task.doFirst {
            providers.exec {
                workingDir rootProject.projectDir.parentFile
                commandLine "node", "scripts/check-release-env.cjs"
            }.result.get().assertNormalExitValue()
        }
    }
}
`;
/** @type {import('expo/config-plugins').ConfigPlugin} */
module.exports = (config) => {
  config = withXcodeProject(config, (mod) => {
    mod.modResults = guardIosProject(mod.modResults);
    return mod;
  });
  return withAppBuildGradle(config, (mod) => {
    if (mod.modResults.language !== 'groovy')
      throw new Error('Review release guard for non-Groovy Gradle.');
    if (!mod.modResults.contents.includes('// Langtify release backend guard'))
      mod.modResults.contents += gradleGuard;
    return mod;
  });
};
module.exports.guardIosProject = guardIosProject;
