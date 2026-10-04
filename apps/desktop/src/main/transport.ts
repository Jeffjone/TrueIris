let mode: 'demo' | 'ordinary' = 'ordinary';
/** Main configures this once; the renderer cannot select an API identity. */
export function setTransportMode(demo: boolean) {
  mode = demo ? 'demo' : 'ordinary';
}
export function transportMode() {
  return mode;
}
export const privateFetch: typeof fetch = (input, init) => {
  const headers = new Headers(
    input instanceof Request ? input.headers : undefined,
  );
  new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
  if (!headers.has('x-trueiris-mode')) headers.set('x-trueiris-mode', mode);
  return fetch(input, { ...init, headers: Object.fromEntries(headers) });
};
