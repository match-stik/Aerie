// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDb } from './init.js';
import { createCompanion } from './companions.js';
import {
  ownerSeat,
  buildCardRoomPrompt,
  getCardTable,
  newCardTable,
  seatOrder,
  viewCardTable,
} from './cards.js';

// Two contracts that have each already failed in real use, and neither of
// which anything was checking. They are here as guards rather than as coverage:
// both bugs were invisible to the type system and to every existing test, and
// both were found on the owner's own screen.
//
// Dealing a table needs the cut deck, and the art is gitignored — so the seat
// contract skips itself on a clone rather than failing there. loadDeck refusing
// to deal without art is the correct behaviour, not the thing under test.

const DECK_CUT = existsSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../../../../data/cards/cards.json'),
);
const UNCUT = 'the deck has not been cut — data/cards is gitignored';

function seedHouse(): { slugs: string[]; ids: string[] } {
  initDb(':memory:');
  const made = ['birch', 'willow', 'cedar'].map((slug) => createCompanion({
    slug,
    displayName: slug[0].toUpperCase() + slug.slice(1),
    claudeMdPath: `/tmp/${slug}/CLAUDE.md`,
    mcpJsonPath: `/tmp/${slug}/.mcp.json`,
  }));
  return { slugs: made.map((c) => c.slug), ids: made.map((c) => c.id) };
}

test('every seat is keyed and served by SLUG, never by companion id', { skip: DECK_CUT ? false : UNCUT }, () => {
  const { slugs, ids } = seedHouse();

  // The chairs on the phone are looked up by slug. Keying them by id put three
  // raw uuids and three broken-image glyphs at the owner's table mid-game.
  assert.deepEqual(seatOrder(), [...slugs, ownerSeat()]);

  const created = newCardTable('klondike');
  const stored = getCardTable(created.id);
  assert.ok(stored, 'the table it just made should be readable back');

  const storedKeys = Object.keys(stored.seats);
  assert.deepEqual(storedKeys.sort(), [...slugs, ownerSeat()].sort());
  for (const id of ids) {
    assert.ok(!storedKeys.includes(id), `seats must not be keyed by the companion id ${id}`);
  }

  const view = viewCardTable(stored, ownerSeat());
  const viewed = view.seats.map((seat) => seat.slug);
  assert.deepEqual(viewed.sort(), [...slugs, ownerSeat()].sort());
  for (const seat of viewed) {
    assert.ok(!ids.includes(seat), `the view must not hand the phone an id (${seat})`);
    assert.ok(
      !/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(seat),
      `a uuid-shaped seat means the phone will render a raw id (${seat})`,
    );
  }

  // The owner's own chair is the only one whose hand is visible to them.
  const mine = view.seats.find((seat) => seat.slug === ownerSeat());
  assert.ok(mine && Array.isArray(mine.hand), 'the owner sees their own hand');
  assert.ok(view.seats.filter((seat) => seat.hand !== undefined).length === 1);
});

test('what the owner said reaches the prompt, and it goes last', () => {
  // The failure this guards was silent in every instrument: the message was
  // written to the database and rendered on the owner's screen, and simply never put
  // into the turn. The room answered the board three times running.
  const line = 'lol are you responding to me';
  const prompt = buildCardRoomPrompt('klondike', 'Stock 0, waste 0.', line);

  assert.ok(prompt.includes(line), 'the prompt must carry what they actually said');
  assert.ok(prompt.trimEnd().endsWith(line), 'what the owner said goes last, after the framing and the board');
  assert.ok(prompt.includes('Stock 0, waste 0.'), 'the board still travels with it');

  // A board-less table must not quietly drop the owner's line along with the board.
  const dealt = buildCardRoomPrompt('klondike', null, line);
  assert.ok(dealt.includes('Nothing dealt yet.'));
  assert.ok(dealt.trimEnd().endsWith(line));

  // Markdown in the owner's line is theirs and is passed through untouched.
  const emphatic = '**this** one, the _seven_';
  assert.ok(buildCardRoomPrompt('klondike', null, emphatic).trimEnd().endsWith(emphatic));
});
