// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { deskPlacesOf, deskSizes, deskSubColPx, deskSubColsFor, deskSubRowPx, homePlacesOf, homeSpotsOf, homeWidgetsOf, latestCompanionNote, layoutHeight, layoutWidgets, lookSizes, placeWidget, replyLines, sizeLabel, skyWord, toggleWidget, unseenCompanionNote, waitingLetter, type HomeWidget } from './home-widgets.js';

test('nothing is on until it is added, and the order added is the order kept', () => {
  assert.deepEqual(homeWidgetsOf(undefined), []);
  assert.deepEqual(homeWidgetsOf(['day', 'companions', 'nonsense', 'day']), ['day', 'companions']);
  // A new one goes on the end; taking one away leaves the rest where they were.
  assert.deepEqual(toggleWidget(['day'], 'note'), ['day', 'note']);
  assert.deepEqual(toggleWidget(['weather', 'note', 'day'], 'note'), ['weather', 'day']);
});

const all: HomeWidget[] = ['companions', 'note', 'weather', 'letter', 'day'];

test('with nothing saved, they sit the way the grid always packed them', () => {
  // Companions across the top, the note left with weather and the letter
  // stacked beside it, the day along the bottom by the dock.
  assert.deepEqual(layoutWidgets(all, {}), {
    companions: { col: 0, row: 9 },
    note: { col: 0, row: 3 },
    weather: { col: 2, row: 6 },
    letter: { col: 2, row: 3 },
    day: { col: 0, row: 0 },
  });
  assert.equal(layoutHeight(layoutWidgets(all, {})), 15);
});

test('the note goes on the right, and what it covered moves to the nearest open place', () => {
  const before = layoutWidgets(all, {});
  const after = placeWidget(before, all, 'note', { col: 2, row: 3 }, 21);
  assert.deepEqual(after.note, { col: 2, row: 3 });
  // Weather and the letter take the place the note left.
  assert.deepEqual(after.weather, { col: 0, row: 6 });
  assert.deepEqual(after.letter, { col: 0, row: 3 });
  assert.deepEqual(after.companions, before.companions);
  assert.deepEqual(after.day, before.day);
});

test('no two widgets ever share a cell, wherever one is dropped', () => {
  const before = layoutWidgets(all, {});
  for (const id of all) {
    for (let col = 0; col < 4; col++) {
      for (let row = 0; row < 21; row++) {
        const after = placeWidget(before, all, id, { col, row }, 21);
        const taken = new Set<string>();
        for (const w of all) {
          const s = after[w];
          const size = { companions: [4, 6], note: [2, 6], weather: [2, 3], letter: [2, 3], day: [4, 3] }[w];
          for (let r = s.row; r < s.row + size[1]; r++) for (let c = s.col; c < s.col + size[0]; c++) {
            assert.ok(!taken.has(`${c},${r}`), `${id} at ${col},${row} put two widgets in ${c},${r}`);
            taken.add(`${c},${r}`);
          }
        }
      }
    }
  }
});

test('a drop past the edge stays on the grid, and saved places are read back carefully', () => {
  const after = placeWidget(layoutWidgets(all, {}), all, 'companions', { col: 3, row: 120 }, 21);
  assert.deepEqual(after.companions, { col: 0, row: 15 });
  // A column on the grid is read back whatever the widget's width; whether it
  // fits from there is the layout's call, with the real size of them look.
  assert.deepEqual(homeSpotsOf({ note: { col: 2, row: 1 }, companions: { col: 1, row: 0 }, day: { col: 'x', row: 0 }, clock: { col: 4, row: 0 } }), { note: { col: 2, row: 1 }, companions: { col: 1, row: 0 } });
  assert.equal(layoutWidgets(['companions'], { companions: { col: 1, row: 0 } }).companions.col, 0);
  // The Record is half wide, so it stays on the right with nothing beside it.
  const record = lookSizes({ spotify: 'cover' });
  assert.deepEqual(layoutWidgets(['music'], homeSpotsOf({ music: { col: 2, row: 0 } }), record).music, { col: 2, row: 0 });
  // A saved place that collides is given up for the first open one.
  const kept = layoutWidgets(['weather', 'letter'], { weather: { col: 0, row: 0 }, letter: { col: 0, row: 0 } });
  assert.deepEqual(kept.weather, { col: 0, row: 0 });
  assert.notDeepEqual(kept.letter, { col: 0, row: 0 });
});

