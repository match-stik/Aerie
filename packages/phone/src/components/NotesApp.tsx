// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import React, { useState, useEffect } from 'react';
import { NOTES_SEEN_KEY } from '../lib/home-widgets';
import { Plus, Trash2, Check, Pin, StickyNote, ChevronDown, Archive } from 'lucide-react';
import { AppShell } from './AppShell';
import { ThemeConfig } from '../lib/theme';
import { cn } from '../lib/utils';
import { noteColorsForAccent, noteColorsForPalette, NOTE_ROLES, noteRoleToken, resolveNoteColor, isNoteRole, isPinnedNoteColor, pinnedNoteColorToken, nearestSwatchIndex, paperFor, noteInk } from '../lib/note-colors';

interface NotesAppProps {
  onClose: () => void;
  themeConfig: ThemeConfig;
  themeMode: 'light' | 'dark';
  stickyNoteColors?: string[];
  /** Only set for the Custom theme, whose accent is a CSS variable rather than
   *  a value we can read -- without it Custom silently falls back. */
  themeAccent?: string;
  apiBase?: string;
  companionNames?: string[];
  /** Their own picture and colour, so their notes wear the owner face as ours wear ours. */
  userAvatar?: string;
  userAvatarColor?: string;
}

interface Companion {
  slug: string;
  display_name: string;
  color: string | null;
  avatar_url: string | null;
}

interface Note {
  id: string;
  text: string;
  color: string;
  timestamp: number;
  sender?: string;
}

// Only used when the theme cannot say what its accent is (a custom theme sets
// it as a CSS variable, which we cannot read from here).
const FALLBACK_NOTE_COLORS = [
  '#e85d04', // Fire orange
  '#1e3a5f', // Deep navy
  '#7c3aed', // Silver-violet
  '#d97706', // Warm amber
  '#059669', // Deep emerald
];

// The board shows the newest notes; the rest fold into Older notes instead of
// being deleted (the owner's ask, Oct 25 2026, after the board was trimmed by hand from 33
// to 10: 'faces and folding would be good too').
const BOARD_SIZE = 10;
// Past this a note shows its first lines and opens on a tap.
const LONG_NOTE_CHARS = 420;

