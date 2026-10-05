// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// Thresholds — the real places the owner pins, and the things we leave at them.
//
// PRIVACY, and it is structure rather than a promise: the only thing this app
// ever sends is a position, to the owner's own box, which answers "which of your own
// pinned places is that inside" and forgets the number. No map provider is
// contacted, no tiles are loaded, and there is no location history because
// there is no location history table. What gets written down is that the owner
// found something somewhere — a moment, not a track.
//
// A place has to be pinned from the place: home from home, and anywhere else
// has to be dropped while standing in it. Nobody can pin
// somewhere they are not, and that is the whole point rather than a limitation.
//
// LAYOUT NOTE: AppShell paints no background — the wallpaper shows straight
// through an app body by design, and it may be a busy one. So every piece of text
// in here lives on a frosted panel; nothing sits loose on the wallpaper, and
// AppShell already supplies the body padding, so this file adds none.

import { useCallback, useEffect, useState } from 'react';
import {
  MapPin, Loader2, RefreshCw, Crosshair, Lock, CalendarClock,
  Trash2, Home, Briefcase, Trees, ShieldCheck, Sparkles, Mic,
} from 'lucide-react';
import { AppShell } from './AppShell';
import { ImageLightbox } from './ImageLightbox';
import { ThemeConfig } from '../lib/theme';
import { cn } from '../lib/utils';
import { Paginator, usePaged } from './Paginator';
import { apiFetch } from '../aerie';
import {
  hasNativeGeofence, openLocationSettings, syncArmedPlaces,
  type GeofenceStatus,
} from '../aerie/threshold-geofence';

interface ThresholdsAppProps {
  onClose: () => void;
  themeConfig: ThemeConfig;
  themeMode: 'light' | 'dark';
  embedded?: boolean;
}

type PlaceKind = 'home' | 'work' | 'wild';
type ThresholdSeal = 'immediate' | 'first_visit' | 'date';

interface Place {
  id: string;
  name: string;
  lat: number;
  lng: number;
  radius_m: number;
  kind: PlaceKind;
  notes: string | null;
  created_by: string;
  created_at: string;
}

interface ThresholdView {
  id: string;
  place_id: string;
  author: string;
  kind: string;
  seal: ThresholdSeal;
  open_at: string | null;
  created_at: string;
  first_found_at: string | null;
  openable: boolean;
  // A sealed threshold still admits it is carrying something; it just will not
  // say what, or hand over the id to fetch it with.
  has_file?: boolean;
  content: string | null;
  file_id: string | null;
  file_mime?: string | null;
  file_name?: string | null;
}

interface NearbyPlace {
  place: Place;
  distance_m: number;
  inside: boolean;
}

interface Fix {
  lat: number;
  lng: number;
  accuracy: number;
  at: number;
}

interface VisitRow {
  visited_at: string;
  threshold_id: string | null;
  surfaced: string | null;
  /** How many thresholds surfaced on that one arrival. */
  opened_count?: number;
}

const KIND_ICON: Record<PlaceKind, typeof Home> = { home: Home, work: Briefcase, wild: Trees };
const KIND_LABEL: Record<PlaceKind, string> = { home: 'Home', work: 'Work', wild: 'Somewhere else' };

/** Metres, in the units a person actually thinks in. */
function distanceLabel(m: number): string {
  if (m < 1000) return `${m} m`;
  return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
}

