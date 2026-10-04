import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import {
  _electron as electron,
  expect,
  type Page,
  type Locator,
} from '@playwright/test';
import {
  loadWorkspaceEnvironment,
  parseEnvironment,
} from '../packages/shared/src/config';
import { TigerStore } from '../packages/db/src/index';
import { buildApp } from '../apps/api/src/app';
import { GeminiReasoningProvider } from '../apps/api/src/agents/provider';
import {
  MockVoiceProvider,
  type TranscriptionStream,
  type Transcript,
} from '../apps/api/src/voice/provider';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const output = join(root, 'demo-deliverables');
const screenshots = join(output, 'screenshots');
const work = join(output, '.work');
const require = createRequire(join(root, 'apps/desktop/package.json'));
const width = 1440,
  height = 810;

// Synthetic input keeps personal microphone audio out of this silent recording.
class SilentDemoVoice extends MockVoiceProvider {
  override async open(
    listener: (event: Transcript) => void,
    signal: AbortSignal,
  ): Promise<TranscriptionStream> {
    const stream = await super.open(listener, signal);
    const ready = performance.now() + 2800;
    return {
      ...stream,
      send: (pcm) => {
        if (performance.now() >= ready) stream.send(pcm);
      },
    };
  }
}

type Shot = {
  name: string;
  duration: number;
  title: string;
  text: string;
  parts: { start: number; end: number }[];
};
const shots: Shot[] = [];
loadWorkspaceEnvironment();
const env = parseEnvironment(process.env);
if (!env.DATABASE_URL || !env.GEMINI_API_KEY)
  throw new Error(
    'Database and Gemini configuration are required in the ignored .env.',
  );
await mkdir(screenshots, { recursive: true });
await mkdir(work, { recursive: true });
const store = new TigerStore(env.DATABASE_URL, env.DATABASE_CA_FILE);
const owner = randomUUID(),
  token = randomUUID() + randomUUID();
const api = buildApp('silent', {
  store,
  userId: owner,
  token,
  demoMode: true,
  reasoning: new GeminiReasoningProvider(env.GEMINI_API_KEY, env.GEMINI_MODEL),
  voice: new SilentDemoVoice(),
});
let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
let page: Page;
let origin = 0;
const time = () => (performance.now() - origin) / 1000;
const hold = (ms: number) => page.waitForTimeout(ms);

async function cleanText() {
  await page.evaluate(() => {
    const clean = () => {
      const walk = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
      );
      let node;
      while ((node = walk.nextNode())) {
        if (['SCRIPT', 'STYLE'].includes(node.parentElement?.tagName ?? ''))
          continue;
        if (node.nodeValue && /\bmock\b/i.test(node.nodeValue))
          node.nodeValue = node.nodeValue.replace(/\bmock\b/gi, 'simulated');
      }
    };
    clean();
    new MutationObserver(clean).observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  });
  await page.addStyleTag({
    content: `
    #demo-cursor { position:fixed; z-index:2147483647; width:18px; height:18px; border:2px solid #3f779f; background:#ffffffaa; border-radius:50%; pointer-events:none; transform:translate(-50%,-50%); box-shadow:0 2px 9px #34587340; }
    .demo-ripple { position:fixed; z-index:2147483646; width:24px; height:24px; border:2px solid #7caed0; border-radius:50%; pointer-events:none; animation:demo-ripple .6s ease-out forwards; }
    @keyframes demo-ripple { from {transform:translate(-50%,-50%) scale(.7); opacity:.9} to {transform:translate(-50%,-50%) scale(2.5);opacity:0} }
  `,
  });
  await page.evaluate(() => {
    const cursor = document.createElement('div');
    cursor.id = 'demo-cursor';
    cursor.setAttribute('aria-hidden', 'true');
    document.body.append(cursor);
    document.addEventListener('mousemove', (e) => {
      cursor.style.left = `${e.clientX}px`;
      cursor.style.top = `${e.clientY}px`;
    });
    document.addEventListener('click', (e) => {
      const ring = document.createElement('div');
      ring.className = 'demo-ripple';
      ring.style.left = `${e.clientX}px`;
      ring.style.top = `${e.clientY}px`;
      document.body.append(ring);
      setTimeout(() => ring.remove(), 650);
    });
  });
}

