// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchPublic, isPublicAddress, isPublicUrl, type LookupFn } from './public-fetch.js';
import { urlToImageBlock } from './visual-blocks.js';

const resolvesTo = (address: string): LookupFn => async () => [{ address, family: address.includes(':') ? 6 : 4 }];

function fakeFetch(responses: Record<string, () => Response>): { fn: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const fn = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    const make = responses[url];
    if (!make) throw new Error(`unexpected fetch ${url}`);
    return make();
  }) as typeof fetch;
  return { fn, calls };
}

test('private, loopback, link-local and tailnet addresses are not public', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.123.177.11', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) {
    assert.equal(isPublicAddress(ip), false, ip);
  }
  for (const ip of ['8.8.8.8', '162.159.128.233', '2606:4700::1111']) {
    assert.equal(isPublicAddress(ip), true, ip);
  }
});

test('only http and https to public addresses pass the gate', async () => {
  assert.equal(await isPublicUrl('http://127.0.0.1:3013/api/internal/journal'), false);
  assert.equal(await isPublicUrl('file:///etc/passwd'), false);
  assert.equal(await isPublicUrl('https://example.test/x.png', resolvesTo('10.0.0.5')), false);
  assert.equal(await isPublicUrl('https://example.test/x.png', resolvesTo('93.184.216.34')), true);
});

test('a URL that resolves inside the box is never fetched', async () => {
  const { fn, calls } = fakeFetch({});
  const result = await fetchPublic('https://sneaky.test/pic.png', { lookup: resolvesTo('127.0.0.1'), fetchImpl: fn });
  assert.equal(result, null);
  assert.deepEqual(calls, []);
});

test('a public URL that redirects inside the box is stopped at the redirect', async () => {
  const lookup: LookupFn = async (host) => [{ address: host === 'public.test' ? '93.184.216.34' : '127.0.0.1', family: 4 }];
  const { fn, calls } = fakeFetch({
    'https://public.test/pic.png': () => new Response(null, { status: 302, headers: { location: 'http://inside.test:3013/api/internal/journal' } }),
  });
  const result = await fetchPublic('https://public.test/pic.png', { lookup, fetchImpl: fn });
  assert.equal(result, null);
  assert.deepEqual(calls, ['https://public.test/pic.png']);
});

test('a body past the cap is refused even when it never says its size', async () => {
  const big = new Uint8Array(2048);
  const { fn } = fakeFetch({
    'https://public.test/huge.png': () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(big); controller.enqueue(big); controller.close(); },
    }), { headers: { 'content-type': 'image/png' } }),
  });
  const result = await fetchPublic('https://public.test/huge.png', { lookup: resolvesTo('93.184.216.34'), fetchImpl: fn, maxBytes: 3000 });
  assert.equal(result, null);
});

test('a public picture still arrives', async () => {
  const { fn } = fakeFetch({
    'https://public.test/ok.png': () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } }),
  });
  const result = await fetchPublic('https://public.test/ok.png', { lookup: resolvesTo('93.184.216.34'), fetchImpl: fn });
  assert.ok(result);
  assert.equal(result.contentType, 'image/png');
  assert.equal(result.bytes.length, 3);
});

// A real picture served on this box's own loopback: the old fetcher took it
// and handed it to the model; the gate has to refuse it.
test('the image fetcher refuses a picture served on loopback', async () => {
  const { createServer } = await import('node:http');
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'image/png' });
    res.end(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address() as { port: number };
    assert.equal(await urlToImageBlock(`http://127.0.0.1:${port}/pic.png`), null);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
