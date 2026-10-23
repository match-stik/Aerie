// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import assert from 'node:assert/strict';
import test from 'node:test';
import { crossSiteVerdict } from './csrf.js';

test('a request from their own page passes', () => {
  assert.equal(crossSiteVerdict({ secFetchSite: 'same-origin', origin: 'https://aerie.example.net', host: 'aerie.example.net' }), null);
  assert.equal(crossSiteVerdict({ secFetchSite: 'none' }), null);
});

test('another site, or a sibling subdomain, is named', () => {
  assert.match(crossSiteVerdict({ secFetchSite: 'cross-site', origin: 'https://evil.test', host: 'aerie.example.net' }) ?? '', /cross-site/);
  assert.match(crossSiteVerdict({ secFetchSite: 'same-site', origin: 'https://other.example.net', host: 'aerie.example.net' }) ?? '', /same-site/);
});

test('with no Sec-Fetch-Site, Origin decides, and no Origin at all is not a browser', () => {
  assert.equal(crossSiteVerdict({ origin: 'https://aerie.tail380956.ts.net', host: 'aerie.tail380956.ts.net' }), null);
  assert.match(crossSiteVerdict({ origin: 'https://evil.test', host: 'aerie.example.net' }) ?? '', /not this house/);
  assert.match(crossSiteVerdict({ origin: 'null', host: 'aerie.example.net' }) ?? '', /null/);
  assert.equal(crossSiteVerdict({ host: 'aerie.example.net' }), null);
});

test('a forwarded host counts as this house', () => {
  assert.equal(crossSiteVerdict({ origin: 'https://aerie.example.net', host: 'localhost:3003', forwardedHost: 'aerie.example.net' }), null);
});
