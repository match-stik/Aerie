// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// What a message's raw content turns into before a bubble draws it: the sentinels
// the adapter wraps attachments in, Discord's raw syntax, stickers and emoji as
// markdown images. No React and no store, so it can be tested on its own.

import { discordEmotesToMarkdown } from './discord-emotes';
import { stickerLinesAsParagraphs } from './sticker-lines';
import { extractVideoUrls, safeVideoSrc } from './video-attachments';

export interface MessageContent {
  isGif: boolean;
  isImage: boolean;
  isVoice: boolean;
  isFile: boolean;
  fileName: string;
  fileContent: string;
  mediaUrl: string;
  mediaUrls: string[];
  textContent: string;
  videoSources: string[];
  isEmoteOnly: boolean;
  emoteSizeClass: string;
  textToSpeak: string;
}

export function parseMessageContent(
  message: { content?: string | null; via?: unknown; type?: string },
  customEmojis: ReadonlyArray<{ shortcode: string }> | undefined,
  resolveSticker: (ref: string) => string | null | undefined,
): MessageContent {
  let isGif = false;
  let isImage = false;
  let isVoice = false;
  let isFile = false;
  let fileName = '';
  let fileContent = '';
  let mediaUrl = '';
  // Multi-attachment: a single message can carry several [IMG]: sentinels
  // (the adapter appends one per metadata.attachment). We surface them as
  // a list and render a small grid; mediaUrl above stays populated with
  // the first one so the legacy single-image rendering paths still work.
  const mediaUrls: string[] = [];
  let textContent = (message.content || '').trim();
  // Films ride as [VIDEO]: sentinels and come out first, so none of the
  // picture or file parsing below ever sees one.
  const videos = extractVideoUrls(textContent);
  textContent = videos.text;
  const videoSources = videos.urls.map(safeVideoSrc).filter((s): s is string => !!s);

  // Discord raw-syntax cleanup for bridged messages (render-time, so it's
  // retroactive across history): mention tokens like <@id> render as noise —
  // drop user/role/channel refs, and turn custom emotes <a:name:id> into
  // inline images straight off the Discord CDN (gif when animated, png
  // otherwise; the demoji: branch of the img renderer sizes them like
  // emotes). New ingests also resolve mentions server-side via cleanContent.
  // Emote tokens are drawn on every message, ours included: our Discord
  // replies carry them too, sometimes on a '# ' line (lib/discord-emotes.ts).
  textContent = discordEmotesToMarkdown(textContent);
  if (message.via && textContent.includes('<')) {
    textContent = textContent
      // Bridged Discord stickers — the gateway appends <dsticker:name:id.ext>
      // tokens (stickers aren't message content on Discord's side); unfold
      // them into the same sticker: img form house stickers use.
      .replace(/<dsticker:([^:>]*):(\d+\.(?:png|gif))>/g, (_m, name, file) =>
        `![sticker:${name}](https://media.discordapp.net/stickers/${file}?size=160)`)
      .replace(/<@[!&]?\d+>/g, '')
      .replace(/<#\d+>/g, '')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
  }

  // Discord "-# whisper" subtext: lines starting with "-# " render small and
  // muted. Rewritten to h6 (which chat prose never uses organically) so the
  // h6 component below can style it — works for bridged, typed, and
  // companion messages alike.
  if (/(^|\n)-# /.test(textContent)) {
    textContent = textContent.replace(/(^|\n)-# +(.*)/g, (_m, brk: string, text: string) => `${brk}###### ${text}`);
  }

  // Sticker refs: replace ::pack_sticker:: with an inline image markdown ref
  // that resolves to the cached URL from aerie/stickers.ts. Stickers must
  // run before the emoji pass so the `::` form doesn't get confused with
  // the `:emoji:` form.
  if (textContent && textContent.includes('::')) {
    textContent = textContent.replace(/::([a-zA-Z0-9_-]+_[a-zA-Z0-9_-]+)::/g, (match, ref) => {
      const url = resolveSticker(ref);
      return url ? `![sticker:${ref}](${url})` : match;
    });
  }

  // A sticker-only line becomes its own paragraph so it sits centered (lib/sticker-lines.ts).
  textContent = stickerLinesAsParagraphs(textContent);

  // Custom Emoji Parser: Replace :shortcode: with a lightweight placeholder tag.
  // This avoids passing massive Base64 strings through Markdown processing, preventing lag.
  if (customEmojis && customEmojis.length > 0 && textContent) {
    customEmojis.forEach(emoji => {
      const escapedShortcode = emoji.shortcode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const shortcodeRegex = new RegExp(`:${escapedShortcode}:`, 'g');
      // Use "emoji:" src scheme as a lightweight identifier for our custom renderer
      textContent = textContent.replace(shortcodeRegex, `![emoji:${emoji.shortcode}](emoji:${emoji.shortcode})`);
    });
  }
  // Emotes-only messages get Discord-style jumbo rendering — true when nothing
  // remains after removing emote placeholders (custom :shortcode: and bridged
  // Discord demoji images alike).
  let isEmoteOnly = false;
  if (textContent) {
    const strippedOfEmotes = textContent.replace(/!\[d?emoji(?:-big)?:[^\]]*\]\([^)]*\)/g, '');
    isEmoteOnly = strippedOfEmotes !== textContent && strippedOfEmotes.trim() === '';
  }
  // Jumbo when the message is nothing but emotes; comfortably larger inline otherwise.
  const emoteSizeClass = isEmoteOnly ? '!h-12' : '!h-[1.75em]';
  let textToSpeak = '';

  // Check if content is a voice note
  if (textContent.startsWith('[VOICE]:')) {
    isVoice = true;
    textContent = textContent.replace('[VOICE]:', '').trim();
  } else if (message.type === 'voice') {
    isVoice = true;
  }

  // If it's a voice note, extract the speaker and the actual message for the audio player
  if (isVoice) {
    // Find first ": " to split speaker from message
    const firstColon = textContent.indexOf(': ');
    if (firstColon !== -1 && firstColon < 20) {
      textToSpeak = textContent.substring(firstColon + 2).trim();
    } else {
      // Fallback if no colon is found
      textToSpeak = textContent;
    }
  }

  // Check if content contains a File
  if (textContent.includes('[FILE:')) {
    const match = textContent.match(/\[FILE:(.*?)\]:?\s*([\s\S]*)/);
    if (match) {
      isFile = true;
      fileName = match[1].trim() || 'document.pdf';
      fileContent = match[2];
      textContent = textContent.replace(match[0], '').trim();
    }
  }

  // Check if content contains a GIF or Image
  if (textContent.includes('[GIF]:')) {
    isGif = true;
    const parts = textContent.split('[GIF]:');
    textContent = parts[0].trim();
    mediaUrl = parts[1].trim();
  } else if (textContent.includes('[IMG]:')) {
    isImage = true;
    // The sentinel pattern is `[IMG]:<url>` and the adapter joins multiple
    // attachments with a space between each `[IMG]:url`. Splitting on the
    // sentinel and parsing each chunk lets us recover ALL urls instead of
    // just the first one (which was the old bug — multi-attachment
    // messages rendered only the first image on the bubble).
    const parts = textContent.split('[IMG]:');
    textContent = parts[0].trim();
    for (let i = 1; i < parts.length; i++) {
      let chunk = parts[i].trim();
      // [JSON]: tail (legacy single-image path) — strip it.
      if (chunk.includes('[JSON]:')) {
        chunk = chunk.split('[JSON]:')[0].trim();
      }
      // The next attachment's sentinel was already consumed by split,
      // but its url chunk may have whitespace separating multiple. Take
      // up to the first whitespace as the url; the rest (if any) is the
      // start of the next chunk and will be handled in the next iter…
      // except split already broke them apart. So just trim and use it.
      // Trailing space before next sentinel still ends up in the next
      // part as leading whitespace, which trim handles above.
      if (chunk) mediaUrls.push(chunk);
    }
    mediaUrl = mediaUrls[0] || '';
  } else {
    try {
      const parsed = JSON.parse(textContent);
      if (parsed.type === 'gif') {
        isGif = true;
        mediaUrl = parsed.url;
        textContent = '';
      }
    } catch (e) {
      // Not a JSON GIF
    }
    
    // Fallback: Check if the entire message is just a media URL
    if (!isGif && !isImage) {
      if (/^data:image\/(jpeg|jpg|png|gif|webp)[;,]/i.test(textContent)) {
        isImage = true;
        mediaUrl = textContent;
        textContent = '';
      } else {
        try {
          const url = new URL(textContent);
          const pathname = url.pathname.toLowerCase();
          const isTrustedDomain = (hostname: string, domain: string) => {
            return hostname === domain || hostname.endsWith('.' + domain);
          };
          if (
            pathname.match(/\.(jpeg|jpg|gif|png|webp)$/) || 
            (isTrustedDomain(url.hostname, 'giphy.com') && pathname.includes('/media/')) ||
            isTrustedDomain(url.hostname, 'media.tenor.com') ||
            isTrustedDomain(url.hostname, 'firebasestorage.googleapis.com')
          ) {
            isImage = true; // Treat as image to render it standalone
            mediaUrl = textContent;
            textContent = '';
          }
        } catch (e) {
          // Not a valid standalone URL
        }
      }
    }
  }

  return {
    isGif, isImage, isVoice, isFile, fileName, fileContent, mediaUrl, mediaUrls,
    textContent, videoSources, isEmoteOnly, emoteSizeClass, textToSpeak,
  };
}

export function isMediaUrl(url: string): boolean {
  if (/^data:image\/(jpeg|jpg|png|gif|webp)[;,]/i.test(url)) return true;
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname.toLowerCase();
    const isTrustedDomain = (hostname: string, domain: string) => {
      return hostname === domain || hostname.endsWith('.' + domain);
    };
    return (
      pathname.match(/\.(jpeg|jpg|gif|png|webp)$/) != null ||
      (isTrustedDomain(parsed.hostname, 'giphy.com') && pathname.includes('/media/')) ||
      isTrustedDomain(parsed.hostname, 'media.tenor.com') ||
      isTrustedDomain(parsed.hostname, 'firebasestorage.googleapis.com')
    );
  } catch (e) {
    return false;
  }
}
