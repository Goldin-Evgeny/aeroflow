import { existsSync, readFileSync, rmSync } from 'node:fs';
import { basename, isAbsolute, relative, resolve } from 'node:path';

const [operation, runId, ...flags] = process.argv.slice(2);
const root = resolve(process.env.AEROFLOW_RUN_ROOT ?? resolve(process.cwd(), '.aeroflow', 'runs'));

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

function layout(id) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(id ?? '')) {
    throw new Error(`invalid run identity ${JSON.stringify(id)}`);
  }
  const runDirectory = resolve(root, id);
  const rel = relative(root, runDirectory);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel) || basename(runDirectory) !== id) {
    throw new Error('resolved run directory is outside the configured run root');
  }
  return {
    runDirectory,
    lifecycle: resolve(runDirectory, 'lifecycle.json'),
    owner: resolve(runDirectory, 'owner.json'),
    artifact: resolve(runDirectory, 'validation-artifact.json'),
  };
}

try {
  if (operation !== 'inspect' && operation !== 'cleanup') {
    throw new Error('usage: node scripts/validation-runs.mjs <inspect|cleanup> <run-id> [--force]');
  }
  const paths = layout(runId);
  if (!existsSync(paths.runDirectory)) throw new Error(`run ${runId} does not exist under ${root}`);
  if (operation === 'inspect') {
    const read = (path) => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null);
    console.log(
      JSON.stringify(
        {
          root,
          runDirectory: paths.runDirectory,
          lifecycle: read(paths.lifecycle),
          owner: read(paths.owner),
          artifact: read(paths.artifact),
        },
        null,
        2,
      ),
    );
  } else {
    const force = flags.includes('--force');
    if (!force) {
      if (!existsSync(paths.artifact))
        throw new Error('cleanup requires a durable terminal artifact');
      const artifact = JSON.parse(readFileSync(paths.artifact, 'utf8'));
      if (artifact.complete !== true || artifact.termination?.reason !== 'completed') {
        throw new Error(
          'cleanup requires complete=true and termination.reason=completed; use --force only for an explicit operator discard',
        );
      }
    }
    rmSync(paths.runDirectory, { recursive: true });
    console.log(`removed ${paths.runDirectory}${force ? ' (operator-forced)' : ''}`);
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
