// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Sticker as StickerIcon, RefreshCw, Loader2, Plus, Minus, Upload, Trash2, X, Check, Crop as CropIcon } from 'lucide-react';
import { AppShell } from './AppShell';
import { Paginator, usePaged } from './Paginator';
import { ThemeConfig, ThemeColors } from '../lib/theme';
import { cn } from '../lib/utils';
import { apiFetch } from '../aerie';
import Cropper from 'react-easy-crop';
import type { Area } from 'react-easy-crop';
import { useBackHandler } from '../lib/use-back-handler';

interface PacksAppProps {
  onClose: () => void;
  themeConfig: ThemeConfig;
  themeMode: 'light' | 'dark';
  // Called after a successful emoji mutation so App.tsx can re-sync the
  // composer's emoji picker cache without waiting for a reconnect.
  onEmojisChanged?: () => void;
}

interface Pack {
  id: string;
  name: string;
  description?: string | null;
}

interface Item {
  id: string;
  name: string;
  url: string;
  pack_id: string | null;
}

type Kind = 'stickers' | 'emojis';

// How big a copy the crop box keeps to work from. Cropping has to happen BEFORE
// the shrink to sticker size, or a crop just stretches 256 pixels back up and
// goes soft. Capped so a long batch of sheets is not every full photo in memory.
const CROP_SOURCE_MAX = 1024;

