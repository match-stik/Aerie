// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The sky where the phone is, from Open-Meteo, for the lock screen and the
// home widget alike (moved out of LockScreen.tsx).
import { useEffect, useState } from 'react';
import type { LockWeather } from './LockClock';

export function useWeather(): LockWeather | null {
  const [weather, setWeather] = useState<LockWeather | null>(null);
  useEffect(() => {
    if (!('geolocation' in navigator)) return;
    let gone = false;
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const { latitude, longitude } = position.coords;
          const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current_weather=true&temperature_unit=fahrenheit`);
          const data = await res.json();
          if (!gone && data.current_weather) {
            setWeather({ temp: Math.round(data.current_weather.temperature), code: data.current_weather.weathercode });
          }
        } catch (e) {
          console.error('Failed to fetch weather', e);
        }
      },
      (error) => console.error('Geolocation error:', error),
    );
    return () => { gone = true; };
  }, []);
  return weather;
}
