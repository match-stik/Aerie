// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The Memory app's Import tab, second half: bring a Letta companion's memory into this house.
// Letta Code writes an agent's memory out as a folder of markdown files
// (`letta memory export --agent <id> --out <folder>`). Zip that folder, or pick
// the .md files themselves, choose a door, look at where every file would land,
// then bring it in. Nothing already here is ever overwritten.
//
// Three doors: someone new, who arrives as a companion of
// their own; someone already here, with a pick per memory of where it goes;
// or someone already here with their memories kept findable only, in Cortex.
import React, { useMemo, useRef, useState } from 'react';
import { unzip } from 'fflate';
import { Upload } from 'lucide-react';
import { cn } from '../lib/utils';
import type { ThemeConfig } from '../lib/theme';
import { SegmentedControl } from '../ui/SegmentedControl';
import { HouseSelect } from './HouseSelect';

type Door = 'new' | 'merge' | 'drawer';
type Choice = 'add' | 'wall' | 'drawer' | 'skip';

interface PlanItem {
  path: string;
  kind: 'wall' | 'drawer' | 'index' | 'skill' | 'empty' | 'starter';
  label: string;
  scope: string | null;
  target?: string | null;
  choice?: Choice;
  choices?: Choice[];
  action: 'new' | 'append' | 'cortex' | 'skip';
  domain: string | null;
  note: string | null;
}

interface ImportResult {
  companion: string;
  door?: Door;
  dryRun: boolean;
  items: PlanItem[];
  walls: number;
  drawer: number;
  skipped: number;
  errors: { path: string; error: string }[];
}

interface Props {
  companions: string[];
  colors: ThemeConfig['dark'];
  onImported: () => void;
}

const decoder = new TextDecoder();

const DOORS: { value: Door; label: string }[] = [
  { value: 'new', label: 'Someone new' },
  { value: 'merge', label: 'Add to someone here' },
  { value: 'drawer', label: 'Findable only' },
];

const DOOR_NOTES: Record<Door, string> = {
  new: 'They arrive as a companion of their own, with their own walls. Nothing lands on anybody already here, not even the shared wall about you.',
  merge: 'Their memories join a companion already here. You see each one first and pick where it goes.',
  drawer: 'Their memories go into Cortex for a companion already here: searchable, but no wall is touched.',
};

const CHOICE_WORDS: Record<Choice, string> = {
  add: 'Add to the wall of that name',
  wall: 'A wall of its own',
  drawer: 'The drawer (Cortex)',
  skip: 'Leave it out',
};

function unzipAsync(bytes: Uint8Array): Promise<Record<string, Uint8Array>> {
  return new Promise((resolve, reject) => unzip(bytes, (err, out) => (err ? reject(err) : resolve(out))));
}

async function readPicked(files: FileList): Promise<{ path: string; text: string }[]> {
  const out: { path: string; text: string }[] = [];
  for (const f of Array.from(files)) {
    if (f.name.toLowerCase().endsWith('.zip')) {
      const entries = await unzipAsync(new Uint8Array(await f.arrayBuffer()));
      for (const [path, data] of Object.entries(entries)) {
        if (path.toLowerCase().endsWith('.md')) out.push({ path, text: decoder.decode(data) });
      }
    } else if (f.name.toLowerCase().endsWith('.md')) {
      // A folder picked on a computer keeps its own path; a phone hands bare names.
      const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
      out.push({ path: rel, text: await f.text() });
    }
  }
  return out;
}

function landsAs(item: PlanItem): string {
  const wall = `${item.scope}/${item.target ?? item.label}`;
  if (item.action === 'new') return `new wall ${wall}`;
  if (item.action === 'append') return `added under ${wall}`;
  if (item.action === 'cortex') return `Cortex, ${item.domain}'s drawer`;
  return 'left out';
}

