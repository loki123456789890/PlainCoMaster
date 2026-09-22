/**
 * Starts Expo with the app pointed at the local Firebase emulators.
 *
 *     npm run start:emulator -- --web
 *
 * A one-line `EXPO_PUBLIC_USE_FIREBASE_EMULATOR=1 expo start` would do
 * this on a POSIX shell and fails on Windows PowerShell, which is where
 * this project is developed. A three-line script beats adding cross-env
 * as a dependency for one variable.
 *
 * Start the emulators themselves first, in another terminal:
 *
 *     npm run emulators
 */
import { spawn } from 'node:child_process';

// shell: true is required on Windows and harmless elsewhere. Node 20+
// refuses to spawn a .cmd shim directly (EINVAL) — npx on Windows IS such
// a shim, so without this the script dies before Expo is reached.
const child = spawn(
  'npx',
  ['expo', 'start', ...process.argv.slice(2)],
  {
    shell: true,
    stdio: 'inherit',
    env: {
      ...process.env,
      EXPO_PUBLIC_USE_FIREBASE_EMULATOR: '1',
      // Metro caches the inlined value of an EXPO_PUBLIC_ variable, so a
      // run that previously bundled production config would otherwise
      // keep it. Clearing is cheaper than debugging why the warning
      // banner never appeared.
      EXPO_NO_DOTENV: '1',
    },
  }
);

child.on('exit', (code) => process.exit(code ?? 0));
