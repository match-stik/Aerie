// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The browser's own back, for the web app (theirs, Oct 31 2026). On an Android
// phone the system back gesture goes to the browser, and the browser walks
// its history, which this phone never used for navigation, so back took them
// straight out of Aerie. Now, while they are anywhere with somewhere to step
// back to, one mark sits in the browser's history; when the browser goes
// back it lands on that mark instead of leaving, and the house takes the same
// step the app's back gesture takes, then puts the mark back if there is
// still somewhere to go. At the home screen there is no mark, so back leaves
// as a browser should. The APK never does any of this: its back comes to the
// listener above first.

import { useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { runBackHandler } from './back-stack';

export function useBrowserBack(
  osState: string,
  showSettings: boolean,
  setShowSettings: (open: boolean) => void,
  setOsState: (screen: 'home') => void,
  closeApp: () => void,
) {
  const backStateRef = useRef({ osState, showSettings });
  backStateRef.current = { osState, showSettings };
  const backMarkRef = useRef(false);
  useEffect(() => {
    if (Capacitor.isNativePlatform()) return;
    const deep = () => {
      const st = backStateRef.current;
      return st.showSettings || (st.osState !== 'home' && st.osState !== 'locked');
    };
    const mark = () => {
      if (backMarkRef.current || !deep()) return;
      try { window.history.pushState({ aerieBack: true }, ''); backMarkRef.current = true; } catch { /* history refused; back behaves as before */ }
    };
    const onPop = () => {
      if (!backMarkRef.current) return;
      backMarkRef.current = false;
      const st = backStateRef.current;
      if (st.showSettings) { if (!runBackHandler()) setShowSettings(false); }
      else if (st.osState === 'appdrawer') { if (!runBackHandler()) setOsState('home'); }
      else if (!runBackHandler() && st.osState !== 'home' && st.osState !== 'locked') closeApp();
      // Let the step land, then leave a fresh mark if they are still deep.
      window.setTimeout(mark, 0);
    };
    window.addEventListener('popstate', onPop);
    if (deep()) mark();
    else if (backMarkRef.current) {
      // Back home some other way (a tap, the home button): take the spare mark
      // out of history, so their next back leaves on the first press.
      backMarkRef.current = false;
      try { window.history.back(); } catch { /* nothing to take back */ }
    }
    return () => window.removeEventListener('popstate', onPop);
  }, [osState, showSettings]);
}
