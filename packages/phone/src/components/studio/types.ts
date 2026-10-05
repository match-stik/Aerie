// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import type { ChangeEvent, MouseEvent, MutableRefObject, RefObject, TouchEvent } from 'react';
import type { ThemeColors, ThemeConfig } from '../../lib/theme';

export type ThemeMode = 'light' | 'dark';
export type ViewMode = 'generate' | 'edit' | 'draw' | 'refs';
export type StudioSection = 'create' | 'gif' | 'cutout' | 'gallery';
export type Backend = 'codex' | 'antigravity' | 'openart';
export type DrawTool = 'brush' | 'eraser';
export type CastSource = 'selected-references' | 'manual' | 'none' | 'unknown';
export type AspectRatioValue =
  | 'square' | 'portrait' | 'landscape'
  | '16:9' | '9:16' | '21:9'
  | '2:3' | '3:2' | '4:5' | '5:4' | '3:4' | '4:3'
  | 'custom';

export interface StudioPoint {
  x: number;
  y: number;
}

export interface GeneratedImage {
  id: string;
  src: string;
  prompt: string;
  model: string;
  backend: string;
  width: number;
  height: number;
  timestamp: number;
  folderId?: string;
  aspectRatio?: string;
  /** Legacy alias retained while older gallery metadata is migrated. */
  references?: string[];
  /** Exact drawers supplied to the renderer. Kept separate from visible cast. */
  referenceDrawers?: string[];
  /** Canonical people visible in the asset, used for exact-combination albums. */
  cast?: string[];
  castSource?: CastSource;
  /** Prompt before Studio appended a style preset. */
  sourcePrompt?: string;
  styleId?: string;
  mediaType?: 'image' | 'video';
}

export interface GalleryCastGroup {
  cast: string[];
  count: number;
}

export interface GalleryGroups {
  groups: GalleryCastGroup[];
  unknown: number;
  none: number;
}

export interface StudioFolder {
  id: string;
  name: string;
}

export interface RefDrawer {
  slug: string;
  label: string;
  isDefault: boolean;
  emoji?: string;
  refs: Array<{ filename: string; url: string }>;
}

/**
 * Readiness of one Studio backend, as reported by GET /api/studio/backends.
 * An empty list means the backend never answered — the picker then behaves
 * exactly as it did before this existed rather than dimming everything.
 */
export interface StudioBackendStatus {
  key: Backend;
  label: string;
  ready: boolean;
  reason?: string;
  fix?: string;
}

/**
 * The Codex window, when it is nearly gone. Rides on GET /api/studio/backends
 * so the user sees it before writing a prompt rather than after a job dies. Null
 * whenever there is nothing to say, and absent entirely from an older backend.
 */
export interface StudioWindowWarning {
  backend: 'codex';
  remainingPercent: number;
  usedPercent: number;
  window: 'primary' | 'secondary';
  windowMinutes: number | null;
  resetsAt: string | null;
  thresholdPercent: number;
  limitReached: boolean;
}

export interface StudioAppProps {
  onClose: () => void;
  themeConfig: ThemeConfig;
  themeMode: ThemeMode;
}

export interface StudioPanelProps {
  colors: ThemeColors;
  themeMode: ThemeMode;
}

export interface GenerationControlsProps extends StudioPanelProps {
  backend: Backend;
  setBackend: (b: Backend) => void;
  backendStatus: StudioBackendStatus[];
  codexModel: string;
  setCodexModel: (m: string) => void;
  agyModel: string;
  setAgyModel: (m: string) => void;
  openartModel: string;
  setOpenartModel: (m: string) => void;
  size: AspectRatioValue;
  setSize: (s: AspectRatioValue) => void;
  customWidth: number;
  setCustomWidth: (w: number) => void;
  customHeight: number;
  setCustomHeight: (h: number) => void;
  drawers: RefDrawer[];
  selectedSubjects: string[];
  toggleSubject: (slug: string) => void;
  showSubjects: boolean;
  setShowSubjects: (v: boolean) => void;
  prompt: string;
  setPrompt: (p: string) => void;
  selectedStyle: string;
  selectedDirective: string;
  setSelectedDirective: (d: string) => void;
  setSelectedStyle: (s: string) => void;
  showStylePicker: boolean;
  setShowStylePicker: (v: boolean) => void;
  showDirectivePicker: boolean;
  setShowDirectivePicker: (v: boolean) => void;
  generating: boolean;
  handleGenerate: () => void;
  enhancing: boolean;
  handleEnhance: () => void;
  error: string | null;
}

