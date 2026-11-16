// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The size of the room the laptop wallpaper sits behind, read off the
// wallpaper layer itself (theirs, Nov 15 2026: 'not sure what aspect ratio we'd
// need'). Null on the phone or before the layer is on the page.
import { useEffect, useState } from 'react';

export interface RoomSize { width: number; height: number }

export function readRoomSize(): RoomSize | null {
  if (typeof document === 'undefined') return null;
  if (!document.querySelector('.aerie-root[data-desk]')) return null;
  const layer = document.querySelector('.aerie-wallpaper-layer');
  if (!layer) return null;
  const r = layer.getBoundingClientRect();
  const width = Math.round(r.width), height = Math.round(r.height);
  return width > 0 && height > 0 ? { width, height } : null;
}

export function useRoomAspect(): RoomSize | null {
  const [size, setSize] = useState<RoomSize | null>(() => readRoomSize());
  useEffect(() => {
    const read = () => setSize((old) => {
      const next = readRoomSize();
      return old && next && old.width === next.width && old.height === next.height ? old : next;
    });
    read();
    const layer = document.querySelector('.aerie-wallpaper-layer');
    const ro = layer && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(read) : null;
    if (layer && ro) ro.observe(layer);
    window.addEventListener('resize', read);
    return () => { ro?.disconnect(); window.removeEventListener('resize', read); };
  }, []);
  return size;
}

/** The shape to crop a laptop room picture to: the room as it is now, or 16:10 when it cannot be read. */
export function deskRoomAspect(): number {
  const room = readRoomSize();
  return room ? room.width / room.height : 16 / 10;
}

/** The lock screen has the whole window, so its picture is cropped to the window. */
export function deskWindowAspect(): number {
  if (typeof window === 'undefined' || !(window.innerWidth > 0) || !(window.innerHeight > 0)) return 16 / 10;
  return window.innerWidth / window.innerHeight;
}
