import { spawn } from 'node:child_process';
const mode = process.argv[2];
if (!['dev', 'start'].includes(mode))
  throw new Error('Choose dev or start demo launch');
const environment = { ...process.env, TRUEIRIS_DEMO_MODE: 'true' };
// Editor hosts can set this for their own runtime; the desktop needs Electron.
delete environment.ELECTRON_RUN_AS_NODE;
const grouped = process.platform !== 'win32';
const child = spawn(
  'pnpm',
  [
    'exec',
    'concurrently',
    '--kill-others',
    '-n',
    'api,desktop',
    `pnpm ${mode}:api`,
    `pnpm ${mode}:desktop`,
  ],
  {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    detached: grouped,
    env: environment,
  },
);
let stopping = false;
let shutdownTimer;
function stopChildren(signal) {
  try {
    if (grouped && child.pid) process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch (error) {
    if (error.code !== 'ESRCH') process.exitCode = 1;
  }
}
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => {
    if (stopping) return;
    stopping = true;
    stopChildren(signal);
    // pnpm/concurrently can retain signal handlers after their children exit.
    shutdownTimer = setTimeout(() => stopChildren('SIGKILL'), 5000);
    shutdownTimer.unref();
  });
child.once('error', () => {
  console.error('Could not launch demo processes. Check pnpm installation.');
  process.exitCode = 1;
});
child.once('exit', (code) => {
  clearTimeout(shutdownTimer);
  process.exitCode = stopping ? 0 : (code ?? 1);
});
