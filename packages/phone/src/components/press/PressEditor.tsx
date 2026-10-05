// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PressAsset, PressIssue, PressPack, PressPackItem, PressSpread } from '@aerie/shared';
import {
  CaptureUpdateAction,
  Excalidraw,
  MainMenu,
  convertToExcalidrawElements,
  exportToBlob,
  loadLibraryFromBlob,
  newElementWith,
} from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import './press.css';
import type {
  AppState,
  BinaryFileData,
  BinaryFiles,
  DataURL,
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
  LibraryItem,
  LibraryItems,
} from '@excalidraw/excalidraw/types';
import type {
  ExcalidrawElement,
  ExcalidrawImageElement,
  FileId,
} from '@excalidraw/excalidraw/element/types';
import {
  AlignCenter,
  Archive,
  BringToFront,
  Check,
  Copy,
  Crop,
  Download,
  Eye,
  FileArchive,
  Focus,
  Image as ImageIcon,
  ImagePlus,
  Layers3,
  Lock,
  Loader2,
  Maximize2,
  MoveDown,
  MoveUp,
  Paintbrush,
  Palette,
  RefreshCw,
  RotateCcw,
  Scissors,
  SlidersHorizontal,
  Sparkles,
  TextCursorInput,
  Trash2,
  Unlock,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { unzip } from 'fflate';
import type { ThemeConfig } from '../../lib/theme';
import { apiFetch } from '../../aerie';
import { cn } from '../../lib/utils';
import {
  EDGE_PRESETS,
  TAPE_PRESETS,
  createTapeDataURL,
  nextMaterialSeed,
  readImageDimensions,
} from './materials';
import { abrTipToPng, parseAbrInWorker } from './abr';
import {
  EMPTY_PHOTO_ADJUSTMENTS,
  PHOTO_ADJUSTMENT_SPECS,
  PHOTO_LOOK_PRESETS,
  normalizePhotoAdjustments,
  photoAdjustmentValue,
  photoAdjustmentsEqual,
  photoAdjustmentsHaveChanges,
  setPhotoAdjustmentValue,
} from './photo-adjustments';
import { PressPhotoRenderer, isCancelledPhotoRender } from './photo-renderer';
import type {
  BorderPresetId,
  EdgePresetId,
  PackItemMaterialRecipe,
  PhotoAdjustmentStackV1,
  PhotoAdjustmentType,
  PhotoMaterialRecipe,
  PressFileRef,
  PressMaterialRecipe,
  PressSceneDocumentV1,
  TapeMaterialRecipe,
  TapePresetId,
  UploadedFile,
} from './types';
import { PRESS_WORKSPACE_COLOR, parsePressScene } from './types';

declare global {
  interface Window {
    EXCALIDRAW_ASSET_PATH?: string;
  }
}

if (typeof window !== 'undefined') window.EXCALIDRAW_ASSET_PATH = '/excalidraw-assets/';

interface PressEditorProps {
  issue: PressIssue;
  spread: PressSpread;
  assets: PressAsset[];
  themeConfig: ThemeConfig;
  themeMode: 'light' | 'dark';
  onSaveStatusChange: (status: SaveStatus) => void;
  onSpreadSaved: (spread: PressSpread) => void;
  onAssetChanged: (asset: PressAsset) => void;
}

type SaveStatus = 'loading' | 'clean' | 'dirty' | 'saving' | 'error';
type MaterialTab = 'edges' | 'borders' | 'tape' | 'packs';
type ImageFitMode = 'fit' | 'fill' | 'stretch' | 'center';

interface SceneSnapshot {
  elements: readonly ExcalidrawElement[];
  appState: AppState;
  files: BinaryFiles;
}

interface PhotoLabPreview {
  fileId: FileId;
  mimeType: BinaryFileData['mimeType'];
  width: number;
  height: number;
}

interface PhotoLabSession {
  targetId: string;
  openingElement: ExcalidrawImageElement;
  openingRecipe: PhotoMaterialRecipe;
  source: Blob;
  draft: PhotoAdjustmentStackV1;
  beforePreview: PhotoLabPreview | null;
  afterPreview: PhotoLabPreview | null;
  rendering: boolean;
}

function sceneContentSignature(elements: readonly ExcalidrawElement[], gridSize: number | null | undefined): string {
  // Selection, menus, zoom, and panning all trigger Excalidraw onChange. None
  // of those make the spread dirty. Element order/version and the one persisted
  // app-state field are the actual Press document boundary.
  return `${gridSize ?? 'none'}|${elements.map((element) => [
    element.id,
    element.version,
    element.versionNonce,
    element.isDeleted ? 1 : 0,
  ].join(':')).join('|')}`;
}

function fileToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error('Could not read file'));
    reader.readAsDataURL(blob);
  });
}

async function uploadBlob(blob: Blob, filename: string): Promise<UploadedFile> {
  const body = new FormData();
  body.append('file', blob, filename);
  const response = await apiFetch('/api/files', { method: 'POST', body });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(payload.error || 'Could not upload material');
  }
  return response.json() as Promise<UploadedFile>;
}

async function uploadPressItemBlob(blob: Blob, filename: string): Promise<UploadedFile> {
  const body = new FormData();
  body.append('file', blob, filename);
  const response = await apiFetch('/api/press/item-files', { method: 'POST', body });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(payload.error || 'Could not stock Press material');
  }
  return response.json() as Promise<UploadedFile>;
}

async function uploadPressSource(file: File): Promise<UploadedFile> {
  const body = new FormData();
  body.append('file', file, file.name);
  const response = await apiFetch('/api/press/sources', { method: 'POST', body });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(payload.error || 'Could not retain the original Press source');
  }
  return response.json() as Promise<UploadedFile>;
}

function materialRecipe(element: ExcalidrawElement | null): PressMaterialRecipe | null {
  if (!element?.customData || typeof element.customData !== 'object') return null;
  const press = (element.customData as { press?: unknown }).press;
  if (!press || typeof press !== 'object' || typeof (press as { kind?: unknown }).kind !== 'string') return null;
  return press as PressMaterialRecipe;
}

function isImageElement(element: ExcalidrawElement | null): element is ExcalidrawImageElement {
  return element?.type === 'image';
}

function selectedFrom(snapshot: SceneSnapshot): ExcalidrawElement | null {
  const ids = snapshot.appState.selectedElementIds || {};
  const id = Object.keys(ids).find((candidate) => ids[candidate]);
  return id ? snapshot.elements.find((element) => element.id === id && !element.isDeleted) || null : null;
}

function createPageElement(spreadId: string, scene: PressSceneDocumentV1): ExcalidrawElement {
  return convertToExcalidrawElements([{
    id: `press-page-${spreadId}`,
    type: 'rectangle',
    x: scene.page.x,
    y: scene.page.y,
    width: scene.page.width,
    height: scene.page.height,
    backgroundColor: scene.page.background,
    fillStyle: 'solid',
    strokeColor: '#9f9484',
    strokeWidth: 1,
    strokeStyle: 'solid',
    roughness: 0,
    opacity: 100,
    locked: true,
    customData: { press: { kind: 'page' } },
  }], { regenerateIds: false })[0] as ExcalidrawElement;
}

function createPageShadowElement(spreadId: string, scene: PressSceneDocumentV1): ExcalidrawElement {
  return convertToExcalidrawElements([{
    id: `press-page-shadow-${spreadId}`,
    type: 'rectangle',
    x: scene.page.x,
    y: scene.page.y,
    width: scene.page.width,
    height: scene.page.height,
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeColor: '#000000',
    strokeWidth: 12,
    roughness: 0,
    opacity: 48,
    locked: true,
    customData: { press: { kind: 'page-shadow' } },
  }], { regenerateIds: false })[0] as ExcalidrawElement;
}

function pressKind(element: ExcalidrawElement): string | null {
  return (element.customData as { press?: { kind?: string } } | undefined)?.press?.kind || null;
}

function normalizePressChrome(
  elements: readonly ExcalidrawElement[],
  spreadId: string,
  scene: PressSceneDocumentV1,
): ExcalidrawElement[] {
  const existingPage = elements.find((element) => pressKind(element) === 'page');
  const page = existingPage
    ? newElementWith(existingPage, {
      x: scene.page.x,
      y: scene.page.y,
      width: scene.page.width,
      height: scene.page.height,
      backgroundColor: scene.page.background,
      strokeColor: '#9f9484',
      strokeWidth: 1,
      roughness: 0,
      opacity: 100,
      locked: true,
    })
    : createPageElement(spreadId, scene);
  const content = elements.filter((element) => {
    const kind = pressKind(element);
    return kind !== 'page' && kind !== 'page-shadow';
  });
  return [createPageShadowElement(spreadId, scene), page, ...content];
}

async function hydrateFiles(refs: Record<string, PressFileRef>): Promise<BinaryFiles> {
  const entries = await Promise.all(Object.entries(refs).map(async ([id, ref]) => {
    try {
      let dataURL = ref.inlineDataURL;
      if (!dataURL && ref.storageFileId) {
        const response = await apiFetch(`/api/files/${ref.storageFileId}`);
        if (!response.ok) return null;
        dataURL = await fileToDataURL(await response.blob());
      }
      if (!dataURL) return null;
      const file: BinaryFileData = {
        id: id as FileId,
        dataURL: dataURL as DataURL,
        mimeType: ref.mimeType as BinaryFileData['mimeType'],
        created: Date.now(),
        lastRetrieved: Date.now(),
      };
      return [id, file] as const;
    } catch {
      return null;
    }
  }));
  return Object.fromEntries(entries.filter((entry): entry is readonly [string, BinaryFileData] => !!entry)) as BinaryFiles;
}

function safeFilename(value: string): string {
  return value.trim().replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 90) || 'press-spread';
}

const PACK_IMAGE_MIMES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
};

function extensionOf(value: string): string {
  return value.split('.').pop()?.toLowerCase() || '';
}

function packNameFromFile(value: string): string {
  return value.replace(/\.(excalidrawlib|abr|zip|png|jpe?g|webp|gif|svg)$/i, '').trim() || 'Imported pack';
}

