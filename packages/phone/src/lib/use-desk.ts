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
