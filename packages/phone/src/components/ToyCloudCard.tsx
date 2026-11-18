// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The Lovense app road on the Toys page: for a screen with no Android phone
// holding the toys (a laptop, a browser, an iPhone). The toys stay connected
// to the Lovense Remote app on the person's phone, and the house reaches them
// through Lovense's servers (backend services/lovense-cloud.ts).
//
// A bridge left open after somebody forgets it runs into Lovense's rate
// limits, and what Lovense hands back is a link to a QR picture, which on the
// same screen has to be opened on the phone instead of scanned. So every step
// here is a button the person presses (nothing polls), the picture Lovense hands back is shown AND its link is
// there to open or copy, and Disconnect makes the old link worthless.

import { useCallback, useEffect, useState } from 'react';
import { Hand, Link2, LoaderCircle, Unplug } from 'lucide-react';
import { api } from '../aerie';
import { cn } from '../lib/utils';

interface CloudStatus {
  hasToken: boolean;
  open: boolean;
  lastUsedAt: string | null;
  closesAfterQuietMinutes: number;
  /** What the Lovense app last posted to the house's callback, when that is set up. */
  toys?: { id: string; name: string; nickName: string; connected: boolean }[] | null;
  toysAt?: string | null;
}

interface Props {
  /** False when the page around it has its own STOP. */
  withStop?: boolean;
  panelClass: string;
  textMain: string;
  textMuted: string;
}