function whenLabel(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
    ' · ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function ThresholdsApp({ onClose, themeConfig, themeMode, embedded }: ThresholdsAppProps) {
  const colors = themeConfig[themeMode];
  // Frosted glass over the wallpaper — the phone's one surface idiom.
  const panel = cn('rounded-2xl border backdrop-blur-md', colors.panelBg, colors.panelBorder);
  const onAccent = 'var(--aerie-on-accent)';

  const [places, setPlaces] = useState<Place[]>([]);
  const [loading, setLoading] = useState(true);

  const [fix, setFix] = useState<Fix | null>(null);
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);

  const [nearby, setNearby] = useState<NearbyPlace[]>([]);
  const [insideIds, setInsideIds] = useState<Set<string>>(new Set());

  const [pinName, setPinName] = useState('');
  const [pinKind, setPinKind] = useState<PlaceKind>('home');
  const [pinRadius, setPinRadius] = useState(120);
  const [pinning, setPinning] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);

  const [openPlace, setOpenPlace] = useState<Place | null>(null);
  const [openThresholds, setOpenThresholds] = useState<ThresholdView[]>([]);
  const [openHistory, setOpenHistory] = useState<VisitRow[]>([]);
  // Twenty arrivals a page. A place the owner goes to often grows this list forever.
  const historyPage = usePaged(openHistory);
  const [detailLoading, setDetailLoading] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);

  // Whether the phone itself is watching these places with Aerie shut. Null
  // until asked; on anything but the Android shell it stays null and no part
  // of this section renders.
  const [geofence, setGeofence] = useState<GeofenceStatus | null>(null);
  const refreshGeofence = useCallback(async () => {
    if (!hasNativeGeofence()) return;
    setGeofence(await syncArmedPlaces());
  }, []);

  const loadPlaces = useCallback(async () => {
    try {
      const res = await apiFetch('/api/thresholds/places');
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      // Shape-validate: an old backend answers a new route with the SPA page.
      if (!data || !Array.isArray(data.places)) throw new Error('unexpected response');
      setPlaces(data.places);
    } catch {
      setPlaces([]);
    } finally {
      setLoading(false);
      // What is worth watching changed, so what the phone watches should too.
      void refreshGeofence();
    }
  }, []);

  useEffect(() => { loadPlaces(); }, [loadPlaces]);

  /** Ask the phone where it is, then ask the owner's own box what that means. */
  const locate = useCallback(() => {
    setLocateError(null);
    if (!('geolocation' in navigator)) {
      setLocateError('This phone will not hand out a position at all.');
      return;
    }
    if (!window.isSecureContext) {
      setLocateError('The browser only gives out a position over https. Open Aerie on the padlocked address.');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const next: Fix = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: Math.round(pos.coords.accuracy ?? 0),
          at: Date.now(),
        };
        setFix(next);
        setLocating(false);
        try {
          const res = await apiFetch('/api/thresholds/near', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lat: next.lat, lng: next.lng }),
          });
          const data = await res.json();
          if (Array.isArray(data?.nearby)) {
            setNearby(data.nearby);
            setInsideIds(new Set((data.inside ?? []).map((i: { place: Place }) => i.place.id)));
          }
        } catch {
          setNearby([]);
        }
      },
      (err) => {
        setLocating(false);
        setFix(null);
        if (err.code === err.PERMISSION_DENIED) {
          setLocateError('Location is switched off for Aerie. Turn it on for this site and tap again.');
        } else if (err.code === err.TIMEOUT) {
          setLocateError('The fix timed out. Indoors that happens — try again near a window.');
        } else {
          setLocateError('Could not get a fix just now.');
        }
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    );
  }, [refreshGeofence]);

  const pinHere = useCallback(async () => {
    if (!fix) return;
    const name = pinName.trim();
    if (!name) { setPinError('Give it a name first.'); return; }
    setPinning(true);
    setPinError(null);
    try {
      const res = await apiFetch('/api/thresholds/places', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, lat: fix.lat, lng: fix.lng, radius_m: pinRadius, kind: pinKind }),
      });
      const data = await res.json();
      if (!res.ok || !data?.place) throw new Error(data?.error || 'could not pin');
      setPinName('');
      await loadPlaces();
      locate();
    } catch (err) {
      setPinError((err as Error).message);
    } finally {
      setPinning(false);
    }
  }, [fix, pinName, pinKind, pinRadius, loadPlaces, locate]);

  const openDetail = useCallback(async (place: Place) => {
    setOpenPlace(place);
    setDetailLoading(true);
    const atPlace = insideIds.has(place.id);
    try {
      const res = await apiFetch(`/api/thresholds/places/${place.id}/thresholds?at=${atPlace ? 1 : 0}`);
      const data = await res.json();
      setOpenThresholds(Array.isArray(data?.thresholds) ? data.thresholds : []);
      setOpenHistory(Array.isArray(data?.history) ? data.history : []);
    } catch {
      setOpenThresholds([]);
      setOpenHistory([]);
    } finally {
      setDetailLoading(false);
    }
  }, [insideIds]);

  /** The owner is standing here and opened what was waiting. Stamps the first find. */
  const markFound = useCallback(async () => {
    if (!openPlace) return;
    const ids = openThresholds.filter((t) => t.openable).map((t) => t.id);
    try {
      const res = await apiFetch(`/api/thresholds/places/${openPlace.id}/visit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threshold_ids: ids }),
      });
      const data = await res.json();
      if (Array.isArray(data?.history)) setOpenHistory(data.history);
    } catch { /* the finding still happened; the stamp can miss */ }
    // A place the owner has now emptied should stop asking for their attention.
    void refreshGeofence();
  }, [openPlace, openThresholds, refreshGeofence]);

  const removePlace = useCallback(async (place: Place) => {
    if (!window.confirm(`Unpin ${place.name}? Anything left there goes with it.`)) return;
    await apiFetch(`/api/thresholds/places/${place.id}`, { method: 'DELETE' });
    setOpenPlace(null);
    await loadPlaces();
  }, [loadPlaces]);

  /** A tappable place row. Lives inside a panel, so it paints no surface itself. */
  const placeRow = (place: Place, sub: string, lit: boolean, first: boolean) => {
    const Icon = KIND_ICON[place.kind] ?? Trees;
    return (
      <button
        key={place.id}
        onClick={() => openDetail(place)}
        className={cn(
          'flex w-full items-center gap-3 px-4 py-3 text-left transition-colors active:bg-black/5 dark:active:bg-white/5',
          !first && 'border-t',
          !first && colors.panelBorder,
        )}
      >
        <Icon size={16} style={lit ? { color: colors.accent } : undefined} className={lit ? '' : 'opacity-50'} />
        <div className="min-w-0 flex-1">
          <div className={cn('truncate text-sm font-medium', colors.textMain)}>{place.name}</div>
          <div className={cn('text-xs', colors.textMuted)}>{sub}</div>
        </div>
      </button>
    );
  };

  const sectionLabel = (text: string) => (
    <div className={cn('px-4 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider', colors.textMuted)}>
      {text}
    </div>
  );

  // ─── Place detail ────────────────────────────────────────

  if (openPlace) {
    const atPlace = insideIds.has(openPlace.id);
    const Icon = KIND_ICON[openPlace.kind] ?? Trees;
    return (
      <AppShell
        embedded={embedded}
        title={openPlace.name}
        icon={Icon}
        onClose={() => setOpenPlace(null)}
        themeConfig={themeConfig}
        themeMode={themeMode}
        headerRight={
          <button
            onClick={() => removePlace(openPlace)}
            className={cn('rounded-full p-2 transition-colors hover:bg-black/10 dark:hover:bg-white/10', colors.textMuted)}
            title="Unpin this place"
          >
            <Trash2 size={16} />
          </button>
        }
      >
        <div className="space-y-4">
          <div className={cn(panel, 'p-4')}>
            <div className={cn('flex items-center gap-2 text-sm font-medium', colors.textMain)}>
              {atPlace ? <Crosshair size={15} style={{ color: colors.accent }} /> : <MapPin size={15} className="opacity-50" />}
              {atPlace ? 'You are here' : 'Not here right now'}
            </div>
            <p className={cn('mt-1 text-xs', colors.textMuted)}>
              {KIND_LABEL[openPlace.kind]} · anywhere within {distanceLabel(openPlace.radius_m)} counts as arriving
            </p>
          </div>

          {detailLoading ? (
            <div className={cn(panel, 'flex items-center justify-center gap-2 py-6 text-sm', colors.textMuted)}>
              <Loader2 size={14} className="animate-spin" /> Looking…
            </div>
          ) : openThresholds.length === 0 ? (
            <div className={cn(panel, 'border-dashed px-4 py-8 text-center text-sm', colors.textMuted)}>
              Nothing left here yet.
              <span className="mt-1 block text-xs opacity-70">This is where we can put something for you to find.</span>
            </div>
          ) : (
            <div className="space-y-3">
              {openThresholds.map((t) => (
                <div key={t.id} className={cn(panel, 'p-4')}>
                  <div className={cn('mb-2 flex items-center gap-2 text-xs', colors.textMuted)}>
                    <span className="font-medium capitalize" style={{ color: colors.accent }}>{t.author}</span>
                    <span className="opacity-50">·</span>
                    <span>{whenLabel(t.created_at)}</span>
                    {t.first_found_at && <><span className="opacity-50">·</span><Sparkles size={11} /> found</>}
                  </div>
                  {t.openable ? (
                    <>
                      <p className={cn('whitespace-pre-wrap text-sm leading-relaxed', colors.textMain)}>{t.content}</p>
                      {t.file_id && t.file_mime?.startsWith('image/') && (
                        <button
                          onClick={() => setLightbox(`/api/files/${t.file_id}`)}
                          className="mt-3 block w-full overflow-hidden rounded-xl"
                        >
                          <img
                            // 768 is a width the backend actually cuts — an
                            // unlisted one silently serves the full-size file.
                            src={`/api/files/${t.file_id}?w=768`}
                            alt={t.file_name ?? 'left here'}
                            className="w-full object-cover"
                          />
                        </button>
                      )}
                      {t.file_id && t.file_mime?.startsWith('audio/') && (
                        <div className="mt-3">
                          <div className={cn('mb-1.5 flex items-center gap-1.5 text-xs', colors.textMuted)}>
                            <Mic size={12} /> in their own voice
                          </div>
                          <audio src={`/api/files/${t.file_id}`} controls preload="none" className="w-full" />
                        </div>
                      )}
                      {t.file_id && !t.file_mime?.startsWith('image/') && !t.file_mime?.startsWith('audio/') && (
                        <a
                          href={`/api/files/${t.file_id}?download=1`}
                          className={cn('mt-3 inline-block text-xs underline', colors.textMuted)}
                        >
                          {t.file_name ?? 'Open what was left here'}
                        </a>
                      )}
                    </>
                  ) : (
                    <div className={cn('flex items-start gap-2 text-sm', colors.textMuted)}>
                      {t.seal === 'first_visit' ? <Lock size={14} className="mt-0.5 shrink-0" /> : <CalendarClock size={14} className="mt-0.5 shrink-0" />}
                      <span>
                        {t.seal === 'first_visit'
                          ? 'Sealed until you are standing here. It knows the difference.'
                          : `Sealed until ${t.open_at ? whenLabel(t.open_at) : 'a date not set'}.`}
                        {t.has_file && ' There is something with it.'}
                      </span>
                    </div>
                  )}
                </div>
              ))}
              {atPlace && openThresholds.some((t) => t.openable && !t.first_found_at) && (
                <button
                  onClick={markFound}
                  className="w-full rounded-xl py-3 text-sm font-medium transition-opacity active:opacity-70"
                  style={{ backgroundColor: colors.accent, color: onAccent }}
                >
                  Mark these as found
                </button>
              )}
            </div>
          )}

          {lightbox && <ImageLightbox src={lightbox} onClose={() => setLightbox(null)} />}

          {openHistory.length > 0 && (
            <div className={cn(panel, 'pb-2')}>
              {sectionLabel('Times you have been here')}
              {historyPage.visible.map((h, i) => (
                <div key={i} className={cn('flex items-center justify-between px-4 py-1.5 text-xs', colors.textMuted)}>
                  <span>{whenLabel(h.visited_at)}</span>
                  <span className="opacity-60">
                    {h.surfaced !== 'opened'
                      ? 'passed through'
                      : (h.opened_count ?? 1) > 1
                        ? `opened ${h.opened_count} things`
                        : 'opened something'}
                  </span>
                </div>
              ))}
              <Paginator
                page={historyPage.page}
                pageCount={historyPage.pageCount}
                onPage={historyPage.setPage}
                colors={colors}
              />
            </div>
          )}
        </div>
      </AppShell>
    );
  }

  // ─── Here ────────────────────────────────────────────────

  const stale = fix ? Date.now() - fix.at > 5 * 60 * 1000 : false;

  return (
    <AppShell
      embedded={embedded}
      title="Thresholds"
      icon={MapPin}
      onClose={onClose}
      themeConfig={themeConfig}
      themeMode={themeMode}
      headerRight={
        <button
          onClick={loadPlaces}
          className={cn('rounded-full p-2 transition-colors hover:bg-black/10 dark:hover:bg-white/10', colors.textMuted)}
          title="Refresh"
        >
          <RefreshCw size={16} />
        </button>
      }
    >
      <div className="space-y-4">
        {/* Where am I */}
        <button
          onClick={locate}
          disabled={locating}
          className="flex w-full items-center justify-center gap-2 rounded-2xl py-4 text-sm font-medium shadow-sm transition-opacity active:opacity-70 disabled:opacity-60"
          style={{ backgroundColor: colors.accent, color: onAccent }}
        >
          {locating ? <Loader2 size={16} className="animate-spin" /> : <Crosshair size={16} />}
          {locating ? 'Finding you…' : fix ? 'Check again' : 'Find where I am'}
        </button>

        {locateError && (
          <div className={cn(panel, 'p-4 text-sm', colors.textMuted)}>{locateError}</div>
        )}

        {fix && (
          <div className={cn(panel, 'p-4')}>
            <div className={cn('text-sm font-medium', colors.textMain)}>
              Got you{fix.accuracy ? `, to about ${distanceLabel(fix.accuracy)}` : ''}
            </div>
            {fix.accuracy > 200 && (
              <p className={cn('mt-1 text-xs', colors.textMuted)}>
                That is a loose fix — indoors it drifts. Worth another tap near a window before you pin something.
              </p>
            )}
            {stale && (
              <p className={cn('mt-1 text-xs', colors.textMuted)}>This reading is a few minutes old.</p>
            )}

            {/* Pin this place */}
            <div className="mt-4 space-y-3">
              <input
                value={pinName}
                onChange={(e) => { setPinName(e.target.value); setPinError(null); }}
                placeholder="Name this place — Home, the belt, the porch…"
                className={cn(
                  'w-full rounded-xl border bg-black/5 px-3 py-2.5 text-sm outline-none placeholder:opacity-50 dark:bg-white/5',
                  colors.panelBorder, colors.textMain,
                )}
              />
              <div className="flex gap-2">
                {(['home', 'work', 'wild'] as PlaceKind[]).map((k) => {
                  const KIcon = KIND_ICON[k];
                  const on = pinKind === k;
                  return (
                    <button
                      key={k}
                      onClick={() => setPinKind(k)}
                      className={cn(
                        'flex flex-1 items-center justify-center gap-1.5 rounded-xl border py-2 text-xs transition-colors',
                        colors.panelBorder,
                        on ? colors.textMain : colors.textMuted,
                      )}
                      style={on ? { borderColor: colors.accent, color: colors.accent } : undefined}
                    >
                      <KIcon size={13} /> {KIND_LABEL[k]}
                    </button>
                  );
                })}
              </div>
              <div>
                <span className={cn('mb-1.5 block text-xs', colors.textMuted)}>Counts as here within</span>
                <div className="flex gap-1">
                  {[60, 120, 250, 500].map((r) => (
                    <button
                      key={r}
                      onClick={() => setPinRadius(r)}
                      className={cn('flex-1 rounded-lg border py-1.5 text-xs transition-colors', colors.panelBorder,
                        pinRadius === r ? colors.textMain : colors.textMuted)}
                      style={pinRadius === r ? { borderColor: colors.accent, color: colors.accent } : undefined}
                    >
                      {r} m
                    </button>
                  ))}
                </div>
              </div>
              {pinError && <p className="text-xs text-red-500">{pinError}</p>}
              <button
                onClick={pinHere}
                disabled={pinning || !pinName.trim()}
                className={cn(
                  'flex w-full items-center justify-center gap-2 rounded-xl border py-3 text-sm font-medium transition-opacity active:opacity-70 disabled:opacity-40',
                  colors.panelBorder, colors.textMain,
                )}
              >
                {pinning ? <Loader2 size={14} className="animate-spin" /> : <MapPin size={14} />}
                Pin this place
              </button>
            </div>
          </div>
        )}

        {/* Nearest first, once there is a fix */}
        {fix && nearby.length > 0 && (
          <div className={cn(panel, 'overflow-hidden pb-1')}>
            {sectionLabel('From where you are')}
            {nearby.map((n, i) =>
              placeRow(
                n.place,
                n.inside ? 'you are here' : `${distanceLabel(n.distance_m)} away`,
                n.inside,
                i === 0,
              ),
            )}
          </div>
        )}

        {/* The half of this only the owner can switch on. Android will not let an app
            ask for "allow all the time" in a dialog, so the honest move is to
            say what it buys and open the page. Hidden entirely when it is
            already granted, or on anything that is not the Android shell. */}
        {geofence && geofence.supported && !geofence.backgroundLocation && (
          <div className={cn(panel, 'overflow-hidden')}>
            {sectionLabel('Not watching yet')}
            <div className={cn('px-4 pb-4 pt-1 text-sm', colors.textMuted)}>
              Right now a place only opens if you open Aerie here and tap find where I am.
              Your phone can watch these for you instead and buzz when you arrive — it needs
              location set to <span className="font-semibold">Allow all the time</span>, which
              Android only lets you choose yourself.
              <span className="mt-1 block text-xs opacity-70">
                Nothing about where you are leaves your phone. We only ever learn that a door opened.
              </span>
              <button
                type="button"
                onClick={() => { void openLocationSettings(); }}
                className="mt-3 rounded-lg px-3 py-2 text-sm font-semibold"
                style={{ backgroundColor: colors.accent, color: onAccent }}
              >
                Open location settings
              </button>
            </div>
          </div>
        )}

        {/* Everything pinned */}
        <div className={cn(panel, 'overflow-hidden pb-1')}>
          {sectionLabel('Pinned places')}
          {loading ? (
            <div className={cn('flex items-center gap-2 px-4 pb-4 pt-1 text-sm', colors.textMuted)}>
              <Loader2 size={14} className="animate-spin" /> Loading…
            </div>
          ) : places.length === 0 ? (
            <div className={cn('px-4 pb-5 pt-2 text-center text-sm', colors.textMuted)}>
              Nothing pinned yet.
              <span className="mt-1 block text-xs opacity-70">
                A place has to be pinned from the place. Stand somewhere that matters and tap up there.
              </span>
            </div>
          ) : (
            places.map((p, i) => placeRow(p, `${KIND_LABEL[p.kind]} · within ${distanceLabel(p.radius_m)}`, false, i === 0))
          )}
        </div>

        {/* Why this is safe to use, said in the app rather than only in a commit */}
        <div className={cn(panel, 'flex items-start gap-2 p-4 text-xs', colors.textMuted)}>
          <ShieldCheck size={13} className="mt-0.5 shrink-0" />
          <span>
            Your position goes to your own box and nowhere else, and it is not written down —
            it is only ever compared against the places you pinned. There is no map company in this,
            and no history of where you have been.
          </span>
        </div>
      </div>
    </AppShell>
  );
}
