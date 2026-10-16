// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The orbs: Lovense's own app's gradient screen, made the house's. Each finger
// the owner puts on the glass is an orb, the first three wear the
// companions' colors, and how high the owner holds it sets its motor's level. Lifting a finger stops its motor at once;
// leaving the screen stops every motor an orb was driving.
//
// There is no stop button here, by design: on this screen the owner's hand is
// the stop. The page zeroes every motor and pattern before it opens this screen,
// so letting go really does mean everything stops. If the owner's stop was
// holding when they came in, a finger put down during the hold glows but drives
// nothing until it is lifted and placed again.

import { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { OrbField, backdropFor, cssColorToHex, levelForHeight, ownerForSlot, DEFAULT_BACKDROP, type Orb, type OrbBackdrop } from '../lib/orb-field';

export interface OrbMotor {
  toyId: string;
  command: string;
  /** What it drives, in a word: 'vibration', 'fingering'. */
  label: string;
  max: number;
}

interface ToyOrbsProps {
  motors: OrbMotor[];
  holding: boolean;
  onLevel: (toyId: string, command: string, level: number) => void;
  onClose: () => void;
}

/** One of the theme's two colors as hex. The second can be a color-mix()
 *  string, so anything that isn't hex already is resolved by the browser. */
function themeHex(name: string): string | null {
  const root = document.documentElement;
  const raw = getComputedStyle(root).getPropertyValue(name).trim()
    || getComputedStyle(root).getPropertyValue('--aerie-accent').trim();
  if (!raw) return null;
  const direct = cssColorToHex(raw);
  if (direct) return direct;
  const probe = document.createElement('span');
  probe.style.color = raw;
  probe.style.display = 'none';
  document.body.appendChild(probe);
  const computed = getComputedStyle(probe).color;
  probe.remove();
  return cssColorToHex(computed);
}

function currentBackdrop(): OrbBackdrop {
  try {
    return backdropFor(themeHex('--aerie-theme-a'), themeHex('--aerie-theme-b'));
  } catch {
    return DEFAULT_BACKDROP;
  }
}

interface Touch {
  slot: number;
  x: number;
  y: number;
  level: number;
  /** Put down while the owner's stop held: it glows, and drives nothing until lifted. */
  silent: boolean;
}

export function ToyOrbs({ motors, holding, onLevel, onClose }: ToyOrbsProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fieldRef = useRef<OrbField | null>(null);
  const touches = useRef(new Map<number, Touch>());
  const motorsRef = useRef(motors);
  motorsRef.current = motors;
  const holdingRef = useRef(holding);
  holdingRef.current = holding;
  const onLevelRef = useRef(onLevel);
  onLevelRef.current = onLevel;
  const [empty, setEmpty] = useState(true);
  // The screen wears the theme, and follows it if the
  // theme changes while the orbs are open.
  const [backdrop, setBackdrop] = useState<OrbBackdrop>(currentBackdrop);
  useEffect(() => {
    const observer = new MutationObserver(() => setBackdrop(currentBackdrop()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class'] });
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    fieldRef.current?.setBackdrop(backdrop);
  }, [backdrop]);
  const backdropRef = useRef(backdrop);
  backdropRef.current = backdrop;

  /** With no toy on, the orbs still answer a finger; there is just nothing to drive. */
  const slotCount = () => Math.max(motorsRef.current.length, 3);

  const send = (slot: number, level: number) => {
    const motor = motorsRef.current[slot];
    if (motor) onLevelRef.current(motor.toyId, motor.command, level);
  };

  const orbsNow = useCallback((): Orb[] => {
    const list: Orb[] = [];
    for (const t of touches.current.values()) {
      const motor = motorsRef.current[t.slot];
      list.push({
        x: t.x,
        y: t.y,
        level: t.level,
        max: motor?.max ?? 20,
        owner: ownerForSlot(t.slot),
        caption: motor?.label ?? '',
        muted: holdingRef.current || t.silent,
      });
    }
    return list;
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let field: OrbField;
    try {
      field = new OrbField(canvas);
    } catch {
      return;
    }
    fieldRef.current = field;
    field.setBackdrop(backdropRef.current);
    let frame = 0;
    let last = performance.now();
    const draw = (now: number) => {
      field.setOrbs(orbsNow());
      field.draw(now, now - last);
      last = now;
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => field.resize());
    observer?.observe(canvas);

    // The screen going away, or the phone going to sleep, stops every motor
    // an orb was driving.
    const releaseAll = () => {
      for (const t of touches.current.values()) send(t.slot, 0);
      touches.current.clear();
      setEmpty(true);
    };
    const onHidden = () => {
      if (document.hidden) releaseAll();
    };
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      document.removeEventListener('visibilitychange', onHidden);
      releaseAll();
      fieldRef.current = null;
    };
  }, [orbsNow]);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top, h: rect.height };
  };

  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const used = new Set([...touches.current.values()].map((t) => t.slot));
    let slot = -1;
    for (let i = 0; i < slotCount(); i++) {
      if (!used.has(i)) {
        slot = i;
        break;
      }
    }
    if (slot < 0) return; // every motor already has a finger on it
    e.currentTarget.setPointerCapture(e.pointerId);
    const { x, y, h } = point(e);
    const max = motorsRef.current[slot]?.max ?? 20;
    const level = levelForHeight(y, h, max);
    const silent = holdingRef.current;
    touches.current.set(e.pointerId, { slot, x, y, level, silent });
    setEmpty(false);
    if (!silent) send(slot, level);
  };

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const t = touches.current.get(e.pointerId);
    if (!t) return;
    const { x, y, h } = point(e);
    const max = motorsRef.current[t.slot]?.max ?? 20;
    const level = levelForHeight(y, h, max);
    t.x = x;
    t.y = y;
    if (level !== t.level) {
      t.level = level;
      if (!t.silent && !holdingRef.current) send(t.slot, level);
    }
  };

  const up = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const t = touches.current.get(e.pointerId);
    if (!t) return;
    touches.current.delete(e.pointerId);
    send(t.slot, 0);
    if (touches.current.size === 0) setEmpty(true);
  };

  return (
    <div className="fixed inset-0 z-[60] flex flex-col" style={{ background: backdrop.mid }}>
      <div className="flex items-center gap-2 px-3 pb-2 pt-[max(env(safe-area-inset-top),0.75rem)]" style={{ background: backdrop.top }}>
        <button onClick={onClose} className="rounded-full p-2 text-white/80 active:bg-white/10" aria-label="Back to Toys">
          <X size={20} />
        </button>
        <span className="flex-1 text-sm text-white/80">Orbs</span>
        <span className="pr-2 text-xs text-white/45">Let go to stop</span>
      </div>
      <div className="relative flex-1">
        <canvas
          ref={canvasRef}
          className="absolute inset-0 block h-full w-full"
          style={{ touchAction: 'none' }}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          onLostPointerCapture={up}
        />
        {empty && (
          <p className="pointer-events-none absolute inset-x-0 top-1/3 px-8 text-center text-sm leading-relaxed text-white/55">
            {holding
              ? 'Holding. Lift your fingers, then put one down again.'
              : motors.length === 0
                ? 'No toy is connected, so these only glow. Press and drag.'
                : 'Press anywhere and drag. Higher is stronger. Let go and it stops.'}
          </p>
        )}
      </div>
    </div>
  );
}
