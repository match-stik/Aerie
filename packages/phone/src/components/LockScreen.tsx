// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import React, { useState, useEffect } from 'react';
import { motion, useAnimation, PanInfo } from 'motion/react';
import { Cloud, Sun, CloudRain, Snowflake } from 'lucide-react';

interface LockScreenProps {
  onUnlock: () => void;
  wallpaper?: string;
}

interface WeatherData {
  temp: number;
  code: number;
}

export function LockScreen({ onUnlock, wallpaper }: LockScreenProps) {
  const [time, setTime] = useState(new Date());
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const controls = useAnimation();

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          try {
            const { latitude, longitude } = position.coords;
            const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current_weather=true&temperature_unit=fahrenheit`);
            const data = await res.json();
            if (data.current_weather) {
              setWeather({
                temp: Math.round(data.current_weather.temperature),
                code: data.current_weather.weathercode,
              });
            }
          } catch (e) {
            console.error('Failed to fetch weather', e);
          }
        },
        (error) => {
          console.error('Geolocation error:', error);
        }
      );
    }
  }, []);

  const handleDragEnd = (event: any, info: PanInfo) => {
    if (info.offset.y < -100) {
      onUnlock();
    } else {
      controls.start({ y: 0, transition: { type: 'spring', stiffness: 300, damping: 20 } });
    }
  };

  const getWeatherIcon = (code: number) => {
    if (code <= 3) return <Sun className="h-4 w-4 text-yellow-300" />;
    if (code <= 48) return <Cloud className="h-4 w-4 text-white/80" />;
    if (code <= 67 || code >= 80) return <CloudRain className="h-4 w-4 text-blue-300" />;
    return <Snowflake className="h-4 w-4 text-white" />;
  };

  return (
    <motion.div 
      className="absolute inset-0 z-50 flex flex-col items-center justify-between overflow-hidden bg-black text-white"
      initial={{ opacity: 1 }}
      animate={{ opacity: 1 }}
      exit={{ y: '-100%', opacity: 0, transition: { duration: 0.4, ease: 'easeInOut' } }}
    >
      {/* Wallpaper Background */}
      {wallpaper && (
        <div 
          className="absolute inset-0 z-0 bg-cover bg-center opacity-60"
          style={{ backgroundImage: `url(${wallpaper})` }}
        />
      )}
      {!wallpaper && (
        <div className="absolute inset-0 z-0 bg-gradient-to-b from-slate-900 to-black opacity-80" />
      )}

      {/* Top Section: Time & Date */}
      <div className="z-10 mt-6 flex flex-col items-center">
        <h1 className="text-5xl font-light tracking-tight drop-shadow-lg">
          {time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </h1>
        <p className="mt-1 text-sm font-medium text-white/80 drop-shadow-md">
          {time.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}
        </p>
      </div>

      {/* Weather Widget — top-right corner */}
      {weather && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="absolute top-12 right-4 z-10 flex items-center gap-1.5 rounded-full bg-black/30 px-3 py-1.5 backdrop-blur-md border border-white/10"
          style={{ marginTop: 'var(--sat)' }}
        >
          {getWeatherIcon(weather.code)}
          <span className="text-xs font-medium">{weather.temp}°F</span>
        </motion.div>
      )}

      {/* Bottom Section: Swipe to Unlock */}
      <motion.div 
        className="z-10 mb-12 flex flex-col items-center"
        drag="y"
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={0.2}
        onDragEnd={handleDragEnd}
        animate={controls}
      >
        <motion.div 
          className="mb-4 h-1 w-12 rounded-full bg-white/30"
          animate={{ y: [0, -10, 0] }}
          transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
        />
        <p className="text-sm font-medium tracking-widest text-white/50 uppercase">
          Swipe up to unlock
        </p>
      </motion.div>
    </motion.div>
  );
}