async function click(locator: Locator) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (box)
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {
      steps: 18,
    });
  await hold(250);
  await locator.click();
  await hold(450);
}
async function top() {
  await page
    .locator('main')
    .evaluate((el) => el.scrollTo({ top: 0, behavior: 'smooth' }));
  await hold(800);
}
async function focus(locator: Locator, offset = 30) {
  await locator.evaluate((el, margin) => {
    const main = document.querySelector('main')!;
    main.scrollTo({
      top:
        main.scrollTop +
        el.getBoundingClientRect().top -
        main.getBoundingClientRect().top -
        margin,
      behavior: 'smooth',
    });
  }, offset);
  await hold(1200);
}
async function route(label: string) {
  await click(page.getByRole('link', { name: label, exact: true }));
  await top();
}
async function screenshot(name: string) {
  await hold(800);
  expect(await page.locator('body').innerText()).not.toMatch(/\bmock\b/i);
  await page.locator('#demo-cursor').evaluate((el) => {
    (el as HTMLElement).style.visibility = 'hidden';
  });
  await page.screenshot({
    path: join(screenshots, `${name}.png`),
    scale: 'css',
  });
  await page.locator('#demo-cursor').evaluate((el) => {
    (el as HTMLElement).style.visibility = 'visible';
  });
  console.log(`Captured ${name}.png`);
}
async function shot(
  name: string,
  duration: number,
  title: string,
  text: string,
  action: (parts: Shot['parts']) => Promise<void>,
) {
  const parts: Shot['parts'] = [];
  await action(parts);
  shots.push({ name, duration, title, text, parts });
  console.log(`Recorded chapter: ${title}`);
}

