// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The laptop app's updates are signed. The house that builds the app keeps an
// Ed25519 private key OUTSIDE the repo (stage.mjs reads it; `node stage.mjs
// --keygen` makes one), signs every staged zip's version and SHA-256, and the
// public half is built into the app through house.json ("updateKey"). The app
// checks the zip it downloaded against that key before unpacking anything, so
// a page or another house that talks the app into fetching an update cannot
// hand it a copy this house did not sign (outside review, Nov 20 2026: the
// update path had a prompt but no signature or hash check).
// No Electron in here, so the backend's test can load it.

const crypto = require('node:crypto');

/** DER prefix that turns 32 raw Ed25519 public key bytes into an SPKI key. */
const SPKI_ED25519 = Buffer.from('302a300506032b6570032100', 'hex');

/** What gets signed: the version and the zip's hash, so neither can be swapped. */
function updateMessage(version, sha256) {
  return Buffer.from(`aerie-desktop-update:${version}:${sha256}`, 'utf8');
}

function sha256Of(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/** A KeyObject from the base64 raw public key kept in house.json, or null. */
function publicKeyFrom(raw) {
  if (typeof raw !== 'string') return null;
  const bytes = Buffer.from(raw.trim(), 'base64');
  if (bytes.length !== 32) return null;
  try {
    return crypto.createPublicKey({ key: Buffer.concat([SPKI_ED25519, bytes]), format: 'der', type: 'spki' });
  } catch {
    return null;
  }
}

/** A new signing pair: the private key as PEM, the public key as base64 raw bytes. */
function newSigningPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const spki = publicKey.export({ format: 'der', type: 'spki' });
  return {
    privatePem: privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
    publicRaw: spki.subarray(SPKI_ED25519.length).toString('base64'),
  };
}

/** The base64 raw public key belonging to a private key PEM. */
function publicRawOf(privatePem) {
  const spki = crypto.createPublicKey(privatePem).export({ format: 'der', type: 'spki' });
  return spki.subarray(SPKI_ED25519.length).toString('base64');
}

/** Signature (base64) over a version and its zip's hash. */
function signUpdate(version, sha256, privatePem) {
  return crypto.sign(null, updateMessage(version, sha256), privatePem).toString('base64');
}

/**
 * Whether a downloaded zip is the one this house signed. meta is what the
 * house's /api/app/desktop/version answered ({version, sha256, signature}).
 * Returns { ok: true } or { ok: false, reason } in words for the update log.
 */
function verifyUpdate(meta, zip, publicKey) {
  if (!publicKey) return { ok: false, reason: 'the app has no update key built in' };
  if (!meta || typeof meta.version !== 'string') return { ok: false, reason: 'the house did not say which version it is offering' };
  if (typeof meta.sha256 !== 'string' || typeof meta.signature !== 'string') return { ok: false, reason: 'the house offered an unsigned update' };
  const got = sha256Of(zip);
  if (got !== meta.sha256.toLowerCase()) return { ok: false, reason: 'the download does not match the hash the house signed' };
  let good = false;
  try {
    good = crypto.verify(null, updateMessage(meta.version, got), publicKey, Buffer.from(meta.signature, 'base64'));
  } catch {
    good = false;
  }
  return good ? { ok: true } : { ok: false, reason: 'the signature is not from the key this app was built with' };
}

module.exports = { updateMessage, sha256Of, publicKeyFrom, newSigningPair, publicRawOf, signUpdate, verifyUpdate };
