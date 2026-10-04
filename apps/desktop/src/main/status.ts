import {
  desktopStatusSchema,
  healthSchema,
  type DesktopStatus,
} from '@trueiris/schemas';

export async function getDesktopStatus(
  apiUrl: string,
  version: string,
  demoMode: boolean,
): Promise<DesktopStatus> {
  try {
    const response = await fetch(new URL('/health', apiUrl), {
      signal: AbortSignal.timeout(2500),
      redirect: 'error',
    });
    if (!response.ok) throw new Error('API unavailable');
    const health = healthSchema.parse(await response.json());
    return desktopStatusSchema.parse({
      version,
      demoMode,
      api: 'connected',
      ...(health.demo ? { demo: health.demo } : {}),
      integrations: health.integrations,
    });
  } catch {
    return { version, demoMode, api: 'unavailable', integrations: null };
  }
}