export interface GenerationResultsProps extends StudioPanelProps {
  currentImage: GeneratedImage | null;
  setViewMode: (m: ViewMode) => void;
  setViewingImage: (img: GeneratedImage | null) => void;
  handleDownload: (img: GeneratedImage) => void;
  setPrompt: (p: string) => void;
}

export interface GalleryPanelProps extends StudioPanelProps {
  history: GeneratedImage[];
  filteredHistory: GeneratedImage[];
  currentImage: GeneratedImage | null;
  selectFromHistory: (img: GeneratedImage) => void;
  clearHistory: () => void;
  historyRef: RefObject<HTMLDivElement | null>;
  folders: StudioFolder[];
  currentFolderId: string | null;
  setCurrentFolderId: (id: string | null) => void;
  drawers: RefDrawer[];
  currentRefFilter: string | null;
  setCurrentRefFilter: (slug: string | null) => void;
  showFolders: boolean;
  setShowFolders: (v: boolean) => void;
  newFolderName: string;
  setNewFolderName: (n: string) => void;
  createFolder: () => void;
  deleteFolder: (id: string) => void;
  viewingImage: GeneratedImage | null;
  setViewingImage: (img: GeneratedImage | null) => void;
  viewerZoom: number;
  setViewerZoom: (z: number) => void;
  viewerPan: StudioPoint;
  setViewerPan: (p: StudioPoint) => void;
  handleDownload: (img: GeneratedImage) => void;
  setCurrentImage: (img: GeneratedImage | null) => void;
  setViewMode: (m: ViewMode) => void;
  setPrompt: (p: string) => void;
  confirmDelete: GeneratedImage | null;
  setConfirmDelete: (img: GeneratedImage | null) => void;
  deleteFromHistory: (id: string) => void;
}

export interface EditPanelProps extends StudioPanelProps {
  currentImage: GeneratedImage;
  crop: StudioPoint;
  setCrop: (c: StudioPoint) => void;
  zoom: number;
  setZoom: (z: number) => void;
  rotation: number;
  setRotation: (r: number) => void;
  brightness: number;
  setBrightness: (v: number) => void;
  contrast: number;
  setContrast: (v: number) => void;
  hue: number;
  setHue: (v: number) => void;
  cropAspect: number;
  setCropAspect: (v: number) => void;
  onCropComplete: (croppedArea: unknown, croppedAreaPixels: unknown) => void;
  resetEditState: () => void;
}

export interface DrawingCanvasProps extends StudioPanelProps {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  drawTool: DrawTool;
  setDrawTool: (t: DrawTool) => void;
  drawColor: string;
  setDrawColor: (c: string) => void;
  brushSize: number;
  setBrushSize: (s: number) => void;
  drawHistory: string[];
  startDrawing: (e: MouseEvent<HTMLCanvasElement> | TouchEvent<HTMLCanvasElement>) => void;
  draw: (e: MouseEvent<HTMLCanvasElement> | TouchEvent<HTMLCanvasElement>) => void;
  stopDrawing: () => void;
  undoDraw: () => void;
  clearCanvas: () => void;
  /** Hand the canvas to the generator as a reference for the next picture. */
  attachSketchAsReference: () => void;
  sketchBusy: boolean;
  sketchAttached: boolean;
}

export interface RefsPanelProps extends StudioPanelProps {
  drawers: RefDrawer[];
  uploadingFor: string | null;
  refInputRefs: MutableRefObject<Record<string, HTMLInputElement | null>>;
  handleRefFileChange: (slug: string, e: ChangeEvent<HTMLInputElement>) => void;
  deleteRefImage: (slug: string, filename: string) => Promise<void>;
  deleteDrawer: (slug: string) => Promise<void>;
  newDrawerName: string;
  setNewDrawerName: (v: string) => void;
  createDrawer: () => void;
  creatingDrawer: boolean;
  error: string | null;
}

export interface UseStudioStateParams {
  themeMode: ThemeMode;
  codexModels: Array<{ id: string }>;
  antigravityModels: Array<{ id: string }>;
  openartModels: Array<{ key: string; id: string; media: 'image' | 'video' }>;
  promptStyles: Array<{ name: string; style: string }>;
  sizePresets: Array<{ value: AspectRatioValue; dims?: string }>;
}
