/**
 * Wrapper for `npm run test:rules`.
 *
 * The Firestore emulator is a Java process, and firebase-tools finds Java
 * by spawning `java` from PATH. That fails in a very ordinary situation:
 * an editor or terminal that was already running when the JDK was
 * installed keeps the environment it was given at launch, so a freshly
 * opened terminal *tab* still has no Java even though the machine does.
 * The usual advice ("restart your editor") works but is easy to get
 * wrong, and hitting it during a demo is worse than the code needed to
 * avoid it.
 *
 * So this locates a JDK itself and puts it on PATH for the child process
 * only. Nothing is written to the user's environment.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join, delimiter } from 'node:path';

const isWindows = process.platform === 'win32';

function javaOnPath(env) {
  const probe = spawnSync('java', ['-version'], { env, shell: isWindows, stdio: 'ignore' });
  return !probe.error && probe.status === 0;
}

// Directories that commonly hold a JDK, in the order we'd rather find one.
// JAVA_HOME first: if it's set, that's the JDK the machine considers
// canonical, whether or not the current process inherited a PATH entry.
function findJavaBin() {
  const fromHome = process.env.JAVA_HOME;
  if (fromHome && existsSync(join(fromHome, 'bin'))) return join(fromHome, 'bin');

  const roots = isWindows
    ? [
        'C:\\Program Files\\Microsoft',
        'C:\\Program Files\\Java',
        'C:\\Program Files\\Eclipse Adoptium',
        'C:\\Program Files\\Amazon Corretto',
      ]
    : ['/usr/lib/jvm', '/Library/Java/JavaVirtualMachines'];

  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root)) {
      if (!/jdk|jre/i.test(entry)) continue;
      // macOS nests the runtime deeper than Linux and Windows do.
      for (const bin of [join(root, entry, 'bin'), join(root, entry, 'Contents', 'Home', 'bin')]) {
        if (existsSync(join(bin, isWindows ? 'java.exe' : 'java'))) return bin;
      }
    }
  }
  return null;
}

const env = { ...process.env };

// Windows names this variable "Path", not "PATH", and env vars are
// case-insensitive there — but a plain object spread from process.env is
// not. Writing env.PATH directly would add a SECOND key beside the
// existing "Path" and read as undefined, handing the child a PATH holding
// nothing but the Java directory. That breaks the child far worse than
// the missing Java did: even `node` stops resolving. So find whatever
// casing this platform actually used and update that key.
const pathKey = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';

if (!javaOnPath(env)) {
  const javaBin = findJavaBin();
  if (!javaBin) {
    console.error(
      '\nCould not find Java, which the Firestore emulator needs.\n\n' +
        (isWindows
          ? 'Install it with:  winget install Microsoft.OpenJDK.21\n'
          : 'Install a JDK 17 or newer, then re-run.\n')
    );
    process.exit(1);
  }
  env[pathKey] = javaBin + delimiter + (env[pathKey] ?? '');
  if (!env.JAVA_HOME) env.JAVA_HOME = join(javaBin, '..');
  console.log(`Using Java from ${javaBin}\n`);
}

// Invoked through Node against the CLI's entrypoint rather than the
// `firebase` shim, so this doesn't depend on node_modules/.bin being on
// PATH either — the same class of problem it exists to work around.
const cli = join('node_modules', 'firebase-tools', 'lib', 'bin', 'firebase.js');
const result = spawnSync(
  process.execPath,
  [cli, 'emulators:exec', '--only', 'firestore', 'node scripts/test-rules.mjs'],
  { env, stdio: 'inherit' }
);

process.exit(result.status ?? 1);