try {
  const url = await api.listen({ host: '127.0.0.1', port: 0 });
  let preparedState = 'preparing';
  for (let attempt = 0; attempt < 3 && preparedState !== 'ready'; attempt++) {
    const prepared = await api.inject({
      method: 'POST',
      url: '/demo/prepare',
      headers: { authorization: `Bearer ${token}`, 'x-trueiris-mode': 'demo' },
      payload: {},
    });
    preparedState = prepared.json().state;
    console.log(`Sample history preparation: ${preparedState}`);
    if (preparedState !== 'ready')
      await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  if (preparedState !== 'ready')
    throw new Error('The isolated sample dataset could not be prepared.');
  const dataset = (await store.demo.get(owner))!;
  const launchEnv: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    ),
    TRUEIRIS_API_URL: url,
    TRUEIRIS_INGEST_TOKEN: token,
    TRUEIRIS_DEMO_MODE: 'true',
    PRESAGE_API_KEY: '',
    DATABASE_URL: '',
    GEMINI_API_KEY: '',
    ELEVENLABS_API_KEY: '',
    ELEVENLABS_VOICE_ID: '',
    TRUEIRIS_CONTEXT_PROVIDER: 'mock',
    TRUEIRIS_SENSOR_PROVIDER: 'presage',
    ELECTRON_RENDERER_URL: '',
    LOG_LEVEL: 'silent',
  };
  delete launchEnv.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({
    executablePath: require('electron') as string,
    args: [
      join(root, 'apps/desktop'),
      '--force-device-scale-factor=1',
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
    ],
    env: launchEnv,
    recordVideo: { dir: work, size: { width, height } },
  });
  origin = performance.now();
  page = await app.firstWindow();
  await app.evaluate(
    ({ BrowserWindow }, size) => {
      const window = BrowserWindow.getAllWindows()[0]!;
      window.setContentSize(size.width, size.height);
      window.webContents.setAudioMuted(true);
    },
    { width, height },
  );
  await page.setViewportSize({ width, height });
  page.setDefaultTimeout(30_000);
  // tsx preserves names using this helper inside serialized browser callbacks.
  await page.addInitScript('globalThis.__name = (target) => target');
  await page.evaluate('globalThis.__name = (target) => target');
  await cleanText();
  await expect(
    page.getByRole('heading', { name: 'Hi, I’m Iris' }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Explore your sample week ↗' }),
  ).toBeVisible();
  await hold(1600);
  const video = page.video()!;

  await shot(
    'home',
    12,
    'Meet Iris. A little company for your day.',
    'Click the blue companion to talk. Six surrounding blobs open your views and disappear when Iris is active.',
    async (parts) => {
      const start = time();
      await page.mouse.move(720, 380, { steps: 24 });
      await hold(1000);
      await page.mouse.move(760, 350, { steps: 24 });
      await hold(1000);
      await page.mouse.move(1320, 750, { steps: 24 });
      await screenshot('01-Iris-Home');
      await hold(4500);
      parts.push({ start, end: time() });
    },
  );
  await shot(
    'conversation',
    16,
    'Say hello. Iris makes room for you.',
    'The navigation fades away during a conversation. This silent walkthrough uses simulated microphone input.',
    async (parts) => {
      const start = time();
      await click(
        page.getByRole('button', { name: 'Talk to Iris', exact: true }),
      );
      await expect(
        page.getByRole('navigation', { name: 'Main navigation' }),
      ).toBeHidden();
      await hold(3500);
      parts.push({ start, end: time() });
      const answer = page.getByRole('region', { name: 'Iris answer' });
      await expect(answer).toContainText('Supporting evidence', {
        timeout: 90_000,
      });
      await expect(answer).toContainText('GEMINI');
      const responseStart = time();
      await focus(answer);
      await hold(4000);
      parts.push({ start: responseStart, end: time() });
      await top();
      await click(
        page.getByRole('button', {
          name: 'Done for now · show my views',
          exact: true,
        }),
      );
    },
  );
  await shot(
    'recording',
    14,
    'Record activity only when you choose.',
    'Choose an activity and start a session from Iris. Saving to history is optional, and Stop stays within reach.',
    async (parts) => {
      const start = time();
      await click(
        page.getByRole('button', { name: 'Record my activity', exact: true }),
      );
      await page.getByLabel('Activity to record').selectOption('Coding');
      await click(page.getByLabel('Save this activity to history'));
      await click(
        page.getByRole('button', {
          name: 'Start activity recording',
          exact: true,
        }),
      );
      await expect(page.getByTestId('global-context-status')).toContainText(
        'on',
      );
      await focus(page.locator('.iris-playground'), 0);
      await screenshot('02-Activity-Recording');
      await hold(3000);
      await click(
        page.getByRole('button', {
          name: 'Stop activity recording',
          exact: true,
        }),
      );
      parts.push({ start, end: time() });
    },
  );
  await shot(
    'live',
    13,
    'Your current signals, with confidence.',
    'Live brings pulse, respiration, HRV and activity together. The current signal here is simulated; no camera is used.',
    async (parts) => {
      const start = time();
      await route('Live');
      await page.getByLabel('CURRENT ACTIVITY').selectOption('Coding');
      await click(
        page.getByRole('button', { name: 'Start live signal', exact: true }),
      );
      await expect(page.getByTestId('pulse-value')).not.toContainText('—');
      await focus(page.getByRole('region', { name: 'Current physiology' }), 20);
      await screenshot('03-Live-Signals');
      await hold(5000);
      await click(
        page.getByRole('button', { name: 'Stop sensing', exact: true }),
      );
      parts.push({ start, end: time() });
    },
  );
  await shot(
    'week',
    12,
    'One sample week. Several perspectives.',
    'Explore generated historical sessions across multiple days. Every view keeps sample history separate from personal recordings.',
    async (parts) => {
      const start = time();
      await route('TrueIris home');
      await click(
        page.getByRole('link', { name: 'Explore your sample week ↗' }),
      );
      await top();
      await screenshot('04-Sample-Week');
      await focus(page.getByRole('region', { name: 'Sample week' }));
      await hold(3500);
      parts.push({ start, end: time() });
    },
  );
  await shot(
    'timeline',
    18,
    'See the shape of a day. Inspect the details.',
    'Explore activity and physiological trends, select a period, then compare it with earlier coding sessions. Gaps stay visible.',
    async (parts) => {
      const start = time();
      await route('Timeline');
      await page
        .getByLabel('Sample day')
        .fill(dataset.episodes.at(-1)!.range.start.slice(0, 10));
      await expect(
        page.getByRole('region', { name: 'Saved history' }),
      ).toBeVisible();
      await hold(1500);
      await screenshot('05-Timeline');
      await hold(2200);
      await click(
        page.getByRole('button', { name: 'Inspect period', exact: true }),
      );
      const baselines = page.getByRole('region', {
        name: 'Personal baselines',
      });
      await focus(baselines);
      await click(
        page.getByRole('button', { name: 'Compare baseline', exact: true }),
      );
      await expect(baselines).toContainText('baseline');
      await hold(3500);
      parts.push({ start, end: time() });
    },
  );
  await shot(
    'patterns',
    15,
    'Notice what repeats, with evidence.',
    'Pattern cards connect recurring activities to observations. Open their supporting sessions; associations are not causal conclusions.',
    async (parts) => {
      const start = time();
      await route('Patterns');
      await expect(
        page.getByRole('heading', { name: 'Notice what repeats.' }),
      ).toBeVisible();
      await screenshot('06-Patterns');
      await hold(2000);
      await click(
        page
          .getByText('Show the recorded sample evidence', { exact: true })
          .first(),
      );
      await hold(4000);
      parts.push({ start, end: time() });
    },
  );
  await shot(
    'ask',
    16,
    'Ask a question. See what supports the answer.',
    'Gemini retrieves selected history and returns cited facts. A highlighted timeline and evidence cards keep explanations grounded.',
    async (parts) => {
      const start = time();
      await route('Ask Iris');
      await click(
        page.getByRole('button', {
          name: 'Iris, explain the last 30 minutes.',
          exact: true,
        }),
      );
      await hold(1500);
      parts.push({ start, end: time() });
      const answer = page.getByRole('region', { name: 'Iris answer' });
      await expect(answer).toContainText('Supporting evidence', {
        timeout: 90_000,
      });
      await expect(answer).toContainText('GEMINI');
      const responseStart = time();
      await focus(answer);
      await expect(
        page.getByRole('region', { name: 'Explanation timeline' }),
      ).toBeVisible();
      await screenshot('07-Ask-Iris-Evidence');
      await hold(2200);
      await focus(answer.getByRole('heading', { name: 'Supporting evidence' }));
      await hold(3000);
      parts.push({ start: responseStart, end: time() });
    },
  );
  await shot(
    'experiments',
    18,
    'Turn a small question into an experiment.',
    'Compare Music and No Music across seven sample sessions. Ratings, baselines and practical thresholds make uncertainty explicit.',
    async (parts) => {
      const start = time();
      await route('Experiments');
      await click(
        page.getByRole('button', {
          name: 'Demo · Music vs No Music',
          exact: true,
        }),
      );
      const detail = page.getByRole('region', { name: 'Experiment detail' });
      await expect(detail).toContainText('7 / 7 recorded sessions');
      await focus(detail);
      await screenshot('08-Experiments');
      await hold(3500);
      await focus(detail.locator('.experiment-results'));
      await hold(3500);
      parts.push({ start, end: time() });
    },
  );
  await shot(
    'privacy',
    12,
    'Your data. Your control.',
    'Capture starts only when you choose. Manage camera, context, window titles and saving; export or delete your stored history.',
    async (parts) => {
      const start = time();
      await route('Settings');
      await screenshot('09-Settings-Privacy');
      await hold(2500);
      await focus(
        page.getByRole('heading', { name: 'Saved history', exact: true }),
      );
      await hold(4000);
      parts.push({ start, end: time() });
    },
  );
  await shot(
    'outro',
    4,
    'A little more in tune with you.',
    'TrueIris · Reflect on your day, one conversation at a time. Generated sample history and simulated current signals.',
    async (parts) => {
      const start = time();
      await route('TrueIris home');
      await hold(4000);
      parts.push({ start, end: time() });
    },
  );
  expect(shots.reduce((sum, shot) => sum + shot.duration, 0)).toBe(150);
  await app.close();
  app = undefined;
  await writeFile(
    join(work, 'story.json'),
    JSON.stringify(
      { video: await video.path(), width, height, shots },
      null,
      2,
    ),
  );
  console.log('Capture complete. Rendering the silent 150-second video.');
} catch (error) {
  if (error instanceof Error)
    console.error(
      error.stack
        ?.split('\n')
        .filter((line) => line.trim().startsWith('at '))
        .join('\n'),
    );
  if (page!)
    await page
      .screenshot({ path: join(work, 'last-screen.png'), scale: 'css' })
      .catch(() => {});
  console.error(
    'Demo capture failed. Credentials and provider responses have not been logged. Inspect the saved app screenshots for the last successful stage.',
  );
  process.exitCode = 1;
} finally {
  await app?.close();
  await store.deleteData(owner);
  await store.pool.query('DELETE FROM users WHERE id=$1', [owner]);
  await api.close();
}
if (!process.exitCode) {
  const child = spawn(
    process.env.TRUEIRIS_MEDIA_PYTHON ?? 'python3',
    [join(root, 'scripts/render-demo.py'), output],
    { stdio: 'inherit' },
  );
  await new Promise<void>((resolve) => {
    child.once('error', () => {
      process.exitCode = 1;
      resolve();
    });
    child.once('exit', (code) => {
      process.exitCode = code ?? 1;
      resolve();
    });
  });
}
