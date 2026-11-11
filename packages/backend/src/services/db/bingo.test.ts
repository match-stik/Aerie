// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  newBingo, callNumber, daub, undaub, claimBingo, usePower, setSeat, toggleHouse, viewBingo, nextCaller,
  letterFor, loadBingoHouse, patternInstances, oneAway, seatOf, describeBingo, closest,
  FREE, OWNER, DEFAULT_MOMENTS, DAUBS_PER_POWER, FREEZE_BALLS, BingoError, type BingoState,
} from './bingo.js';

function seeded(seed = 1) {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

/** Put chosen numbers at the front of the cage, in order. */
function rig(state: BingoState, ...ns: number[]) {
  state.deck = [...ns, ...state.deck.filter((n) => !ns.includes(n))];
}

test('every seat gets its own cards, each column in range and a free middle', () => {
  const g = newBingo({ callers: ['birch', 'willow', 'cedar'], cardsEach: 3, rand: seeded() });
  assert.deepStrictEqual(g.seats.map((s) => s.who), [OWNER, 'birch', 'willow', 'cedar']);
  for (const seat of g.seats) {
    assert.strictEqual(seat.cards.length, 3);
    for (const card of seat.cards) {
      for (let col = 0; col < 5; col++) for (let row = 0; row < 5; row++) {
        const n = card.numbers[row][col];
        if (row === 2 && col === 2) { assert.strictEqual(n, FREE); continue; }
        assert.ok(n >= col * 15 + 1 && n <= col * 15 + 15);
      }
    }
    assert.strictEqual(seat.house[2][2].label, 'Free');
  }
  assert.strictEqual(g.cap, 3);
  assert.strictEqual(g.deck.length, 75);
  assert.strictEqual(new Set(g.deck).size, 75);
});

test('cards each is held between one and four', () => {
  assert.strictEqual(newBingo({ callers: ['a'], cardsEach: 9, rand: seeded() }).cardsEach, 4);
  assert.strictEqual(newBingo({ callers: ['a'], cardsEach: 0, rand: seeded() }).cardsEach, 1);
});

test('the callers take turns, every ball comes out once, and the round ends when the cage is empty', () => {
  const g = newBingo({ callers: ['birch', 'willow', 'cedar'], rand: seeded(7) });
  g.cap = 99;
  const by: string[] = [];
  for (let i = 0; i < 75 && !g.done; i++) by.push(callNumber(g, { rand: seeded(i + 3) }).by);
  assert.deepStrictEqual(by.slice(0, 4), ['birch', 'willow', 'cedar', 'birch']);
  assert.strictEqual(new Set(g.calls.map((c) => c.n)).size, g.calls.length);
  assert.ok(g.done);
  assert.throws(() => callNumber(g, {}), BingoError);
});

test('a call line always says the number', () => {
  const g = newBingo({ callers: ['cedar'], rand: seeded() });
  const own = callNumber(g, { line: 'Ready?', rand: seeded(2) });
  assert.match(own.line, new RegExp(`^${letterFor(own.n)}-${own.n}\\. Ready\\?$`));
  const house = callNumber(g, { lines: { cedar: ['{call}, love.'] }, rand: seeded(3) });
  assert.strictEqual(house.line, `${letterFor(house.n)}-${house.n}, love.`);
});

test('them daub needs the number called and on that card; companions daub on every call', () => {
  const g = newBingo({ callers: ['birch'], cardsEach: 2, rand: seeded() });
  const mine = g.seats[0].cards[1].numbers[0][0];
  assert.throws(() => daub(g, OWNER, 1, mine), /not been called/);
  rig(g, mine);
  callNumber(g, { rand: seeded(2) });
  assert.deepStrictEqual(g.seats[0].cards[1].daubed, []);
  daub(g, OWNER, 1, mine);
  assert.deepStrictEqual(g.seats[0].cards[1].daubed, [mine]);
  const birch = seatOf(g, 'birch');
  const theirs = birch.cards[0].numbers[1][1];
  rig(g, theirs);
  callNumber(g, { rand: seeded(3) });
  assert.ok(birch.cards[0].daubed.includes(theirs));
});

test('their auto-daub marks for them when they ask it to', () => {
  const g = newBingo({ callers: ['a'], rand: seeded() });
  setSeat(g, OWNER, { autoDaub: true });
  const n = g.seats[0].cards[0].numbers[3][3];
  rig(g, n);
  callNumber(g, { rand: seeded() });
  assert.ok(g.seats[0].cards[0].daubed.includes(n));
});

test('a line only wins when they call it, a card can win twice, and a false call freezes them', () => {
  const g = newBingo({ callers: ['a', 'b', 'c'], rand: seeded(4) });
  for (const seat of g.seats.slice(1)) seat.cards[0].numbers = [[1, 16, 31, 46, 61], [2, 17, 32, 47, 62], [3, 18, FREE, 48, 63], [4, 19, 33, 49, 64], [5, 20, 34, 50, 65]];
  const card = g.seats[0].cards[0];
  const out = claimBingo(g, OWNER);
  assert.strictEqual(out.won, null);
  assert.strictEqual(out.frozenUntil, FREEZE_BALLS + 1);
  const row = card.numbers[0];
  rig(g, ...row, ...card.numbers.map((r) => r[0]).slice(1));
  for (let i = 0; i < FREEZE_BALLS; i++) {
    callNumber(g, { rand: seeded(i + 1) });
    assert.throws(() => daub(g, OWNER, 0, g.calls[g.calls.length - 1].n), /frozen/);
  }
  while (g.calls.length < 9) callNumber(g, { rand: seeded(g.calls.length + 1) });
  for (const n of [...row, ...card.numbers.map((r) => r[0])]) if (n !== FREE) daub(g, OWNER, 0, n);
  const first = claimBingo(g, OWNER);
  const second = claimBingo(g, OWNER);
  assert.ok(first.won && second.won);
  assert.notStrictEqual(first.won!.key, second.won!.key);
  assert.deepStrictEqual(card.claimed.sort(), ['col0', 'row0']);
  assert.throws(() => undaub(g, OWNER, 0, row[0]), /bingo you called/);
});

test('a companion calls his bingo one ball after he could have', () => {
  const g = newBingo({ callers: ['birch', 'willow'], rand: seeded(5) });
  const birch = seatOf(g, 'birch');
  const row = birch.cards[0].numbers[0];
  rig(g, ...row);
  for (let i = 0; i < 5; i++) callNumber(g, { rand: seeded(i + 1) });
  assert.strictEqual(g.wins.filter((w) => w.who === 'birch').length, 0);
  callNumber(g, { rand: seeded(9) });
  assert.strictEqual(g.wins.filter((w) => w.who === 'birch').length >= 1, true);
});

test('the round ends when it has given out its bingos', () => {
  const g = newBingo({ callers: ['a'], rand: seeded() });
  assert.strictEqual(g.cap, 1);
  const card = g.seats[0].cards[0];
  rig(g, ...card.numbers[1]);
  for (let i = 0; i < 5; i++) callNumber(g, { rand: seeded(i + 1) });
  for (const n of card.numbers[1]) daub(g, OWNER, 0, n);
  if (!g.done) claimBingo(g, OWNER);
  assert.ok(g.done);
  assert.throws(() => callNumber(g, {}), /over/);
});

test('every few daubs fill the meter with a power-up, and held ones wait for a tap', () => {
  const g = newBingo({ callers: ['a'], rand: seeded() });
  const seat = g.seats[0];
  const card = seat.cards[0];
  // Prize squares pay on their own, so the meter is counted on plain ones.
  const ns = card.numbers.flat().filter((n) => n !== FREE && !(card.prizes ?? []).includes(n)).slice(0, DAUBS_PER_POWER);
  rig(g, ...ns);
  for (const n of ns) { callNumber(g, { rand: seeded(n) }); daub(g, OWNER, 0, n); }
  assert.strictEqual(seat.held.length, 1);
  assert.strictEqual(seat.meter, 0);
});

test('every card carries two prize squares that pay a power-up once when daubed', () => {
  const g = newBingo({ callers: ['a'], cardsEach: 2, rand: seeded(5) });
  const seat = g.seats[0];
  for (const card of seat.cards) {
    assert.strictEqual(card.prizes?.length, 2);
    assert.ok(!card.prizes?.includes(FREE));
  }
  const prize = seat.cards[0].prizes![0];
  rig(g, prize);
  callNumber(g, { rand: seeded(9) });
  daub(g, OWNER, 0, prize, seeded(4));
  assert.strictEqual(seat.held.length, 1);
  assert.ok(g.events.some((e) => e.who === OWNER && /found the prize/.test(e.text)));
  undaub(g, OWNER, 0, prize);
  daub(g, OWNER, 0, prize, seeded(4));
  assert.strictEqual(seat.held.length, 1);
});

test('the four power-ups each do their one thing', () => {
  const g = newBingo({ callers: ['a'], rand: seeded(8) });
  const seat = g.seats[0];
  const card = seat.cards[0];
  seat.held = ['optimistic', 'audit', 'lucky', 'double'];
  usePower(g, OWNER, { power: 'optimistic', target: { card: 0, row: 0, col: 0 } });
  assert.ok(card.daubed.includes(card.numbers[0][0]));
  usePower(g, OWNER, { power: 'audit' });
  assert.deepStrictEqual(seat.peek, g.deck.slice(0, 3));
  usePower(g, OWNER, { power: 'lucky' });
  assert.ok(card.numbers.flat().includes(g.deck[0]));
  const before = card.daubed.length;
  usePower(g, OWNER, { power: 'double', rand: seeded(3) });
  assert.strictEqual(card.daubed.length, before + 2);
  assert.throws(() => usePower(g, OWNER, { power: 'double' }), /not holding/);
});

test('an auto seat fires a power-up the moment it arrives', () => {
  const g = newBingo({ callers: ['a'], rand: seeded(2) });
  const seat = g.seats[0];
  setSeat(g, OWNER, { autoPower: true });
  const ns = seat.cards[0].numbers.flat().filter((n) => n !== FREE).slice(0, DAUBS_PER_POWER);
  rig(g, ...ns);
  for (const n of ns) { callNumber(g, { rand: seeded(n) }); daub(g, OWNER, 0, n, seeded(1)); }
  assert.strictEqual(seat.held.length, 0);
  assert.ok(g.events.some((e) => e.who === OWNER && /used/.test(e.text)));
});

test('the other patterns have one way to finish and one-away finds the missing square', () => {
  assert.strictEqual(patternInstances('line').length, 12);
  assert.strictEqual(patternInstances('corners')[0].cells.length, 4);
  assert.strictEqual(patternInstances('x')[0].cells.length, 9);
  assert.strictEqual(patternInstances('frame')[0].cells.length, 16);
  assert.strictEqual(patternInstances('blackout')[0].cells.length, 25);
  const g = newBingo({ callers: ['a'], pattern: 'corners', rand: seeded() });
  const card = g.seats[0].cards[0];
  card.daubed = [card.numbers[0][0], card.numbers[0][4], card.numbers[4][0]];
  assert.deepStrictEqual(oneAway(card, 'corners'), ['4,4']);
});

test('the phone never sees the cage, and only they see their Audit', () => {
  const g = newBingo({ callers: ['a'], rand: seeded() });
  g.seats[0].peek = [1, 2, 3];
  g.seats[1].peek = [4, 5, 6];
  const v = viewBingo(g, []);
  assert.ok(!('deck' in v));
  assert.strictEqual(v.left, 75);
  assert.deepStrictEqual(v.seats[0].peek, [1, 2, 3]);
  assert.deepStrictEqual(v.seats[1].peek, []);
});

test('the house cards mark themselves from what was said, and theirs by hand', () => {
  const g = newBingo({ callers: ['cedar'], rand: seeded() });
  g.seats[0].house[0][0] = { label: 'Somebody laughs', cue: '\\b(ha){2,}|\\blol\\b' };
  g.seats[1].house[1][1] = { label: 'A cheer', cue: '\\bcheer' };
  const v = viewBingo(g, ['lol, ok', 'Cheer!']);
  assert.ok(v.seats[0].houseAuto.includes('0,0'));
  assert.ok(v.seats[1].houseAuto.includes('1,1'));
  toggleHouse(g, OWNER, 4, 4);
  assert.ok(g.seats[0].houseMarked.includes('4,4'));
  assert.throws(() => toggleHouse(g, OWNER, 2, 2), BingoError);
});

test('a house file brings its own moments and lines, and a broken cue is left out', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bingo-'));
  const path = join(dir, 'bingo.json');
  writeFileSync(path, JSON.stringify({
    moments: [{ label: 'A cheer', cue: '\\bcheer' }, { label: 'Broken', cue: '(' }],
    lines: { cedar: ['{call}. Ready?', 'no number here'] },
  }));
  const house = loadBingoHouse(path);
  assert.strictEqual(house.moments[0].label, 'A cheer');
  assert.ok(!house.moments.some((m) => m.label === 'Broken'));
  assert.ok(house.moments.length >= 24);
  assert.deepStrictEqual(house.lines.cedar, ['{call}. Ready?']);
  assert.strictEqual(loadBingoHouse(join(dir, 'missing.json')).moments, DEFAULT_MOMENTS);
});