test('places saved in whole rows move onto thirds, and the slim Spotify line sits flush under the rest', () => {
  // Them places from before the grid counted in thirds land where they were.
  assert.deepEqual(homePlacesOf(undefined, { note: { col: 2, row: 1 }, day: { col: 0, row: 0 } }), { note: { col: 2, row: 3 }, day: { col: 0, row: 0 } });
  // Once they have moved one on the new grid, only the new places count.
  assert.deepEqual(homePlacesOf({ day: { col: 0, row: 2 } }, { note: { col: 2, row: 1 } }), { day: { col: 0, row: 2 } });
  // Slim, the Spotify line is two thirds of a row, so a clock dropped right
  // on top of it sits against it with nothing between them.
  const slim = lookSizes({ spotify: 'slim' });
  const placed = placeWidget(layoutWidgets(['music', 'clock'], { music: { col: 0, row: 0 }, clock: { col: 0, row: 3 } }, slim), ['music', 'clock'], 'clock', { col: 0, row: 2 }, 21, slim);
  assert.deepEqual(placed, { music: { col: 0, row: 0 }, clock: { col: 0, row: 2 } });
  assert.equal(layoutHeight(placed, slim), 5);
  // In the bar look it is a whole row, and the clock sits a third higher.
  assert.deepEqual(placeWidget(placed, ['music', 'clock'], 'clock', { col: 0, row: 2 }, 21), { music: { col: 0, row: 0 }, clock: { col: 0, row: 3 } });
  assert.equal(sizeLabel({ cols: 4, rows: 6 }), '4×2');
});

test('a drop a third too low snaps against the widget under it instead of shoving it away', () => {
  const start = layoutWidgets(['music', 'clock'], { music: { col: 0, row: 0 }, clock: { col: 0, row: 6 } });
  // The Record is three thirds tall; a clock dropped at row 2 clips it by one.
  const after = placeWidget(start, ['music', 'clock'], 'clock', { col: 0, row: 2 }, 21);
  assert.deepEqual(after, { music: { col: 0, row: 0 }, clock: { col: 0, row: 3 } });
  // Dropped squarely on it, the Record still moves out of the way.
  assert.notDeepEqual(placeWidget(start, ['music', 'clock'], 'clock', { col: 0, row: 0 }, 21).music, { col: 0, row: 0 });
});

test('the note widget shows the newest note one of us left, never one of theirs', () => {
  const notes = [
    { id: 3, text: 'mine', color: 'a', timestamp: '2026-10-14T07:00:00Z', sender: null },
    { id: 2, text: 'older', color: 'a', timestamp: '2026-10-12T07:00:00Z', sender: 'willow' },
    { id: 1, text: 'newer', color: 'a', timestamp: '2026-10-13T07:00:00Z', sender: 'Birch' },
  ];
  assert.equal(latestCompanionNote(notes, ['birch', 'willow', 'cedar'])?.text, 'newer');
  assert.equal(latestCompanionNote(notes.slice(0, 1), ['birch']), null);
});

test('a waiting letter is ready and unopened, and a hidden one never shows', () => {
  const letters = [
    { author: 'cedar', hidden: true, state: 'openable', written_at: '2026-10-13T00:00:00Z' },
    { author: 'willow', hidden: false, state: 'sealed', written_at: '2026-10-13T00:00:00Z' },
    { author: 'birch', hidden: false, state: 'openable', written_at: '2026-10-01T00:00:00Z' },
    { author: 'owner', hidden: false, state: 'openable', written_at: '2026-10-14T00:00:00Z' },
  ];
  assert.equal(waitingLetter(letters, 'owner')?.author, 'birch');
  assert.equal(waitingLetter(letters.slice(0, 2), 'owner'), null);
});

