// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// Web push, the house's half (theirs, Oct 29 2026: both options in the kit, for
// people without the Android app). A real encrypted push goes to a stand-in
// push service on loopback; a browser cannot subscribe from this box (headless
// Chromium has no push service), so the browser half is proven on a device.
import assert from 'node:assert/strict';
import test from 'node:test';
import type http from 'node:http';
import https from 'node:https';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createECDH, randomBytes } from 'node:crypto';

process.env.NODE_ENV = 'test';
// The library only speaks https, as a real push service does, so the stand-in
// gets a throwaway self-signed certificate, trusted for this process only.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const certDir = mkdtempSync(join(tmpdir(), 'web-push-test-'));
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=127.0.0.1',
  '-keyout', join(certDir, 'key.pem'), '-out', join(certDir, 'cert.pem')], { stdio: 'ignore' });
const tls = { key: readFileSync(join(certDir, 'key.pem')), cert: readFileSync(join(certDir, 'cert.pem')) };
test.after(() => rmSync(certDir, { recursive: true, force: true }));
const { initDb } = await import('./db/init.js');
const { addPushSubscription, listPushSubscriptions } = await import('./db/push.js');
const { getSecret } = await import('./secrets.js');
const { PushService } = await import('./push.js');
initDb(':memory:');

const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function standInPushService(status: number) {
  const seen: Array<{ headers: http.IncomingHttpHeaders; bytes: number }> = [];
  const server = https.createServer(tls, (req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => { seen.push({ headers: req.headers, bytes: Buffer.concat(chunks).length }); res.writeHead(status); res.end(); });
  });
  return new Promise<{ url: string; seen: typeof seen; close: () => void }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port;
      resolve({ url: `https://127.0.0.1:${port}/push/abc`, seen, close: () => server.close() });
    });
  });
}

function browserKeys() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return { p256dh: b64url(ecdh.getPublicKey()), auth: b64url(randomBytes(16)) };
}

test('a browser that turned it on gets an encrypted push signed with the house key', async () => {
  const svc = new PushService();
  const publicKey = svc.getVapidPublicKey();
  assert.ok(publicKey, 'the house makes its own key pair');
  assert.equal(getSecret('vapid_public_key'), publicKey, 'and keeps it, so it never changes under a subscribed browser');
  assert.equal(new PushService().getVapidPublicKey(), publicKey);

  const svcDone = await standInPushService(201);
  const k = browserKeys();
  addPushSubscription({ id: 'b1', endpoint: svcDone.url, keysP256dh: k.p256dh, keysAuth: k.auth, deviceName: 'test browser' });
  await svc.sendPush({ title: 'Birch', body: 'Web push works.', tag: 't' });
  svcDone.close();
  assert.equal(svcDone.seen.length, 1);
  const h = svcDone.seen[0].headers;
  assert.equal(h['content-encoding'], 'aes128gcm', 'encrypted for the browser');
  assert.match(String(h.authorization), /^vapid t=.+, k=/, 'signed with the house key');
  assert.ok(svcDone.seen[0].bytes > 0);
});

test('a subscription the browser threw away is dropped, not retried forever', async () => {
  const gone = await standInPushService(410);
  const k = browserKeys();
  addPushSubscription({ id: 'b2', endpoint: gone.url.replace('abc', 'gone'), keysP256dh: k.p256dh, keysAuth: k.auth });
  const before = listPushSubscriptions().filter((s) => s.type === 'web_push').length;
  await new PushService().sendPush({ title: 'Willow', body: 'Still there?' });
  gone.close();
  const after = listPushSubscriptions().filter((s) => s.type === 'web_push').length;
  assert.ok(after < before, 'the 410 one is gone');
});
