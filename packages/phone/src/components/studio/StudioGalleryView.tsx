// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check, ChevronDown, Copy, Download, Folder, FolderPlus, Images,
  Loader2, MoreHorizontal, Pencil, Plus, RotateCcw, Trash2, Users, X,
} from 'lucide-react';
import { apiFetch } from '../../aerie';
import { cn } from '../../lib/utils';
import { Paginator, usePaged } from '../Paginator';
import { thumbSrc } from '../../lib/thumb';
import { useHouseRoster } from '../../lib/house';
import type { ThemeColors } from '../../lib/theme';
import { ACCENT_TEXT_COLOR_BY_THEME } from './constants';
import {
  canonicalCast, castCollectionLabel, copyStudioText, exactCastKey, galleryItemToImage,
  personTagLabel, personTagSlug,
} from './gallery-utils';
import type {
  GalleryCastGroup, GalleryGroups, GeneratedImage, RefDrawer, StudioFolder, ThemeMode,
} from './types';
import { ZoomableImage } from '../ZoomableImage';

type Collection =
  | { kind: 'recent' }
  | { kind: 'all' }
  | { kind: 'unknown' }
  | { kind: 'none' }
  | { kind: 'cast'; cast: string[] };

interface StudioGalleryViewProps {
  /** Rendered as the first thing inside the scroller — Studio hands its nav
   *  card down here so the tabs scroll away with the gallery instead of
   *  sitting pinned above it. */
  topSlot?: React.ReactNode;
  colors: ThemeColors;
  themeMode: ThemeMode;
  drawers: RefDrawer[];
  folders: StudioFolder[];
  setFolders: (folders: StudioFolder[] | ((folders: StudioFolder[]) => StudioFolder[])) => void;
  onUsePrompt: (image: GeneratedImage) => void;
  onReuseSetup: (image: GeneratedImage) => void;
  onDownload: (image: GeneratedImage) => void;
  onGalleryChanged: () => void;
}

const PAGE_SIZE = 30;

// How many come down the wire per request, which is NOT the same number as how many
// are shown on a page — and keeping them the same is what broke the paginator.
//
// usePaged is deliberately dumb about data and says so in its own comment: it assumes
// the whole list is already in memory. That holds for Identity, Thresholds and Journal.
// The gallery is the one list in the house that fetches incrementally, and its page size
// had been set to the fetch size so the numbers under the grid would agree with the
// "Loads 30 at a time" label above it. The effect was that every fetch added exactly one
// page, so pressing Load More and pressing Next Page became the same action and the
// numbers only ever counted what had already been downloaded. Six hundred pictures meant
// twenty-one taps to see twenty-one page numbers.
//
// The owner's call: no button, keep going until they are all in. So the view now drains the
// collection by itself and the paginator gets what it was always promised — a complete
// list. The wire size goes up to the route's own ceiling to make that seven requests
// instead of twenty-one; the page stays at thirty because the grid is three wide and
// thirty is ten clean rows.
const FETCH_SIZE = 100;

// A stop so a server that answers hasMore forever cannot spin the browser. At 100 a
// request this is far past any real gallery; if it ever trips, the count is wrong
// somewhere and the manual button comes back rather than the loop continuing quietly.
const MAX_AUTO_FETCHES = 200;

const MAX_PERSON_TAGS = 32;

function mediaPreview(image: GeneratedImage, className: string) {
  if (image.mediaType === 'video') {
    return <video src={image.src} className={className} muted playsInline preload="metadata" />;
  }
  return <img src={thumbSrc(image.src, 480)} alt={image.prompt} className={className} loading="lazy" />;
}

