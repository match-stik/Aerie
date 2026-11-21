// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import { useEffect, useMemo, useState } from 'react';
import { deskOf, type Desk } from './desk';

/**
 * The layout this window gets right now (lib/desk.ts). It follows the window
 * as they drag it wider or narrower, so a laptop window pulled down to a
 * sliver is the phone again without a reload.
 */
export function useDesk(theme: { deskLayout?: unknown; deskDock?: unknown; deskChat?: unknown }): Desk {
  const [width, setWidth] = useState(() => (typeof window === 'undefined' ? 0 : window.innerWidth));
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const { deskLayout, deskDock, deskChat } = theme;
  return useMemo(() => deskOf({ deskLayout, deskDock, deskChat }, width), [deskLayout, deskDock, deskChat, width]);
}

/**
 * The laptop's lock screen is the whole window, so a preview of it is drawn
 * at the window's size; undefined on the phone, where previews keep the
 * phone's shape.
 */
export function useDeskScreen(theme: { deskLayout?: unknown; deskDock?: unknown; deskChat?: unknown }): { width: number; height: number } | undefined {
  const on = useDesk(theme).on;
  const [size, setSize] = useState(() => (typeof window === 'undefined' ? { width: 0, height: 0 } : { width: window.innerWidth, height: window.innerHeight }));
  useEffect(() => {
    const onResize = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return on && size.width > 0 && size.height > 0 ? size : undefined;
}