function packMetadata(pack: PressPack): Record<string, unknown> {
  try {
    const parsed = JSON.parse(pack.metadata_json || '{}') as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

async function sanitizeSvg(file: Blob): Promise<Blob> {
  const document = new DOMParser().parseFromString(await file.text(), 'image/svg+xml');
  if (document.querySelector('parsererror') || document.documentElement.tagName.toLowerCase() !== 'svg') {
    throw new Error('That SVG could not be read safely.');
  }
  document.querySelectorAll('script, foreignObject, iframe, object, embed').forEach((node) => node.remove());
  document.querySelectorAll('style').forEach((node) => {
    if (/@import|url\s*\(\s*['"]?(?!#|data:image\/(?:png|jpeg|jpg|webp|gif))/i.test(node.textContent || '')) node.remove();
  });
  document.querySelectorAll('*').forEach((node) => {
    [...node.attributes].forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim().toLowerCase();
      if (name.startsWith('on')
        || (name === 'style' && /@import|url\s*\(\s*['"]?(?!#|data:image\/(?:png|jpeg|jpg|webp|gif))/i.test(value))
        || ((name === 'href' || name === 'xlink:href' || name === 'src')
          && !value.startsWith('#') && !/^data:image\/(?:png|jpeg|jpg|webp|gif)[;,]/.test(value))) {
        node.removeAttribute(attribute.name);
      }
    });
  });
  return new Blob([new XMLSerializer().serializeToString(document)], { type: 'image/svg+xml' });
}

async function rasterizeSvg(file: Blob): Promise<{ blob: Blob; width: number; height: number }> {
  const source = await readImageDimensions(file);
  const longEdge = Math.max(source.width, source.height, 1);
  const scale = Math.min(1536 / longEdge, Math.max(1, 1024 / longEdge));
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const value = new Image();
      value.onload = () => resolve(value);
      value.onerror = () => reject(new Error('That SVG could not be rasterized safely.'));
      value.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas is unavailable');
    context.drawImage(image, 0, 0, width, height);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((value) => value ? resolve(value) : reject(new Error('Could not create SVG stamp')), 'image/png');
    });
    return { blob, width, height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function libraryItemsFromPackItems(items: readonly PressPackItem[]): LibraryItem[] {
  const library: LibraryItem[] = [];
  items.forEach((item) => {
    if (item.kind !== 'excalidraw' || !item.data_json) return;
    try {
      const parsed = JSON.parse(item.data_json) as LibraryItem;
      if (parsed && typeof parsed.id === 'string' && Array.isArray(parsed.elements)) library.push(parsed);
    } catch {
      // A single malformed imported object should not keep the rest of a pack closed.
    }
  });
  return library;
}

function unzipArchive(data: Uint8Array): Promise<Record<string, Uint8Array>> {
  return new Promise((resolve, reject) => {
    unzip(data, (error, files) => error ? reject(error) : resolve(files));
  });
}

export default function PressEditor({
  issue,
  spread,
  assets,
  themeConfig,
  themeMode,
  onSaveStatusChange,
  onSpreadSaved,
  onAssetChanged,
}: PressEditorProps) {
  const colors = themeConfig[themeMode];
  const [initialData, setInitialData] = useState<ExcalidrawInitialDataState | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('loading');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [materialTab, setMaterialTab] = useState<MaterialTab>('edges');
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectionKey, setSelectionKey] = useState('none');
  const [tapeColor, setTapeColor] = useState('#d7b77d');
  const [tapeOpacity, setTapeOpacity] = useState(78);
  const [packs, setPacks] = useState<PressPack[]>([]);
  const [packItems, setPackItems] = useState<PressPackItem[]>([]);
  const [packQuery, setPackQuery] = useState('');
  const [snappingEnabled, setSnappingEnabled] = useState(true);
  const [photoLab, setPhotoLab] = useState<PhotoLabSession | null>(null);
  const [activePhotoAdjustment, setActivePhotoAdjustment] = useState<PhotoAdjustmentType>('exposure');
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const packInputRef = useRef<HTMLInputElement | null>(null);
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const sceneRef = useRef(parsePressScene(spread.scene_json, issue.page_width, issue.page_height));
  const fileRefsRef = useRef<Record<string, PressFileRef>>(sceneRef.current.files);
  const latestRef = useRef<SceneSnapshot | null>(null);
  const selectedRef = useRef<ExcalidrawElement | null>(null);
  const rememberedSelectionIdsRef = useRef<Readonly<Record<string, true>>>({});
  const selectionHoldUntilRef = useRef(0);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());
  const contentSignatureRef = useRef<string | null>(null);
  const editorReadyRef = useRef(false);
  const mountedRef = useRef(true);
  const onSpreadSavedRef = useRef(onSpreadSaved);
  const onAssetChangedRef = useRef(onAssetChanged);
  const onSaveStatusChangeRef = useRef(onSaveStatusChange);
  const packItemsRef = useRef<PressPackItem[]>([]);
  const fittedSpreadRef = useRef<string | null>(null);
  const photoLabRef = useRef<PhotoLabSession | null>(null);
  const photoLabSessionRef = useRef<{ targetId: string } | null>(null);
  const photoRendererRef = useRef<PressPhotoRenderer | null>(null);
  const photoPreviewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const photoPreviewGenerationRef = useRef(0);
  const photoLabBeforeHeldRef = useRef(false);

  useEffect(() => { onSpreadSavedRef.current = onSpreadSaved; }, [onSpreadSaved]);
  useEffect(() => { onAssetChangedRef.current = onAssetChanged; }, [onAssetChanged]);
  useEffect(() => { onSaveStatusChangeRef.current = onSaveStatusChange; }, [onSaveStatusChange]);
  useEffect(() => { packItemsRef.current = packItems; }, [packItems]);
  useEffect(() => { onSaveStatusChangeRef.current(saveStatus); }, [saveStatus]);
  useEffect(() => {
    if (!notice || busy) return;
    const timer = window.setTimeout(() => setNotice(null), 4200);
    return () => window.clearTimeout(timer);
  }, [notice, busy]);

  useEffect(() => () => {
    if (photoPreviewTimerRef.current) clearTimeout(photoPreviewTimerRef.current);
    photoRendererRef.current?.close();
  }, []);

  const selected = selectedRef.current;
  const selectedRecipe = materialRecipe(selected);
  const selectedPhoto = isImageElement(selected) && selectedRecipe?.kind === 'photo'
    ? selectedRecipe as PhotoMaterialRecipe
    : null;
  const selectedTape = isImageElement(selected) && selectedRecipe?.kind === 'tape'
    ? selectedRecipe as TapeMaterialRecipe
    : null;
  const selectedCanFit = isImageElement(selected)
    && selectedRecipe?.kind !== 'tape'
    && pressKind(selected) !== 'page'
    && pressKind(selected) !== 'page-shadow';

  useEffect(() => {
    if (!selectedTape || !selectedRef.current) return;
    setTapeColor(selectedTape.color);
    setTapeOpacity(selectedRef.current.opacity);
  }, [selectionKey]);

  useEffect(() => {
    mountedRef.current = true;
    editorReadyRef.current = false;
    const scene = sceneRef.current;
    void (async () => {
      const files = await hydrateFiles(scene.files);
      const elements = normalizePressChrome(scene.elements, spread.id, scene);
      if (!mountedRef.current) return;
      contentSignatureRef.current = sceneContentSignature(elements, scene.appState.gridSize);
      setInitialData({
        elements,
        appState: {
          viewBackgroundColor: PRESS_WORKSPACE_COLOR,
          gridSize: scene.appState.gridSize ?? null,
          // Excalidraw dark mode pre-inverts raster images and then inverts the
          // whole canvas back with CSS. Press paper has fixed print colors, so
          // keep the drawing engine in its color-accurate light render path;
          // press.css still skins every control with the active Aerie palette.
          theme: 'light',
          objectsSnapModeEnabled: snappingEnabled,
        },
        files,
        scrollToContent: false,
      });
      editorReadyRef.current = true;
      setSaveStatus('clean');
    })();
    return () => { mountedRef.current = false; };
  }, [spread.id]);

  const syncNativeLibrary = useCallback((items: readonly PressPackItem[], merge = true, openLibraryMenu = false) => {
    const api = apiRef.current;
    if (!api) return;
    const libraryItems = libraryItemsFromPackItems(items);
    void api.updateLibrary({
      libraryItems,
      merge,
      openLibraryMenu,
      defaultStatus: 'published',
    });
  }, []);

  const loadPacks = useCallback(async () => {
    try {
      const response = await apiFetch('/api/press/packs');
      if (!response.ok) throw new Error('The pack shelves would not open');
      const data = await response.json() as { packs?: PressPack[]; items?: PressPackItem[] };
      const nextPacks = data.packs || [];
      const nextItems = data.items || [];
      setPacks(nextPacks);
      setPackItems(nextItems);
      packItemsRef.current = nextItems;
      syncNativeLibrary(nextItems, true);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not load Press packs');
    }
  }, [syncNativeLibrary]);

  useEffect(() => { void loadPacks(); }, [loadPacks]);

  const buildDocument = useCallback((snapshot: SceneSnapshot): PressSceneDocumentV1 => {
    const neededFiles = new Set<string>();
    snapshot.elements.forEach((element) => {
      if (!element.isDeleted && element.type === 'image' && element.fileId) neededFiles.add(element.fileId);
    });
    const files: Record<string, PressFileRef> = {};
    neededFiles.forEach((id) => {
      const ref = fileRefsRef.current[id];
      if (ref) files[id] = ref;
    });
    return {
      version: 1,
      page: sceneRef.current.page,
      elements: [...snapshot.elements],
      appState: {
        viewBackgroundColor: PRESS_WORKSPACE_COLOR,
        gridSize: snapshot.appState.gridSize ?? null,
      },
      files,
    };
  }, []);

  // The shelf shows a picture of each issue, and that picture is this spread exported
  // small. It rides AFTER a successful save, in its own request, and every failure is
  // swallowed on purpose: a thumbnail must never be able to cost the user the save it came
  // from. Throttled, because an autosave can fire every few seconds and an export plus
  // an upload is far more expensive than the scene write it is following.
  const lastThumbAtRef = useRef(0);
  const refreshThumbnail = useCallback(async () => {
    const api = apiRef.current;
    if (!api) return;
    const now = Date.now();
    if (now - lastThumbAtRef.current < 45_000) return;
    lastThumbAtRef.current = now;
    try {
      const blob = await exportToBlob({
        elements: api.getSceneElements().filter((element) => !element.isDeleted && pressKind(element) !== 'page-shadow'),
        appState: {
          ...api.getAppState(),
          exportBackground: true,
          viewBackgroundColor: sceneRef.current.page.background,
        },
        files: api.getFiles(),
        mimeType: 'image/png',
        exportPadding: 0,
        // exportScale in appState is NOT read by this path — it is honoured by
        // exportToSvg, not exportToBlob, so setting it there exported the page at
        // full size and produced a 3 MB thumbnail. maxWidthOrHeight is the option
        // exportToBlob actually takes.
        maxWidthOrHeight: 480,
      });
      const uploaded = await uploadBlob(blob, `press-thumb-${spread.id}.png`);
      await apiFetch(`/api/press/spreads/${spread.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ thumbnailFileId: uploaded.fileId }),
      });
    } catch {
      // Silent by design. The spread is saved either way; the shelf just stays blank.
      lastThumbAtRef.current = 0;
    }
  }, [spread.id]);

  const enqueueSave = useCallback((
    snapshot: SceneSnapshot,
    reportStatus = true,
    signature = sceneContentSignature(snapshot.elements, snapshot.appState.gridSize),
  ) => {
    const document = buildDocument(snapshot);
    saveChainRef.current = saveChainRef.current.then(async () => {
      if (reportStatus && mountedRef.current) setSaveStatus('saving');
      try {
        const response = await apiFetch(`/api/press/spreads/${spread.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sceneJson: document }),
        });
        if (!response.ok) throw new Error('Autosave failed');
        const { spread: saved } = await response.json() as { spread: PressSpread };
        if (mountedRef.current) {
          sceneRef.current = document;
          const currentSignature = latestRef.current
            ? sceneContentSignature(latestRef.current.elements, latestRef.current.appState.gridSize)
            : signature;
          setSaveStatus(currentSignature === signature ? 'clean' : 'dirty');
          onSpreadSavedRef.current(saved);
          // Deliberately not awaited — the save is already done and reported.
          void refreshThumbnail();
        }
      } catch (error) {
        console.error('[Press] Save failed:', error);
        if (mountedRef.current) setSaveStatus('error');
      }
    });
  }, [buildDocument, spread.id, refreshThumbnail]);

  const scheduleSave = useCallback((snapshot: SceneSnapshot, signature: string) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setSaveStatus('dirty');
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      enqueueSave(snapshot, true, signature);
    }, 850);
  }, [enqueueSave]);

  useEffect(() => () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    if (latestRef.current && !photoLabSessionRef.current) enqueueSave(latestRef.current, false);
  }, [enqueueSave]);

  function updateSelection(snapshot: SceneSnapshot) {
    let next = selectedFrom(snapshot);
    const selectedIds = Object.fromEntries(
      Object.entries(snapshot.appState.selectedElementIds || {}).filter(([, value]) => value),
    ) as Record<string, true>;
    if (next) {
      rememberedSelectionIdsRef.current = selectedIds;
    } else if (Date.now() < selectionHoldUntilRef.current || snapshot.appState.openMenu === 'canvas') {
      const rememberedId = Object.keys(rememberedSelectionIdsRef.current)[0];
      next = rememberedId
        ? snapshot.elements.find((element) => element.id === rememberedId && !element.isDeleted) || null
        : null;
    } else {
      rememberedSelectionIdsRef.current = {};
    }
    selectedRef.current = next;
    const recipe = materialRecipe(next);
    const imageState = next?.type === 'image' ? `${next.fileId}:${next.opacity}` : '';
    const key = next ? `${next.id}:${recipe?.kind || next.type}:${imageState}` : 'none';
    setSelectionKey((current) => current === key ? current : key);
  }

  function handleChange(
    elements: readonly ExcalidrawElement[],
    appState: AppState,
    files: BinaryFiles,
  ) {
    const snapshot = { elements, appState, files };
    latestRef.current = snapshot;
    updateSelection(snapshot);
    // Photo Lab preview file swaps are deliberately ephemeral. The final
    // recipe/file pair is saved once on Done; Cancel restores the opening
    // element without ever teaching autosave about temporary preview IDs.
    if (photoLabSessionRef.current) return;
    const signature = sceneContentSignature(elements, appState.gridSize);
    if (signature === contentSignatureRef.current) return;
    contentSignatureRef.current = signature;
    if (editorReadyRef.current) scheduleSave(snapshot, signature);
  }

  function openMaterialSheet(tab?: MaterialTab) {
    const api = apiRef.current;
    if (tab) setMaterialTab(tab);
    if (api) {
      const ids = Object.fromEntries(
        Object.entries(api.getAppState().selectedElementIds || {}).filter(([, value]) => value),
      ) as Record<string, true>;
      if (Object.keys(ids).length) rememberedSelectionIdsRef.current = ids;
    }
    selectionHoldUntilRef.current = Date.now() + 700;
    setSheetOpen(true);

    // MainMenu closes itself after onSelect and can clear canvas selection as
    // part of that close. Restore the exact selection after both commits land.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const currentApi = apiRef.current;
      const remembered = rememberedSelectionIdsRef.current;
      if (!currentApi || !Object.keys(remembered).length) return;
      const current = currentApi.getAppState().selectedElementIds || {};
      if (!Object.values(current).some(Boolean)) {
        currentApi.updateScene({
          appState: { selectedElementIds: remembered },
          captureUpdate: CaptureUpdateAction.EVENTUALLY,
        });
      }
      selectionHoldUntilRef.current = 0;
    }));
  }

  async function createPhotoAsset(file: File, uploaded: UploadedFile): Promise<PressAsset> {
    const response = await apiFetch('/api/press/assets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        issueId: issue.id,
        spreadId: spread.id,
        name: file.name,
        kind: 'photo',
        sourceFileId: uploaded.fileId,
        renderedFileId: uploaded.fileId,
        mimeType: uploaded.mimeType,
        recipe: { edgePreset: 'clean', seed: nextMaterialSeed(), adjustments: EMPTY_PHOTO_ADJUSTMENTS },
      }),
    });
    if (!response.ok) throw new Error('Could not register photo in The Press');
    return (await response.json() as { asset: PressAsset }).asset;
  }

  async function importPhoto(file: File) {
    const api = apiRef.current;
    if (!api) return;
    if (!file.type.startsWith('image/')) {
      setNotice('The Press needs an image file here.');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setNotice('That image is over the current 10 MB import limit.');
      return;
    }
    setBusy('Importing photo');
    setNotice(null);
    try {
      const [{ width: naturalWidth, height: naturalHeight }, dataURL, uploaded] = await Promise.all([
        readImageDimensions(file),
        fileToDataURL(file),
        uploadBlob(file, file.name || 'press-photo'),
      ]);
      const asset = await createPhotoAsset(file, uploaded);
      onAssetChangedRef.current(asset);
      const seed = (() => {
        try { return (JSON.parse(asset.recipe_json) as { seed?: number }).seed || nextMaterialSeed(); }
        catch { return nextMaterialSeed(); }
      })();
      const fileId = uploaded.fileId as FileId;
      const recipe: PhotoMaterialRecipe = {
        kind: 'photo',
        assetId: asset.id,
        sourceFileId: uploaded.fileId,
        renderedFileId: uploaded.fileId,
        edgePreset: 'clean',
        seed,
        adjustments: { version: 1, items: [] },
      };
      fileRefsRef.current[fileId] = {
        id: fileId,
        kind: 'photo',
        mimeType: uploaded.mimeType,
        storageFileId: uploaded.fileId,
        sourceFileId: uploaded.fileId,
        assetId: asset.id,
        recipe,
      };
      api.addFiles([{
        id: fileId,
        dataURL: dataURL as DataURL,
        mimeType: uploaded.mimeType as BinaryFileData['mimeType'],
        created: Date.now(),
      }]);

      const page = sceneRef.current.page;
      const scale = Math.min((page.width * 0.64) / naturalWidth, (page.height * 0.62) / naturalHeight, 1);
      const width = Math.max(80, naturalWidth * scale);
      const height = Math.max(80, naturalHeight * scale);
      const element = convertToExcalidrawElements([{
        id: crypto.randomUUID(),
        type: 'image',
        x: page.x + page.width / 2 - width / 2,
        y: page.y + page.height / 2 - height / 2,
        width,
        height,
        fileId,
        status: 'saved',
        scale: [1, 1],
        customData: { press: recipe },
      }], { regenerateIds: false })[0] as ExcalidrawImageElement;
      const elements = [...api.getSceneElements(), element];
      api.updateScene({
        elements,
        appState: { selectedElementIds: { [element.id]: true } },
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
      selectedRef.current = element;
      rememberedSelectionIdsRef.current = { [element.id]: true };
      setSelectionKey(`${element.id}:${element.version}:photo`);
      openMaterialSheet('edges');
      setNotice('Photo placed. Pick an edge or leave it clean.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not import photo');
    } finally {
      setBusy(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function fetchFileBlob(fileId: string): Promise<Blob> {
    const response = await apiFetch(`/api/files/${fileId}`);
    if (!response.ok) throw new Error('The original photo could not be loaded');
    return response.blob();
  }

  function replacePhotoLabState(next: PhotoLabSession | null) {
    photoLabRef.current = next;
    setPhotoLab(next);
  }

  function patchPhotoLabState(patch: Partial<PhotoLabSession>) {
    const current = photoLabRef.current;
    if (!current) return;
    replacePhotoLabState({ ...current, ...patch });
  }

  function photoCropAtSize(
    opening: ExcalidrawImageElement,
    width: number,
    height: number,
  ): ExcalidrawImageElement['crop'] {
    if (!opening.crop) return null;
    return {
      x: opening.crop.x * (width / opening.crop.naturalWidth),
      y: opening.crop.y * (height / opening.crop.naturalHeight),
      width: opening.crop.width * (width / opening.crop.naturalWidth),
      height: opening.crop.height * (height / opening.crop.naturalHeight),
      naturalWidth: width,
      naturalHeight: height,
    };
  }

  function showPhotoLabFile(preview: PhotoLabPreview) {
    const api = apiRef.current;
    const session = photoLabRef.current;
    if (!api || !session) return;
    const target = api.getSceneElements().find((element) => element.id === session.targetId);
    if (!target || !isImageElement(target)) return;
    const updated = newElementWith(target, {
      fileId: preview.fileId,
      status: 'saved',
      crop: photoCropAtSize(session.openingElement, preview.width, preview.height),
      customData: session.openingElement.customData,
    }) as ExcalidrawImageElement;
    api.updateScene({
      elements: api.getSceneElements().map((element) => element.id === updated.id ? updated : element),
      appState: { selectedElementIds: { [updated.id]: true } },
      captureUpdate: CaptureUpdateAction.NEVER,
    });
    selectedRef.current = updated;
    rememberedSelectionIdsRef.current = { [updated.id]: true };
    setSelectionKey(`${updated.id}:${updated.version}:photo-preview`);
  }

  function showPhotoLabOpening() {
    const api = apiRef.current;
    const session = photoLabRef.current;
    if (!api || !session) return;
    const target = api.getSceneElements().find((element) => element.id === session.targetId);
    if (!target || !isImageElement(target)) return;
    const opening = session.openingElement;
    const updated = newElementWith(target, {
      fileId: opening.fileId,
      status: opening.status,
      crop: opening.crop,
      customData: opening.customData,
    }) as ExcalidrawImageElement;
    api.updateScene({
      elements: api.getSceneElements().map((element) => element.id === updated.id ? updated : element),
      appState: { selectedElementIds: { [updated.id]: true } },
      captureUpdate: CaptureUpdateAction.NEVER,
    });
    selectedRef.current = updated;
    rememberedSelectionIdsRef.current = { [updated.id]: true };
    setSelectionKey(`${updated.id}:${updated.version}:photo`);
  }

  async function registerPhotoLabPreview(
    rendered: { blob: Blob; width: number; height: number; mimeType: string },
  ): Promise<PhotoLabPreview> {
    const api = apiRef.current;
    if (!api) throw new Error('The darkroom canvas closed.');
    const fileId = `press-preview-${crypto.randomUUID()}` as FileId;
    const mimeType = (rendered.mimeType || rendered.blob.type || 'image/webp') as BinaryFileData['mimeType'];
    const dataURL = await fileToDataURL(rendered.blob);
    api.addFiles([{
      id: fileId,
      dataURL: dataURL as DataURL,
      mimeType,
      created: Date.now(),
    }]);
    return { fileId, mimeType, width: rendered.width, height: rendered.height };
  }

  async function renderPhotoLabPreview(draft: PhotoAdjustmentStackV1, generation: number) {
    const renderer = photoRendererRef.current;
    const opening = photoLabRef.current;
    if (!renderer || !opening || generation !== photoPreviewGenerationRef.current) return;
    patchPhotoLabState({ rendering: true });
    try {
      const rendered = await renderer.render({
        adjustments: draft,
        edgePreset: opening.openingRecipe.edgePreset,
        seed: opening.openingRecipe.seed,
        maxDimension: 960,
        format: 'preview',
      });
      if (generation !== photoPreviewGenerationRef.current || !photoLabRef.current) return;
      const afterPreview = await registerPhotoLabPreview(rendered);
      if (generation !== photoPreviewGenerationRef.current || !photoLabRef.current) return;
      const unadjusted = !photoAdjustmentsHaveChanges(draft);
      patchPhotoLabState({
        afterPreview,
        beforePreview: photoLabRef.current.beforePreview || (unadjusted ? afterPreview : null),
        rendering: false,
      });
      if (!photoLabBeforeHeldRef.current) showPhotoLabFile(afterPreview);

      // Prepare the zero-adjustment comparison after the visible render. A
      // new slider movement cancels this background job immediately.
      const current = photoLabRef.current;
      if (current && !current.beforePreview) {
        try {
          const before = await renderer.render({
            adjustments: EMPTY_PHOTO_ADJUSTMENTS,
            edgePreset: current.openingRecipe.edgePreset,
            seed: current.openingRecipe.seed,
            maxDimension: 960,
            format: 'preview',
          });
          if (generation !== photoPreviewGenerationRef.current || !photoLabRef.current) return;
          const beforePreview = await registerPhotoLabPreview(before);
          if (generation === photoPreviewGenerationRef.current && photoLabRef.current) {
            patchPhotoLabState({ beforePreview });
          }
        } catch (error) {
          if (!isCancelledPhotoRender(error)) throw error;
        }
      }
    } catch (error) {
      if (!isCancelledPhotoRender(error)) {
        patchPhotoLabState({ rendering: false });
        setNotice(error instanceof Error ? error.message : 'The darkroom preview did not develop.');
      }
    }
  }

  function queuePhotoLabPreview(draft: PhotoAdjustmentStackV1, delay = 140) {
    if (photoPreviewTimerRef.current) clearTimeout(photoPreviewTimerRef.current);
    const generation = ++photoPreviewGenerationRef.current;
    photoPreviewTimerRef.current = setTimeout(() => {
      photoPreviewTimerRef.current = null;
      void renderPhotoLabPreview(draft, generation);
    }, delay);
  }

  function updatePhotoLabDraft(draft: PhotoAdjustmentStackV1) {
    const current = photoLabRef.current;
    if (!current) return;
    const normalized = normalizePhotoAdjustments(draft);
    replacePhotoLabState({ ...current, draft: normalized });
    queuePhotoLabPreview(normalized);
  }

  async function openPhotoLab() {
    const target = selectedRef.current;
    const recipe = materialRecipe(target);
    if (!target || !isImageElement(target) || recipe?.kind !== 'photo') {
      setNotice('Select an imported photo first.');
      return;
    }
    setBusy('Opening the Photo Lab');
    setNotice(null);
    setSheetOpen(false);
    try {
      const source = await fetchFileBlob(recipe.sourceFileId);
      photoRendererRef.current?.close();
      photoRendererRef.current = new PressPhotoRenderer(recipe.sourceFileId, source);
      const adjustments = normalizePhotoAdjustments(recipe.adjustments);
      const openingRecipe: PhotoMaterialRecipe = { ...recipe, adjustments };
      const session: PhotoLabSession = {
        targetId: target.id,
        openingElement: target,
        openingRecipe,
        source,
        draft: adjustments,
        beforePreview: null,
        afterPreview: null,
        rendering: false,
      };
      photoLabSessionRef.current = { targetId: target.id };
      photoLabBeforeHeldRef.current = false;
      replacePhotoLabState(session);
      const firstActive = adjustments.items.find((item) => item.enabled)?.type || 'exposure';
      setActivePhotoAdjustment(firstActive);
      queuePhotoLabPreview(adjustments, 0);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'The Photo Lab would not open.');
    } finally {
      setBusy(null);
    }
  }

  function finishPhotoLab(persist: boolean) {
    if (photoPreviewTimerRef.current) clearTimeout(photoPreviewTimerRef.current);
    photoPreviewTimerRef.current = null;
    ++photoPreviewGenerationRef.current;
    photoRendererRef.current?.close();
    photoRendererRef.current = null;
    photoLabBeforeHeldRef.current = false;
    replacePhotoLabState(null);
    requestAnimationFrame(() => {
      const api = apiRef.current;
      photoLabSessionRef.current = null;
      if (!api) return;
      const snapshot: SceneSnapshot = {
        elements: api.getSceneElements(),
        appState: api.getAppState(),
        files: api.getFiles(),
      };
      latestRef.current = snapshot;
      updateSelection(snapshot);
      const signature = sceneContentSignature(snapshot.elements, snapshot.appState.gridSize);
      contentSignatureRef.current = signature;
      if (persist) enqueueSave(snapshot, true, signature);
    });
  }

  function cancelPhotoLab() {
    if (!photoLabRef.current || busy) return;
    showPhotoLabOpening();
    finishPhotoLab(false);
    setNotice('Photo Lab changes cancelled.');
  }

  function holdPhotoLabBefore(event: React.PointerEvent<HTMLButtonElement>) {
    const before = photoLabRef.current?.beforePreview;
    if (!before) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    photoLabBeforeHeldRef.current = true;
    showPhotoLabFile(before);
  }

  function releasePhotoLabBefore(event?: React.PointerEvent<HTMLButtonElement>) {
    if (event?.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!photoLabBeforeHeldRef.current) return;
    photoLabBeforeHeldRef.current = false;
    const after = photoLabRef.current?.afterPreview;
    if (after) showPhotoLabFile(after);
    else showPhotoLabOpening();
  }

  async function commitPhotoLab() {
    const api = apiRef.current;
    const session = photoLabRef.current;
    const renderer = photoRendererRef.current;
    if (!api || !session || !renderer || busy) return;
    if (photoPreviewTimerRef.current) clearTimeout(photoPreviewTimerRef.current);
    photoPreviewTimerRef.current = null;
    ++photoPreviewGenerationRef.current;
    if (photoAdjustmentsEqual(session.openingRecipe.adjustments, session.draft)) {
      showPhotoLabOpening();
      finishPhotoLab(false);
      setNotice('The original Photo Lab recipe is unchanged.');
      return;
    }

    setBusy('Developing print-resolution photo');
    setNotice(null);
    try {
      const adjustments = normalizePhotoAdjustments(session.draft);
      const canUseSource = session.openingRecipe.edgePreset === 'clean'
        && !photoAdjustmentsHaveChanges(adjustments);
      let renderedFileId = session.openingRecipe.sourceFileId;
      let mimeType = session.source.type || 'image/png';
      let dataURL: string;
      let renderedNatural: { width: number; height: number };

      if (canUseSource) {
        dataURL = await fileToDataURL(session.source);
        renderedNatural = await readImageDimensions(session.source);
      } else {
        const page = sceneRef.current.page;
        const rendered = await renderer.render({
          adjustments,
          edgePreset: session.openingRecipe.edgePreset,
          seed: session.openingRecipe.seed,
          maxDimension: Math.max(2400, page.width, page.height),
          format: 'final',
        });
        const uploaded = await uploadBlob(rendered.blob, 'press-photo-lab.png');
        renderedFileId = uploaded.fileId;
        mimeType = uploaded.mimeType;
        dataURL = await fileToDataURL(rendered.blob);
        renderedNatural = { width: rendered.width, height: rendered.height };
      }

      const nextRecipe: PhotoMaterialRecipe = {
        ...session.openingRecipe,
        renderedFileId,
        adjustments,
      };
      const response = await apiFetch(`/api/press/assets/${session.openingRecipe.assetId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ renderedFileId, recipe: nextRecipe }),
      });
      if (!response.ok) throw new Error('The Photo Lab recipe would not save.');
      const asset = (await response.json() as { asset: PressAsset }).asset;
      onAssetChangedRef.current(asset);

      const nextFileId = renderedFileId as FileId;
      fileRefsRef.current[nextFileId] = {
        id: nextFileId,
        kind: 'photo',
        mimeType,
        storageFileId: renderedFileId,
        sourceFileId: session.openingRecipe.sourceFileId,
        assetId: session.openingRecipe.assetId,
        recipe: nextRecipe,
      };
      api.addFiles([{
        id: nextFileId,
        dataURL: dataURL as DataURL,
        mimeType: mimeType as BinaryFileData['mimeType'],
        created: Date.now(),
      }]);
      const current = api.getSceneElements().find((element) => element.id === session.targetId);
      if (!current || !isImageElement(current)) throw new Error('The edited photo left the spread.');
      const updated = newElementWith(current, {
        fileId: nextFileId,
        status: 'saved',
        crop: photoCropAtSize(session.openingElement, renderedNatural.width, renderedNatural.height),
        customData: { ...session.openingElement.customData, press: nextRecipe },
      }) as ExcalidrawImageElement;
      api.updateScene({
        elements: api.getSceneElements().map((element) => element.id === updated.id ? updated : element),
        appState: { selectedElementIds: { [updated.id]: true } },
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
      selectedRef.current = updated;
      rememberedSelectionIdsRef.current = { [updated.id]: true };
      setSelectionKey(`${updated.id}:${updated.version}:photo`);
      finishPhotoLab(true);
      setNotice(canUseSource ? 'Original photo restored.' : 'Photo developed. The original stays untouched.');
    } catch (error) {
      if (!isCancelledPhotoRender(error)) {
        setNotice(error instanceof Error ? error.message : 'The print-resolution photo did not develop.');
      }
    } finally {
      setBusy(null);
    }
  }

  async function applyEdge(preset: EdgePresetId, seed = selectedPhoto?.seed || nextMaterialSeed()) {
    const api = apiRef.current;
    const target = selectedRef.current;
    const recipe = selectedPhoto;
    if (!api || !target || !isImageElement(target) || !recipe) {
      setNotice('Select an imported photo first.');
      return;
    }
    setBusy(preset === 'clean' ? 'Restoring clean edge' : 'Tearing the paper');
    setNotice(null);
    let renderer: PressPhotoRenderer | null = null;
    try {
      const source = await fetchFileBlob(recipe.sourceFileId);
      const adjustments = normalizePhotoAdjustments(recipe.adjustments);
      let renderedFileId = recipe.sourceFileId;
      let mimeType = source.type || 'image/png';
      let dataURL = await fileToDataURL(source);
      let renderedNatural = await readImageDimensions(source);

      if (preset !== 'clean' || photoAdjustmentsHaveChanges(adjustments)) {
        renderer = new PressPhotoRenderer(recipe.sourceFileId, source);
        const page = sceneRef.current.page;
        const rendered = await renderer.render({
          adjustments,
          edgePreset: preset,
          seed,
          maxDimension: Math.max(2400, page.width, page.height),
          format: 'final',
        });
        const uploaded = await uploadBlob(rendered.blob, `press-${preset}.png`);
        renderedFileId = uploaded.fileId;
        mimeType = uploaded.mimeType;
        dataURL = await fileToDataURL(rendered.blob);
        renderedNatural = { width: rendered.width, height: rendered.height };
      }

      const nextRecipe: PhotoMaterialRecipe = {
        ...recipe,
        renderedFileId,
        edgePreset: preset,
        seed,
        adjustments,
      };
      const response = await apiFetch(`/api/press/assets/${recipe.assetId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ renderedFileId, recipe: nextRecipe }),
      });
      if (!response.ok) throw new Error('The edge recipe would not save');
      const asset = (await response.json() as { asset: PressAsset }).asset;
      onAssetChangedRef.current(asset);

      const nextFileId = renderedFileId as FileId;
      fileRefsRef.current[nextFileId] = {
        id: nextFileId,
        kind: 'photo',
        mimeType,
        storageFileId: renderedFileId,
        sourceFileId: recipe.sourceFileId,
        assetId: recipe.assetId,
        recipe: nextRecipe,
      };
      api.addFiles([{
        id: nextFileId,
        dataURL: dataURL as DataURL,
        mimeType: mimeType as BinaryFileData['mimeType'],
        created: Date.now(),
      }]);
      const nextCrop = target.crop ? {
        x: target.crop.x * (renderedNatural.width / target.crop.naturalWidth),
        y: target.crop.y * (renderedNatural.height / target.crop.naturalHeight),
        width: target.crop.width * (renderedNatural.width / target.crop.naturalWidth),
        height: target.crop.height * (renderedNatural.height / target.crop.naturalHeight),
        naturalWidth: renderedNatural.width,
        naturalHeight: renderedNatural.height,
      } : null;
      const updated = newElementWith(target, {
        fileId: nextFileId,
        status: 'saved',
        crop: nextCrop,
        customData: { ...target.customData, press: nextRecipe },
      }) as ExcalidrawImageElement;
      const elements = api.getSceneElements().map((element) => element.id === target.id ? updated : element);
      api.updateScene({
        elements,
        appState: { selectedElementIds: { [updated.id]: true } },
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
      selectedRef.current = updated;
      setSelectionKey(`${updated.id}:${updated.version}:photo`);
      setNotice(preset === 'clean'
        ? (photoAdjustmentsHaveChanges(adjustments) ? 'Clean edge restored; Photo Lab edits kept.' : 'Original edge restored.')
        : `${EDGE_PRESETS.find((item) => item.id === preset)?.label || 'Edge'} applied with real transparency.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not apply edge');
    } finally {
      renderer?.close();
      setBusy(null);
    }
  }

  function addBorder(preset: BorderPresetId) {
    const api = apiRef.current;
    const target = selectedRef.current;
    if (!api || !target || !isImageElement(target) || materialRecipe(target)?.kind !== 'photo') {
      setNotice('Select an imported photo first.');
      return;
    }
    const groupId = crypto.randomUUID();
    const instant = preset === 'instant-film';
    const stitched = preset === 'stitched';
    const inset = instant ? 22 : 8;
    const bottom = instant ? 74 : inset;
    const borderId = crypto.randomUUID();
    const border = convertToExcalidrawElements([{
      id: borderId,
      type: 'rectangle',
      x: target.x - inset,
      y: target.y - inset,
      width: target.width + inset * 2,
      height: target.height + inset + bottom,
      angle: target.angle,
      groupIds: [groupId],
      backgroundColor: instant ? '#f7f0df' : 'transparent',
      fillStyle: 'solid',
      strokeColor: stitched ? '#6b4f35' : instant ? '#e5dccb' : '#1b1714',
      strokeWidth: stitched ? 3 : instant ? 2 : 5,
      strokeStyle: stitched ? 'dashed' : 'solid',
      roughness: preset === 'ink' ? 2 : 0,
      opacity: 100,
      customData: { press: { kind: 'border', preset, targetId: target.id } },
    }], { regenerateIds: false })[0] as ExcalidrawElement;
    const groupedTarget = newElementWith(target, { groupIds: [...target.groupIds, groupId] });
    const current = api.getSceneElements();
    const next: ExcalidrawElement[] = [];
    current.forEach((element) => {
      if (element.id === target.id && instant) next.push(border);
      next.push(element.id === target.id ? groupedTarget : element);
    });
    if (!instant) next.push(border);
    api.updateScene({
      elements: next,
      appState: { selectedElementIds: { [target.id]: true, [border.id]: true } },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    setNotice(`${preset === 'instant-film' ? 'Instant-film' : preset === 'stitched' ? 'Stitched' : 'Ink'} border added as an editable layer.`);
  }

  function addTape(preset: TapePresetId) {
    const api = apiRef.current;
    if (!api) return;
    const seed = nextMaterialSeed();
    const definition = TAPE_PRESETS.find((item) => item.id === preset)!;
    const color = preset === 'repair' ? definition.color : tapeColor || definition.color;
    const dataURL = createTapeDataURL(preset, color, seed);
    const fileId = crypto.randomUUID() as FileId;
    const recipe: TapeMaterialRecipe = { kind: 'tape', preset, color, seed };
    fileRefsRef.current[fileId] = {
      id: fileId,
      kind: 'material',
      mimeType: 'image/svg+xml',
      inlineDataURL: dataURL,
      recipe,
    };
    api.addFiles([{
      id: fileId,
      dataURL: dataURL as DataURL,
      mimeType: 'image/svg+xml',
      created: Date.now(),
    }]);
    const page = sceneRef.current.page;
    const width = Math.min(310, page.width * 0.32);
    const height = width / 3;
    const element = convertToExcalidrawElements([{
      id: crypto.randomUUID(),
      type: 'image',
      x: page.x + page.width / 2 - width / 2,
      y: page.y + page.height * 0.18,
      width,
      height,
      angle: (Math.random() - 0.5) * 0.18,
      opacity: tapeOpacity,
      fileId,
      status: 'saved',
      scale: [1, 1],
      customData: { press: recipe },
    }], { regenerateIds: false })[0] as ExcalidrawImageElement;
    api.updateScene({
      elements: [...api.getSceneElements(), element],
      appState: { selectedElementIds: { [element.id]: true } },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    selectedRef.current = element;
    setSelectionKey(`${element.id}:${element.version}:tape`);
    setTapeColor(color);
    setNotice(`${definition.label} tape placed. Drag, pinch, and rotate it where you want.`);
  }

  function updateSelectedTape(updates: { color?: string; opacity?: number }) {
    const api = apiRef.current;
    const target = selectedRef.current;
    const recipe = materialRecipe(target);
    if (!api || !target || !isImageElement(target) || recipe?.kind !== 'tape') {
      setNotice('Select a tape piece to restyle it.');
      return;
    }
    const nextRecipe = { ...recipe, color: updates.color || recipe.color };
    let nextFileId = target.fileId;
    if (updates.color) {
      const dataURL = createTapeDataURL(nextRecipe.preset, nextRecipe.color, nextRecipe.seed);
      nextFileId = crypto.randomUUID() as FileId;
      fileRefsRef.current[nextFileId] = {
        id: nextFileId,
        kind: 'material',
        mimeType: 'image/svg+xml',
        inlineDataURL: dataURL,
        recipe: nextRecipe,
      };
      api.addFiles([{
        id: nextFileId,
        dataURL: dataURL as DataURL,
        mimeType: 'image/svg+xml',
        created: Date.now(),
      }]);
    }
    const updated = newElementWith(target, {
      fileId: nextFileId,
      opacity: updates.opacity ?? target.opacity,
      customData: { ...target.customData, press: nextRecipe },
    }) as ExcalidrawImageElement;
    api.updateScene({
      elements: api.getSceneElements().map((element) => element.id === target.id ? updated : element),
      appState: { selectedElementIds: { [updated.id]: true } },
      captureUpdate: updates.opacity === undefined ? CaptureUpdateAction.IMMEDIATELY : CaptureUpdateAction.EVENTUALLY,
    });
    selectedRef.current = updated;
    setSelectionKey(`${updated.id}:${updated.version}:tape`);
  }

  function fitPage(animate = true) {
    const api = apiRef.current;
    if (!api) return;
    const page = api.getSceneElements().find((element) => pressKind(element) === 'page');
    if (!page) return;
    api.scrollToContent(page, {
      fitToViewport: true,
      viewportZoomFactor: 0.84,
      minZoom: 0.05,
      maxZoom: 2,
      animate,
      duration: animate ? 220 : 0,
    });
  }

  function zoomPage(factor: number) {
    const api = apiRef.current;
    if (!api) return;
    const page = api.getSceneElements().find((element) => pressKind(element) === 'page');
    if (!page) return;
    const zoom = Math.max(0.05, Math.min(4, api.getAppState().zoom.value * factor));
    api.scrollToContent(page, {
      fitToViewport: true,
      viewportZoomFactor: 0.84,
      minZoom: zoom,
      maxZoom: zoom,
      animate: true,
      duration: 140,
    });
  }

  async function naturalSizeForImage(element: ExcalidrawImageElement): Promise<{ width: number; height: number }> {
    if (element.crop?.naturalWidth && element.crop?.naturalHeight) {
      return { width: element.crop.naturalWidth, height: element.crop.naturalHeight };
    }
    if (!element.fileId) return { width: element.width, height: element.height };
    const ref = fileRefsRef.current[element.fileId];
    if (ref?.storageFileId) return readImageDimensions(await fetchFileBlob(ref.storageFileId));
    if (ref?.inlineDataURL) return readImageDimensions(await (await fetch(ref.inlineDataURL)).blob());
    const binary = apiRef.current?.getFiles()[element.fileId];
    if (binary?.dataURL) return readImageDimensions(await (await fetch(binary.dataURL)).blob());
    return { width: element.width, height: element.height };
  }

  async function fitSelectedImage(mode: ImageFitMode) {
    const api = apiRef.current;
    const target = selectedRef.current;
    if (!api || !target || !isImageElement(target) || materialRecipe(target)?.kind === 'tape') {
      setNotice('Select a photo or pack image first.');
      return;
    }
    setBusy(mode === 'center' ? null : `${mode[0].toUpperCase()}${mode.slice(1)}ting image`);
    try {
      const page = sceneRef.current.page;
      let updates: Partial<ExcalidrawImageElement>;
      if (mode === 'center') {
        updates = {
          x: page.x + page.width / 2 - target.width / 2,
          y: page.y + page.height / 2 - target.height / 2,
        };
      } else {
        const natural = await naturalSizeForImage(target);
        const imageRatio = natural.width / natural.height;
        const pageRatio = page.width / page.height;
        if (mode === 'stretch') {
          updates = { x: page.x, y: page.y, width: page.width, height: page.height, angle: 0, crop: null };
        } else if (mode === 'fill') {
          let cropX = 0;
          let cropY = 0;
          let cropWidth = natural.width;
          let cropHeight = natural.height;
          if (imageRatio > pageRatio) {
            cropWidth = natural.height * pageRatio;
            cropX = (natural.width - cropWidth) / 2;
          } else {
            cropHeight = natural.width / pageRatio;
            cropY = (natural.height - cropHeight) / 2;
          }
          updates = {
            x: page.x,
            y: page.y,
            width: page.width,
            height: page.height,
            angle: 0,
            crop: {
              x: cropX,
              y: cropY,
              width: cropWidth,
              height: cropHeight,
              naturalWidth: natural.width,
              naturalHeight: natural.height,
            },
          };
        } else {
          const scale = Math.min(page.width / natural.width, page.height / natural.height);
          const width = natural.width * scale;
          const height = natural.height * scale;
          updates = {
            x: page.x + page.width / 2 - width / 2,
            y: page.y + page.height / 2 - height / 2,
            width,
            height,
            angle: 0,
            crop: null,
          };
        }
      }

      const updated = newElementWith(target, updates) as ExcalidrawImageElement;
      api.updateScene({
        elements: api.getSceneElements().map((element) => element.id === target.id ? updated : element),
        appState: { selectedElementIds: { [updated.id]: true } },
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
      selectedRef.current = updated;
      setSelectionKey(`${updated.id}:${updated.version}:${mode}`);
      setNotice({ fit: 'Image fitted inside the page.', fill: 'Image filled the page with a centered crop.', stretch: 'Image stretched to all four page edges.', center: 'Image centered on the page.' }[mode]);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not fit that image');
    } finally {
      setBusy(null);
    }
  }

  function startCropSelectedImage() {
    const api = apiRef.current;
    const target = selectedRef.current;
    if (!api || !target || !isImageElement(target) || materialRecipe(target)?.kind === 'tape') {
      setNotice('Select a photo or pack image first.');
      return;
    }
    setSheetOpen(false);
    selectionHoldUntilRef.current = 0;
    api.updateScene({
      appState: {
        selectedElementIds: { [target.id]: true },
        isCropping: false,
        croppingElementId: target.id,
        openMenu: null,
      },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    setNotice('Crop mode is live. Drag the image inside its frame or pull the crop handles; tap away when it fits.');
  }

  function selectedSceneElements(): ExcalidrawElement[] {
    const api = apiRef.current;
    if (!api) return [];
    const ids = api.getAppState().selectedElementIds || {};
    return api.getSceneElements().filter((element) => ids[element.id] && !element.isDeleted && !['page', 'page-shadow'].includes(pressKind(element) || ''));
  }

  function centerSelectionOnPage() {
    const api = apiRef.current;
    if (!api) return;
    const selectedElements = selectedSceneElements();
    if (!selectedElements.length) {
      setNotice('Select something to center first.');
      return;
    }
    const minX = Math.min(...selectedElements.map((element) => element.x));
    const minY = Math.min(...selectedElements.map((element) => element.y));
    const maxX = Math.max(...selectedElements.map((element) => element.x + element.width));
    const maxY = Math.max(...selectedElements.map((element) => element.y + element.height));
    const page = sceneRef.current.page;
    const dx = page.x + page.width / 2 - (minX + maxX) / 2;
    const dy = page.y + page.height / 2 - (minY + maxY) / 2;
    const ids = new Set(selectedElements.map((element) => element.id));
    api.updateScene({
      elements: api.getSceneElements().map((element) => ids.has(element.id)
        ? newElementWith(element, { x: element.x + dx, y: element.y + dy })
        : element),
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    setNotice('Selection centered on the page.');
  }

  function reorderSelection(action: 'forward' | 'backward' | 'front' | 'back') {
    const api = apiRef.current;
    if (!api) return;
    const elements = [...api.getSceneElements()];
    const selectedIds = new Set(selectedSceneElements().map((element) => element.id));
    if (!selectedIds.size) {
      setNotice('Select something to arrange first.');
      return;
    }
    if (action === 'forward') {
      for (let index = elements.length - 2; index >= 0; index -= 1) {
        if (selectedIds.has(elements[index].id) && !selectedIds.has(elements[index + 1].id)) {
          [elements[index], elements[index + 1]] = [elements[index + 1], elements[index]];
        }
      }
    } else if (action === 'backward') {
      for (let index = 1; index < elements.length; index += 1) {
        if (selectedIds.has(elements[index].id)
          && !selectedIds.has(elements[index - 1].id)
          && !['page', 'page-shadow'].includes(pressKind(elements[index - 1]) || '')) {
          [elements[index], elements[index - 1]] = [elements[index - 1], elements[index]];
        }
      }
    } else {
      const chrome = elements.filter((element) => ['page', 'page-shadow'].includes(pressKind(element) || ''));
      const selectedElements = elements.filter((element) => selectedIds.has(element.id));
      const rest = elements.filter((element) => !selectedIds.has(element.id) && !chrome.includes(element));
      elements.splice(0, elements.length, ...(action === 'front' ? [...chrome, ...rest, ...selectedElements] : [...chrome, ...selectedElements, ...rest]));
    }
    api.updateScene({ elements, captureUpdate: CaptureUpdateAction.IMMEDIATELY });
  }

  function duplicateSelection() {
    const api = apiRef.current;
    if (!api) return;
    const selectedElements = selectedSceneElements();
    if (!selectedElements.length) {
      setNotice('Select something to duplicate first.');
      return;
    }
    const groupMap = new Map<string, string>();
    const idMap = new Map(selectedElements.map((element) => [element.id, crypto.randomUUID()]));
    const duplicates = selectedElements.map((element) => {
      const groupIds = element.groupIds.map((groupId) => {
        if (!groupMap.has(groupId)) groupMap.set(groupId, crypto.randomUUID());
        return groupMap.get(groupId)!;
      });
      const recipe = materialRecipe(element);
      const customData = recipe?.kind === 'border'
        ? { ...element.customData, press: { ...recipe, targetId: idMap.get(recipe.targetId) || recipe.targetId } }
        : element.customData;
      return newElementWith(element, {
        id: idMap.get(element.id)!,
        x: element.x + 26,
        y: element.y + 26,
        groupIds,
        seed: nextMaterialSeed(),
        locked: false,
        customData,
      } as Partial<ExcalidrawElement>);
    });
    api.updateScene({
      elements: [...api.getSceneElements(), ...duplicates],
      appState: { selectedElementIds: Object.fromEntries(duplicates.map((element) => [element.id, true])) },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    setNotice(`${duplicates.length} ${duplicates.length === 1 ? 'piece' : 'pieces'} duplicated.`);
  }

  function toggleSelectionLock() {
    const api = apiRef.current;
    if (!api) return;
    const selectedElements = selectedSceneElements();
    if (!selectedElements.length) {
      setNotice('Select something to lock first.');
      return;
    }
    const ids = new Set(selectedElements.map((element) => element.id));
    const shouldLock = selectedElements.some((element) => !element.locked);
    api.updateScene({
      elements: api.getSceneElements().map((element) => ids.has(element.id) ? newElementWith(element, { locked: shouldLock }) : element),
      appState: { selectedElementIds: shouldLock ? {} : Object.fromEntries([...ids].map((id) => [id, true])) },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    setNotice(shouldLock ? 'Selection locked.' : 'Selection unlocked.');
  }

  function deleteSelection() {
    const api = apiRef.current;
    if (!api) return;
    const ids = new Set(selectedSceneElements().map((element) => element.id));
    if (!ids.size) {
      setNotice('Select something to delete first.');
      return;
    }
    api.updateScene({
      elements: api.getSceneElements().map((element) => ids.has(element.id) ? newElementWith(element, { isDeleted: true }) : element),
      appState: { selectedElementIds: {} },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    selectedRef.current = null;
    setSelectionKey('none');
    setNotice('Selection removed. Undo is still available.');
  }

  async function imagePackPayload(blob: Blob, name: string) {
    const extension = extensionOf(name);
    const mimeType = PACK_IMAGE_MIMES[extension];
    if (!mimeType) throw new Error(`${name} is not a supported pack image.`);
    if (blob.size > 10 * 1024 * 1024) throw new Error(`${name} is over the 10 MB item limit.`);
    let safeBlob = blob;
    let uploadName = name;
    let dimensions: { width: number; height: number };
    if (extension === 'svg') {
      const rendered = await rasterizeSvg(await sanitizeSvg(blob));
      safeBlob = rendered.blob;
      uploadName = name.replace(/\.svg$/i, '.png');
      dimensions = { width: rendered.width, height: rendered.height };
    } else {
      dimensions = await readImageDimensions(safeBlob);
    }
    const uploaded = await uploadPressItemBlob(safeBlob, uploadName);
    return {
      name: name.split('/').pop() || name,
      kind: 'image' as const,
      mimeType: uploaded.mimeType || mimeType,
      sourceFileId: uploaded.fileId,
      width: dimensions.width,
      height: dimensions.height,
    };
  }

  async function saveImportedPack(input: {
    name: string;
    description?: string;
    sourceFormat: 'images' | 'zip' | 'excalidrawlib';
    author?: string;
    license?: string;
    sourceFileId?: string;
    metadata?: Record<string, unknown>;
    items: unknown[];
  }) {
    const response = await apiFetch('/api/press/packs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(payload.error || `Could not import ${input.name}`);
    }
    const data = await response.json() as { pack: PressPack; items: PressPackItem[] };
    setPacks((current) => [data.pack, ...current.filter((pack) => pack.id !== data.pack.id)]);
    setPackItems((current) => [...current, ...data.items]);
    packItemsRef.current = [...packItemsRef.current, ...data.items];
    syncNativeLibrary(data.items, true);
    return data;
  }

  async function importLibraryFile(file: File) {
    const libraryItems = await loadLibraryFromBlob(file, 'published');
    if (!libraryItems.length) throw new Error(`${file.name} contains no reusable objects.`);
    return saveImportedPack({
      name: packNameFromFile(file.name),
      sourceFormat: 'excalidrawlib',
      items: libraryItems.map((item, index) => ({
        name: item.name || `Object ${index + 1}`,
        kind: 'excalidraw',
        data: item,
      })),
    });
  }

  async function importZipFile(file: File) {
    if (file.size > 25 * 1024 * 1024) throw new Error(`${file.name} is over the 25 MB archive limit.`);
    const archive = await unzipArchive(new Uint8Array(await file.arrayBuffer()));
    const entries = Object.entries(archive).filter(([name]) => !name.endsWith('/')
      && !name.startsWith('__MACOSX/') && !!PACK_IMAGE_MIMES[extensionOf(name)]);
    if (!entries.length) throw new Error(`${file.name} contains no supported images.`);
    if (entries.length > 500) throw new Error(`${file.name} contains more than 500 supported images.`);
    const totalSize = entries.reduce((total, [, bytes]) => total + bytes.byteLength, 0);
    if (totalSize > 100 * 1024 * 1024) throw new Error(`${file.name} expands beyond the 100 MB pack limit.`);

    let manifest: { name?: string; description?: string; author?: string; license?: string } = {};
    const manifestEntry = Object.entries(archive).find(([name]) => name.toLowerCase().endsWith('press-pack.json'));
    if (manifestEntry) {
      try { manifest = JSON.parse(new TextDecoder().decode(manifestEntry[1])) as typeof manifest; } catch { /* optional */ }
    }
    const items = [];
    for (const [name, bytes] of entries) {
      const mimeType = PACK_IMAGE_MIMES[extensionOf(name)];
      const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: mimeType });
      items.push(await imagePackPayload(blob, name));
    }
    return saveImportedPack({
      name: manifest.name?.trim() || packNameFromFile(file.name),
      description: manifest.description,
      author: manifest.author,
      license: manifest.license,
      sourceFormat: 'zip',
      items,
    });
  }

  async function importAbrFile(file: File) {
    if (file.size > 50 * 1024 * 1024) throw new Error(`${file.name} is over the 50 MB ABR limit.`);
    const name = packNameFromFile(file.name);
    setBusy(`Reading ${file.name} off the main canvas`);
    const result = await parseAbrInWorker(file, name);
    const original = await uploadPressSource(file);
    const items = [];
    for (let index = 0; index < result.brushes.length; index += 1) {
      const brush = result.brushes[index];
      setBusy(`Rendering ABR tip ${index + 1} of ${result.brushes.length}`);
      const blob = await abrTipToPng(brush);
      const uploaded = await uploadPressItemBlob(blob, `${safeFilename(brush.name)}.png`);
      items.push({
        name: brush.name,
        kind: 'image' as const,
        mimeType: uploaded.mimeType,
        sourceFileId: uploaded.fileId,
        width: brush.width,
        height: brush.height,
        data: {
          abr: {
            diameter: brush.diameter,
            hardness: brush.hardness,
            spacing: brush.spacing,
            angle: brush.angle,
            roundness: brush.roundness,
            sampled: brush.sampled,
            sourceId: brush.sourceId || null,
          },
        },
      });
    }
    return saveImportedPack({
      name,
      description: `${result.brushes.length} Photoshop brush ${result.brushes.length === 1 ? 'tip' : 'tips'} extracted as transparent stamps.`,
      sourceFormat: 'images',
      sourceFileId: original.fileId,
      metadata: {
        importFormat: 'abr',
        originalName: file.name,
        abrVersion: result.version,
        abrSubversion: result.subversion,
        notes: result.notes,
      },
      items,
    });
  }

  async function importPackFiles(files: File[]) {
    if (!files.length) return;
    setBusy('Stocking the pack shelves');
    setNotice(null);
    try {
      const loose = files.filter((file) => !['zip', 'excalidrawlib'].includes(extensionOf(file.name)));
      const archives = files.filter((file) => extensionOf(file.name) === 'zip');
      const libraries = files.filter((file) => extensionOf(file.name) === 'excalidrawlib');
      const brushPacks = files.filter((file) => extensionOf(file.name) === 'abr');
      const looseImages = loose.filter((file) => extensionOf(file.name) !== 'abr');
      let imported = 0;
      for (const file of libraries) { imported += (await importLibraryFile(file)).items.length; }
      for (const file of archives) { imported += (await importZipFile(file)).items.length; }
      for (const file of brushPacks) { imported += (await importAbrFile(file)).items.length; }
      if (looseImages.length) {
        const items = [];
        for (const file of looseImages) items.push(await imagePackPayload(file, file.name));
        const name = looseImages.length === 1
          ? packNameFromFile(looseImages[0].name)
          : `Loose assets · ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
        imported += (await saveImportedPack({ name, sourceFormat: 'images', items })).items.length;
      }
      openMaterialSheet('packs');
      setNotice(`${imported} reusable ${imported === 1 ? 'piece' : 'pieces'} added to the house shelves.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not import that pack');
    } finally {
      setBusy(null);
      if (packInputRef.current) packInputRef.current.value = '';
    }
  }

  async function deletePack(pack: PressPack) {
    if (!window.confirm(`Remove “${pack.name}” from The Press shelves?`)) return;
    try {
      const response = await apiFetch(`/api/press/packs/${pack.id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Could not remove that pack');
      const removedLibraryIds = new Set(libraryItemsFromPackItems(
        packItemsRef.current.filter((item) => item.pack_id === pack.id),
      ).map((item) => item.id));
      const nextItems = packItemsRef.current.filter((item) => item.pack_id !== pack.id);
      setPacks((current) => current.filter((item) => item.id !== pack.id));
      setPackItems(nextItems);
      packItemsRef.current = nextItems;
      if (removedLibraryIds.size && apiRef.current) {
        void apiRef.current.updateLibrary({
          libraryItems: (current: LibraryItems) => current.filter((item) => !removedLibraryIds.has(item.id)),
          merge: false,
          defaultStatus: 'published',
        });
      }
      setNotice(`${pack.name} removed. Placed pieces stay on their spreads.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not remove that pack');
    }
  }

  async function placePackImage(item: PressPackItem) {
    const api = apiRef.current;
    if (!api || item.kind !== 'image' || !item.source_file_id) return;
    setBusy(`Placing ${item.name}`);
    try {
      const response = await apiFetch(`/api/files/${item.source_file_id}`);
      if (!response.ok) throw new Error('That pack image could not be loaded');
      const blob = await response.blob();
      const dataURL = await fileToDataURL(blob);
      const dimensions = item.width && item.height
        ? { width: item.width, height: item.height }
        : await readImageDimensions(blob);
      const fileId = item.source_file_id as FileId;
      const recipe: PackItemMaterialRecipe = { kind: 'pack-item', packId: item.pack_id, itemId: item.id };
      fileRefsRef.current[fileId] = {
        id: fileId,
        kind: 'pack',
        mimeType: item.mime_type || blob.type || 'image/png',
        storageFileId: item.source_file_id,
        recipe,
      };
      api.addFiles([{
        id: fileId,
        dataURL: dataURL as DataURL,
        mimeType: (item.mime_type || blob.type || 'image/png') as BinaryFileData['mimeType'],
        created: Date.now(),
      }]);
      const page = sceneRef.current.page;
      const scale = Math.min((page.width * 0.46) / dimensions.width, (page.height * 0.46) / dimensions.height, 1);
      const width = Math.max(48, dimensions.width * scale);
      const height = Math.max(48, dimensions.height * scale);
      const element = convertToExcalidrawElements([{
        id: crypto.randomUUID(),
        type: 'image',
        x: page.x + page.width / 2 - width / 2,
        y: page.y + page.height / 2 - height / 2,
        width,
        height,
        fileId,
        status: 'saved',
        scale: [1, 1],
        customData: { press: recipe },
      }], { regenerateIds: false })[0] as ExcalidrawImageElement;
      api.updateScene({
        elements: [...api.getSceneElements(), element],
        appState: { selectedElementIds: { [element.id]: true } },
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
      setSheetOpen(false);
      setNotice(`${item.name} placed.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not place that pack image');
    } finally {
      setBusy(null);
    }
  }

  function openNativeLibrary() {
    setSheetOpen(false);
    syncNativeLibrary(packItemsRef.current, true, true);
  }

  async function exportSpread() {
    const api = apiRef.current;
    if (!api) return;
    setBusy('Printing the spread');
    try {
      const blob = await exportToBlob({
        elements: api.getSceneElements().filter((element) => !element.isDeleted && pressKind(element) !== 'page-shadow'),
        appState: { ...api.getAppState(), exportBackground: true, viewBackgroundColor: sceneRef.current.page.background },
        files: api.getFiles(),
        mimeType: 'image/png',
        exportPadding: 0,
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${safeFilename(issue.title)}-${safeFilename(spread.title)}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice('Spread exported as PNG.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not export spread');
    } finally {
      setBusy(null);
    }
  }

  const materialBody = useMemo(() => {
    if (materialTab === 'packs') {
      const query = packQuery.trim().toLowerCase();
      const visiblePacks = packs.filter((pack) => {
        if (!query || pack.name.toLowerCase().includes(query)) return true;
        return packItems.some((item) => item.pack_id === pack.id && item.name.toLowerCase().includes(query));
      });
      return (
        <div className="space-y-3">
          <div className="flex gap-2">
            <input
              value={packQuery}
              onChange={(event) => setPackQuery(event.target.value)}
              placeholder="Search the shelves"
              className={cn('aerie-field min-h-11 min-w-0 flex-1 rounded-xl px-3 text-sm outline-none', colors.textMain)}
            />
            <button
              onClick={() => packInputRef.current?.click()}
              disabled={!!busy}
              className="press-accent-button flex min-h-11 shrink-0 items-center gap-2 rounded-xl px-3 text-[11px] font-bold disabled:opacity-40"
            >
              <Upload size={15} /> Import
            </button>
          </div>
          <div className={cn('rounded-xl border px-3 py-2 text-[10px] leading-relaxed', colors.panelBorder, colors.textMuted)}>
            Import loose PNG, JPG, WebP, GIF, or SVG files; image ZIPs; native <strong>.excalidrawlib</strong> objects; and Photoshop <strong>.abr</strong> tips. These shelves belong to the whole house, not one issue.
          </div>
          {!visiblePacks.length ? (
            <div className={cn('flex min-h-28 flex-col items-center justify-center rounded-2xl border border-dashed px-5 text-center', colors.panelBorder, colors.textMuted)}>
              <Archive size={24} className="mb-2 opacity-60" />
              <div className="text-xs font-semibold">{packs.length ? 'Nothing matches that search.' : 'The storeroom is ready.'}</div>
              <div className="mt-1 text-[10px]">Bring in the old hoard when you find it.</div>
            </div>
          ) : visiblePacks.map((pack) => {
            const metadata = packMetadata(pack);
            const items = packItems.filter((item) => item.pack_id === pack.id
              && (!query || pack.name.toLowerCase().includes(query) || item.name.toLowerCase().includes(query)));
            const images = items.filter((item) => item.kind === 'image');
            const objectCount = items.filter((item) => item.kind === 'excalidraw').length;
            return (
              <section key={pack.id} className={cn('overflow-hidden rounded-2xl border', colors.panelBorder)}>
                <header className="flex items-start gap-2 px-3 py-3">
                  <div className="min-w-0 flex-1">
                    <div className={cn('truncate text-xs font-bold', colors.textMain)}>{pack.name}</div>
                    <div className={cn('mt-0.5 text-[9px]', colors.textMuted)}>
                      {pack.item_count || items.length} pieces · {metadata.importFormat === 'abr' ? 'Photoshop brush tips' : pack.source_format === 'excalidrawlib' ? 'Excalidraw objects' : pack.source_format === 'zip' ? 'ZIP pack' : 'Image pack'}
                      {pack.author ? ` · ${pack.author}` : ''}
                    </div>
                  </div>
                  <button onClick={() => void deletePack(pack)} className={cn('rounded-lg p-2', colors.textMuted)} title={`Remove ${pack.name}`}>
                    <Trash2 size={14} />
                  </button>
                </header>
                {objectCount > 0 && (
                  <button
                    onClick={openNativeLibrary}
                    className="press-pack-library mx-3 mb-3 flex min-h-11 w-[calc(100%_-_1.5rem)] items-center justify-between rounded-xl px-3 text-left"
                  >
                    <span className="flex items-center gap-2 text-[11px] font-bold"><FileArchive size={15} /> Open {objectCount} reusable objects</span>
                    <span aria-hidden>→</span>
                  </button>
                )}
                {!!images.length && (
                  <div className="grid grid-cols-3 gap-2 px-3 pb-3 sm:grid-cols-4">
                    {images.map((item) => (
                      <button
                        key={item.id}
                        onClick={() => void placePackImage(item)}
                        className="press-pack-tile group relative aspect-square overflow-hidden rounded-xl"
                        title={`Place ${item.name}`}
                      >
                        <img src={`/api/files/${item.source_file_id}`} alt="" className="h-full w-full object-contain p-1.5" loading="lazy" />
                        <span className="absolute inset-x-0 bottom-0 truncate bg-black/70 px-1.5 py-1 text-[8px] text-white">{item.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      );
    }
    if (materialTab === 'edges') {
      return (
        <div className="space-y-3">
          <div className={cn('text-[11px]', colors.textMuted)}>
            {selectedPhoto ? `Selected: ${EDGE_PRESETS.find((item) => item.id === selectedPhoto.edgePreset)?.label || 'photo'}` : 'Select a photo on the spread to cut its edge.'}
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {EDGE_PRESETS.map((preset) => {
              const active = selectedPhoto?.edgePreset === preset.id;
              return (
                <button
                  key={preset.id}
                  disabled={!selectedPhoto || !!busy}
                  onClick={() => void applyEdge(preset.id)}
                  className={cn('min-h-16 rounded-xl border p-2 text-left disabled:opacity-40', colors.panelBorder)}
                  style={active ? { borderColor: colors.accent, boxShadow: `0 0 0 1px ${colors.accent}` } : undefined}
                >
                  <div className={cn('text-xs font-bold', colors.textMain)}>{preset.label}</div>
                  <div className={cn('mt-1 text-[9px]', colors.textMuted)}>{preset.note}</div>
                </button>
              );
            })}
          </div>
          <button
            disabled={!selectedPhoto || !!busy}
            onClick={() => void applyEdge(selectedPhoto?.edgePreset === 'clean' ? 'soft-tear' : selectedPhoto!.edgePreset, nextMaterialSeed())}
            className={cn('flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border text-xs font-semibold disabled:opacity-40', colors.panelBorder, colors.textMain)}
          >
            <RefreshCw size={14} /> Shuffle tear
          </button>
        </div>
      );
    }
    if (materialTab === 'borders') {
      const borders: Array<{ id: BorderPresetId; label: string; note: string }> = [
        { id: 'ink', label: 'Ink', note: 'Rough black mark' },
        { id: 'stitched', label: 'Stitched', note: 'Dashed thread edge' },
        { id: 'instant-film', label: 'Instant film', note: 'Wide paper foot' },
      ];
      return (
        <div className="space-y-3">
          <div className={cn('text-[11px]', colors.textMuted)}>{selectedPhoto ? 'Borders stay editable and travel with the photo.' : 'Select a photo to frame it.'}</div>
          <div className="grid grid-cols-3 gap-2">
            {borders.map((border) => (
              <button
                key={border.id}
                disabled={!selectedPhoto}
                onClick={() => addBorder(border.id)}
                className={cn('min-h-20 rounded-xl border p-2 text-left disabled:opacity-40', colors.panelBorder)}
              >
                <div className="mb-2 h-7 rounded border-2" style={{ borderColor: border.id === 'stitched' ? '#8b6b4a' : '#27211c', borderStyle: border.id === 'stitched' ? 'dashed' : 'solid', background: border.id === 'instant-film' ? '#eee3ce' : 'transparent' }} />
                <div className={cn('text-[11px] font-bold', colors.textMain)}>{border.label}</div>
                <div className={cn('mt-0.5 text-[8px] leading-tight', colors.textMuted)}>{border.note}</div>
              </button>
            ))}
          </div>
        </div>
      );
    }
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <label className={cn('flex min-h-11 flex-1 items-center gap-2 rounded-xl border px-3 text-[11px] font-semibold', colors.panelBorder, colors.textMain)}>
            <input type="color" value={tapeColor} onChange={(event) => setTapeColor(event.target.value)} className="h-7 w-8 rounded border-0 bg-transparent" />
            Tape color
          </label>
          {selectedTape && (
            <button
              onClick={() => updateSelectedTape({ color: tapeColor })}
              className="min-h-11 rounded-xl px-3 text-[11px] font-semibold aerie-on-accent"
              style={{ background: colors.accent }}
            >
              Recolor selected
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {TAPE_PRESETS.map((tape) => (
            <button
              key={tape.id}
              onClick={() => addTape(tape.id)}
              className={cn('min-h-20 rounded-xl border p-2 text-left', colors.panelBorder)}
            >
              <div className="mb-2 h-6 -rotate-2 rounded-sm shadow" style={{ background: tape.id === 'repair' ? tape.color : tapeColor, opacity: tape.id === 'vellum' ? 0.55 : 0.9 }} />
              <div className={cn('text-[11px] font-bold', colors.textMain)}>{tape.label}</div>
              <div className={cn('text-[8px]', colors.textMuted)}>{tape.note}</div>
            </button>
          ))}
        </div>
        <label className={cn('block rounded-xl border px-3 py-2', colors.panelBorder)}>
          <div className="mb-2 flex items-center justify-between text-[10px] font-semibold">
            <span className={colors.textMuted}>Opacity</span>
            <span className={colors.textMain}>{tapeOpacity}%</span>
          </div>
          <input
            type="range"
            min="15"
            max="100"
            value={tapeOpacity}
            onChange={(event) => {
              const value = Number(event.target.value);
              setTapeOpacity(value);
              if (selectedTape) updateSelectedTape({ opacity: value });
            }}
            className="w-full"
            style={{ accentColor: colors.accent }}
          />
        </label>
      </div>
    );
  // selectionKey intentionally refreshes the controls when Excalidraw changes selection/version.
  }, [materialTab, selectionKey, selectedPhoto, selectedTape, tapeColor, tapeOpacity, busy, colors, packs, packItems, packQuery]);

  const activePhotoSpec = PHOTO_ADJUSTMENT_SPECS.find((spec) => spec.type === activePhotoAdjustment)
    || PHOTO_ADJUSTMENT_SPECS[0];
  const activePhotoValue = photoLab
    ? photoAdjustmentValue(photoLab.draft, activePhotoSpec.type)
    : activePhotoSpec.defaultValue;
  const activePhotoValueLabel = activePhotoSpec.type === 'exposure'
    ? `${activePhotoValue >= 0 ? '+' : ''}${(activePhotoValue / 100).toFixed(2)} EV`
    : `${activePhotoValue >= 0 ? '+' : ''}${activePhotoValue}`;

  if (!initialData) {
    return <div className={cn('flex h-full items-center justify-center gap-2 text-sm', colors.textMuted)}><Loader2 size={18} className="animate-spin" />Opening paper and ink…</div>;
  }

  return (
    <div
      className="press-editor relative h-full w-full overflow-hidden"
      onContextMenuCapture={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <Excalidraw
        initialData={initialData}
        excalidrawAPI={(api) => {
          apiRef.current = api;
          syncNativeLibrary(packItemsRef.current, true);
          if (fittedSpreadRef.current !== spread.id) {
            fittedSpreadRef.current = spread.id;
            requestAnimationFrame(() => fitPage(false));
          }
        }}
        onChange={handleChange}
        theme="light"
        objectsSnapModeEnabled={snappingEnabled}
        autoFocus
        handleKeyboardGlobally={false}
        UIOptions={{
          tools: { image: false },
          canvasActions: {
            changeViewBackgroundColor: false,
            loadScene: false,
            saveToActiveFile: false,
            export: false,
            toggleTheme: false,
            clearCanvas: false,
          },
        }}
      >
        <MainMenu>
          <MainMenu.Group title="Add">
            <MainMenu.Item icon={<ImagePlus size={17} />} onSelect={() => fileInputRef.current?.click()}>
              Photo
            </MainMenu.Item>
            <MainMenu.Item icon={<TextCursorInput size={17} />} onSelect={() => apiRef.current?.setActiveTool({ type: 'text' })}>
              Text
            </MainMenu.Item>
            <MainMenu.Item icon={<Paintbrush size={17} />} onSelect={() => apiRef.current?.setActiveTool({ type: 'freedraw' })}>
              Draw
            </MainMenu.Item>
            <MainMenu.Item icon={<Scissors size={17} />} onSelect={() => openMaterialSheet('edges')}>
              Materials
            </MainMenu.Item>
            <MainMenu.Item icon={<Archive size={17} />} onSelect={() => openMaterialSheet('packs')}>
              Packs
            </MainMenu.Item>
          </MainMenu.Group>
          <MainMenu.Separator />
          <MainMenu.Group title="Arrange selection">
            <MainMenu.Item disabled={!selectedPhoto} icon={<SlidersHorizontal size={17} />} onSelect={() => void openPhotoLab()}>
              Edit photo
            </MainMenu.Item>
            <MainMenu.Item disabled={!selectedCanFit} icon={<Focus size={17} />} onSelect={() => void fitSelectedImage('fit')}>
              Fit inside page
            </MainMenu.Item>
            <MainMenu.Item disabled={!selectedCanFit} icon={<Maximize2 size={17} />} onSelect={() => void fitSelectedImage('fill')}>
              Fill page + crop
            </MainMenu.Item>
            <MainMenu.Item disabled={!selectedCanFit} icon={<Crop size={17} />} onSelect={startCropSelectedImage}>
              Adjust crop
            </MainMenu.Item>
            <MainMenu.Item disabled={!selectedCanFit} icon={<ImageIcon size={17} />} onSelect={() => void fitSelectedImage('stretch')}>
              Stretch to page
            </MainMenu.Item>
            <MainMenu.Item disabled={!selected} icon={<AlignCenter size={17} />} onSelect={centerSelectionOnPage}>
              Center on page
            </MainMenu.Item>
            <MainMenu.Item disabled={!selected} icon={<MoveUp size={17} />} onSelect={() => reorderSelection('forward')}>
              Bring forward
            </MainMenu.Item>
            <MainMenu.Item disabled={!selected} icon={<BringToFront size={17} />} onSelect={() => reorderSelection('front')}>
              Bring to front
            </MainMenu.Item>
            <MainMenu.Item disabled={!selected} icon={<MoveDown size={17} />} onSelect={() => reorderSelection('backward')}>
              Send backward
            </MainMenu.Item>
            <MainMenu.Item disabled={!selected} icon={<Layers3 size={17} />} onSelect={() => reorderSelection('back')}>
              Send to back
            </MainMenu.Item>
            <MainMenu.Item disabled={!selected} icon={<Copy size={17} />} onSelect={duplicateSelection}>
              Duplicate
            </MainMenu.Item>
            <MainMenu.Item disabled={!selected} icon={selected?.locked ? <Unlock size={17} /> : <Lock size={17} />} onSelect={toggleSelectionLock}>
              {selected?.locked ? 'Unlock' : 'Lock'}
            </MainMenu.Item>
            <MainMenu.Item disabled={!selected} icon={<Trash2 size={17} />} onSelect={deleteSelection}>
              Delete
            </MainMenu.Item>
          </MainMenu.Group>
          <MainMenu.Separator />
          <MainMenu.Group title="View">
            <MainMenu.Item icon={<Focus size={17} />} onSelect={() => fitPage()}>
              Fit page
            </MainMenu.Item>
            <MainMenu.Item icon={<ZoomIn size={17} />} onSelect={() => zoomPage(1.2)}>
              Zoom in
            </MainMenu.Item>
            <MainMenu.Item icon={<ZoomOut size={17} />} onSelect={() => zoomPage(1 / 1.2)}>
              Zoom out
            </MainMenu.Item>
            <MainMenu.Item
              icon={<Sparkles size={17} />}
              selected={snappingEnabled}
              onSelect={() => {
                const next = !snappingEnabled;
                setSnappingEnabled(next);
                apiRef.current?.updateScene({ appState: { objectsSnapModeEnabled: next } });
                setNotice(next ? 'Object snapping on.' : 'Object snapping off.');
              }}
            >
              Snapping + guides
            </MainMenu.Item>
          </MainMenu.Group>
          <MainMenu.Separator />
          <MainMenu.Group title="Packs">
            <MainMenu.Item icon={<Upload size={17} />} onSelect={() => packInputRef.current?.click()}>
              Import pack
            </MainMenu.Item>
            <MainMenu.Item icon={<FileArchive size={17} />} disabled={!packItems.some((item) => item.kind === 'excalidraw')} onSelect={openNativeLibrary}>
              Open object library
            </MainMenu.Item>
          </MainMenu.Group>
          <MainMenu.Separator />
          <MainMenu.Group title="File">
            <MainMenu.Item
              icon={<Check size={17} />}
              disabled={!latestRef.current || saveStatus === 'saving'}
              onSelect={() => { if (latestRef.current) enqueueSave(latestRef.current); }}
            >
              Save now
            </MainMenu.Item>
            <MainMenu.Item icon={<Download size={17} />} onSelect={() => void exportSpread()}>
              Export PNG
            </MainMenu.Item>
          </MainMenu.Group>
        </MainMenu>
      </Excalidraw>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={(event) => { const file = event.target.files?.[0]; if (file) void importPhoto(file); }}
      />

      <input
        ref={packInputRef}
        type="file"
        multiple
        accept=".excalidrawlib,.abr,.zip,image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
        className="hidden"
        onChange={(event) => void importPackFiles(Array.from(event.target.files || []))}
      />

      {!sheetOpen && !photoLab && selectedCanFit && (
        <div className="press-context-bar absolute bottom-[4.2rem] left-1/2 z-30 flex -translate-x-1/2 gap-0.5 rounded-2xl p-1" style={{ marginBottom: 'var(--sab)' }}>
          {selectedPhoto && (
            <button
              onClick={() => void openPhotoLab()}
              className="press-context-action flex min-h-11 min-w-12 flex-col items-center justify-center rounded-xl px-1.5 text-[8px] font-bold"
            >
              <SlidersHorizontal size={15} /><span className="mt-0.5">Edit</span>
            </button>
          )}
          {([
            ['fit', Focus, 'Fit'],
            ['fill', Maximize2, 'Fill'],
            ['crop', Crop, 'Crop'],
            ['stretch', ImageIcon, 'Stretch'],
            ['center', AlignCenter, 'Center'],
          ] as const).map(([mode, Icon, label]) => (
            <button
              key={mode}
              onClick={() => mode === 'crop' ? startCropSelectedImage() : void fitSelectedImage(mode)}
              className="press-context-action flex min-h-11 min-w-12 flex-col items-center justify-center rounded-xl px-1.5 text-[8px] font-bold"
            >
              <Icon size={15} /><span className="mt-0.5">{label}</span>
            </button>
          ))}
        </div>
      )}

      {!sheetOpen && !photoLab && (
        <button
          onClick={() => fitPage()}
          className="press-float absolute bottom-5 right-6 z-30 flex h-9 w-9 items-center justify-center rounded-lg"
          style={{ marginBottom: 'var(--sab)' }}
          title="Fit page"
        >
          <Focus size={16} />
        </button>
      )}

      {!sheetOpen && !photoLab && (
        <button
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => openMaterialSheet()}
          className="press-materials-button absolute bottom-4 left-1/2 z-30 flex h-11 -translate-x-1/2 items-center gap-2 rounded-full px-5 text-xs font-bold"
          style={{ marginBottom: 'var(--sab)' }}
        >
          <Scissors size={16} /> Materials
        </button>
      )}

      {sheetOpen && (
        <section
          className={cn('absolute inset-x-2 bottom-2 z-40 flex max-h-[56%] flex-col overflow-hidden rounded-[1.5rem] border shadow-2xl backdrop-blur-2xl', colors.panelBg, colors.panelBorder)}
          style={{ paddingBottom: 'var(--sab)' }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <header className="flex shrink-0 items-center gap-2 px-3 pb-2 pt-3">
            <div className="mr-auto">
              <div className={cn('text-[9px] font-black uppercase tracking-[0.18em]', colors.textMuted)}>{materialTab === 'packs' ? 'House storeroom' : 'Materials tray'}</div>
              <div className={cn('font-serif text-base italic', colors.textMain)}>{materialTab === 'packs' ? 'Shelve, browse, place.' : 'Cut, frame, fasten.'}</div>
            </div>
            <button onClick={() => { selectionHoldUntilRef.current = 0; setSheetOpen(false); }} className={cn('rounded-full p-2', colors.textMuted)}><X size={18} /></button>
          </header>
          <nav className="grid shrink-0 grid-cols-4 gap-1 px-3 pb-2">
            {([
              ['edges', Scissors, 'Edges'],
              ['borders', Layers3, 'Borders'],
              ['tape', Palette, 'Tape'],
              ['packs', Archive, 'Packs'],
            ] as const).map(([id, Icon, label]) => (
              <button
                key={id}
                onClick={() => setMaterialTab(id)}
                className={cn('flex min-h-11 items-center justify-center gap-1.5 rounded-xl border text-[11px] font-semibold', colors.panelBorder, materialTab === id ? 'aerie-on-accent' : colors.textMuted)}
                style={materialTab === id ? { background: colors.accent, borderColor: colors.accent } : undefined}
              >
                <Icon size={14} /> {label}
              </button>
            ))}
          </nav>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 scrollbar-hide">{materialBody}</div>
        </section>
      )}

      {photoLab && (
        <section
          className={cn('absolute inset-x-2 bottom-2 z-40 flex max-h-[64%] flex-col overflow-hidden rounded-[1.5rem] border shadow-2xl backdrop-blur-2xl', colors.panelBg, colors.panelBorder)}
          style={{ paddingBottom: 'var(--sab)' }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <header className="flex shrink-0 items-center gap-2 px-3 pb-2 pt-3">
            <div className="min-w-0 flex-1">
              <div className={cn('flex items-center gap-1.5 text-[9px] font-black uppercase tracking-[0.18em]', colors.textMuted)}>
                Photo Lab
                {photoLab.rendering && <Loader2 size={11} className="animate-spin" />}
              </div>
              <div className={cn('truncate font-serif text-base italic', colors.textMain)}>Develop without flattening.</div>
            </div>
            <button
              disabled={!photoLab.beforePreview || !!busy}
              onPointerDown={holdPhotoLabBefore}
              onPointerUp={releasePhotoLabBefore}
              onPointerCancel={releasePhotoLabBefore}
              className={cn('flex min-h-10 items-center gap-1.5 rounded-xl border px-2.5 text-[10px] font-bold disabled:opacity-35', colors.panelBorder, colors.textMain)}
              title="Hold to compare with the unadjusted photo"
            >
              <Eye size={14} /> Hold before
            </button>
            <button
              disabled={!!busy}
              onClick={() => updatePhotoLabDraft({ version: 1, items: [] })}
              className={cn('rounded-full p-2 disabled:opacity-35', colors.textMuted)}
              title="Reset every adjustment"
            >
              <RotateCcw size={17} />
            </button>
            <button disabled={!!busy} onClick={cancelPhotoLab} className={cn('rounded-full p-2 disabled:opacity-35', colors.textMuted)}><X size={18} /></button>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 scrollbar-hide">
            <div className={cn('mb-2 text-[9px] font-black uppercase tracking-[0.14em]', colors.textMuted)}>Looks</div>
            <div className="mb-3 flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
              {PHOTO_LOOK_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  disabled={!!busy}
                  onClick={() => updatePhotoLabDraft(preset.stack)}
                  className={cn('min-h-14 min-w-[7.4rem] shrink-0 rounded-xl border px-3 py-2 text-left disabled:opacity-35', colors.panelBorder)}
                >
                  <div className={cn('text-[11px] font-bold', colors.textMain)}>{preset.label}</div>
                  <div className={cn('mt-0.5 text-[8px]', colors.textMuted)}>{preset.note}</div>
                </button>
              ))}
            </div>

            <div className={cn('mb-2 text-[9px] font-black uppercase tracking-[0.14em]', colors.textMuted)}>Adjust</div>
            <div className="mb-3 grid grid-cols-4 gap-1.5">
              {PHOTO_ADJUSTMENT_SPECS.map((spec) => {
                const value = photoAdjustmentValue(photoLab.draft, spec.type);
                const active = spec.type === activePhotoSpec.type;
                return (
                  <button
                    key={spec.type}
                    onClick={() => setActivePhotoAdjustment(spec.type)}
                    className={cn('flex min-h-14 flex-col items-center justify-center rounded-xl border px-1 text-center', colors.panelBorder, active ? 'aerie-on-accent' : colors.textMuted)}
                    style={active ? { background: colors.accent, borderColor: colors.accent } : undefined}
                  >
                    <span className="text-[9px] font-bold leading-tight">{spec.shortLabel}</span>
                    <span className="mt-1 text-[8px] opacity-75">{spec.type === 'exposure' ? `${(value / 100).toFixed(2)}` : value}</span>
                  </button>
                );
              })}
            </div>

            <div className={cn('rounded-2xl border p-3', colors.panelBorder)}>
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <div className={cn('text-xs font-bold', colors.textMain)}>{activePhotoSpec.label}</div>
                  <div className={cn('mt-0.5 text-[9px]', colors.textMuted)}>Rendered from the untouched original.</div>
                </div>
                <button
                  onClick={() => updatePhotoLabDraft(setPhotoAdjustmentValue(photoLab.draft, activePhotoSpec.type, activePhotoSpec.defaultValue))}
                  className={cn('min-h-9 rounded-lg border px-2.5 text-[9px] font-bold', colors.panelBorder, colors.textMuted)}
                >
                  Reset
                </button>
              </div>
              <input
                type="range"
                min={activePhotoSpec.min}
                max={activePhotoSpec.max}
                step={activePhotoSpec.step}
                value={activePhotoValue}
                disabled={!!busy}
                onChange={(event) => updatePhotoLabDraft(setPhotoAdjustmentValue(photoLab.draft, activePhotoSpec.type, Number(event.target.value)))}
                className="w-full disabled:opacity-40"
                style={{ accentColor: colors.accent }}
              />
              <div className={cn('mt-2 flex items-center justify-between text-[9px] tabular-nums', colors.textMuted)}>
                <span>{activePhotoSpec.min}</span>
                <span className={cn('rounded-full border px-2 py-1 font-bold', colors.panelBorder, colors.textMain)}>{activePhotoValueLabel}</span>
                <span>{activePhotoSpec.max}</span>
              </div>
            </div>
          </div>

          <footer className={cn('grid shrink-0 grid-cols-2 gap-2 border-t px-3 py-3', colors.panelBorder)}>
            <button
              disabled={!!busy}
              onClick={cancelPhotoLab}
              className={cn('min-h-11 rounded-xl border text-xs font-bold disabled:opacity-35', colors.panelBorder, colors.textMain)}
            >
              Cancel
            </button>
            <button
              disabled={!!busy}
              onClick={() => void commitPhotoLab()}
              className="press-accent-button flex min-h-11 items-center justify-center gap-2 rounded-xl text-xs font-bold disabled:opacity-35"
            >
              <Check size={15} /> Done
            </button>
          </footer>
        </section>
      )}

      {(busy || notice) && (
        <div className="pointer-events-none absolute bottom-16 left-3 right-3 z-50 flex justify-center" style={{ marginBottom: photoLab ? '62vh' : sheetOpen ? '45vh' : 'var(--sab)' }}>
          <div className="press-notice pointer-events-auto flex max-w-sm items-center gap-2 rounded-xl px-3 py-2 text-[11px] shadow-xl backdrop-blur">
            {busy ? <Loader2 size={13} className="shrink-0 animate-spin" /> : <Sparkles size={13} className="shrink-0 press-accent-text" />}
            <span className="flex-1">{busy || notice}</span>
            {!busy && <button onClick={() => setNotice(null)} className="p-1 opacity-60"><X size={13} /></button>}
          </div>
        </div>
      )}
    </div>
  );
}