export function PacksApp({ onClose, themeConfig, themeMode, onEmojisChanged }: PacksAppProps) {
  const colors = themeConfig[themeMode];
  const [kind, setKind] = useState<Kind>('stickers');
  const [packs, setPacks] = useState<Pack[]>([]);
  // Twenty packs a page.
  const packsPage = usePaged(packs);
  const [items, setItems] = useState<Item[]>([]);
  const [selectedPack, setSelectedPack] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [newPackName, setNewPackName] = useState('');
  const [creating, setCreating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Files the user just picked, held until they confirm the names. Built
  // from the file input's onChange — picking doesn't upload immediately
  // anymore. Each row has its own draftName so the user can edit before
  // sending. Mirrors the Resonant frontend's pre-upload table.
  const [staged, setStaged] = useState<Array<{ blob: Blob; source: Blob; defaultName: string; draftName: string; previewUrl: string; cropArea?: Area }>>([]);
  // The crop box the user drives themselves, zoom and drag like Discord's. Holds the
  // picture being cropped and what to do with the result; null when closed.
  const [cropping, setCropping] = useState<{ src: string; label: string; onDone: (blob: Blob) => void; onClose?: () => void; onArea?: (area: Area) => void } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const base = `/api/${kind}`;

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [packsRes, itemsRes] = await Promise.all([apiFetch(`${base}/packs`), apiFetch(base)]);
      const loadedPacks: Pack[] = packsRes.ok ? await packsRes.json() : [];
      const loadedItems: Item[] = itemsRes.ok ? await itemsRes.json() : [];
      setPacks(loadedPacks);
      setItems(loadedItems);
      // Stay on the current pack if it still exists. Otherwise land on the
      // first real pack, falling back to the Unpacked virtual view (null)
      // when there are no real packs but legacy loose items exist.
      setSelectedPack((prev) => {
        if (prev && loadedPacks.some((p) => p.id === prev)) return prev;
        if (loadedPacks.length > 0) return loadedPacks[0].id;
        if (loadedItems.some((i) => i.pack_id === null)) return null;
        return null;
      });
    } catch {
      setError('Failed to load');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  async function createPack() {
    const name = newPackName.trim();
    if (!name) return;
    setCreating(true);
    try {
      const res = await apiFetch(`${base}/packs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        const pack = await res.json();
        setPacks((prev) => [...prev, pack]);
        setSelectedPack(pack.id);
        setNewPackName('');
      } else {
        setError((await res.json().catch(() => ({}))).error || 'Failed to create pack');
      }
    } finally {
      setCreating(false);
    }
  }

  async function deletePack(id: string) {
    const res = await apiFetch(`${base}/packs/${id}`, { method: 'DELETE' });
    if (res.ok) {
      setPacks((prev) => {
        const next = prev.filter((p) => p.id !== id);
        setSelectedPack((cur) => (cur === id ? next[0]?.id ?? null : cur));
        return next;
      });
      setItems((prev) => prev.filter((i) => i.pack_id !== id));
      if (kind === 'emojis') onEmojisChanged?.();
    }
  }

  // Stage picked files into the review table. The default name is just
  // the sanitised filename — the pack prefix gets prepended at upload
  // time (only for emojis, since their namespace is flat; stickers are
  // scoped by pack in the shortcode itself). Matches Resonant's manager.
  //
  // The bytes are BAKED HERE rather than at upload. A picked File is a handle
  // to something the operating system still owns, and on Android the read
  // grant behind it can lapse while a big batch is still being named — so the
  // decode that used to happen at upload time could fail for every file at
  // once, minutes after picking, with nothing on screen but one line per
  // sticker saying the image would not load. Resizing on the way in means the
  // page holds the actual pixels: a failure now names itself while the row is
  // still in front of you, and once a row is staged it WILL upload.
  async function stageFiles(files: FileList) {
    if (!selectedPack) return;
    const picked = Array.from(files);
    if (fileInput.current) fileInput.current.value = '';
    const unreadable: string[] = [];
    for (const file of picked) {
      const base = file.name.replace(/\.[^.]+$/, '').replace(/[^a-z0-9]/gi, '').toLowerCase();
      try {
        const blob = await resizeImage(file, kind === 'emojis' ? 192 : 256);
        // The crop box works from this bigger copy, so a crop is made before the shrink.
        const source = file.type === 'image/gif' ? blob : await resizeImage(file, CROP_SOURCE_MAX);
        setStaged((prev) => [...prev, {
          blob,
          source,
          defaultName: base,
          draftName: base,
          previewUrl: URL.createObjectURL(blob),
        }]);
      } catch {
        unreadable.push(base || file.name);
      }
    }
    if (unreadable.length) {
      setError(summarizeNames('Could not read', unreadable, 'try picking them again'));
    }
  }

  // One readable line out of a batch failure. Seventy-six names joined with
  // commas is not a message, it is a wall — and it can be the only thing on
  // screen when a whole pack fails to upload.
  function summarizeNames(prefix: string, names: string[], advice?: string): string {
    const shown = names.slice(0, 3).join(', ');
    const rest = names.length - 3;
    const body = rest > 0 ? `${shown} and ${rest} more` : shown;
    return `${prefix} ${names.length === 1 ? '' : `${names.length} `}${names.length === 1 ? 'file' : 'files'}: ${body}${advice ? ` — ${advice}` : ''}`;
  }

  // Resize on the client before upload to stay under the backend's per-
  // file caps and so users don't have to think about source resolution.
  // GIFs pass through untouched — canvas re-encoding would freeze them.
  async function resizeImage(file: File, maxSize: number): Promise<Blob> {
    if (file.type === 'image/gif') return file;
    return new Promise((resolve, reject) => {
      const img = new Image();
      // Seventy-six of these in one batch is seventy-six live object URLs if
      // nobody hands them back.
      const src = URL.createObjectURL(file);
      const done = <T,>(fn: (v: T) => void) => (v: T) => { URL.revokeObjectURL(src); fn(v); };
      const settle = { resolve: done(resolve), reject: done(reject) };
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let { width, height } = img;
        if (width > maxSize || height > maxSize) {
          if (width > height) {
            height = (height / width) * maxSize;
            width = maxSize;
          } else {
            width = (width / height) * maxSize;
            height = maxSize;
          }
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return settle.reject(new Error('Canvas context unavailable'));
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          (blob) => (blob ? settle.resolve(blob) : settle.reject(new Error('Resize failed'))),
          'image/webp',
          0.9,
        );
      };
      img.onerror = () => settle.reject(new Error('Image load failed'));
      img.src = src;
    });
  }

  function updateStagedName(idx: number, value: string) {
    setStaged((prev) => prev.map((s, i) => (i === idx ? { ...s, draftName: value } : s)));
  }

  function removeStaged(idx: number) {
    setStaged((prev) => {
      const dropped = prev[idx];
      if (dropped) URL.revokeObjectURL(dropped.previewUrl);
      return prev.filter((_, i) => i !== idx);
    });
  }

  function clearStaged() {
    setStaged((prev) => {
      for (const s of prev) URL.revokeObjectURL(s.previewUrl);
      return [];
    });
  }

  async function uploadStaged() {
    if (!selectedPack || staged.length === 0) return;
    setUploading(true);
    setError(null);
    const uploaded: Item[] = [];
    const errors: string[] = [];
    const packName = packs.find((p) => p.id === selectedPack)?.name || '';
    const packPrefix = packName.toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const row of staged) {
      const cleaned = row.draftName.trim().replace(/[^a-z0-9]/gi, '').toLowerCase();
      const localName = cleaned || row.defaultName;
      // Emojis live in a flat global namespace — prepend the pack name so
      // two packs can both have a "hug" without colliding. Stickers are
      // already scoped via ::pack_name:: at lookup time so they stay bare.
      const finalName = kind === 'emojis' && packPrefix ? `${packPrefix}_${localName}` : localName;
      try {
        // Already resized on the way in — the bytes are ours, not the OS's.
        const form = new FormData();
        form.append('file', new File([row.blob], `${finalName}.webp`, { type: row.blob.type || 'image/webp' }));
        form.append('packId', selectedPack);
        form.append('name', finalName);
        if (row.cropArea) {
          form.append('cropX', String(row.cropArea.x));
          form.append('cropY', String(row.cropArea.y));
          form.append('cropWidth', String(row.cropArea.width));
          form.append('cropHeight', String(row.cropArea.height));
        }
        const res = await apiFetch(base, { method: 'POST', body: form });
        if (res.ok) uploaded.push(await res.json());
        else errors.push(`${finalName} (${(await res.json().catch(() => ({}))).error || res.status})`);
      } catch (err) {
        errors.push(`${finalName} (${err instanceof Error ? err.message : 'failed'})`);
      }
    }
    setItems((prev) => [...prev, ...uploaded]);
    if (errors.length) setError(summarizeNames('Could not upload', errors));
    setUploading(false);
    clearStaged();
    if (kind === 'emojis' && uploaded.length > 0) onEmojisChanged?.();
  }

  async function deleteItem(id: string) {
    const res = await apiFetch(`${base}/${id}`, { method: 'DELETE' });
    if (res.ok) {
      setItems((prev) => prev.filter((i) => i.id !== id));
      if (kind === 'emojis') onEmojisChanged?.();
    }
  }

  // Inline rename — PATCHes the backend (stickers + emojis both support
  // { name } updates). The user is editing the full stored name here, so
  // underscores are allowed (emojis include the `<pack>_<name>` form).
  async function renameItem(id: string, raw: string) {
    const next = raw.replace(/[^a-z0-9_]/gi, '').toLowerCase();
    if (!next) return;
    const current = items.find((it) => it.id === id);
    if (!current || current.name === next) return;
    try {
      const res = await apiFetch(`${base}/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: next }),
      });
      if (res.ok) {
        const updated = await res.json().catch(() => null);
        setItems((prev) => prev.map((it) => (it.id === id ? { ...it, name: updated?.name || next } : it)));
        if (kind === 'emojis') onEmojisChanged?.();
      } else {
        const data = await res.json().catch(() => ({}));
        setError(`Rename failed: ${data.error || res.status}`);
      }
    } catch {
      setError('Rename failed');
    }
  }

  // Swap the PICTURE of one that already exists. Upload creates a new item and
  // refuses a name the pack already holds, so until now a corrected drawing had
  // nowhere to go except a second sticker under a different name — the original
  // stayed on screen forever. Same resize as the staging path, for the same
  // reason: hold the pixels, not a handle the OS can take back.
  async function replaceItem(id: string, file: File, alreadySized = false) {
    try {
      // A crop arrives square and already at size; encoding it a second time
      // would only cost it a generation.
      const blob = alreadySized ? file : await resizeImage(file, kind === 'emojis' ? 192 : 256);
      const form = new FormData();
      form.append('file', blob, file.name);
      const res = await apiFetch(`${base}/${id}`, { method: 'PATCH', body: form });
      if (res.ok) {
        const updated = await res.json().catch(() => null);
        if (updated?.url) {
          setItems((prev) => prev.map((it) => (it.id === id ? { ...it, url: updated.url } : it)));
        }
        if (kind === 'emojis') onEmojisChanged?.();
      } else {
        const data = await res.json().catch(() => ({}));
        setError(`Replace failed: ${data.error || res.status}`);
      }
    } catch {
      setError('Could not read that image — try picking it again');
    }
  }

  // Animated GIFs never go through the crop box: a canvas keeps one frame.
  const isGifUrl = (url: string) => /\.gif($|[?#])/i.test(url);
  const cropSize = kind === 'emojis' ? 192 : 256;

  // An animated sticker is framed here and cut on the server, every frame of it.
  async function cropAnimated(item: Item, area: Area) {
    try {
      const res = await apiFetch(`${base}/${item.id}/crop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ x: area.x, y: area.y, width: area.width, height: area.height }),
      });
      const updated = await res.json().catch(() => null);
      if (!res.ok || !updated?.url) throw new Error(updated?.error || `Crop failed (${res.status})`);
      setItems((prev) => prev.map((it) => (it.id === item.id ? { ...it, url: updated.url } : it)));
    } catch (err: any) {
      setError(err?.message || 'Crop failed');
    }
  }

  function cropItem(item: Item) {
    if (isGifUrl(item.url)) {
      setCropping({ src: item.url, label: item.name, onDone: () => {}, onArea: (area) => void cropAnimated(item, area) });
      return;
    }
    setCropping({
      src: item.url,
      label: item.name,
      onDone: (blob) => replaceItem(item.id, new File([blob], `${item.name}.webp`, { type: 'image/webp' }), true),
    });
  }

  function cropStaged(idx: number) {
    const row = staged[idx];
    if (!row) return;
    // An animated one is only framed here. The box rides along with the upload and
    // the server cuts every frame on arrival.
    if (row.blob.type === 'image/gif') {
      const src = URL.createObjectURL(row.blob);
      setCropping({
        src,
        label: row.draftName || row.defaultName,
        onDone: () => {},
        onArea: (area) => setStaged((prev) => prev.map((s, i) => (i === idx ? { ...s, cropArea: area } : s))),
        onClose: () => URL.revokeObjectURL(src),
      });
      return;
    }
    // From the big copy, every time, so cropping twice never compounds the loss.
    const src = URL.createObjectURL(row.source);
    setCropping({
      src,
      label: row.draftName || row.defaultName,
      onDone: (blob) => {
        const previewUrl = URL.createObjectURL(blob);
        setStaged((prev) => prev.map((s, i) => (i === idx ? { ...s, blob, previewUrl } : s)));
        URL.revokeObjectURL(row.previewUrl);
      },
      onClose: () => URL.revokeObjectURL(src),
    });
  }

  // Replace goes through the crop box too, on the FULL-SIZE picture the user picked, so
  // the crop is made before the shrink. An animated GIF skips it, because a canvas
  // would keep one frame of it.
  async function replaceViaCrop(item: Item, file: File) {
    if (file.type === 'image/gif') {
      void replaceItem(item.id, file);
      return;
    }
    try {
      // Hold the pixels, not the handle: the read grant can lapse while the user frames it.
      const source = await resizeImage(file, CROP_SOURCE_MAX);
      const src = URL.createObjectURL(source);
      setCropping({
        src,
        label: item.name,
        onDone: (blob) => replaceItem(item.id, new File([blob], `${item.name}.webp`, { type: 'image/webp' }), true),
        onClose: () => URL.revokeObjectURL(src),
      });
    } catch {
      setError('Could not read that image — try picking it again');
    }
  }

  // selectedPack === null means the virtual "Unpacked" view — items that
  // never had a pack_id set (legacy emojis from before pack support, or
  // anything assigned with packId=null). They show up in the picker tray
  // but were invisible from PacksApp before this view existed.
  const packItems = items.filter((i) => i.pack_id === selectedPack);
  const looseItems = items.filter((i) => i.pack_id === null);
  const hasLoose = looseItems.length > 0;
  const isLooseView = selectedPack === null && hasLoose;
  const card = cn('rounded-2xl border p-3 mb-3', colors.panelBg, colors.panelBorder);

  return (
    <AppShell
      title="Packs"
      icon={StickerIcon}
      onClose={onClose}
      themeConfig={themeConfig}
      themeMode={themeMode}
      headerRight={
        <button
          onClick={() => load()}
          className={cn('rounded-full p-2 transition-colors hover:bg-black/10 dark:hover:bg-white/10', colors.textMuted)}
          title="Refresh"
        >
          {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
        </button>
      }
    >
      {/* Kind toggle */}
      <div className={cn('rounded-2xl border p-3 backdrop-blur-md mb-3', colors.panelBg, colors.panelBorder)}>
        <div className="flex gap-1.5">
          {(['stickers', 'emojis'] as Kind[]).map((k) => (
            <button
              key={k}
              onClick={() => setKind(k)}
              className={cn('flex-1 rounded-lg py-1.5 text-xs font-medium capitalize transition-colors border', colors.panelBorder)}
              style={kind === k ? { background: colors.accent, color: 'var(--aerie-on-accent)' } : undefined}
            >
              {k}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className={cn('rounded-2xl border p-3 backdrop-blur-md text-xs py-6 text-center', colors.panelBg, colors.panelBorder, colors.textMuted)}>Loading…</div>
      ) : (
        <>
          {/* Pack selector and new pack */}
          <div className={cn('rounded-2xl border p-3 backdrop-blur-md mb-3', colors.panelBg, colors.panelBorder)}>
            {/* Pack selector — real packs plus a virtual "Unpacked" chip
                when there are loose items (typically legacy emojis with
                null pack_id). */}
            <div className="flex flex-wrap gap-1.5 mb-3">
              {hasLoose && (
                <button
                  onClick={() => setSelectedPack(null)}
                  className={cn('rounded-lg px-2.5 py-1 text-xs border italic', colors.panelBorder)}
                  style={selectedPack === null ? { background: colors.accent, color: 'var(--aerie-on-accent)' } : undefined}
                >
                  Unpacked · {looseItems.length}
                </button>
              )}
              {packsPage.visible.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setSelectedPack(p.id)}
                  className={cn('rounded-lg px-2.5 py-1 text-xs border', colors.panelBorder)}
                  style={selectedPack === p.id ? { background: colors.accent, color: 'var(--aerie-on-accent)' } : undefined}
                >
                  {p.name}
                </button>
              ))}
              <Paginator page={packsPage.page} pageCount={packsPage.pageCount} onPage={packsPage.setPage} colors={colors} />
            </div>

            {/* New pack */}
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="New pack name…"
                value={newPackName}
                onChange={(e) => setNewPackName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && createPack()}
                className={cn('flex-1 rounded-lg border px-3 py-1.5 text-xs bg-transparent', colors.panelBorder, colors.textMain)}
              />
              <button
                onClick={createPack}
                disabled={creating || !newPackName.trim()}
                className="rounded-lg px-3 py-1.5 text-xs font-semibold aerie-on-accent disabled:opacity-50 flex items-center gap-1"
                style={{ background: colors.accent }}
              >
                <Plus size={14} /> Pack
              </button>
            </div>
          </div>

          {/* A warning needs something behind it. Loose coloured text over a
              wallpaper is unreadable exactly when it matters most — when a
              whole batch has failed and the message is the only thing left. */}
          {error && (
            <div
              className="mb-2 flex items-start gap-2 rounded-xl border px-3 py-2 text-xs leading-snug"
              style={{
                color: colors.accent,
                borderColor: colors.accent,
                background: themeMode === 'dark' ? 'rgba(12,12,14,0.88)' : 'rgba(255,255,255,0.92)',
              }}
            >
              <span className="flex-1">{error}</span>
              <button onClick={() => setError(null)} aria-label="Dismiss" className="shrink-0 opacity-70">
                <X size={12} />
              </button>
            </div>
          )}

          {selectedPack || isLooseView ? (
            <div className={card}>
              <div className="flex items-center justify-between mb-2">
                <span className={cn('text-sm font-medium', colors.textMain)}>
                  {isLooseView
                    ? `Unpacked · ${looseItems.length}`
                    : `${packs.find((p) => p.id === selectedPack)?.name} · ${packItems.length}`}
                </span>
                <div className="flex items-center gap-1.5">
                  {!isLooseView && (
                    <button
                      onClick={() => fileInput.current?.click()}
                      disabled={uploading}
                      className={cn('rounded-lg border px-2 py-1 text-[11px] flex items-center gap-1 disabled:opacity-50', colors.panelBorder, colors.textMain)}
                    >
                      {uploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />} Upload
                    </button>
                  )}
                  {!isLooseView && selectedPack && (
                    <button
                      onClick={() => deletePack(selectedPack)}
                      className={cn('rounded-lg p-1.5', colors.textMuted)}
                      title="Delete pack"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
              <input
                ref={fileInput}
                type="file"
                accept="image/png,image/webp,image/gif"
                multiple
                hidden
                onChange={(e) => e.target.files && stageFiles(e.target.files)}
              />

              {/* Staging table — pick files, edit names, then bulk upload */}
              {staged.length > 0 && (
                <div className={cn('mb-3 rounded-xl border p-2', colors.panelBorder)}>
                  <div className="flex items-center justify-between mb-2">
                    <span className={cn('text-[11px] font-semibold uppercase tracking-wider', colors.textMuted)}>
                      Review {staged.length} file{staged.length === 1 ? '' : 's'}
                    </span>
                    <button
                      onClick={clearStaged}
                      disabled={uploading}
                      className={cn('text-[10px] underline disabled:opacity-50', colors.textMuted)}
                    >
                      Cancel
                    </button>
                  </div>
                  <div className="space-y-1.5 max-h-72 overflow-y-auto">
                    {staged.map((row, idx) => (
                      <div
                        key={`${row.defaultName}-${idx}`}
                        className={cn('flex items-center gap-2 rounded-lg border px-2 py-1.5', colors.panelBorder)}
                      >
                        <img
                          src={row.previewUrl}
                          alt={row.draftName || row.defaultName}
                          className="h-8 w-8 rounded object-contain flex-shrink-0"
                        />
                        <input
                          type="text"
                          value={row.draftName}
                          onChange={(e) => updateStagedName(idx, e.target.value)}
                          className={cn(
                            'flex-1 bg-transparent text-xs font-mono focus:outline-none px-1',
                            colors.textMain,
                          )}
                          style={{ caretColor: colors.accent }}
                        />
                        <button
                          onClick={() => cropStaged(idx)}
                          disabled={uploading}
                          className={cn('rounded p-1 hover:bg-black/10 dark:hover:bg-white/10 disabled:opacity-50', colors.textMuted)}
                          style={row.cropArea ? { color: colors.accent } : undefined}
                          title={row.cropArea ? 'Framed. It is cut when it uploads' : 'Crop'}
                        >
                          <CropIcon size={12} />
                        </button>
                        <button
                          onClick={() => removeStaged(idx)}
                          disabled={uploading}
                          className={cn('rounded p-1 hover:bg-black/10 dark:hover:bg-white/10 disabled:opacity-50', colors.textMuted)}
                          title="Remove from upload"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={uploadStaged}
                    disabled={uploading || staged.length === 0}
                    className="w-full mt-2 rounded-lg py-1.5 text-xs font-semibold aerie-on-accent disabled:opacity-50 flex items-center justify-center gap-1"
                    style={{ background: colors.accent }}
                  >
                    {uploading ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                    Upload {staged.length}
                  </button>
                </div>
              )}

              {(() => {
                const visible = isLooseView ? looseItems : packItems;
                if (visible.length === 0) {
                  return (
                    <div className={cn('text-xs py-4 text-center', colors.textMuted)}>
                      No {kind} in this pack yet.
                    </div>
                  );
                }
                return (
                  <div className="grid grid-cols-3 gap-2">
                    {visible.map((item) => (
                      <PackItemCard
                        key={item.id}
                        item={item}
                        colors={colors}
                        onDelete={() => deleteItem(item.id)}
                        onRename={(value) => renameItem(item.id, value)}
                        onReplace={(file) => void replaceViaCrop(item, file)}
                        onCrop={isGifUrl(item.url) && kind !== 'stickers' ? undefined : () => cropItem(item)}
                      />
                    ))}
                  </div>
                );
              })()}
              {isLooseView && (
                <p className={cn('text-[10px] mt-3 italic text-center', colors.textMuted)}>
                  These weren't assigned to a pack. Create a pack above to organize them, then re-upload.
                </p>
              )}
            </div>
          ) : (
            <div className={cn('text-xs py-6 text-center', colors.textMuted)}>
              No packs yet — create one above.
            </div>
          )}
        </>
      )}
      {cropping && (
        <StickerCropDialog
          src={cropping.src}
          label={cropping.label}
          size={cropSize}
          animated={!!cropping.onArea}
          onSaveArea={cropping.onArea ? (area) => { cropping.onArea?.(area); cropping.onClose?.(); setCropping(null); } : undefined}
          onCancel={() => { cropping.onClose?.(); setCropping(null); }}
          onSave={(blob) => { cropping.onDone(blob); cropping.onClose?.(); setCropping(null); }}
        />
      )}
    </AppShell>
  );
}

// Controlled-input card. Tracks draft locally so the user can type
// freely without state churn on every keystroke; commits on blur/Enter.
// Resets the draft when item.name changes from outside (e.g. after the
// PATCH response comes back with the sanitised server value) so the
// visible text stays in sync with what's actually saved.
function PackItemCard({
  item,
  colors,
  onDelete,
  onRename,
  onReplace,
  onCrop,
}: {
  item: Item;
  colors: ThemeColors;
  onDelete: () => void;
  onRename: (value: string) => void;
  onReplace: (file: File) => void;
  onCrop?: () => void;
}) {
  const [draft, setDraft] = useState(item.name);
  const replaceInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setDraft(item.name);
  }, [item.name]);

  return (
    <div className={cn('relative rounded-xl border p-1.5 flex flex-col items-stretch gap-1', colors.panelBorder)}>
      <div className="relative aspect-square flex items-center justify-center">
        <img src={item.url} alt={item.name} className="max-h-full max-w-full object-contain" />
        <button
          onClick={() => replaceInput.current?.click()}
          className="absolute -top-1 -left-1 flex items-center justify-center w-5 h-5 rounded-full aerie-on-accent opacity-80 hover:opacity-100 transition-opacity"
          style={{ background: colors.accent }}
          title="Replace image"
        >
          <RefreshCw size={10} />
        </button>
        <input
          ref={replaceInput}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const picked = e.target.files?.[0];
            e.target.value = '';
            if (picked) onReplace(picked);
          }}
        />
        <button
          onClick={onDelete}
          className="absolute -top-1 -right-1 flex items-center justify-center w-5 h-5 rounded-full aerie-on-accent opacity-80 hover:opacity-100 transition-opacity"
          style={{ background: colors.accent }}
          title="Delete"
        >
          <Trash2 size={10} />
        </button>
        {onCrop && (
          <button
            onClick={onCrop}
            className="absolute -bottom-1 -left-1 flex items-center justify-center w-5 h-5 rounded-full aerie-on-accent opacity-80 hover:opacity-100 transition-opacity"
            style={{ background: colors.accent }}
            title="Crop"
          >
            <CropIcon size={10} />
          </button>
        )}
      </div>
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => onRename(draft)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            setDraft(item.name);
            (e.target as HTMLInputElement).blur();
          }
        }}
        className={cn(
          'bg-transparent text-[10px] text-center font-mono w-full focus:outline-none focus:ring-1 rounded px-1',
          colors.textMain,
        )}
        style={{ caretColor: colors.accent }}
      />
    </div>
  );
}

// The crop box for stickers and emojis. It is the same cropper the avatars use
// and the user drives it: slide or pinch to zoom, drag to move. Square rather than
// round, and the empty space stays see-through, shown over a checkerboard so
// the user can tell air from picture. The framed square is drawn at the pack's own
// size, so every sticker comes out the same shape and nothing is re-uploaded.
function StickerCropDialog({
  src,
  label,
  size,
  animated = false,
  onSaveArea,
  onCancel,
  onSave,
}: {
  src: string;
  label: string;
  size: number;
  /** An animated picture is only framed here; the server cuts every frame. So the
   *  box stays inside the picture, which is the only crop the server can make. */
  animated?: boolean;
  onSaveArea?: (area: Area) => void;
  onCancel: () => void;
  onSave: (blob: Blob) => void;
}) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<Area | null>(null);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  useBackHandler(true, onCancel);

  async function save() {
    if (!area) return;
    if (onSaveArea) {
      onSaveArea(area);
      return;
    }
    setSaving(true);
    setFailed(null);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.crossOrigin = 'anonymous';
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('load'));
        el.src = src;
      });
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('canvas');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      // The square the user framed, stretched over the whole canvas. Whatever part
      // of it hangs off the edge of the picture stays transparent.
      ctx.drawImage(img, area.x, area.y, area.width, area.height, 0, 0, size, size);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.92));
      if (!blob) throw new Error('encode');
      onSave(blob);
    } catch {
      setFailed('Could not crop that one. Try again?');
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      <div className="px-4 pt-4 pb-2 text-center text-[11px] font-mono text-white/70 truncate">{label}</div>
      <div className="relative flex-1">
        <Cropper
          image={src}
          crop={crop}
          zoom={zoom}
          minZoom={animated ? 1 : 0.25}
          maxZoom={8}
          zoomSpeed={0.2}
          aspect={1}
          showGrid
          restrictPosition={animated}
          onCropChange={setCrop}
          onZoomChange={setZoom}
          onCropComplete={(_, px) => setArea(px)}
          style={{
            containerStyle: {
              backgroundColor: '#3a3a3a',
              backgroundImage: 'conic-gradient(#555 25%, #3a3a3a 0 50%, #555 0 75%, #3a3a3a 0)',
              backgroundSize: '20px 20px',
            },
          }}
        />
      </div>
      <div className="p-4 bg-neutral-900 border-t border-white/10 flex flex-col gap-4">
        <div className="flex items-center gap-4 px-2">
          <Minus size={14} className="text-white/40" />
          <input
            type="range"
            value={zoom}
            min={animated ? 1 : 0.25}
            max={8}
            step={0.05}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="flex-1 accent-white h-1 bg-white/20 rounded-lg appearance-none cursor-pointer"
            aria-label="Zoom"
          />
          <Plus size={14} className="text-white/40" />
        </div>
        {failed && <div className="text-[11px] text-red-300 text-center">{failed}</div>}
        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-white/70 hover:text-white"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={!area || saving}
            className="px-4 py-2 text-[10px] font-bold uppercase tracking-widest bg-white text-black rounded-full disabled:opacity-50"
          >
            {saving ? 'Saving' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
