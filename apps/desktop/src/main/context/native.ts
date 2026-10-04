import koffi from 'koffi';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { basename } from 'node:path';
import type { Foreground } from '@trueiris/schemas';

type Pointer = bigint | null;
export class UnsupportedContext extends Error {}
const empty: Foreground = {
  application: null,
  windowTitle: null,
  titleAccess: 'off',
};
const clean = (value: string, max: number) =>
  value
    .replace(/\p{Cc}/gu, ' ')
    .trim()
    .slice(0, max);

function macReader(): (titles: boolean) => Promise<Foreground> {
  koffi.load('/System/Library/Frameworks/AppKit.framework/AppKit');
  const objc = koffi.load('/usr/lib/libobjc.A.dylib');
  const getClass = objc.func('void *objc_getClass(const char *)') as (
    name: string,
  ) => Pointer;
  const selector = objc.func('void *sel_registerName(const char *)') as (
    name: string,
  ) => Pointer;
  const message = objc.func('objc_msgSend', 'void *', ['void *', 'void *']) as (
    obj: Pointer,
    sel: Pointer,
  ) => Pointer;
  const string = objc.func('objc_msgSend', 'str', ['void *', 'void *']) as (
    obj: Pointer,
    sel: Pointer,
  ) => string | null;
  const pid = objc.func('objc_msgSend', 'int32', ['void *', 'void *']) as (
    obj: Pointer,
    sel: Pointer,
  ) => number;
  const push = objc.func('void *objc_autoreleasePoolPush()') as () => Pointer;
  const pop = objc.func('void objc_autoreleasePoolPop(void *)') as (
    pool: Pointer,
  ) => void;
  const cf = koffi.load(
    '/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation',
  );
  const ax = koffi.load(
    '/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices',
  );
  const trusted = ax.func('bool AXIsProcessTrusted()') as () => boolean;
  const create = ax.func('void *AXUIElementCreateApplication(int32)') as (
    pid: number,
  ) => Pointer;
  const timeout = ax.func(
    'int AXUIElementSetMessagingTimeout(void *, float)',
  ) as (obj: Pointer, seconds: number) => number;
  const copy = ax.func(
    'int AXUIElementCopyAttributeValue(void *, void *, _Out_ void **)',
  ) as (obj: Pointer, attr: Pointer, result: Pointer[]) => number;
  const cfString = cf.func(
    'void *CFStringCreateWithCString(void *, const char *, uint32)',
  ) as (alloc: Pointer, text: string, encoding: number) => Pointer;
  const getString = cf.func(
    'bool CFStringGetCString(void *, _Out_ char *, long, uint32)',
  ) as (
    obj: Pointer,
    buffer: Buffer,
    size: number,
    encoding: number,
  ) => boolean;
  const typeId = cf.func('unsigned long CFGetTypeID(void *)') as (
    obj: Pointer,
  ) => number;
  const stringId = cf.func('unsigned long CFStringGetTypeID()') as () => number;
  const release = cf.func('void CFRelease(void *)') as (obj: Pointer) => void;
  const call = (obj: Pointer, name: string) => message(obj, selector(name));
  const text = (obj: Pointer) =>
    obj ? string(obj, selector('UTF8String')) : null;
  return async (titles) => {
    const pool = push();
    const owned: Pointer[] = [];
    try {
      const application = call(
        call(getClass('NSWorkspace'), 'sharedWorkspace'),
        'frontmostApplication',
      );
      if (!application)
        return { ...empty, titleAccess: titles ? 'unavailable' : 'off' };
      const name = clean(text(call(application, 'localizedName')) ?? '', 256);
      const id = clean(
        text(call(application, 'bundleIdentifier')) ?? name,
        256,
      );
      if (!name || !id)
        return { ...empty, titleAccess: titles ? 'unavailable' : 'off' };
      const result: Foreground = {
        application: { id, name },
        windowTitle: null,
        titleAccess: titles ? 'unavailable' : 'off',
      };
      if (!titles) return result; // No AX calls/title reads before explicit opt-in.
      if (!trusted()) return { ...result, titleAccess: 'permission_required' };
      const app = create(pid(application, selector('processIdentifier')));
      owned.push(app);
      timeout(app, 0.25);
      const attribute = (obj: Pointer, name: string) => {
        const key = cfString(null, name, 0x08000100);
        owned.push(key);
        const value: Pointer[] = [null];
        if (copy(obj, key, value) !== 0) return null;
        owned.push(value[0] ?? null);
        return value[0] ?? null;
      };
      const window = attribute(app, 'AXFocusedWindow');
      const title = window ? attribute(window, 'AXTitle') : null;
      if (!title || typeId(title) !== stringId()) return result;
      const buffer = Buffer.alloc(4096);
      if (getString(title, buffer, buffer.length, 0x08000100)) {
        result.windowTitle =
          clean(buffer.toString('utf8').split('\0')[0] ?? '', 512) || null;
        result.titleAccess = 'ready';
      }
      return result;
    } finally {
      for (const value of owned.reverse()) if (value) release(value);
      pop(pool);
    }
  };
}

