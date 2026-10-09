// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Box, ChevronLeft, Play, Trash2, Code, Eye } from 'lucide-react';
import { cn } from '../lib/utils';
import { useBackHandler } from '../lib/use-back-handler';
import { Paginator, usePaged } from './Paginator';
import type { ThemeConfig } from '../lib/theme';
// The runtime, the vendor inlining and the house-image inlining are shared
// with the Story Shelf's scene widgets, so they live in one place.
import { fillSealedPage, getVendorBundle, inlineHouseImages, sealedPageTemplate } from '../lib/sealed-frame';

interface ArtifactsAppProps {
  onClose: () => void;
  themeConfig: ThemeConfig;
  themeMode: 'light' | 'dark';
}

interface Artifact {
  id: string;
  name: string;
  description: string | null;
  code: string;
  thumbnail: string | null;
  created_at: string;
  updated_at: string;
}

export function ArtifactsApp({ onClose, themeConfig, themeMode }: ArtifactsAppProps) {
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const artifactsPage = usePaged(artifacts);
  const [loading, setLoading] = useState(true);
  const [selectedArtifact, setSelectedArtifact] = useState<Artifact | null>(null);
  const [view, setView] = useState<'list' | 'preview' | 'code'>('list');

  // The system back does what this app's own header arrow does: a step out of
  // preview or code lands on the list, and only the list closes the app.
  useBackHandler(view !== 'list', () => {
    setView('list');
    setSelectedArtifact(null);
  });
  const [error, setError] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const colors = themeConfig[themeMode];

  const fetchArtifacts = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/artifacts', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch artifacts');
      const data = await res.json();
      setArtifacts(data.artifacts || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchArtifacts();
  }, [fetchArtifacts]);

  const loadArtifact = async (id: string) => {
    try {
      const res = await fetch(`/api/artifacts/${id}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load artifact');
      const data = await res.json();
      setSelectedArtifact(data.artifact);
      setView('preview');
    } catch (err: any) {
      setError(err.message);
    }
  };

  const deleteArtifact = async (id: string) => {
    if (!confirm('Delete this artifact?')) return;
    try {
      await fetch(`/api/artifacts/${id}`, { method: 'DELETE', credentials: 'include' });
      setArtifacts(prev => prev.filter(a => a.id !== id));
      if (selectedArtifact?.id === id) {
        setSelectedArtifact(null);
        setView('list');
      }
    } catch (err: any) {
      setError(err.message);
    }
  };

  const renderInIframe = useCallback(() => {
    if (!iframeRef.current || !selectedArtifact) return;

    const iframe = iframeRef.current;
    const artifactCode = selectedArtifact.code;

    // Artifacts render inside the house, so they read the house's font instead
    // of hardcoding one. This resolves whatever the user has selected in Settings.
    const houseRoot = document.querySelector('.aerie-root');
    const houseFont = (houseRoot && getComputedStyle(houseRoot).fontFamily)
      || '"Geist", ui-sans-serif, system-ui, sans-serif';

    const html = sealedPageTemplate({ themeMode, accent: colors.accent, houseFont });

    // srcdoc, not doc.write: the artifact runs in a null-origin sandbox
    // (sandbox="allow-scripts", no allow-same-origin), so it cannot read the
    // app's cookies, touch the parent DOM, or call authenticated endpoints —
    // e.g. GET /api/secrets/:name, which hands full provider keys to any
    // same-origin caller. The runtime arrives inlined via getVendorBundle,
    // and fillSealedPage fills the template's two holes.
    Promise.all([getVendorBundle(), inlineHouseImages(artifactCode)])
      .then(([vendorTags, inlinedCode]) => {
        if (iframeRef.current !== iframe) return;
        iframe.srcdoc = fillSealedPage(html, vendorTags, inlinedCode);
      })
      .catch((err) => {
        if (iframeRef.current !== iframe) return;
        const msg = err instanceof Error ? err.message : String(err);
        iframe.srcdoc = `<!DOCTYPE html><html><body style="background:${themeMode === 'dark' ? '#0a0a0f' : '#ffffff'};color:${colors.accent};font-family:system-ui;padding:1rem">Failed to load the preview runtime: ${msg}</body></html>`;
      });
  }, [selectedArtifact, themeMode, colors.accent]);

  useEffect(() => {
    if (view === 'preview' && selectedArtifact) {
      const timer = setTimeout(renderInIframe, 100);
      return () => clearTimeout(timer);
    }
  }, [view, selectedArtifact, renderInIframe]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      // Transparent root so the wallpaper shows through like the other apps.
      // The rendered-artifact iframe keeps its own bg.
      className={cn("absolute inset-0 flex flex-col z-20", colors.textMain)}
      style={{
        paddingTop: 'var(--sat)',
        paddingBottom: 'var(--sab)'
      }}
    >
      {/* Header */}
      <header className={cn("aerie-shell-header flex items-center gap-3 px-4 pb-3", colors.pageBg)} style={{ paddingTop: 'calc(var(--sat) + 0.75rem)' }}>
        <button
          onClick={() => {
            if (view !== 'list') {
              setView('list');
              setSelectedArtifact(null);
            } else {
              onClose();
            }
          }}
          className={cn("p-2 -ml-2 rounded-full transition-colors hover:bg-black/10 dark:hover:bg-white/10", colors.textMuted)}
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <Box className="h-5 w-5" style={{ color: colors.accent }} />
        <h1 className={cn("text-lg font-semibold flex-1", colors.textMain)}>
          {view === 'list' ? 'Artifacts' : selectedArtifact?.name || 'Artifact'}
        </h1>
        {selectedArtifact && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setView(view === 'code' ? 'preview' : 'code')}
              className={cn("p-2 rounded-full transition-colors hover:bg-black/10 dark:hover:bg-white/10", colors.textMuted)}
              title={view === 'code' ? 'Preview' : 'View Code'}
            >
              {view === 'code' ? <Eye className="h-5 w-5" /> : <Code className="h-5 w-5" />}
            </button>
            <button
              onClick={() => deleteArtifact(selectedArtifact.id)}
              className="p-2 rounded-full transition-colors hover:opacity-80"
              style={{ color: colors.accent }}
              title="Delete"
            >
              <Trash2 className="h-5 w-5" />
            </button>
          </div>
        )}
      </header>

      {/* Content */}
      <div className="aerie-app-body flex-1 overflow-auto">
        {loading ? (
          <div className={cn("flex items-center justify-center h-full", colors.textMuted)}>
            Loading...
          </div>
        ) : error ? (
          <div className="p-4" style={{ color: colors.accent }}>{error}</div>
        ) : view === 'list' ? (
          <div className="p-4 space-y-3">
            {artifacts.length === 0 ? (
              <div className={cn("text-center py-12", colors.textMuted)}>
                <Box className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No artifacts yet</p>
                <p className="text-sm mt-1">Interactive components will appear here</p>
              </div>
            ) : (
              artifactsPage.visible.map(artifact => (
                <button
                  key={artifact.id}
                  onClick={() => loadArtifact(artifact.id)}
                  className={cn(
                    "w-full p-4 rounded-xl text-left transition-colors",
                    "hover:bg-black/5 dark:hover:bg-white/5",
                    colors.panelBg
                  )}
                >
                  <div className="flex items-start gap-3">
                    {artifact.thumbnail ? (
                      <img
                        src={artifact.thumbnail}
                        alt=""
                        className="w-12 h-12 rounded-lg object-cover"
                      />
                    ) : (
                      <div
                        className="w-12 h-12 rounded-lg flex items-center justify-center"
                        style={{ backgroundColor: colors.accent + '22' }}
                      >
                        <Box className="h-6 w-6" style={{ color: colors.accent }} />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <h3 className={cn("font-medium truncate", colors.textMain)}>{artifact.name}</h3>
                      {artifact.description && (
                        <p className={cn("text-sm truncate mt-1", colors.textMuted)}>
                          {artifact.description}
                        </p>
                      )}
                      <p className={cn("text-xs mt-1", colors.textMuted)}>
                        {new Date(artifact.updated_at).toLocaleDateString()}
                      </p>
                    </div>
                    <Play className={cn("h-5 w-5 flex-shrink-0", colors.textMuted)} />
                  </div>
                </button>
              ))
            )}
            <Paginator
              page={artifactsPage.page}
              pageCount={artifactsPage.pageCount}
              onPage={artifactsPage.setPage}
              colors={colors}
            />
          </div>
        ) : view === 'preview' ? (
          // sandbox="allow-scripts" WITHOUT allow-same-origin — a null opaque
          // origin, so artifact code (which can be model-generated) is walled off
          // from the app's cookies, DOM and authenticated API. The two flags
          // together defeat the sandbox entirely; that was the Aug 16 2026 audit
          // finding. Paired with srcdoc in renderInIframe above.
          <iframe
            ref={iframeRef}
            className="w-full h-full border-0"
            sandbox="allow-scripts"
            title="Artifact Preview"
          />
        ) : (
          <pre className={cn("p-4 text-sm overflow-auto h-full font-mono", colors.textMain)}>
            {selectedArtifact?.code}
          </pre>
        )}
      </div>
    </motion.div>
  );
}