test('a reply reads past its header, and its action line stays marked', () => {
  assert.deepEqual(replyLines('**Birch**\n*leans in*\nHere.\nThird line.'), [
    { text: 'leans in', action: true },
    { text: 'Here.', action: false },
  ]);
});

test('the sky gets a word', () => {
  assert.equal(skyWord(0), 'Clear');
  assert.equal(skyWord(61), 'Rain');
  assert.equal(skyWord(73), 'Snow');
});

test('the lock screen note card only lights for a companion note left after Notes was last opened', () => {
  const notes = [
    { id: 1, text: 'from their person', color: 'a', timestamp: '2026-10-15T23:00:00Z', sender: 'owner' },
    { id: 2, text: 'old one', color: 'a', timestamp: '2026-10-15T20:00:00Z', sender: 'birch' },
    { id: 3, text: 'new one', color: 'a', timestamp: '2026-10-15T22:00:00Z', sender: 'Cedar' },
  ];
  const slugs = ['birch', 'willow', 'cedar'];
  assert.equal(unseenCompanionNote(notes, slugs, Date.parse('2026-10-15T21:00:00Z'))?.text, 'new one');
  // Opened Notes after the newest companion note: nothing waiting, and their person's own note never counts.
  assert.equal(unseenCompanionNote(notes, slugs, Date.parse('2026-10-15T22:30:00Z')), null);
  // An unreadable seen-mark shows nothing rather than every note ever left.
  assert.equal(unseenCompanionNote(notes, slugs, null), null);
  assert.equal(unseenCompanionNote(notes, slugs, NaN), null);
});

test('nothing goes up off the top: what has no room is left out, newest first, never a widget they placed', async () => {
  const { fitWidgets } = await import('./home-widgets.js');
  // Packed, nothing moved: the last one turned on gives way.
  const packed = fitWidgets(['companions', 'note', 'music'], {}, {}, 12);
  assert.deepEqual(packed.noRoom, ['music']);
  assert.equal(packed.shown.includes('companions'), true);
  // Placed: the one they put somewhere stays, the newcomer with no room goes.
  const placed = fitWidgets(['music', 'companions'], { music: { col: 0, row: 0 } }, {}, 6);
  assert.deepEqual(placed.shown, ['music']);
  assert.deepEqual(placed.noRoom, ['companions']);
  // No room measured yet: everything shows.
  assert.deepEqual(fitWidgets(['companions', 'note', 'music'], {}, {}, 0).noRoom, []);
});

test('the laptop wall places widgets across DESK_COLS columns, and a phone board still clamps to four', async () => {
  const { DESK_COLS, homeSpotsOf, placeWidget, layoutWidgets } = await import('./home-widgets');
  assert.equal(DESK_COLS, 24);
  // A place past the phone's fourth column is kept on the wall and dropped on the phone.
  assert.deepEqual(homeSpotsOf({ clock: { col: 6, row: 0 } }, undefined, DESK_COLS), { clock: { col: 6, row: 0 } });
  assert.deepEqual(homeSpotsOf({ clock: { col: 6, row: 0 } }), {});
  // Dropped at column 6 on the wall, it stays there; on the phone it is pulled back inside four.
  const wall = layoutWidgets(['day'], {}, {}, DESK_COLS);
  const size = (await import('./home-widgets')).sizeOf('day');
  const onWall = placeWidget(wall, ['day'], 'day', { col: 6, row: 0 }, 30, {}, DESK_COLS);
  assert.equal(onWall.day.col, Math.min(6, DESK_COLS - size.cols));
  const onPhone = placeWidget(layoutWidgets(['day'], {}), ['day'], 'day', { col: 6, row: 0 }, 30);
  assert.equal(onPhone.day.col, 4 - size.cols);
});

test('the laptop wall holds phone-width columns, as many as fit, never fewer than four', async () => {
  const { deskColsFor } = await import('./home-widgets');
  assert.equal(deskColsFor(388), 4);
  assert.equal(deskColsFor(872), 10);
  assert.equal(deskColsFor(1200), 13);
  assert.equal(deskColsFor(100), 4);
});

