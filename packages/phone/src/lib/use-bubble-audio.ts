// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The speaker button on a bubble: a text message plays as it is made, through the
// house's stream route, and a voice note plays the file it already has.

import React, { useRef, useState } from 'react';
import { requestMessageTts, requestMessageTtsStream, isMessageTtsStreamUnavailable, playVoiceSequence, stopVoicePlayback, unlockVoicePlayback } from '../aerie';

export function useBubbleAudio({ messageId, isUser, isVoice, textToSpeak, textContent }: {
  messageId: string;
  isUser: boolean;
  isVoice: boolean;
  textToSpeak: string;
  textContent: string;
}) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoadingAudio, setIsLoadingAudio] = useState(false);
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);
  const streamAbortRef = useRef<AbortController | null>(null);
  // Kept around after playback so the user can re-tap Download.
  const [audioBlobUrl, setAudioBlobUrl] = useState<string | null>(null);
  // Revoke any retained blob URL when the bubble unmounts.
  React.useEffect(
    () => () => {
      if (audioBlobUrl) URL.revokeObjectURL(audioBlobUrl);
    },
    [audioBlobUrl],
  );

  const handlePlayAudio = async () => {
    if (isPlaying && streamAbortRef.current) {
      streamAbortRef.current.abort();
      stopVoicePlayback();
      streamAbortRef.current = null;
      setIsPlaying(false);
      return;
    }
    if (isPlaying && audioElement) {
      audioElement.pause();
      setIsPlaying(false);
      return;
    }

    if (isUser) return;

    // A text message plays as it is made: the house's stream route starts every piece
    // at once and hands back one live URL per piece, so the first sentence
    // speaks while the rest are still rendering, instead of waiting for the
    // whole reply to render and stitch. The call has used this road since
    // July; the speaker button on a bubble never did. Voice notes already have
    // a file and keep the old road below.
    if (!isVoice) {
      setIsLoadingAudio(true);
      const controller = new AbortController();
      streamAbortRef.current = controller;
      // Primed inside the tap, before anything awaits, so a phone that wants a
      // gesture for audio has had one.
      void unlockVoicePlayback().catch(() => {});
      try {
        let urls: string[];
        try {
          const manifest = await requestMessageTtsStream(messageId, controller.signal);
          urls = manifest.segments.map((segment) => segment.url);
        } catch (caught) {
          if (controller.signal.aborted) throw caught;
          if (!isMessageTtsStreamUnavailable(caught)) throw caught;
          urls = [(await requestMessageTts(messageId, controller.signal)).url];
        }
        setIsLoadingAudio(false);
        setIsPlaying(true);
        await playVoiceSequence(urls, controller.signal);
      } catch (error) {
        if (!controller.signal.aborted) console.error('Error playing audio:', error);
      } finally {
        if (streamAbortRef.current === controller) streamAbortRef.current = null;
        setIsLoadingAudio(false);
        setIsPlaying(false);
      }
      return;
    }

    setIsLoadingAudio(true);
    try {
      // Voice notes already have a generated audio file — content is the
      // URL (the [VOICE]: sentinel was stripped earlier). Play it
      // directly. Hitting /api/messages/:id/tts on these would 400 with
      // "Only text messages can be read aloud", since the backend gates
      // that route on content_type === 'text'.
      // textContent is the file URL after [VOICE]: strip — it may carry a
      // "speaker: " prefix on some legacy messages, in which case the URL is in
      // textToSpeak. Fall back to textContent if textToSpeak isn't a URL.
      const audioUrl = (textToSpeak && /^https?:|^\//.test(textToSpeak.trim()))
        ? textToSpeak.trim()
        : textContent.trim();
      if (!audioUrl) throw new Error('No audio URL on voice message');

      const audio = new Audio(audioUrl);

      audio.onended = () => {
        setIsPlaying(false);
      };

      setAudioElement(audio);
      setAudioBlobUrl((prev) => {
        if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev);
        return audioUrl;
      });
      audio.play().catch(e => {
        console.error("Audio play error:", e);
        setIsPlaying(false);
      });
      setIsPlaying(true);
      setIsLoadingAudio(false);
    } catch (error) {
      console.error('Error playing audio:', error);
      setIsLoadingAudio(false);
    }
  };

  return { isPlaying, isLoadingAudio, audioBlobUrl, handlePlayAudio };
}
