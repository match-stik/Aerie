// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The backup phrase and the key it stands for, made on the laptop. The house
// only ever gets the public half; the phrase is shown once, written on paper,
// and never stored or sent anywhere. This must turn a phrase into exactly the
// key packages/backend/src/services/sealed-backup.ts does (keysFromPhrase), or
// nothing the house seals could be opened; sealed-backup.test.ts holds the two
// together. No Electron in here, so the test can load it.

const crypto = require('node:crypto');

/** Crockford's base32: no I, L, O or U, so nothing on paper reads as two letters. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const SALT = 'aerie-backup-key-v1';
const PKCS8_X25519 = Buffer.from('302e020100300506032b656e04220420', 'hex');

/** Eight groups of four: 160 bits, written down once. */
function newPhrase() {
  const bytes = crypto.randomBytes(32);
  let out = '';
  for (let i = 0; i < 32; i++) {
    out += ALPHABET[bytes[i] & 31];
    if (i % 4 === 3 && i < 31) out += '-';
  }
  return out;
}

function normalizePhrase(phrase) {
  return String(phrase).toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
}

/** The public half of the key a phrase stands for, as 32 raw bytes. */
function publicKeyFromPhrase(phrase) {
  const seed = crypto.scryptSync(normalizePhrase(phrase), SALT, 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const privateKey = crypto.createPrivateKey({ key: Buffer.concat([PKCS8_X25519, seed]), format: 'der', type: 'pkcs8' });
  const spki = crypto.createPublicKey(privateKey).export({ format: 'der', type: 'spki' });
  return spki.subarray(spki.length - 32);
}

module.exports = { ALPHABET, newPhrase, normalizePhrase, publicKeyFromPhrase };
