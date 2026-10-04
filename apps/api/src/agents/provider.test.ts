import { expect, it, vi } from 'vitest';
import { GeminiReasoningProvider, boundedJson } from './provider';
const contents = [
  { role: 'user' as const, parts: [{ text: 'synthetic question' }] },
];
it('uses official HTTPS transport, tool schemas and header-only keys, preserving opaque signatures', async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              role: 'model',
              parts: [
                {
                  functionCall: { name: 'get_current_state', args: {} },
                  thoughtSignature: 'signature',
                },
              ],
            },
            finishReason: 'STOP',
          },
        ],
      }),
    ),
  );
  const provider = new GeminiReasoningProvider(
    'test-private-key',
    'gemini-3.8-flash',
    request,
  );
  const result = await provider.next(contents, new AbortController().signal);
  expect(result.parts[0]?.thoughtSignature).toBe('signature');
  const [url, options] = request.mock.calls[0]!;
  expect(String(url)).not.toContain('key=');
  expect(options?.headers).toMatchObject({
    'x-goog-api-key': 'test-private-key',
  });
  expect(options?.redirect).toBe('error');
  const body = JSON.parse(String(options?.body));
  expect(body.store).toBe(false);
  expect(body.tools[0].functionDeclarations).toHaveLength(8);
  expect(body.toolConfig.functionCallingConfig.mode).toBe('ANY');
});
it('rejects malformed, blocked, oversized and unsuccessful responses without private diagnostics', async () => {
  const request = vi.fn<typeof fetch>();
  const provider = new GeminiReasoningProvider(
    'key',
    'gemini-3.8-flash',
    request,
  );
  for (const body of [
    { candidates: [] },
    {
      candidates: [
        {
          content: { role: 'model', parts: [{ text: 'hidden reasoning' }] },
          finishReason: 'MAX_TOKENS',
        },
      ],
    },
  ]) {
    request.mockResolvedValue(new Response(JSON.stringify(body)));
    await expect(
      provider.next(contents, new AbortController().signal),
    ).rejects.toThrow();
  }
  request.mockResolvedValue(
    new Response('private key contents', { status: 429 }),
  );
  await expect(
    provider.next(contents, new AbortController().signal),
  ).rejects.toThrow('Gemini request unavailable');
  await expect(
    boundedJson(new Response('x'.repeat(1025)), 1024),
  ).rejects.toThrow('exceeds limit');
  expect(() => new GeminiReasoningProvider('key', '../private')).toThrow();
});