test('the companions see the table in words', () => {
  const g = newBingo({ callers: ['birch'], rand: seeded() });
  callNumber(g, { rand: seeded() });
  const text = describeBingo(g, (w) => (w === OWNER ? 'Sam' : w));
  assert.match(text, /Pattern: any line\. 1 of 75 called/);
  assert.match(text, /Sam: 1 card/);
  assert.match(text, /birch: 1 card/);
  assert.strictEqual(nextCaller(g), 'birch');
});

test('a card that has called its only pattern reads full, not 0 of 5', () => {
  const g = newBingo({ callers: ['a'], pattern: 'frame', rand: seeded() });
  const card = g.seats[0].cards[0];
  card.claimed = ['frame'];
  assert.deepStrictEqual(closest(card, 'frame'), { have: 16, need: 16 });
  const fresh = g.seats[0];
  fresh.cards[0].claimed = [];
  assert.strictEqual(closest(fresh.cards[0], 'frame').need, 16);
});

test('a square pays the power meter once, however often it is marked again (Nov 9 2026)', () => {
  const g = newBingo({ callers: ['birch'], rand: seeded(7) });
  const seat = g.seats.find((s) => s.who === OWNER)!;
  const card = seat.cards[0];
  const n = card.numbers[0][0];
  g.deck = [n, ...g.deck.filter((d) => d !== n)];
  callNumber(g, { rand: seeded(1) });
  const before = seat.meter;
  daub(g, OWNER, 0, n);
  const after = seat.meter;
  undaub(g, OWNER, 0, n);
  daub(g, OWNER, 0, n);
  assert.equal(seat.meter, after);
  assert.notEqual(after, before);
});

test('the newer shapes: plus, stamp, diamond, letter T and L, little frame (Nov 9 2026)', () => {
  const size = (p: Parameters<typeof patternInstances>[0]) => patternInstances(p).map((i) => i.cells.length);
  assert.deepEqual(size('plus'), [9]);
  assert.deepEqual(size('stamp'), [4, 4, 4, 4]);
  assert.deepEqual(size('diamond'), [8]);
  assert.deepEqual(size('tee'), [9]);
  assert.deepEqual(size('ell'), [9]);
  assert.deepEqual(size('inner'), [8]);
  assert.ok(!patternInstances('inner')[0].cells.some(([r, c]) => r === 2 && c === 2));
});