function windowsReader(): (titles: boolean) => Promise<Foreground> {
  const user = koffi.load('user32.dll'),
    kernel = koffi.load('kernel32.dll');
  const foreground = user.func(
    'void * __stdcall GetForegroundWindow()',
  ) as () => Pointer;
  const getPid = user.func(
    'uint32 __stdcall GetWindowThreadProcessId(void *, _Out_ uint32 *)',
  ) as (window: Pointer, id: number[]) => number;
  const open = kernel.func(
    'void * __stdcall OpenProcess(uint32, int, uint32)',
  ) as (access: number, inherit: number, pid: number) => Pointer;
  const close = kernel.func('int __stdcall CloseHandle(void *)') as (
    obj: Pointer,
  ) => number;
  const image = kernel.func(
    'int __stdcall QueryFullProcessImageNameW(void *, uint32, _Out_ uint16 *, _Inout_ uint32 *)',
  ) as (obj: Pointer, flags: number, buffer: Buffer, size: number[]) => number;
  const title = user.func(
    'int __stdcall GetWindowTextW(void *, _Out_ uint16 *, int)',
  ) as (obj: Pointer, buffer: Buffer, size: number) => number;
  return async (titles) => {
    const window = foreground();
    if (!window)
      return { ...empty, titleAccess: titles ? 'unavailable' : 'off' };
    const id = [0];
    getPid(window, id);
    const handle = open(0x1000, 0, id[0]!);
    if (!handle)
      return { ...empty, titleAccess: titles ? 'unavailable' : 'off' };
    try {
      const buffer = Buffer.alloc(65_536),
        size = [32_768];
      if (!image(handle, 0, buffer, size))
        return { ...empty, titleAccess: titles ? 'unavailable' : 'off' };
      const name = clean(
        basename(
          buffer.toString('utf16le', 0, size[0]! * 2).replaceAll('\\', '/'),
        ),
        256,
      );
      if (!name) return empty;
      const result: Foreground = {
        application: { id: name.toLowerCase(), name },
        windowTitle: null,
        titleAccess: titles ? 'unavailable' : 'off',
      };
      if (titles) {
        const buffer = Buffer.alloc(1026);
        const count = title(window, buffer, 513);
        if (count > 0) {
          result.windowTitle = clean(
            buffer.toString('utf16le', 0, count * 2),
            512,
          );
          result.titleAccess = 'ready';
        }
      }
      return result;
    } finally {
      close(handle);
    }
  };
}

const run = promisify(execFile);
export function parseX11Application(value: string): Foreground['application'] {
  const names = [...value.matchAll(/"([^"\n]*)"/g)].map((m) => m[1] ?? '');
  const name = clean(names.at(-1) ?? '', 256);
  return name ? { id: name.toLowerCase(), name } : null;
}
function linuxReader(): (titles: boolean) => Promise<Foreground> {
  if (
    process.env.XDG_SESSION_TYPE === 'wayland' ||
    process.env.WAYLAND_DISPLAY ||
    !process.env.DISPLAY
  )
    throw new UnsupportedContext();
  const query = async (args: string[]) =>
    (
      await run('xprop', args, {
        timeout: 750,
        maxBuffer: 16_384,
        encoding: 'utf8',
      })
    ).stdout;
  return async (titles) => {
    const root = await query(['-root', '_NET_ACTIVE_WINDOW']);
    const id = root.match(/0x[\da-f]+/i)?.[0];
    if (!id || /^0x0+$/i.test(id))
      return { ...empty, titleAccess: titles ? 'unavailable' : 'off' };
    const application = parseX11Application(
      await query(['-id', id, 'WM_CLASS']),
    );
    const result: Foreground = {
      application,
      windowTitle: null,
      titleAccess: titles ? 'unavailable' : 'off',
    };
    if (titles && application) {
      let value: string;
      try {
        value = await query(['-id', id, '_NET_WM_NAME', 'WM_NAME']);
      } catch {
        return result;
      }
      result.windowTitle =
        clean(value.match(/= "([^\n]*)"/)?.[1] ?? '', 512) || null;
      if (result.windowTitle) result.titleAccess = 'ready';
    }
    return result;
  };
}
export function nativeReader(): (titles: boolean) => Promise<Foreground> {
  if (process.platform === 'darwin') return macReader();
  if (process.platform === 'win32') return windowsReader();
  if (process.platform === 'linux') return linuxReader();
  throw new UnsupportedContext();
}