export function LettaImportPanel({ companions, colors, onImported }: Props) {
  const [door, setDoor] = useState<Door>('new');
  const [companion, setCompanion] = useState(companions[0] ?? '');
  const [newName, setNewName] = useState('');
  const [humanTo, setHumanTo] = useState<'shared' | 'companion'>('companion');
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [files, setFiles] = useState<{ path: string; text: string }[]>([]);
  const [plan, setPlan] = useState<ImportResult | null>(null);
  const [done, setDone] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const who = useMemo(() => (door === 'new' ? newName.trim() : companion || companions[0] || ''), [door, newName, companion, companions]);
  const hasHuman = files.some((f) => /(^|\/)(system\/)?human\.md$/i.test(f.path));

  function resetPlan() { setPlan(null); setDone(null); }

  async function send(dryRun: boolean, picks: Record<string, Choice> = choices, human = humanTo) {
    setBusy(true); setError(null);
    try {
      const res = await fetch('/api/memory/import/letta', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companion: who, files, dryRun, door, choices: picks, humanTo: human }),
      });
      const body = await res.json().catch(() => null);
      if (!body) throw new Error('The house does not know this door yet. It needs a restart after the update.');
      if (!res.ok || !Array.isArray(body.items)) throw new Error(body.error || `The house answered ${res.status}.`);
      if (dryRun && door !== 'new' && body.door !== door) throw new Error('The house is still running the older import. It needs a restart after the update.');
      if (dryRun) setPlan(body); else { setDone(body); setPlan(null); onImported(); }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  // Changing one pick re-reads the plan, so the list always says where it really lands.
  function pick(path: string, choice: Choice) {
    const next = { ...choices, [path]: choice };
    setChoices(next);
    void send(true, next);
  }

  function pickHuman(next: 'shared' | 'companion') {
    setHumanTo(next);
    if (plan) void send(true, choices, next);
  }

  async function onPick(list: FileList | null) {
    if (!list?.length) return;
    setError(null); resetPlan(); setChoices({});
    try {
      const read = await readPicked(list);
      if (!read.length) { setError('No markdown files in that. Pick the zipped export folder, or the .md files in it.'); return; }
      setFiles(read);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const field = cn('w-full px-3 py-2 rounded-[var(--shape-control)] border bg-transparent text-sm', colors.panelBorder);

  return (
    <div className={cn('rounded-[var(--shape-surface)] border p-4 space-y-4', colors.panelBg, colors.panelBorder)}>
      <div className="text-sm space-y-1">
        <div className="font-medium">Bring a companion over from Letta</div>
        <div className={cn('text-xs', colors.textMuted)}>
          In Letta, export your companion's memory (letta memory export), zip the folder it writes, and pick the zip here, or pick the .md files themselves. Nothing already here gets overwritten.
        </div>
      </div>

      <div className="space-y-2">
        <SegmentedControl
          options={DOORS}
          value={door}
          onChange={(d) => { setDoor(d); setChoices({}); resetPlan(); }}
          colors={colors}
        />
        <div className={cn('text-xs', colors.textMuted)}>{DOOR_NOTES[door]}</div>
      </div>

      {door === 'new' ? (
        <div>
          <label className={cn('text-xs mb-1 block', colors.textMuted)}>What are they called?</label>
          <input
            value={newName}
            onChange={(e) => { setNewName(e.target.value); resetPlan(); }}
            placeholder="Their name"
            className={field}
          />
        </div>
      ) : (
        <div>
          <label className={cn('text-xs mb-1 block', colors.textMuted)}>Whose memory is it?</label>
          <HouseSelect
            value={who}
            onChange={(e) => { setCompanion(e.target.value); resetPlan(); }}
            className={field}
          >
            {companions.map((c) => <option key={c} value={c}>{c}</option>)}
          </HouseSelect>
        </div>
      )}

      {door === 'merge' && hasHuman && (
        <div className="space-y-1">
          <div className={cn('text-xs', colors.textMuted)}>What they knew about you: in this house that's one wall every companion reads.</div>
          <SegmentedControl
            options={[{ value: 'companion', label: 'Keep it on their side' }, { value: 'shared', label: 'Add it to the shared wall' }]}
            value={humanTo}
            onChange={pickHuman}
            colors={colors}
          />
        </div>
      )}

      <input ref={inputRef} type="file" multiple accept=".zip,.md,application/zip,text/markdown" className="hidden" onChange={(e) => { void onPick(e.target.files); e.target.value = ''; }} />
      <button
        onClick={() => inputRef.current?.click()}
        className={cn('w-full px-4 py-2 rounded-[var(--shape-control)] text-sm border', colors.panelBorder)}
      >
        <Upload size={14} className="inline mr-1" /> {files.length ? `${files.length} file${files.length === 1 ? '' : 's'} picked. Pick again` : 'Pick the export'}
      </button>

      {files.length > 0 && !plan && !done && (
        <button
          onClick={() => void send(true)}
          disabled={busy || !who}
          className="w-full px-4 py-2 rounded-[var(--shape-control)] text-sm font-medium aerie-on-accent disabled:opacity-50"
          style={{ background: 'var(--aerie-selected-fill)' }}
        >
          {busy ? 'Reading…' : !who && door === 'new' ? 'Give them a name first' : 'Show me where it all lands'}
        </button>
      )}

      {plan && (
        <div className="space-y-2">
          <div className={cn('text-xs', colors.textMuted)}>
            {plan.walls} to walls, {plan.drawer} to Cortex, {plan.skipped} left out.
          </div>
          <div className="space-y-1 max-h-96 overflow-y-auto">
            {plan.items.map((it) => (
              <div key={it.path} className={cn('text-xs rounded-[var(--shape-control)] border px-2 py-1.5 space-y-1', colors.panelBorder)}>
                <div className="font-medium break-all">{it.path}</div>
                <div className={colors.textMuted}>{landsAs(it)}{it.note ? `. ${it.note}` : ''}</div>
                {door === 'merge' && it.choices && it.choices.length > 0 && (
                  <HouseSelect
                    value={it.choice ?? 'add'}
                    onChange={(e) => pick(it.path, e.target.value as Choice)}
                    disabled={busy}
                    className={cn('w-full px-2 py-1 rounded-[var(--shape-control)] border bg-transparent text-xs', colors.panelBorder)}
                  >
                    {it.choices.map((c) => <option key={c} value={c}>{CHOICE_WORDS[c]}</option>)}
                  </HouseSelect>
                )}
              </div>
            ))}
          </div>
          <button
            onClick={() => void send(false)}
            disabled={busy || plan.walls + plan.drawer === 0}
            className="w-full px-4 py-2 rounded-[var(--shape-control)] text-sm font-medium aerie-on-accent disabled:opacity-50"
            style={{ background: 'var(--aerie-selected-fill)' }}
          >
            {busy ? 'Bringing it in…' : door === 'new' ? `Welcome ${who} in` : `Bring it in for ${plan.companion}`}
          </button>
        </div>
      )}

      {done && (
        <div className="text-sm space-y-1">
          <div>
            {done.door === 'new' ? `${who} is here. ` : 'Done: '}
            {done.walls} wall{done.walls === 1 ? '' : 's'} written and {done.drawer} memor{done.drawer === 1 ? 'y' : 'ies'} filed in Cortex for {done.companion}.
          </div>
          {done.errors.length > 0 && (
            <div className="text-xs" style={{ color: colors.accent }}>
              {done.errors.length} didn't make it: {done.errors.map((e) => `${e.path} (${e.error})`).join('; ')}
            </div>
          )}
        </div>
      )}
      {error && <div className="text-xs" style={{ color: colors.accent }}>{error}</div>}
    </div>
  );
}