export function StudioGalleryView({
  topSlot,
  colors,
  themeMode,
  drawers,
  folders,
  setFolders,
  onUsePrompt,
  onReuseSetup,
  onDownload,
  onGalleryChanged,
}: StudioGalleryViewProps) {
  const [collection, setCollection] = useState<Collection>({ kind: 'recent' });
  const [castMode, setCastMode] = useState<'exact' | 'includes'>('exact');
  const [folderId, setFolderId] = useState('');
  const [items, setItems] = useState<GeneratedImage[]>([]);
  // The gallery pages at PAGE_SIZE, not at the house default of twenty.
  //
  // Two reasons, and they point the same way. It is a THREE-WIDE GRID: twenty leaves
  // a last row with two tiles in it and a hole, which is what made it look wrong.
  // And this view already fetches in batches of PAGE_SIZE and says so on the box —
  // "Loads 30 at a time" — so a page of twenty made the numbers underneath disagree
  // with the label above. One number for the whole view instead: it fetches thirty,
  // it shows thirty, and thirty is ten clean rows of three.
  const imagesPage = usePaged(items, PAGE_SIZE);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [groups, setGroups] = useState<GalleryGroups>({ groups: [], unknown: 0, none: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<GeneratedImage | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [castEditor, setCastEditor] = useState<{ filenames: string[]; image?: GeneratedImage } | null>(null);
  const [editCast, setEditCast] = useState<string[]>([]);
  const [newPersonName, setNewPersonName] = useState('');
  const [personTagError, setPersonTagError] = useState<string | null>(null);
  const [savingCast, setSavingCast] = useState(false);
  const [showFolderCreator, setShowFolderCreator] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [folderBusy, setFolderBusy] = useState(false);
  const [showBulkFolderPicker, setShowBulkFolderPicker] = useState(false);
  const [movingSelection, setMovingSelection] = useState(false);
  const [bulkFolderName, setBulkFolderName] = useState('');
  const [autoFetches, setAutoFetches] = useState(0);
  const [drainStalled, setDrainStalled] = useState(false);
  const galleryRequestRef = useRef(0);
  const galleryLoadingRef = useRef(false);

  // Residency and the house's own names for its groups come from the house,
  // not from a list of people compiled into this view.
  const { residents, companionSlugs, castLabels, isResident } = useHouseRoster();
  const houseGroups = useMemo(
    () => ({ residents, companionSlugs, labels: castLabels }),
    [residents, companionSlugs, castLabels],
  );
  const labels = useMemo(() => new Map(drawers.map((drawer) => [drawer.slug, drawer.label])), [drawers]);
  const labelFor = useCallback((slug: string) => labels.get(slug) ?? personTagLabel(slug), [labels]);
  const castDrawers = useMemo(() => {
    const byCast = new Map<string, RefDrawer>();
    for (const drawer of drawers) {
      const slug = canonicalCast([drawer.slug])[0];
      if (!slug || !isResident(slug)) continue;
      const existing = byCast.get(slug);
      if (!existing || drawer.isDefault) byCast.set(slug, drawer);
    }
    return [...byCast.values()];
  }, [drawers, isResident]);
  const customPersonCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const group of groups.groups) {
      for (const person of canonicalCast(group.cast)) {
        if (!isResident(person)) counts.set(person, (counts.get(person) ?? 0) + group.count);
      }
    }
    return [...counts.entries()].sort(([a], [b]) => labelFor(a).localeCompare(labelFor(b)));
  }, [groups.groups, labelFor, isResident]);
  const knownCustomPeople = useMemo(() => {
    const people = new Set(customPersonCounts.map(([person]) => person));
    for (const person of canonicalCast(editCast)) {
      if (!isResident(person)) people.add(person);
    }
    return [...people].sort((a, b) => labelFor(a).localeCompare(labelFor(b)));
  }, [customPersonCounts, editCast, labelFor, isResident]);

  const loadGroups = useCallback(async () => {
    try {
      const response = await apiFetch('/api/studio/gallery/groups');
      if (!response.ok) return;
      const data = await response.json();
      const rawGroups = Array.isArray(data.groups) ? data.groups : [];
      setGroups({
        groups: rawGroups
          .map((group: any): GalleryCastGroup => ({ cast: canonicalCast(group.cast), count: Number(group.count) || 0 }))
          .filter((group: GalleryCastGroup) => group.cast.length > 0 && group.count > 0),
        unknown: Number(data.unknown ?? data.unknownCount) || 0,
        none: Number(data.none ?? data.noneCount) || 0,
      });
    } catch {
      // The gallery remains usable if the collection summary is unavailable.
    }
  }, []);

  const loadPage = useCallback(async (append: boolean) => {
    // A collection can change while its previous request is still in flight.
    // Replacements supersede that request; repeated Load More taps do not.
    if (append && galleryLoadingRef.current) return;
    const requestId = ++galleryRequestRef.current;
    galleryLoadingRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: String(FETCH_SIZE) });
      if (append && nextCursor) params.set('cursor', nextCursor);
      if (folderId) params.set('folderId', folderId);
      if (collection.kind === 'unknown') params.set('castState', 'unknown');
      if (collection.kind === 'none') params.set('castState', 'none');
      if (collection.kind === 'cast') {
        params.set('cast', canonicalCast(collection.cast).join(','));
        params.set('castMode', castMode);
        params.set('castState', 'known');
      }
      const response = await apiFetch(`/api/studio/gallery?${params.toString()}`);
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `Gallery request failed (${response.status})`);
      }
      const data = await response.json();
      if (requestId !== galleryRequestRef.current) return;
      const page = Array.isArray(data.items) ? data.items.map(galleryItemToImage) : [];
      setItems((current) => append
        ? [...current, ...page.filter((image: GeneratedImage) => !current.some((old) => old.id === image.id))]
        : page);
      setNextCursor(typeof data.nextCursor === 'string' ? data.nextCursor : null);
      setHasMore(collection.kind === 'recent' ? false : Boolean(data.hasMore));
      setTotal(Number(data.total) || page.length);
    } catch (cause) {
      if (requestId === galleryRequestRef.current) {
        setError(cause instanceof Error ? cause.message : 'Gallery could not be loaded');
      }
    } finally {
      if (requestId === galleryRequestRef.current) {
        galleryLoadingRef.current = false;
        setLoading(false);
      }
    }
  }, [castMode, collection, folderId, nextCursor]);

  useEffect(() => {
    setItems([]);
    setNextCursor(null);
    setSelectedIds(new Set());
    setAutoFetches(0);
    setDrainStalled(false);
    void loadPage(false);
    // loadPage intentionally changes with the active query; loading/cursor are not query inputs here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collection, castMode, folderId]);

  // Keep pulling until the collection is all here. Each batch lands in items, which
  // re-renders, which fills in another few page numbers underneath — so the user watches
  // them arrive instead of tapping for them.
  //
  // Switching collection cancels this for free: the effect above empties items and
  // clears the cursor, and loadPage stamps every request so a superseded one drops
  // its own result on the floor.
  useEffect(() => {
    if (!hasMore || loading || error || !nextCursor) return;
    if (autoFetches >= MAX_AUTO_FETCHES) {
      setDrainStalled(true);
      return;
    }
    setAutoFetches((n) => n + 1);
    void loadPage(true);
  }, [hasMore, loading, error, nextCursor, autoFetches, loadPage]);

  useEffect(() => { void loadGroups(); }, [loadGroups]);

  useEffect(() => {
    if (!selectionMode || selectedIds.size === 0) setShowBulkFolderPicker(false);
  }, [selectionMode, selectedIds]);

  const refresh = useCallback(async () => {
    setNextCursor(null);
    await Promise.all([loadGroups(), loadPage(false)]);
    onGalleryChanged();
  }, [loadGroups, loadPage, onGalleryChanged]);

  const toggleSelected = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openCastEditor = (filenames: string[], image?: GeneratedImage) => {
    setEditCast(image?.cast ?? []);
    setNewPersonName('');
    setPersonTagError(null);
    setCastEditor({ filenames, image });
  };

  const togglePersonTag = (slug: string) => {
    if (!editCast.includes(slug) && editCast.length >= MAX_PERSON_TAGS) {
      setPersonTagError(`An image can have up to ${MAX_PERSON_TAGS} people tags.`);
      return;
    }
    setPersonTagError(null);
    setEditCast((current) => current.includes(slug)
      ? current.filter((value) => value !== slug)
      : canonicalCast([...current, slug]));
  };

  const addPersonTag = () => {
    const slug = personTagSlug(newPersonName);
    if (!slug) {
      setPersonTagError('Use a name up to 40 characters, without commas.');
      return;
    }
    if (editCast.includes(slug)) {
      setNewPersonName('');
      setPersonTagError(null);
      return;
    }
    if (editCast.length >= MAX_PERSON_TAGS) {
      setPersonTagError(`An image can have up to ${MAX_PERSON_TAGS} people tags.`);
      return;
    }
    setEditCast((current) => canonicalCast([...current, slug]));
    setNewPersonName('');
    setPersonTagError(null);
  };

  const saveCast = async (source: 'manual' | 'none' | 'selected-references') => {
    if (!castEditor || savingCast) return;
    setSavingCast(true);
    try {
      const cast = source === 'none'
        ? []
        : source === 'selected-references'
          ? canonicalCast(castEditor.image?.referenceDrawers ?? castEditor.image?.references ?? [])
            .filter((member) => isResident(member))
          : canonicalCast(editCast);
      const body = { cast, castSource: source };
      const response = castEditor.filenames.length === 1
        ? await apiFetch(`/api/studio/gallery/${encodeURIComponent(castEditor.filenames[0])}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        })
        : await apiFetch('/api/studio/gallery', {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filenames: castEditor.filenames, ...body }),
        });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'People could not be updated');
      }
      setCastEditor(null);
      setNewPersonName('');
      setPersonTagError(null);
      setViewing(null);
      setSelectedIds(new Set());
      setSelectionMode(false);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'People could not be updated');
    } finally {
      setSavingCast(false);
    }
  };

  const moveToFolder = async (image: GeneratedImage, nextFolderId: string) => {
    try {
      const response = await apiFetch(`/api/studio/gallery/${encodeURIComponent(image.id)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderId: nextFolderId || null }),
      });
      if (!response.ok) throw new Error('Move failed');
      const updated = { ...image, folderId: nextFolderId || undefined };
      setViewing(updated);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Move failed');
    }
  };

  const moveSelectionToFolder = async (nextFolderId: string) => {
    if (selectedIds.size === 0 || movingSelection) return;
    setMovingSelection(true);
    try {
      const response = await apiFetch('/api/studio/gallery', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filenames: Array.from(selectedIds), folderId: nextFolderId || null }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Images could not be moved');
      }
      setShowBulkFolderPicker(false);
      setSelectedIds(new Set());
      setSelectionMode(false);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Images could not be moved');
    } finally {
      setMovingSelection(false);
    }
  };

  const createFolderAndMoveSelection = async () => {
    const name = bulkFolderName.trim();
    if (!name || selectedIds.size === 0 || movingSelection) return;
    setMovingSelection(true);
    try {
      const folderResponse = await apiFetch('/api/studio/folders', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!folderResponse.ok) throw new Error('Folder could not be created');
      const folderData = await folderResponse.json();
      const newFolder = folderData.folder as StudioFolder;
      setFolders((current) => [...current, newFolder]);

      const moveResponse = await apiFetch('/api/studio/gallery', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filenames: Array.from(selectedIds), folderId: newFolder.id }),
      });
      if (!moveResponse.ok) {
        const data = await moveResponse.json().catch(() => ({}));
        throw new Error(data.error || 'Folder was created, but the images could not be moved');
      }
      setBulkFolderName('');
      setShowBulkFolderPicker(false);
      setSelectedIds(new Set());
      setSelectionMode(false);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Folder could not be created');
    } finally {
      setMovingSelection(false);
    }
  };

  const deleteImage = async (image: GeneratedImage) => {
    if (!window.confirm('Delete this gallery item? This cannot be undone.')) return;
    try {
      const response = await apiFetch(`/api/studio/gallery/${encodeURIComponent(image.id)}`, { method: 'DELETE' });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Delete failed');
      }
      setViewing(null);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Delete failed');
    }
  };

  const createFolder = async () => {
    if (!folderName.trim() || folderBusy) return;
    setFolderBusy(true);
    try {
      const response = await apiFetch('/api/studio/folders', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: folderName.trim() }),
      });
      if (!response.ok) throw new Error('Folder could not be created');
      const data = await response.json();
      setFolders((current) => [...current, data.folder]);
      setFolderId(data.folder.id);
      setFolderName('');
      setShowFolderCreator(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Folder could not be created');
    } finally {
      setFolderBusy(false);
    }
  };

  const deleteCurrentFolder = async () => {
    if (!folderId || !window.confirm('Delete this folder? Its images will return to the main gallery.')) return;
    try {
      const response = await apiFetch(`/api/studio/folders/${encodeURIComponent(folderId)}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Folder could not be deleted');
      setFolders((current) => current.filter((folder) => folder.id !== folderId));
      setFolderId('');
      onGalleryChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Folder could not be deleted');
    }
  };

  const copyPrompt = async (image: GeneratedImage) => {
    const lines = [image.prompt];
    lines.push(`Model: ${image.backend}/${image.model}`);
    if (image.aspectRatio) lines.push(`Aspect: ${image.aspectRatio}`);
    if (image.referenceDrawers?.length) lines.push(`References: ${image.referenceDrawers.join(', ')}`);
    await copyStudioText(lines.join('\n'));
  };

  const collectionKey = collection.kind === 'cast' ? `cast:${castMode}:${exactCastKey(collection.cast)}` : collection.kind;

  return (
    <div className="aerie-app-body flex-1 overflow-y-auto px-4 pb-24 pt-3">
      {topSlot}
      <div className="space-y-4">
        <section className={cn('space-y-3 rounded-2xl border p-3 shadow-lg backdrop-blur-md', colors.panelBg, colors.panelBorder)}>
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
            {([
              { key: 'recent', label: 'Recent', collection: { kind: 'recent' } as Collection },
              { key: 'all', label: 'All', collection: { kind: 'all' } as Collection },
              { key: 'unknown', label: `Unsorted${groups.unknown ? ` ${groups.unknown}` : ''}`, collection: { kind: 'unknown' } as Collection },
              { key: 'none', label: `No people${groups.none ? ` ${groups.none}` : ''}`, collection: { kind: 'none' } as Collection },
            ]).map((entry) => (
              <button
                type="button"
                key={entry.key}
                onClick={() => setCollection(entry.collection)}
                className={cn('shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium backdrop-blur-sm', colors.panelBg, colors.panelBorder, collectionKey !== entry.key && colors.textMuted)}
                style={collectionKey === entry.key ? { borderColor: colors.accent, color: colors.accent } : undefined}
              >
                {entry.label}
              </button>
            ))}
            {groups.groups.map((group) => {
              const key = `cast:exact:${exactCastKey(group.cast)}`;
              return (
                <button
                  type="button"
                  key={key}
                  onClick={() => { setCastMode('exact'); setCollection({ kind: 'cast', cast: group.cast }); }}
                  className={cn('shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium backdrop-blur-sm', colors.panelBg, colors.panelBorder, collectionKey !== key && colors.textMuted)}
                  style={collectionKey === key ? { borderColor: colors.accent, color: colors.accent } : undefined}
                >
                  {castCollectionLabel(group.cast, labelFor, houseGroups)} {group.count}
                </button>
              );
            })}
          </div>

          {customPersonCounts.length > 0 && (
            <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-hide">
              <span className={cn('shrink-0 px-1 text-[10px] font-semibold uppercase tracking-[0.14em]', colors.textMuted)}>People</span>
              {customPersonCounts.map(([person, count]) => {
                const key = `cast:includes:${person}`;
                return (
                  <button
                    type="button"
                    key={person}
                    onClick={() => { setCastMode('includes'); setCollection({ kind: 'cast', cast: [person] }); }}
                    className={cn('shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium backdrop-blur-sm', colors.panelBg, colors.panelBorder, collectionKey !== key && colors.textMuted)}
                    style={collectionKey === key ? { borderColor: colors.accent, color: colors.accent } : undefined}
                  >
                    {labelFor(person)} {count}
                  </button>
                );
              })}
            </div>
          )}

          <div className="flex items-center gap-2">
            <div className={cn('relative min-w-0 flex-1 rounded-xl border', colors.panelBg, colors.panelBorder)}>
              <Folder className={cn('pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2', colors.textMuted)} />
              <select
                value={folderId}
                onChange={(event) => setFolderId(event.target.value)}
                className={cn('w-full appearance-none bg-transparent py-2 pl-9 pr-8 text-xs outline-none', colors.textMain)}
              >
                <option value="">Every project folder</option>
                {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
              </select>
              <ChevronDown className={cn('pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2', colors.textMuted)} />
            </div>
            <button type="button" onClick={() => setShowFolderCreator((value) => !value)} className={cn('rounded-xl border p-2', colors.panelBg, colors.panelBorder, colors.textMuted)} title="New folder">
              <FolderPlus className="h-4 w-4" />
            </button>
            {folderId && (
              <button type="button" onClick={deleteCurrentFolder} className="rounded-xl border border-red-500/30 p-2 text-red-400" title="Delete selected folder">
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>

          <p className={cn('px-1 text-[11px] leading-relaxed', colors.textMuted)}>
            People collections use everyone you tag. Project folders organize images independently.
          </p>

          {showFolderCreator && (
            <div className={cn('flex gap-2 rounded-xl border p-2', colors.panelBg, colors.panelBorder)}>
              <input
                value={folderName}
                onChange={(event) => setFolderName(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') void createFolder(); }}
                placeholder="Project folder name"
                className={cn('min-w-0 flex-1 bg-transparent px-2 text-sm outline-none', colors.textMain)}
                autoFocus
              />
              <button type="button" onClick={createFolder} disabled={folderBusy || !folderName.trim()} className="rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-40" style={{ backgroundColor: colors.accent, color: ACCENT_TEXT_COLOR_BY_THEME[themeMode] }}>
                {folderBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Create'}
              </button>
            </div>
          )}

          {collection.kind === 'cast' && (
            <div className={cn('flex items-center justify-between rounded-xl border px-3 py-2', colors.panelBg, colors.panelBorder)}>
              <div>
                <p className={cn('text-xs font-medium', colors.textMain)}>{castCollectionLabel(collection.cast, labelFor, houseGroups)}</p>
                <p className={cn('text-[10px]', colors.textMuted)}>{castMode === 'exact' ? 'Only this exact cast' : 'Any image containing this cast'}</p>
              </div>
              <button type="button" onClick={() => setCastMode((mode) => mode === 'exact' ? 'includes' : 'exact')} className="rounded-lg px-2.5 py-1.5 text-xs font-semibold" style={{ color: colors.accent }}>
                {castMode === 'exact' ? 'Exactly' : 'Includes'}
              </button>
            </div>
          )}
        </section>

        <div className={cn('flex items-center justify-between rounded-2xl border px-3 py-2.5 shadow-lg backdrop-blur-md', colors.panelBg, colors.panelBorder)}>
          <div>
            <p className={cn('text-sm font-semibold', colors.textMain)}>{collection.kind === 'recent' ? 'Newest creations' : `${total} ${total === 1 ? 'creation' : 'creations'}`}</p>
            <p className={cn('text-[10px]', colors.textMuted)}>{collection.kind === 'recent' ? 'The latest 30 only' : (hasMore ? 'Loading them all' : 'All of them')}</p>
          </div>
          <button
            type="button"
            onClick={() => { setSelectionMode((value) => !value); setSelectedIds(new Set()); }}
            className={cn('rounded-lg px-2.5 py-1.5 text-xs font-medium', colors.textMuted)}
          >
            {selectionMode ? 'Done' : 'Select'}
          </button>
        </div>

        {error && <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>}

        {items.length === 0 && !loading ? (
          <div className={cn('rounded-2xl border border-dashed py-16 text-center', colors.panelBorder, colors.textMuted)}>
            <Images className="mx-auto mb-3 h-10 w-10 opacity-30" />
            <p className="text-sm">Nothing in this collection yet</p>
          </div>
        ) : (
              <>
          <div className="grid grid-cols-3 gap-2">
            {imagesPage.visible.map((image) => {
              const selected = selectedIds.has(image.id);
              return (
                <button
                  type="button"
                  key={image.id}
                  onClick={() => selectionMode ? toggleSelected(image.id) : setViewing(image)}
                  className={cn(
                    'relative aspect-square overflow-hidden rounded-xl border-2 p-0.5 shadow-md backdrop-blur-sm transition-[border-color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60',
                    colors.panelBg,
                    !selected && colors.panelBorder,
                  )}
                  style={selected ? {
                    borderColor: colors.accent,
                    boxShadow: `0 0 0 1px ${colors.accent}, 0 8px 20px rgba(0, 0, 0, 0.28)`,
                  } : undefined}
                  aria-pressed={selectionMode ? selected : undefined}
                  aria-label={selectionMode ? `${selected ? 'Deselect' : 'Select'} gallery image` : 'Open gallery image'}
                >
                  {mediaPreview(image, 'h-full w-full rounded-[9px] object-cover')}
                  {selectionMode && (
                    <span className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full border bg-black/65 text-white">
                      {selected && <Check className="h-4 w-4" />}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <Paginator page={imagesPage.page} pageCount={imagesPage.pageCount} onPage={imagesPage.setPage} colors={colors} />
              </>
        )}

        {/* One line for the whole wait, and it counts. A spinner says "something is
            happening"; a count says how much longer, which is the thing the user actually
            asked about. It disappears on its own when the last batch lands. */}
        {(loading || (hasMore && !drainStalled && !error)) && (
          <div className={cn('flex items-center justify-center gap-2 py-6 text-xs', colors.textMuted)}>
            <Loader2 className="h-4 w-4 animate-spin" />
            {total > 0 && items.length > 0
              ? `Loading ${items.length} of ${total}`
              : 'Loading gallery'}
          </div>
        )}
        {/* Only if the automatic pull gave up. Nothing here is a normal part of looking
            at the gallery any more — if this button is on screen, something went wrong. */}
        {hasMore && !loading && (drainStalled || error) && (
          <button type="button" onClick={() => { setDrainStalled(false); setAutoFetches(0); void loadPage(true); }} className={cn('w-full rounded-xl border py-3 text-sm font-medium', colors.panelBg, colors.panelBorder, colors.textMain)}>
            Keep loading ({items.length} of {total})
          </button>
        )}
      </div>

      {selectionMode && selectedIds.size > 0 && (
        <div className="fixed bottom-[calc(var(--sab)+1rem)] left-1/2 z-30 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-2 rounded-2xl border border-white/15 bg-black/90 px-3 py-2 text-white shadow-2xl backdrop-blur-xl">
          <span className="text-xs font-semibold">{selectedIds.size} selected</span>
          <button type="button" onClick={() => openCastEditor(Array.from(selectedIds))} className="flex items-center gap-1 rounded-lg bg-white/10 px-2.5 py-1.5 text-xs">
            <Users className="h-3.5 w-3.5" /> Set people
          </button>
          <button type="button" onClick={() => setShowBulkFolderPicker(true)} className="flex items-center gap-1 rounded-lg bg-white/10 px-2.5 py-1.5 text-xs">
            <Folder className="h-3.5 w-3.5" /> Move
          </button>
        </div>
      )}

      {showBulkFolderPicker && selectedIds.size > 0 && (
        <div className="absolute inset-0 z-50 flex items-end bg-black/70 p-4">
          <div className={cn('max-h-[75vh] w-full overflow-y-auto rounded-2xl border p-4 shadow-2xl', colors.pageBg, colors.panelBorder)}>
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className={cn('font-semibold', colors.textMain)}>Move {selectedIds.size} {selectedIds.size === 1 ? 'image' : 'images'}</h2>
                <p className={cn('text-xs', colors.textMuted)}>Choose a project folder. This does not change the People collection.</p>
              </div>
              <button type="button" onClick={() => setShowBulkFolderPicker(false)} disabled={movingSelection} className={cn('rounded-full p-2', colors.textMuted)}><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-2">
              <div className={cn('flex gap-2 rounded-xl border p-2', colors.panelBg, colors.panelBorder)}>
                <input
                  value={bulkFolderName}
                  onChange={(event) => setBulkFolderName(event.target.value)}
                  onKeyDown={(event) => { if (event.key === 'Enter') void createFolderAndMoveSelection(); }}
                  placeholder="New folder for these images"
                  disabled={movingSelection}
                  className={cn('min-w-0 flex-1 bg-transparent px-2 text-sm outline-none', colors.textMain)}
                />
                <button
                  type="button"
                  onClick={() => void createFolderAndMoveSelection()}
                  disabled={movingSelection || !bulkFolderName.trim()}
                  className="shrink-0 rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-40"
                  style={{ backgroundColor: colors.accent, color: ACCENT_TEXT_COLOR_BY_THEME[themeMode] }}
                >
                  Create + move
                </button>
              </div>
              <button
                type="button"
                onClick={() => void moveSelectionToFolder('')}
                disabled={movingSelection}
                className={cn('flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left text-sm disabled:opacity-50', colors.panelBg, colors.panelBorder, colors.textMain)}
              >
                <Folder className={cn('h-4 w-4', colors.textMuted)} /> No project folder
              </button>
              {folders.map((folder) => (
                <button
                  type="button"
                  key={folder.id}
                  onClick={() => void moveSelectionToFolder(folder.id)}
                  disabled={movingSelection}
                  className={cn('flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left text-sm disabled:opacity-50', colors.panelBg, colors.panelBorder, colors.textMain)}
                >
                  <Folder className="h-4 w-4" style={{ color: colors.accent }} /> {folder.name}
                </button>
              ))}
              {folders.length === 0 && (
                <p className={cn('rounded-xl border border-dashed px-3 py-6 text-center text-xs', colors.panelBorder, colors.textMuted)}>
                  No project folders yet. Name one above to create it and move this selection in one step.
                </p>
              )}
            </div>
            {movingSelection && <div className={cn('mt-3 flex items-center justify-center gap-2 text-xs', colors.textMuted)}><Loader2 className="h-4 w-4 animate-spin" /> Moving images</div>}
          </div>
        </div>
      )}

      {viewing && (
        <div className="absolute inset-0 z-40 flex flex-col bg-black/95 text-white">
          <div className="flex items-center justify-between p-4" style={{ paddingTop: 'calc(var(--sat) + 0.75rem)' }}>
            <button type="button" onClick={() => setViewing(null)} className="rounded-full bg-white/10 p-2"><X className="h-5 w-5" /></button>
            <div className="flex gap-2">
              <button type="button" onClick={() => onDownload(viewing)} className="rounded-full bg-white/10 p-2" title="Download"><Download className="h-4 w-4" /></button>
              <button type="button" onClick={() => void deleteImage(viewing)} className="rounded-full bg-red-500/20 p-2 text-red-300" title="Delete"><Trash2 className="h-4 w-4" /></button>
            </div>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center p-4">
            {viewing.mediaType === 'video'
              ? <video src={viewing.src} className="max-h-full max-w-full" controls loop playsInline autoPlay />
              : <ZoomableImage src={viewing.src} alt={viewing.prompt} className="rounded-xl" />}
          </div>
          <div className="space-y-3 border-t border-white/10 bg-black/85 p-4 pb-[calc(var(--sab)+1rem)]">
            <p className="max-h-24 overflow-y-auto whitespace-pre-wrap text-sm">{viewing.prompt || 'No prompt stored for this asset.'}</p>
            <div className="flex gap-2 overflow-x-auto">
              <button type="button" onClick={() => onUsePrompt(viewing)} disabled={!viewing.prompt} className="shrink-0 rounded-xl px-3 py-2 text-xs font-semibold disabled:opacity-40" style={{ backgroundColor: colors.accent, color: ACCENT_TEXT_COLOR_BY_THEME[themeMode] }}>Use prompt</button>
              <button type="button" onClick={() => onReuseSetup(viewing)} disabled={!viewing.prompt} className="shrink-0 rounded-xl bg-white/10 px-3 py-2 text-xs font-semibold disabled:opacity-40">Reuse setup</button>
              <button type="button" onClick={() => void copyPrompt(viewing)} disabled={!viewing.prompt} className="shrink-0 rounded-xl bg-white/10 p-2.5 disabled:opacity-40" title="Copy prompt and settings"><Copy className="h-4 w-4" /></button>
              <button type="button" onClick={() => openCastEditor([viewing.id], viewing)} className="flex shrink-0 items-center gap-1 rounded-xl bg-white/10 px-3 py-2 text-xs"><Pencil className="h-3.5 w-3.5" /> People</button>
            </div>
            <div className="flex items-center gap-2">
              <Folder className="h-4 w-4 text-white/50" />
              <select value={viewing.folderId ?? ''} onChange={(event) => void moveToFolder(viewing, event.target.value)} className="min-w-0 flex-1 rounded-lg border border-white/10 bg-white/10 px-2 py-2 text-xs text-white">
                <option value="">No project folder</option>
                {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
              </select>
              <MoreHorizontal className="h-4 w-4 text-white/30" />
            </div>
            <p className="text-[10px] uppercase tracking-wide text-white/45">
              {viewing.backend} · {viewing.model.split('/').pop()}
              {viewing.cast?.length ? ` · ${castCollectionLabel(viewing.cast, labelFor, houseGroups)}` : viewing.castSource === 'none' ? ' · No people' : ' · Unsorted'}
            </p>
          </div>
        </div>
      )}

      {castEditor && (
        <div className="absolute inset-0 z-50 flex items-end bg-black/70 p-4">
          <div className={cn('max-h-[82vh] w-full overflow-y-auto rounded-2xl border p-4 shadow-2xl', colors.pageBg, colors.panelBorder)}>
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className={cn('font-semibold', colors.textMain)}>Who is in {castEditor.filenames.length === 1 ? 'this image' : `these ${castEditor.filenames.length} images`}?</h2>
                <p className={cn('text-xs', colors.textMuted)}>
                  {castEditor.filenames.length === 1
                    ? 'Exact people collections update automatically.'
                    : `Saving replaces the people list on all ${castEditor.filenames.length} selected images.`}
                </p>
              </div>
              <button type="button" onClick={() => { setCastEditor(null); setNewPersonName(''); setPersonTagError(null); }} className={cn('rounded-full p-2', colors.textMuted)}><X className="h-4 w-4" /></button>
            </div>
            <p className={cn('mb-2 text-[10px] font-semibold uppercase tracking-[0.16em]', colors.textMuted)}>Household</p>
            <div className="flex flex-wrap gap-2">
              {castDrawers.map((drawer) => {
                const slug = canonicalCast([drawer.slug])[0] ?? drawer.slug;
                const active = editCast.includes(slug);
                return (
                  <button
                    type="button"
                    key={drawer.slug}
                    onClick={() => togglePersonTag(slug)}
                    aria-pressed={active}
                    className={cn('flex items-center gap-1.5 rounded-full border px-3 py-2 text-xs', colors.panelBorder, !active && colors.textMuted)}
                    style={active ? { borderColor: colors.accent, color: colors.accent } : undefined}
                  >
                    {active && <Check className="h-3.5 w-3.5" />}
                    <span>{drawer.emoji ? `${drawer.emoji} ` : ''}{drawer.label}</span>
                  </button>
                );
              })}
            </div>
            <div className={cn('mt-4 rounded-2xl border p-3', colors.panelBg, colors.panelBorder)}>
              <div className="mb-2 flex items-baseline justify-between gap-3">
                <p className={cn('text-xs font-semibold', colors.textMain)}>Other people</p>
                <p className={cn('text-[10px]', colors.textMuted)}>Reusable in every image</p>
              </div>
              {knownCustomPeople.length > 0 && (
                <div className="mb-3 flex flex-wrap gap-2">
                  {knownCustomPeople.map((slug) => {
                    const active = editCast.includes(slug);
                    return (
                      <button
                        type="button"
                        key={slug}
                        onClick={() => togglePersonTag(slug)}
                        aria-pressed={active}
                        className={cn('flex items-center gap-1.5 rounded-full border px-3 py-2 text-xs', colors.panelBorder, !active && colors.textMuted)}
                        style={active ? { borderColor: colors.accent, color: colors.accent } : undefined}
                      >
                        {active && <Check className="h-3.5 w-3.5" />}
                        {labelFor(slug)}
                      </button>
                    );
                  })}
                </div>
              )}
              <div className={cn('flex gap-2 rounded-xl border p-2', colors.panelBg, colors.panelBorder)}>
                <input
                  value={newPersonName}
                  onChange={(event) => { setNewPersonName(event.target.value); setPersonTagError(null); }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      addPersonTag();
                    }
                  }}
                  placeholder="Add a person, e.g. Ivy"
                  maxLength={80}
                  className={cn('min-w-0 flex-1 bg-transparent px-2 text-sm outline-none', colors.textMain)}
                />
                <button
                  type="button"
                  onClick={addPersonTag}
                  disabled={!newPersonName.trim() || editCast.length >= MAX_PERSON_TAGS}
                  className="flex shrink-0 items-center gap-1 rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-40"
                  style={{ backgroundColor: colors.accent, color: ACCENT_TEXT_COLOR_BY_THEME[themeMode] }}
                >
                  <Plus className="h-3.5 w-3.5" /> Add
                </button>
              </div>
              {personTagError && <p className="mt-2 px-1 text-[11px] text-red-400">{personTagError}</p>}
              <p className={cn('mt-2 px-1 text-[10px] leading-relaxed', colors.textMuted)}>
                Adding a name keeps every person already selected. Tap any highlighted name to remove it.
              </p>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => void saveCast('manual')} disabled={savingCast || editCast.length === 0} className="rounded-xl py-3 text-sm font-semibold disabled:opacity-40" style={{ backgroundColor: colors.accent, color: ACCENT_TEXT_COLOR_BY_THEME[themeMode] }}>
                {savingCast ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : 'Save exact people'}
              </button>
              <button type="button" onClick={() => void saveCast('none')} disabled={savingCast} className={cn('rounded-xl border py-3 text-sm font-medium', colors.panelBorder, colors.textMain)}>No people</button>
              {(() => {
                const references = canonicalCast(castEditor.image?.referenceDrawers ?? castEditor.image?.references ?? []);
                const canReset = references.length > 0 && references.every((member) => isResident(member));
                return canReset ? (
                <button type="button" onClick={() => void saveCast('selected-references')} disabled={savingCast} className={cn('col-span-2 flex items-center justify-center gap-2 rounded-xl border py-3 text-sm', colors.panelBorder, colors.textMuted)}>
                  <RotateCcw className="h-4 w-4" /> Reset to generated selection
                </button>
                ) : null;
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