async function post<T>(url: string, body?: unknown): Promise<T | null> {
  try {
    const res = await api.post(url, body ?? {});
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('application/json')) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export function ToyCloudCard({ withStop = true, panelClass, textMain, textMuted }: Props) {
  const [status, setStatus] = useState<CloudStatus | null>(null);
  const [link, setLink] = useState<{ qr: string; code: string | null } | null>(null);
  const [note, setNote] = useState<string>('');
  const [busy, setBusy] = useState<string>('');

  const refresh = useCallback(async () => {
    try {
      const res = await api.get('/api/toys/cloud');
      const ct = res.headers.get('content-type') || '';
      if (res.ok && ct.includes('application/json')) setStatus((await res.json()) as CloudStatus);
    } catch {
      // Leave the card as it was; nothing here should shout about a blip.
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const run = async (name: string, fn: () => Promise<void>) => {
    setBusy(name);
    try { await fn(); } finally { setBusy(''); void refresh(); }
  };

  const getLink = () => run('link', async () => {
    const out = await post<{ ok: boolean; qr?: string; code?: string | null; error?: string }>('/api/toys/cloud/link');
    if (out?.ok && out.qr) {
      setLink({ qr: out.qr, code: out.code ?? null });
      setNote('Open the Lovense Remote app on your phone and scan this, or open the link on your phone.');
    } else setNote(out?.error || 'Could not get a link from Lovense.');
  });

  const check = () => run('check', async () => {
    const out = await post<{ ok: boolean; toys?: unknown; error?: string }>('/api/toys/cloud/check');
    if (out?.ok) {
      const names = toyNames(out.toys);
      // Lovense's server road answers GetToys with a plain yes and no list (seen
      // with a Fizz linked and buzzing), so a missing list means
      // linked, not empty.
      setNote(names.length ? `Linked. The Lovense app has: ${names.join(', ')}.` : 'Linked: the Lovense app is open and answering.');
    } else setNote(out?.error || 'Could not ask Lovense.');
  });

  const hand = (open: boolean) => run(open ? 'hand' : 'back', async () => {
    await post('/api/toys/cloud/hand', { open });
    setNote(open ? '' : 'Taken back, and every toy stopped.');
  });

  const stop = () => run('stop', async () => {
    const out = await post<{ ok: boolean; error?: string }>('/api/toys/cloud/stop');
    setNote(out?.ok ? 'Stopped. The remote stays handed over until you take it back.' : out?.error || 'Stop did not reach Lovense.');
  });

  const disconnect = () => run('disconnect', async () => {
    await post('/api/toys/cloud/disconnect');
    setLink(null);
    setNote('Disconnected. The old link no longer works; get a new one to link again.');
  });

  const btn = 'flex items-center justify-center gap-1.5 rounded-[var(--shape-control)] px-3 py-2 text-xs font-medium transition-transform active:scale-[0.98] disabled:opacity-50';
  const quiet = cn(btn, 'border border-white/15 bg-white/5');

  if (status && !status.hasToken) {
    return (
      <div className={cn(panelClass, 'p-4 text-sm')}>
        <p className={textMain}>Through the Lovense app</p>
        <p className={cn('mt-1 text-xs', textMuted)}>
          Add your Lovense developer token in Settings, Secrets, and this screen can reach your toys through the Lovense Remote app on your phone.
        </p>
      </div>
    );
  }

  return (
    <div className={cn(panelClass, 'flex flex-col gap-3 p-4 text-sm')}>
      <div>
        <p className={textMain}>Through the Lovense app</p>
        <p className={cn('mt-1 text-xs', textMuted)}>
          Your toys stay connected to the Lovense Remote app on your phone, and this screen reaches them through Lovense: everything on this page works from here. Your companions can't reach them until you hand the remote over, and it closes by itself after {status?.closesAfterQuietMinutes ?? 120} quiet minutes.
        </p>
      </div>

      {status?.open ? (
        <div className="flex gap-2">
          {withStop && (
            <button className={cn(btn, 'flex-1')} style={{ background: 'var(--aerie-selected-fill)', color: 'var(--aerie-on-accent)' }} onClick={stop} disabled={!!busy}>
              <Hand size={14} /> STOP
            </button>
          )}
          <button className={cn(quiet, 'flex-1', textMain)} onClick={() => hand(false)} disabled={!!busy}>Take it back</button>
        </div>
      ) : (
        <button className={cn(btn, 'w-full')} style={{ background: 'var(--aerie-selected-fill)', color: 'var(--aerie-on-accent)' }} onClick={() => hand(true)} disabled={!!busy}>
          Hand over the remote
        </button>
      )}

      <div className="flex flex-wrap gap-2">
        <button className={cn(quiet, textMain)} onClick={getLink} disabled={!!busy}>
          {busy === 'link' ? <LoaderCircle size={14} className="animate-spin" /> : <Link2 size={14} />} Get link
        </button>
        <button className={cn(quiet, textMain)} onClick={check} disabled={!!busy}>
          {busy === 'check' ? <LoaderCircle size={14} className="animate-spin" /> : null} Check
        </button>
        <button className={cn(quiet, textMain)} onClick={disconnect} disabled={!!busy}>
          <Unplug size={14} /> Disconnect
        </button>
      </div>

      {link && (
        <div className="flex flex-col items-center gap-2">
          <img src={link.qr} alt="Lovense link code" className="h-44 w-44 rounded-[var(--shape-control)] bg-white p-2" />
          <a href={link.qr} target="_blank" rel="noreferrer" className={cn('break-all text-center text-xs underline', textMuted)}>{link.qr}</a>
          {link.code && <p className={cn('text-xs', textMuted)}>Code: {link.code}</p>}
        </div>
      )}

      {status?.toys && status.toys.length > 0 && (() => {
        // What is on first, by name, and what it knows but can't reach after.
        const label = (t: { name: string; nickName: string }) => {
          const n = t.nickName || t.name || 'a toy';
          return n.charAt(0).toUpperCase() + n.slice(1);
        };
        const on = status.toys.filter((t) => t.connected).map(label);
        const off = status.toys.filter((t) => !t.connected).map(label);
        return (
          <p className={cn('text-xs', textMain)}>
            {on.length ? `Connected in the Lovense app: ${on.join(', ')}.` : 'No toys connected in the Lovense app right now.'}
            {off.length ? ` It also knows ${off.join(', ')}, not connected right now.` : ''}
          </p>
        );
      })()}

      {note && <p className={cn('text-xs', textMuted)}>{note}</p>}
    </div>
  );
}

/** Toy names out of Lovense's GetToys answer, whatever shape it comes in. */
function toyNames(raw: unknown): string[] {
  let data = raw;
  if (data && typeof data === 'object' && 'toys' in (data as Record<string, unknown>)) data = (data as Record<string, unknown>).toys;
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch { return []; }
  }
  const list = Array.isArray(data) ? data : data && typeof data === 'object' ? Object.values(data as Record<string, unknown>) : [];
  return list
    .map((t) => (t && typeof t === 'object' ? String((t as Record<string, unknown>).nickName || (t as Record<string, unknown>).name || (t as Record<string, unknown>).toyType || '') : ''))
    .filter(Boolean);
}
