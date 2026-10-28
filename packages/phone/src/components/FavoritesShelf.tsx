// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// One contact card's shelf of favorite pictures (services/favorites.ts in the
// house). Theirs, Oct 7 2026: each card gets its own small gallery of favorites,
// picked by that card's owner, separate from the Studio gallery, and the owner adds
// to them too. A favorite only points at a picture already in the house, so
// taking one off never touches the picture itself.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus, X, Trash2, Upload, Check } from 'lucide-react';
import { apiFetch } from '../aerie';
import { cn } from '../lib/utils';
import { useBackHandler } from '../lib/use-back-handler';

interface Favorite {
  id: string;
  url: string;
  by: string;
  note: string | null;
  addedAt: string;
}

interface GalleryItem {
  filename: string;
  url: string;
  mediaType?: string;
}

interface Colors {
  panelBg: string;
  panelBorder: string;
  textMain: string;
  textMuted: string;
  accent: string;
  accentText: string;
}

/** A small copy for the grid: gallery pictures and uploaded files both have thumbnails. */
const thumb = (url: string, w = 256): string =>
  url.startsWith('/api/studio/gallery/') || url.startsWith('/api/files/') ? `${url}?w=${w}` : url;

export const FavoritesShelf: React.FC<{
  /** A companion slug, or 'owner' for their card. */
  card: string;
  /** The card's display name, for the empty line. */
  name: string;
  /** Names for whoever added a picture, by slug; 'owner' reads as You. */
  nameFor: (by: string) => string;
  colors: Colors;
}> = ({ card, name, nameFor, colors }) => {
  const [favorites, setFavorites] = useState<Favorite[] | null>(null);
  const [open, setOpen] = useState<Favorite | null>(null);
  const [picking, setPicking] = useState(false);

  const load = useCallback(() => {
    apiFetch(`/api/favorites/${encodeURIComponent(card)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setFavorites(Array.isArray(d?.favorites) ? d.favorites : []))
      .catch(() => setFavorites([]));
  }, [card]);

  useEffect(() => {
    setFavorites(null);
    setOpen(null);
    setPicking(false);
    load();
  }, [load]);

  // Hangs several in one go (theirs, Oct 27 2026: 'the option to select more
  // than one to hang'). One request each, in order, so the shelf keeps them
  // in the order the owner picked them, newest on top.
  const add = async (urls: string[]) => {
    for (const url of urls) {
      const r = await apiFetch(`/api/favorites/${encodeURIComponent(card)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      }).catch(() => null);
      const d = r && r.ok ? await r.json().catch(() => null) : null;
      if (Array.isArray(d?.favorites)) setFavorites(d.favorites);
    }
    setPicking(false);
  };

  const remove = async (fav: Favorite) => {
    const r = await apiFetch(`/api/favorites/${encodeURIComponent(card)}/${encodeURIComponent(fav.id)}`, { method: 'DELETE' }).catch(() => null);
    const d = r && r.ok ? await r.json().catch(() => null) : null;
    if (Array.isArray(d?.favorites)) setFavorites(d.favorites);
    setOpen(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className={cn('micro-label', colors.accentText)}>Favorites</h3>
        <button
          onClick={() => setPicking(true)}
          className={cn('p-1.5 rounded-full hover:bg-white/10 transition-colors', colors.textMuted)}
          title="Add a picture from the gallery"
          aria-label="Add a favorite"
        >
          <Plus size={16} />
        </button>
      </div>
      {favorites === null ? (
        <div className={cn('h-20 rounded-2xl border', colors.panelBg, colors.panelBorder)} />
      ) : favorites.length === 0 ? (
        <p className={cn('text-sm italic', colors.textMuted)}>
          Nothing on {name}'s shelf yet.
        </p>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {favorites.map((f) => (
            <button
              key={f.id}
              onClick={() => setOpen(f)}
              className={cn('aspect-square rounded-xl overflow-hidden border', colors.panelBorder)}
            >
              <img src={thumb(f.url)} alt="" loading="lazy" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}

      {open && (
        <FavoriteViewer
          favorite={open}
          addedBy={nameFor(open.by)}
          colors={colors}
          onClose={() => setOpen(null)}
          onRemove={() => remove(open)}
        />
      )}
      {picking && (
        <GalleryPicker
          colors={colors}
          already={new Set((favorites ?? []).map((f) => f.url))}
          onPick={add}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  );
};

const FavoriteViewer: React.FC<{
  favorite: Favorite;
  addedBy: string;
  colors: Colors;
  onClose: () => void;
  onRemove: () => void;
}> = ({ favorite, addedBy, colors, onClose, onRemove }) => {
  useBackHandler(true, onClose);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-[95] bg-black/90 flex flex-col" onClick={onClose}>
      <div className="flex items-center justify-between p-4" style={{ paddingTop: 'calc(var(--sat, 0px) + 1rem)' }}>
        <button onClick={(e) => { e.stopPropagation(); onRemove(); }} className="p-2 rounded-full hover:bg-white/10 text-white/80" title="Take it off this shelf" aria-label="Take it off this shelf">
          <Trash2 size={18} />
        </button>
        <button onClick={onClose} className="p-2 rounded-full hover:bg-white/10 text-white/80" aria-label="Close">
          <X size={20} />
        </button>
      </div>
      <div className="flex-1 min-h-0 flex items-center justify-center px-2">
        <img src={favorite.url} alt="" className="max-w-full max-h-full object-contain" onClick={(e) => e.stopPropagation()} />
      </div>
      <div className="p-4 text-center text-sm text-white/80" style={{ paddingBottom: 'calc(var(--sab, 0px) + 1rem)' }}>
        {favorite.note && <p className="italic mb-1">{favorite.note}</p>}
        <p className={cn('text-[10px] uppercase tracking-widest', colors.textMuted)}>Picked by {addedBy}</p>
      </div>
    </div>,
    document.body,
  );
};

const GalleryPicker: React.FC<{
  colors: Colors;
  already: Set<string>;
  onPick: (urls: string[]) => void | Promise<void>;
  onClose: () => void;
}> = ({ colors, already, onPick, onClose }) => {
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [chosen, setChosen] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  useBackHandler(true, onClose);

  const more = useCallback(() => {
    if (loading || !hasMore) return;
    setLoading(true);
    const q = new URLSearchParams({ limit: '60' });
    if (cursor) q.set('cursor', cursor);
    apiFetch(`/api/studio/gallery?${q.toString()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const page: GalleryItem[] = Array.isArray(d?.items) ? d.items.filter((i: GalleryItem) => !i.mediaType || i.mediaType.startsWith('image')) : [];
        setItems((prev) => [...prev, ...page]);
        setCursor(d?.nextCursor ?? null);
        setHasMore(Boolean(d?.hasMore));
      })
      .catch(() => setHasMore(false))
      .finally(() => setLoading(false));
  }, [cursor, hasMore, loading]);

  useEffect(() => { more(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (url: string) =>
    setChosen((prev) => (prev.includes(url) ? prev.filter((u) => u !== url) : [...prev, url]));

  const hang = async (urls: string[]) => {
    if (!urls.length || busy) return;
    setBusy(true);
    try {
      await onPick(urls);
    } finally {
      setBusy(false);
    }
  };

  // Pictures from their phone, not made in Studio (theirs, Oct 27 2026: 'especially
  // our wedding photos'). Each goes into the house's file store untouched, the
  // same raw road the Inbox uses, and the shelf points at it there; whatever
  // the owner has already ticked in the gallery is hung in the same go.
  const upload = async (files: File[]) => {
    if (!files.length || busy) return;
    setBusy(true);
    setUploadError(null);
    const urls: string[] = [];
    try {
      for (const file of files) {
        const form = new FormData();
        form.append('file', file, file.name);
        const res = await apiFetch('/api/files', { method: 'POST', body: form });
        const meta = res.ok ? await res.json().catch(() => null) : null;
        if (!meta?.fileId) throw new Error(`Upload failed (${res.status})`);
        urls.push(`/api/files/${meta.fileId}`);
      }
      await onPick([...chosen, ...urls]);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
      if (urls.length) await onPick(urls);
    } finally {
      setBusy(false);
    }
  };

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-[95] bg-black/60 flex items-end" onClick={onClose}>
      <div
        className={cn('w-full max-h-[80vh] rounded-t-3xl border-t p-4 overflow-y-auto scrollbar-hide', colors.panelBg, colors.panelBorder)}
        style={{ paddingBottom: 'calc(var(--sab, 0px) + 1rem)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className={cn('micro-label', colors.accentText)}>Pick from the gallery</h3>
          <div className="flex items-center gap-1">
            <button
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className={cn('flex items-center gap-1.5 px-2.5 py-1.5 rounded-full hover:bg-white/10 text-[10px] font-bold uppercase tracking-widest', colors.textMuted)}
              title="Upload from your phone"
            >
              <Upload size={14} /> Upload
            </button>
            <button onClick={onClose} className={cn('p-1.5 rounded-full hover:bg-white/10', colors.textMuted)} aria-label="Close">
              <X size={16} />
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = '';
              void upload(files);
            }}
          />
        </div>
        {uploadError && <p className="text-xs text-red-400 mb-2">{uploadError}</p>}
        {busy && <p className={cn('text-xs mb-2', colors.textMuted)}>Hanging…</p>}
        <div className="grid grid-cols-3 gap-2">
          {items.map((it) => {
            const taken = already.has(it.url);
            const order = chosen.indexOf(it.url);
            return (
              <button
                key={it.filename}
                disabled={taken || busy}
                onClick={() => toggle(it.url)}
                className={cn('aspect-square rounded-xl overflow-hidden border relative', colors.panelBorder, taken && 'opacity-40')}
              >
                <img src={thumb(it.url)} alt="" loading="lazy" className="w-full h-full object-cover" />
                {order > -1 && (
                  <span className="absolute inset-0 ring-2 ring-inset ring-[var(--aerie-accent,#e85d04)] rounded-xl">
                    <span className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-[var(--aerie-accent,#e85d04)] text-[var(--aerie-on-accent,#fff)] flex items-center justify-center">
                      <Check size={12} />
                    </span>
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {hasMore && (
          <button
            onClick={more}
            disabled={loading}
            className={cn('w-full mt-3 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest', colors.textMuted)}
          >
            {loading ? 'Loading…' : 'More'}
          </button>
        )}
        {chosen.length > 0 && (
          <div className="sticky bottom-0 pt-3">
            <button
              onClick={() => void hang(chosen)}
              disabled={busy}
              className="w-full py-3 rounded-2xl text-xs font-bold uppercase tracking-widest bg-[var(--aerie-accent,#e85d04)] text-[var(--aerie-on-accent,#fff)]"
            >
              Hang {chosen.length}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
};