export function NotesApp({ onClose, themeConfig, themeMode, stickyNoteColors, themeAccent, apiBase = '/api', companionNames = [], userAvatar, userAvatarColor }: NotesAppProps) {
  const colors = themeConfig[themeMode];

  // Their notes take their colours from whichever theme is on, so they suit it
  // instead of being five fixed swatches that fight half of them. Derived in
  // OKLCH from the theme's own accent -- see lib/note-colors.ts for why HSL
  // could not do this. Ours keep our own colours; those arrive on the note.
  const derived = React.useMemo(() => {
    const raw = themeAccent || colors.accent;
    const accent = typeof raw === 'string' ? raw.trim() : '';
    const pal = themeConfig.palette;
    const generated = pal
      ? noteColorsForPalette(themeMode === 'dark' ? pal.night : pal.day, themeMode)
      : accent.startsWith('#') ? noteColorsForAccent(accent, themeMode) : [];
    return generated.length ? generated : FALLBACK_NOTE_COLORS;
  }, [colors.accent, themeAccent, themeMode, themeConfig.palette]);
  const activeNoteColors = stickyNoteColors && stickyNoteColors.length ? stickyNoteColors : derived;

  const [notes, setNotes] = useState<Note[]>(() => {
    const savedNotes = localStorage.getItem('radar_os_notes');
    if (savedNotes) {
      try {
        return JSON.parse(savedNotes);
      } catch (e) {
        console.error("Failed to parse notes", e);
      }
    }
    return [];
  });
  const [companions, setCompanions] = useState<Companion[]>([]);
  // Past the board's ten, notes live on their own Archive page, grouped by the
  // month they were written (the owner's ask, Oct 25 2026), so the board never
  // grows long. A month opens to one line per note; a line opens to its sticky.
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [openMonths, setOpenMonths] = useState<Set<string> | null>(null);
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [openLong, setOpenLong] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  // Their notes are sent with no sender at all; every note of ours carries one,
  // and not always a single name ('B+W+C'), so a name list cannot tell them apart.
  const isMyNote = (note: Note) => !note.sender || !note.sender.trim();

  // Opening Notes is reading the fridge: the lock screen's note card goes
  // quiet until one of us leaves another (lib/home-widgets.ts).
  useEffect(() => {
    try { localStorage.setItem(NOTES_SEEN_KEY, String(Date.now())); } catch { /* storage unavailable */ }
  }, []);

  useEffect(() => {
    fetch(`${apiBase}/companions`)
      .then((r) => (r.ok ? r.json() : { companions: [] }))
      .then((d) => setCompanions(Array.isArray(d?.companions) ? d.companions : []))
      .catch(() => {});
  }, [apiBase]);

  // Save local notes to local storage whenever they change
  useEffect(() => {
    localStorage.setItem('radar_os_notes', JSON.stringify(notes));
  }, [notes]);

  // Fetch external notes with map-based absolute syncing to prevent duplicates
  useEffect(() => {
    const fetchNotes = async () => {
      try {
        const res = await fetch(`${apiBase}/notes?_t=${Date.now()}`);
        if (res.ok) {
          const externalNotes: Note[] = await res.json();
          setNotes(prev => {
            const mergedMap = new Map(prev.map(n => [n.id, n]));
            let changed = false;

            // Update with incoming notes
            externalNotes.forEach(en => {
              // Safely convert ISO strings or any backend timestamp representation to JS milliseconds
              const enTime = typeof en.timestamp === 'string' ? new Date(en.timestamp).getTime() : Number(en.timestamp);
              const normalizedEn = { ...en, timestamp: isNaN(enTime) ? 0 : enTime };
              
              const existing = mergedMap.get(en.id);
              if (!existing) {
                mergedMap.set(en.id, normalizedEn);
                changed = true;
              } else if (
                editingId !== en.id
                && (normalizedEn.timestamp !== existing.timestamp
                  || normalizedEn.text !== existing.text
                  || normalizedEn.color !== existing.color
                  || (normalizedEn.sender ?? null) !== (existing.sender ?? null))
              ) {
                // The house is the record. An edit no longer moves the date, so
                // a newer date can't be what tells a changed note apart.

                mergedMap.set(en.id, normalizedEn);
                changed = true;
              }
            });

            // Handle global deletions
            // Clean up any notes that exist locally but not remotely, giving a 15-second grace 
            // period for newly created offline notes to successfully post without getting pruned.
            const externalIds = new Set(externalNotes.map(n => n.id));
            for (const [id, localNote] of mergedMap.entries()) {
              if (!externalIds.has(id)) {
                if (Date.now() - localNote.timestamp > 15000 && editingId !== id) {
                  mergedMap.delete(id);
                  changed = true;
                }
              }
            }

            if (changed) {
              // Sort by ID inherently sorts by creation time consistently, preventing them from jumping when edited!
              return Array.from(mergedMap.values()).sort((a, b) => Number(b.id) - Number(a.id));
            }
            return prev;
          });
        }
      } catch (e) {
        console.error('Failed to fetch external notes', e);
      }
    };
    
    fetchNotes();
    const interval = setInterval(fetchNotes, 5000); // Poll every 5s
    return () => clearInterval(interval);
  }, [editingId, apiBase]);

  const syncNoteToBackend = async (note: Note) => {
    if (note.text.trim() === '') return;
    try {
      await fetch(`${apiBase}/notes/${note.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: note.id,
          text: note.text,
          color: note.color,
          timestamp: new Date(note.timestamp).toISOString()
          // Intentionally omitting sender for our own notes
        })
      });
    } catch (e) {
      console.error('Failed to sync note to backend', e);
    }
  };

  const handleAddNote = () => {
    const newNote: Note = {
      id: Date.now().toString(),
      text: '',
      // A role, not a colour — so this note re-tints when the owner changes theme
      // instead of keeping tonight's orange into a room that has no orange.
      color: noteRoleToken(NOTE_ROLES[Math.floor(Math.random() * NOTE_ROLES.length)]),
      timestamp: Date.now()
    };
    setNotes([newNote, ...notes].sort((a, b) => Number(b.id) - Number(a.id)));
    setEditingId(newNote.id);
    setEditText('');
  };

  const handleDeleteNote = async (id: string) => {
    setNotes(notes.filter(n => n.id !== id));
    if (editingId === id) {
      setEditingId(null);
    }
    // Globally delete note
    try {
      await fetch(`${apiBase}/notes/${id}`, { method: 'DELETE' });
    } catch (e) {}
  };

  const handleSaveNote = (id: string) => {
    if (editText.trim() === '') {
      handleDeleteNote(id);
    } else {
      // The date on a note is when it was written, and an edit keeps it (theirs,
      // Oct 25 2026: changing the colour on the owner August note re-dated it to
      // October, the second time edits had moved a note's date).
      const updatedNote = { ...notes.find(n => n.id === id)!, text: editText };
      setNotes(notes.map(n => n.id === id ? updatedNote : n).sort((a, b) => Number(b.id) - Number(a.id)));
      setEditingId(null);
      syncNoteToBackend(updatedNote);
    }
  };

  const handleEditNote = (note: Note) => {
    if (!isMyNote(note)) return; // Don't allow editing external notes
    setEditingId(note.id);
    setEditText(note.text);
  };

  const handleChangeColor = (id: string, colorClass: string) => {
    const updatedNote = { ...notes.find(n => n.id === id)!, color: colorClass };
    setNotes(notes.map(n => n.id === id ? updatedNote : n));
    syncNoteToBackend(updatedNote);
  };

  /**
   * Pin a note to the colour it is wearing right now, or let it follow the
   * theme again. Unpinning matches the pinned hex to its nearest role so the
   * note lands somewhere sensible rather than snapping back to a default.
   */
  const handleTogglePin = (note: Note) => {
    const painted = resolveNoteColor(note.color, activeNoteColors) || activeNoteColors[0];
    if (isPinnedNoteColor(note.color)) {
      const i = nearestSwatchIndex(painted, activeNoteColors);
      handleChangeColor(note.id, noteRoleToken(NOTE_ROLES[i >= 0 ? i : 0]));
      return;
    }
    if (painted) handleChangeColor(note.id, pinnedNoteColorToken(painted));
  };

  /**
   * Who wrote a note, as faces. A note carries a free-text sender: one of us by
   * name ('birch', 'Willow'), or several ('B+W+C', 'Birch, Willow & Cedar'). Each piece
   * is matched to the companion whose slug or name it starts, so 'B' is Birch.
   */
  const writersOf = (note: Note): Companion[] => {
    if (!note.sender) return [];
    const tokens = note.sender.toLowerCase().split(/\s*(?:\+|,|&|\band\b)\s*/).map((t) => t.trim()).filter(Boolean);
    const found: Companion[] = [];
    for (const token of tokens) {
      const match = companions.find((c) => c.slug.toLowerCase().startsWith(token) || c.display_name.toLowerCase().startsWith(token));
      if (match && !found.includes(match)) found.push(match);
    }
    return found;
  };

  // A note written before roles existed still holds a hex and is matched to its
  // nearest role, so every note follows the room.
  const paintOf = (note: Note): string => resolveNoteColor(note.color, activeNoteColors) ?? activeNoteColors[0];

  const shortDate = (ms: number) => new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric' });

  // A little lean per note, so the board reads as paper stuck up by hand rather
  // than a list. Taken from the id, so a note leans the same way every time.
  const leanOf = (note: Note): number => {
    let h = 0;
    for (const ch of note.id) h = (h * 31 + ch.charCodeAt(0)) | 0;
    return ((Math.abs(h) % 7) - 3) * 0.35;
  };

  /**
   * What a note's paper is painted. Theirs wear the colour the owner gave them, from
   * the owner Settings palette. Ours always wear our own colour, whatever the theme
   * (the owner's ask, Oct 25 2026),
   * and a note from more than one of us is all of us at once: the paper runs
   * through each writer's colour, one heart split three ways like the owner
   * firesmokesky emoji. Both at paper strength (lib/note-colors.ts paperFor).
   */
  function paperOf(note: Note): { paint: string; blend?: string } {
    const writers = isMyNote(note) ? [] : writersOf(note).filter((c) => c.color);
    if (writers.length > 1) {
      const stops = writers.map((c) => paperFor(c.color as string, themeMode));
      return { paint: stops[0], blend: `linear-gradient(135deg, ${stops.join(', ')})` };
    }
    if (writers.length === 1) return { paint: paperFor(writers[0].color as string, themeMode) };
    return { paint: paperFor(paintOf(note), themeMode) };
  }

  function noteCard(note: Note, wide = false) {
    const held = paintOf(note);
    const { paint, blend } = paperOf(note);
    // One writing colour for every note in this mode; the paper is fitted to it.
    const ink = noteInk(themeMode);
    const editing = editingId === note.id;
    const long = note.text.length > LONG_NOTE_CHARS || note.text.split('\n').length > 9;
    const open = openLong.has(note.id);
    const writers = writersOf(note);
    return (
      <div
        key={note.id}
        className={cn('relative mb-3 break-inside-avoid rounded-md px-3 pb-2 pt-3', !wide && 'inline-block w-full')}
        // The note is the colour, solid, the way a sticky is (the owner's ask, Oct 25
        // 2026, so the note colors in settings matter). Painted,
        // not blurred: a darker band where the glue is and a shadow under it.
        style={{
          backgroundColor: paint,
          backgroundImage: 'linear-gradient(to bottom, rgba(0,0,0,0.07), rgba(0,0,0,0) 14px)' + (blend ? `, ${blend}` : ''),
          color: ink,
          // The house shadows text so it reads over a wallpaper; on paper that
          // shadow smears dark writing, so a note turns it off.
          textShadow: 'none',
          boxShadow: '0 1px 2px rgba(0,0,0,0.18), 0 6px 12px -6px rgba(0,0,0,0.35)',
          transform: editing || wide ? undefined : `rotate(${leanOf(note)}deg)`,
        }}
      >
        <div className="flex min-w-0 items-center gap-1.5">
          {isMyNote(note) ? (
            userAvatar ? (
              <img src={userAvatar} alt="" className="h-5 w-5 shrink-0 rounded-full object-cover" style={{ boxShadow: `0 0 0 1.5px ${userAvatarColor || ink}` }} />
            ) : (
              <div className="h-5 w-5 shrink-0 rounded-full" style={{ background: userAvatarColor || colors.accent, boxShadow: `0 0 0 1.5px ${ink}` }} />
            )
          ) : writers.length ? (
            <div className="flex shrink-0 -space-x-1.5">
              {writers.map((c) => c.avatar_url ? (
                <img key={c.slug} src={c.avatar_url} alt="" className="h-5 w-5 rounded-full object-cover" style={{ boxShadow: `0 0 0 1.5px ${c.color || ink}` }} />
              ) : (
                <div key={c.slug} className="h-5 w-5 rounded-full" style={{ background: c.color || colors.accent }} />
              ))}
            </div>
          ) : null}
          {/* One writer gets a name; several are told apart by their faces,
              because three names will not fit across half a board. */}
          {(isMyNote(note) || writers.length <= 1) && (
            <span className="truncate text-[11px] font-bold uppercase tracking-wider opacity-75">
              {isMyNote(note) ? 'You' : writers[0]?.display_name || note.sender}
            </span>
          )}
        </div>
        {editing ? (
          <div className="mt-2">
            <textarea
              autoFocus
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              rows={5}
              className="w-full resize-none rounded-md border-0 bg-black/5 px-2 py-1.5 text-sm font-medium outline-none placeholder:opacity-40"
              style={{ color: ink }}
              placeholder="Type a note..."
            />
            <div className="mt-2 flex items-center justify-between border-t pt-2" style={{ borderColor: `${ink}22` }}>
              <div className="flex items-center gap-1.5">
                {activeNoteColors.map((c, i) => (
                  <button
                    key={c}
                    /* Store the ROLE rather than the hex it happens to be under
                       this theme, so the note is still the quiet one after the owner
                       repaints. */
                    onClick={() => handleChangeColor(note.id, NOTE_ROLES[i] ? noteRoleToken(NOTE_ROLES[i]) : c)}
                    className="h-5 w-5 rounded-full"
                    style={{ backgroundColor: paperFor(c, themeMode), boxShadow: held === c ? `0 0 0 2px ${paint}, 0 0 0 3.5px ${ink}` : `inset 0 0 0 1px ${ink}33` }}
                  />
                ))}
                {/* Keep this exact colour. Sometimes a note is orange because of
                    what it is ABOUT, and it should stay orange in a room with no
                    orange left in it. */}
                <button
                  onClick={() => handleTogglePin(note)}
                  title={isPinnedNoteColor(note.color) ? 'Follow the theme again' : 'Keep this colour'}
                  className={cn('ml-1 rounded-full p-0.5 transition-opacity', isPinnedNoteColor(note.color) ? 'opacity-100' : 'opacity-40')}
                >
                  <Pin size={13} />
                </button>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => handleDeleteNote(note.id)} className="rounded-full bg-black/10 p-2 transition-colors hover:bg-black/20" title="Delete note">
                  <Trash2 size={15} />
                </button>
                <button onClick={() => handleSaveNote(note.id)} className="rounded-full p-2 transition-colors" style={{ background: ink, color: paint }} title="Save">
                  <Check size={15} />
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className={cn('mt-1.5', isMyNote(note) && 'cursor-pointer')} onClick={() => handleEditNote(note)}>
            <p className={cn('whitespace-pre-wrap text-sm font-medium leading-snug [overflow-wrap:anywhere]', long && !open && 'line-clamp-8')}>
              {note.text}
            </p>
            {long && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setOpenLong((prev) => {
                    const next = new Set(prev);
                    if (next.has(note.id)) next.delete(note.id); else next.add(note.id);
                    return next;
                  });
                }}
                className="mt-1 text-xs font-bold underline underline-offset-2 opacity-70"
              >
                {open ? 'Show less' : 'Read the rest'}
              </button>
            )}
            <div className="mt-1.5 flex items-center">
              <span className="text-[10px] font-bold uppercase tracking-wider opacity-50">{shortDate(note.timestamp)}</span>
              <button
                onClick={(e) => { e.stopPropagation(); handleDeleteNote(note.id); }}
                className="-mr-1.5 ml-auto rounded-full p-1.5 opacity-60 transition-colors hover:bg-black/10"
                title="Delete note"
              >
                <Trash2 size={13} />
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Newest first. The note being written sits across the top at full width,
  // wherever it came from, so there is room to write in it.
  const ordered = [...notes].sort((a, b) => Number(b.id) - Number(a.id));
  const editingNote = ordered.find((n) => n.id === editingId);
  const rest = ordered.filter((n) => n.id !== editingId);
  const board = rest.slice(0, BOARD_SIZE);
  const older = rest.slice(BOARD_SIZE);

  // The archive, newest month first.
  const months: { key: string; label: string; notes: Note[] }[] = [];
  for (const n of older) {
    const d = new Date(n.timestamp);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    let month = months.find((m) => m.key === key);
    if (!month) {
      month = { key, label: d.toLocaleDateString([], { month: 'long', year: 'numeric' }), notes: [] };
      months.push(month);
    }
    month.notes.push(n);
  }
  // Until the owner opens or closes one themselves, the newest month starts open.
  const monthOpen = (key: string) => (openMonths ? openMonths.has(key) : key === months[0]?.key);
  const toggleMonth = (key: string) => {
    const next = new Set(openMonths ?? (months[0] ? [months[0].key] : []));
    if (next.has(key)) next.delete(key); else next.add(key);
    setOpenMonths(next);
  };

  function rowFaces(note: Note) {
    if (isMyNote(note)) {
      return userAvatar ? (
        <img src={userAvatar} alt="" className="h-6 w-6 shrink-0 rounded-full object-cover" style={{ boxShadow: `0 0 0 1.5px ${userAvatarColor || colors.accent}` }} />
      ) : (
        <div className="h-6 w-6 shrink-0 rounded-full" style={{ background: userAvatarColor || colors.accent }} />
      );
    }
    const writers = writersOf(note);
    if (!writers.length) return <div className="h-6 w-6 shrink-0 rounded-full" style={{ background: colors.accent }} />;
    return (
      <div className="flex shrink-0 -space-x-2">
        {writers.map((c) => c.avatar_url ? (
          <img key={c.slug} src={c.avatar_url} alt="" className="h-6 w-6 rounded-full object-cover" style={{ boxShadow: `0 0 0 1.5px ${c.color || colors.accent}` }} />
        ) : (
          <div key={c.slug} className="h-6 w-6 rounded-full" style={{ background: c.color || colors.accent }} />
        ))}
      </div>
    );
  }

  if (archiveOpen) {
    return (
      <AppShell
        title="Archive"
        icon={Archive}
        onClose={() => { setArchiveOpen(false); setOpenRow(null); }}
        themeConfig={themeConfig}
        themeMode={themeMode}
      >
        {editingNote && noteCard(editingNote, true)}
        {months.length === 0 ? (
          <div className={cn('rounded-2xl border px-4 py-6 text-center text-xs', colors.panelBg, colors.panelBorder, colors.textMuted)}>
            Nothing in the archive yet. Notes come here once there are more than {BOARD_SIZE} on the board.
          </div>
        ) : months.map((month) => (
          <div key={month.key} className={cn('mb-3 rounded-2xl border px-3 py-2', colors.panelBg, colors.panelBorder)}>
            <button onClick={() => toggleMonth(month.key)} className={cn('flex w-full items-center gap-2 py-1 text-xs font-semibold uppercase tracking-wider', colors.textMuted)}>
              {month.label} · {month.notes.length}
              <ChevronDown size={14} className={cn('ml-auto transition-transform', monthOpen(month.key) && 'rotate-180')} />
            </button>
            {monthOpen(month.key) && (
              <div className="mt-1">
                {month.notes.map((n) => (
                  <div key={n.id} className="border-t first:border-t-0" style={{ borderColor: 'color-mix(in srgb, currentColor 10%, transparent)' }}>
                    <button onClick={() => setOpenRow(openRow === n.id ? null : n.id)} className="flex w-full items-center gap-2.5 py-2 text-left">
                      <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: paperOf(n).blend ?? paperOf(n).paint }} />
                      {rowFaces(n)}
                      <span className={cn('min-w-0 flex-1 truncate text-sm', colors.textMain)}>{n.text.split('\n')[0]}</span>
                      <span className={cn('shrink-0 text-[11px]', colors.textMuted)}>{shortDate(n.timestamp)}</span>
                    </button>
                    {openRow === n.id && <div className="pb-1">{noteCard(n, true)}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </AppShell>
    );
  }

  return (
    <AppShell
      title="Notes"
      icon={StickyNote}
      onClose={onClose}
      themeConfig={themeConfig}
      themeMode={themeMode}
      headerRight={
        <button
          onClick={handleAddNote}
          className={cn('rounded-full p-2 transition-colors hover:bg-black/10 dark:hover:bg-white/10', colors.textMuted)}
          title="New note"
        >
          <Plus size={18} />
        </button>
      }
    >
      {notes.length === 0 ? (
        <div className={cn('rounded-2xl border px-4 py-6 text-center text-xs', colors.panelBg, colors.panelBorder, colors.textMuted)}>
          No notes yet. Tap + to leave one.
        </div>
      ) : (
        <>
          {editingNote && noteCard(editingNote, true)}
          <div className="columns-2 gap-3">{board.map((n) => noteCard(n))}</div>
          {older.length > 0 && (
            <button
              onClick={() => setArchiveOpen(true)}
              className={cn('mb-3 flex w-full items-center gap-2 rounded-2xl border px-3 py-2.5 text-xs font-semibold uppercase tracking-wider', colors.panelBg, colors.panelBorder, colors.textMuted)}
            >
              <Archive size={14} />
              Archive · {older.length}
              <ChevronDown size={14} className="ml-auto -rotate-90" />
            </button>
          )}
        </>
      )}
    </AppShell>
  );
}