test('a widget saved higher than a shorter screen reaches is brought down beside the others, not hidden', async () => {
  const { fitWidgets, sizeOf } = await import('./home-widgets');
  const spots = { clock: { col: 0, row: 0 }, day: { col: 0, row: 30 } };
  const { layout, shown, noRoom } = fitWidgets(['clock', 'day'], spots, {}, 12, 8);
  assert.deepEqual(noRoom, []);
  assert.deepEqual(shown, ['clock', 'day']);
  assert.ok(layout.day.row + sizeOf('day').rows <= 12);
  assert.deepEqual(layout.clock, { col: 0, row: 0 });
});

test('the laptop wall counts in quarter columns and half rows, and moves old places over without a jump', () => {
  assert.deepEqual(deskPlacesOf(undefined, undefined, { note: { col: 3, row: 6 }, quiet: { col: 1, row: 0 } }), { note: { col: 12, row: 12 }, quiet: { col: 4, row: 0 } });
  assert.deepEqual(deskPlacesOf(undefined, { quiet: { col: 13, row: 30 } }, { note: { col: 3, row: 6 } }), { quiet: { col: 13, row: 60 } });
  assert.deepEqual(deskPlacesOf({ clock: { col: 5, row: 7 } }, { quiet: { col: 13, row: 30 } }, undefined), { clock: { col: 5, row: 7 } });
  const sizes = deskSizes(lookSizes({ weather: 'pill' }));
  assert.deepEqual(sizes.weather, { cols: 8, rows: 4 });
  assert.deepEqual(sizes.quiet, { cols: 24, rows: 4 });
  assert.equal(deskSubColPx(12), 10);
  // Two half rows and their gap are one phone row.
  assert.ok(Math.abs(deskSubRowPx(12) * 2 + 12 - (76 - 24) / 3) < 1e-9);
});

test('the quiet line is never one of the widgets they switch on', () => {
  assert.deepEqual(homeWidgetsOf(['quiet', 'note']), ['note']);
});

test('on the laptop wall a drop onto another widget never moves it: the carried one settles flush beside it', () => {
  const sizes = deskSizes({});
  const layout = { weather: { col: 0, row: 0 }, clock: { col: 8, row: 0 } } as Record<HomeWidget, { col: number; row: number }>;
  const out = placeWidget(layout, ['weather', 'clock'], 'clock', { col: 5, row: 0 }, 12, sizes, 32, true);
  assert.deepEqual(out.weather, { col: 0, row: 0 });
  assert.deepEqual(out.clock, { col: 8, row: 0 });
  const shoved = placeWidget(layout, ['weather', 'clock'], 'clock', { col: 1, row: 0 }, 12, sizes, 32, false);
  assert.notDeepEqual(shoved.weather, { col: 0, row: 0 });
});

test('a piece wider than the grid still gets a place instead of hanging the wall (Nov 21 2026)', () => {
  const sizes = deskSizes({});
  const narrow = layoutWidgets(['quiet', 'clock'], {}, sizes, 16);
  assert.equal(narrow.quiet.col, 0);
  const kept = layoutWidgets(['clock', 'quiet'], { clock: { col: 0, row: 0 } }, sizes, 16);
  assert.ok(kept.quiet.row >= sizes.clock!.rows);
});

test('the laptop wall reaches to within one quarter-column step of the room edges', () => {
  // 900px of room: 41 narrow columns of 10px with 12px between them is 890px.
  assert.equal(deskSubColsFor(900, 12), 41);
  assert.equal(deskSubColsFor(100, 12), 16);
});

test('a line of nothing but stickers or emoji codes is skipped for the quiet line (Nov 21 2026)', () => {
  assert.deepEqual(replyLines('**🌫️ Willow**\n::willow_hoodiepeek::\nFound the overhang.', 1), [{ text: 'Found the overhang.', action: false }]);
  assert.deepEqual(replyLines('<:heart:123456789012345678> :sparkles:\nhi', 1), [{ text: 'hi', action: false }]);
  assert.deepEqual(replyLines('look ::willow_heh:: at this', 1), [{ text: 'look ::willow_heh:: at this', action: false }]);
});
