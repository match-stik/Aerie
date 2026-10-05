// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// Barrel export — all database functions from domain modules

// Core state
export { initDb, getDb } from './init.js';

// Domain modules
export * from './config.js';
export * from './threads.js';
export * from './messages.js';
export * from './reactions.js';
export * from './embeddings.js';
export * from './sessions.js';
export * from './web-sessions.js';
export * from './push.js';
export * from './canvases.js';
export * from './timers.js';
export * from './triggers.js';
export * from './stickers.js';
export * from './emojis.js';
export * from './usage.js';
export * from './companions.js';
export * from './digests.js';
export * from './mcp-servers.js';
export * from './tts.js';
export * from './journal.js';
export * from './letters.js';
export * from './thresholds.js';
export * from './self-knowledge.js';
export * from './pet.js';
export * from './battleship.js';
export * from './cards.js';
export * from './solitaire.js';
export * from './rat-screw.js';
