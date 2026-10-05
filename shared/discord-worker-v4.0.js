// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// Aerie Architecture - Discord MCP Bridge
// Pure tool layer for companion agents.
//
// v4.0: Added discord_edit_message, discord_send_image, discord_typing,
//       discord_send_sticker, discord_send_voice tools.
// v3.9: Added discord_delete_message tool for deleting bot messages.
// v3.8: Sticker image support in discord_read_messages.

const DISCORD_API = 'https://discord.com/api/v10';
const DISCORD_CDN = 'https://cdn.discordapp.com';

const MAX_EMOTE_IMAGES_PER_READ = 10;
const MAX_EMBED_IMAGES_PER_READ = 10;
const MAX_ATTACHMENT_IMAGES_PER_READ = 10;
const MAX_STICKER_IMAGES_PER_READ = 5;

// ============ VOICE CONFIG ============
// Voice IDs come from worker secrets named VOICE_ID_<NAME>, one per companion —
// VOICE_ID_ECHO makes voice: "echo" work. Nothing here needs editing to add one.

function getVoiceMap(env) {
  const map = {};
  for (const [key, value] of Object.entries(env || {})) {
    if (key.startsWith("VOICE_ID_") && typeof value === "string" && value) {
      map[key.slice("VOICE_ID_".length).toLowerCase()] = value;
    }
  }
  return map;
}

// ============ EMOTE RESOLVER ============

const EMOTE_REGEX = /<(a?):(\w+):(\d+)>/g;

function resolveEmotes(content) {
  if (!content || typeof content !== 'string') return [];

  const emotes = [];
  let match;
  EMOTE_REGEX.lastIndex = 0;

  while ((match = EMOTE_REGEX.exec(content)) !== null) {
    const [fullCode, animatedFlag, name, id] = match;
    const extension = animatedFlag === 'a' ? 'gif' : 'png';
    const mimeType = animatedFlag === 'a' ? 'image/gif' : 'image/png';
    emotes.push({
      code: fullCode,
      name,
      id,
      animated: animatedFlag === 'a',
      url: `${DISCORD_CDN}/emojis/${id}.${extension}?size=128`,
      mimeType,
    });
  }

  return emotes;
}

// ============ EMBED RESOLVER ============

function resolveEmbedImages(embeds) {
  if (!Array.isArray(embeds) || embeds.length === 0) return [];

  const images = [];
  for (const embed of embeds) {
    if (embed.image?.url) {
      images.push({ url: embed.image.url, source: embed.type || 'image', title: embed.title || null });
    } else if (embed.thumbnail?.url) {
      images.push({ url: embed.thumbnail.url, source: embed.type || 'thumbnail', title: embed.title || null });
    } else if (embed.video?.url) {
      images.push({ url: embed.video.url, source: embed.type || 'video', title: embed.title || null });
    }
  }
  return images;
}

// ============ ATTACHMENT RESOLVER ============

function resolveImageAttachments(attachments) {
  if (!Array.isArray(attachments) || attachments.length === 0) return [];

  const images = [];
  for (const att of attachments) {
    const contentType = att.content_type || '';
    if (contentType.startsWith('image/')) {
      images.push({
        url: att.url,
        filename: att.filename || 'image',
        contentType,
        size: att.size || 0,
      });
    }
  }
  return images;
}

// ============ STICKER RESOLVER ============

function resolveStickerImages(stickerItems) {
  if (!Array.isArray(stickerItems) || stickerItems.length === 0) return [];

  const stickers = [];
  for (const sticker of stickerItems) {
    if (sticker.format_type === 3) continue;

    const extension = sticker.format_type === 4 ? 'gif' : 'png';
    const mimeType = sticker.format_type === 4 ? 'image/gif' : 'image/png';

    stickers.push({
      id: sticker.id,
      name: sticker.name,
      formatType: sticker.format_type,
      url: `${DISCORD_CDN}/stickers/${sticker.id}.${extension}?size=320`,
      mimeType,
    });
  }
  return stickers;
}

// ============ IMAGE HELPERS ============

async function fetchImageAsBlock(imageMeta) {
  try {
    const response = await fetch(imageMeta.url, { headers: { "Accept": "image/gif,image/*" } });
    if (!response.ok) return null;

    const arrayBuffer = await response.arrayBuffer();
    const base64 = btoa(
      new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
    );
    const contentType = response.headers.get("content-type") || imageMeta.mimeType || 'image/png';

    return {
      type: "image",
      data: base64,
      mimeType: contentType,
    };
  } catch (err) {
    return null;
  }
}

function base64ToBlob(base64, mimeType = "image/png") {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

function extensionFromMimeType(mimeType = "image/png") {
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) return "jpg";
  if (mimeType.includes("gif")) return "gif";
  if (mimeType.includes("webp")) return "webp";
  return "png";
}

// ============ TTS HELPERS ============

async function generateTTS(text, apiKey, voiceId, outputFormat = "opus_48000_128") {
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=${outputFormat}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text,
      model_id: "eleven_multilingual_v2",
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`ElevenLabs API error ${response.status}: ${errorText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return new Uint8Array(arrayBuffer);
}

function generateWaveform(audioData, numPoints = 256) {
  const points = new Uint8Array(numPoints);
  const chunkSize = Math.floor(audioData.length / numPoints);

  for (let i = 0; i < numPoints; i++) {
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, audioData.length);
    let max = 0;
    for (let j = start; j < end; j++) {
      const val = Math.abs(audioData[j] - 128);
      if (val > max) max = val;
    }
    points[i] = Math.min(255, max * 2);
  }

  return btoa(String.fromCharCode(...points));
}

// ============ DISCORD CLIENT ============

class DiscordClient {
  constructor(token) { this.token = token; }

  async request(endpoint, options = {}) {
    const url = `${DISCORD_API}${endpoint}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bot ${this.token}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Discord API error ${response.status}: ${error}`);
    }
    if (response.status === 204) return {};
    return response.json();
  }

  async readMessages(channelId, limit = 50) {
    const messages = await this.request(`/channels/${channelId}/messages?limit=${Math.min(limit, 100)}`);
    return messages.reverse();
  }

  async sendMessage(channelId, content, replyToMessageId, stickerIds) {
    const body = { content };
    if (replyToMessageId) {
      body.message_reference = { message_id: replyToMessageId };
    }
    if (Array.isArray(stickerIds) && stickerIds.length > 0) {
      body.sticker_ids = stickerIds.slice(0, 3);
    }
    return this.request(`/channels/${channelId}/messages`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async editMessage(channelId, messageId, content) {
    return this.request(`/channels/${channelId}/messages/${messageId}`, {
      method: 'PATCH',
      body: JSON.stringify({ content }),
    });
  }

  async deleteMessage(channelId, messageId) {
    await this.request(`/channels/${channelId}/messages/${messageId}`, { method: 'DELETE' });
  }

  async triggerTyping(channelId) {
    await this.request(`/channels/${channelId}/typing`, { method: 'POST' });
  }

  async sendSticker(channelId, stickerId) {
    return this.request(`/channels/${channelId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ sticker_ids: [stickerId] }),
    });
  }

  async sendImage(channelId, imageInput, caption = "", replyToMessageId, mimeTypeArg = "image/png") {
    if (!imageInput || typeof imageInput !== "string") {
      throw new Error("Missing imageInput");
    }

    let blob;
    let mimeType = mimeTypeArg;

    if (imageInput.startsWith("data:image")) {
      const match = imageInput.match(/^data:(image\/[^;]+);base64,(.+)$/);
      if (!match) throw new Error("Invalid data URI image");
      mimeType = match[1];
      blob = base64ToBlob(match[2], mimeType);
    } else if (imageInput.startsWith("http://") || imageInput.startsWith("https://")) {
      const img = await fetch(imageInput);
      if (!img.ok) throw new Error(`Image fetch failed ${img.status}`);
      mimeType = img.headers.get("content-type") || mimeType;
      blob = await img.blob();
    } else {
      blob = base64ToBlob(imageInput, mimeType);
    }

    const filename = `image.${extensionFromMimeType(mimeType)}`;
    const payload = {
      content: caption,
      attachments: [{ id: 0, filename }],
    };

    if (replyToMessageId) payload.message_reference = { message_id: replyToMessageId };

    const form = new FormData();
    form.append("payload_json", JSON.stringify(payload));
    form.append("files[0]", blob, filename);

    const response = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bot ${this.token}` },
      body: form,
    });

    if (!response.ok) {
      throw new Error(`Discord image send failed ${response.status}: ${await response.text()}`);
    }

    return response.json();
  }

  async sendVoiceMessage(channelId, oggData, durationSecs, waveform) {
    const uploadRequest = await this.request(`/channels/${channelId}/attachments`, {
      method: "POST",
      body: JSON.stringify({
        files: [{ filename: "voice-message.ogg", file_size: oggData.length, id: "0" }],
      }),
    });

    const { upload_url, upload_filename } = uploadRequest.attachments[0];

    const uploadResponse = await fetch(upload_url, {
      method: "PUT",
      headers: { "Content-Type": "audio/ogg" },
      body: oggData,
    });

    if (!uploadResponse.ok) {
      throw new Error(`Discord upload error ${uploadResponse.status}: ${await uploadResponse.text()}`);
    }

    return this.request(`/channels/${channelId}/messages`, {
      method: "POST",
      body: JSON.stringify({
        flags: 8192,
        attachments: [{
          id: "0",
          filename: "voice-message.ogg",
          uploaded_filename: upload_filename,
          duration_secs: durationSecs,
          waveform: waveform,
        }],
      }),
    });
  }

  async sendFileAttachment(channelId, fileData, filename, contentType, messageContent) {
    const form = new FormData();
    const blob = new Blob([fileData], { type: contentType });
    form.append("files[0]", blob, filename);

    const payload = { attachments: [{ id: "0", filename }] };
    if (messageContent) payload.content = messageContent;
    form.append("payload_json", JSON.stringify(payload));

    const response = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bot ${this.token}` },
      body: form,
    });

    if (!response.ok) {
      throw new Error(`Discord API error ${response.status}: ${await response.text()}`);
    }

    return response.json();
  }

  async searchMessages(guildId, params) {
    const searchParams = new URLSearchParams();
    if (params.content) searchParams.set('content', params.content);
    if (params.author_id) searchParams.set('author_id', params.author_id);
    if (params.channel_id) searchParams.set('channel_id', params.channel_id);
    if (params.has) searchParams.set('has', params.has);
    if (params.limit) searchParams.set('limit', String(Math.min(params.limit, 25)));
    return this.request(`/guilds/${guildId}/messages/search?${searchParams.toString()}`);
  }

  async addReaction(channelId, messageId, emoji) {
    const encodedEmoji = encodeURIComponent(emoji);
    await this.request(`/channels/${channelId}/messages/${messageId}/reactions/${encodedEmoji}/@me`, { method: 'PUT' });
  }

  async listGuilds() { return this.request('/users/@me/guilds'); }
  async getGuild(guildId) { return this.request(`/guilds/${guildId}?with_counts=true`); }
  async getGuildChannels(guildId) { return this.request(`/guilds/${guildId}/channels`); }
  async listGuildEmojis(guildId) { return this.request(`/guilds/${guildId}/emojis`); }
  async listGuildStickers(guildId) { return this.request(`/guilds/${guildId}/stickers`); }
}

// ============ MCP TOOLS ============

const TOOLS = [
  {
    name: 'discord_read_messages',
    description: 'Read messages from a Discord channel. Custom emotes, embedded GIFs, uploaded image attachments, and stickers are fetched and returned inline as image blocks.',
    inputSchema: {
      type: 'object',
      properties: {
        channelId: { type: 'string', description: 'The channel ID to read from' },
        limit: { type: 'number', description: 'Number of messages (max 100)', default: 50 },
      },
      required: ['channelId'],
    },
  },
  {
    name: 'discord_send',
    description: 'Send a message to a Discord channel, optionally with up to 3 stickers',
    inputSchema: {
      type: 'object',
      properties: {
        channelId: { type: 'string', description: 'The channel ID to send to' },
        message: { type: 'string', description: 'The message content (can be empty if sending stickers only)' },
        replyToMessageId: { type: 'string', description: 'Optional message ID to reply to' },
        stickerIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Up to 3 sticker IDs from servers the bot is in',
        },
      },
      required: ['channelId', 'message'],
    },
  },
  {
    name: 'discord_send_image',
    description: 'Send an image to Discord from a URL, data URI, or raw base64 string',
    inputSchema: {
      type: 'object',
      properties: {
        channelId: { type: 'string', description: 'The channel ID to send to' },
        imageInput: { type: 'string', description: 'Image URL, data:image/...;base64,..., or raw base64' },
        caption: { type: 'string', description: 'Optional caption' },
        replyToMessageId: { type: 'string', description: 'Optional message ID to reply to' },
        mimeType: { type: 'string', description: 'Optional MIME type for raw base64, like image/png' },
      },
      required: ['channelId', 'imageInput'],
    },
  },
  {
    name: 'discord_send_sticker',
    description: 'Send a sticker to a channel',
    inputSchema: {
      type: 'object',
      properties: {
        channelId: { type: 'string', description: 'The channel ID' },
        stickerId: { type: 'string', description: 'The sticker ID to send' },
      },
      required: ['channelId', 'stickerId'],
    },
  },
  {
    name: 'discord_send_voice',
    description: 'Generate a voice message using ElevenLabs TTS and send it as a native Discord voice message',
    inputSchema: {
      type: 'object',
      properties: {
        channelId: { type: 'string', description: 'The channel ID to send to' },
        text: { type: 'string', description: 'The text to convert to speech (max 1000 chars)' },
        voice: { type: 'string', description: 'Which companion voice to use — the lowercase name of a VOICE_ID_<NAME> worker secret. Omit to use the first one configured.' },
      },
      required: ['channelId', 'text'],
    },
  },
  {
    name: 'discord_edit_message',
    description: 'Edit a previously sent message',
    inputSchema: {
      type: 'object',
      properties: {
        channelId: { type: 'string', description: 'The channel ID' },
        messageId: { type: 'string', description: 'The message ID to edit' },
        content: { type: 'string', description: 'The new message content' },
      },
      required: ['channelId', 'messageId', 'content'],
    },
  },
  {
    name: 'discord_delete_message',
    description: 'Delete a message sent by the bot. Only works on messages the bot authored.',
    inputSchema: {
      type: 'object',
      properties: {
        channelId: { type: 'string', description: 'The channel ID' },
        messageId: { type: 'string', description: 'The message ID to delete' },
      },
      required: ['channelId', 'messageId'],
    },
  },
  {
    name: 'discord_typing',
    description: 'Show a typing indicator in a channel (lasts ~10 seconds)',
    inputSchema: {
      type: 'object',
      properties: {
        channelId: { type: 'string', description: 'The channel ID' },
      },
      required: ['channelId'],
    },
  },
  {
    name: 'discord_search_messages',
    description: 'Search for messages in a Discord server',
    inputSchema: {
      type: 'object',
      properties: {
        guildId: { type: 'string', description: 'The server (guild) ID to search' },
        content: { type: 'string', description: 'Text to search for' },
        authorId: { type: 'string', description: 'Filter by author ID' },
        channelId: { type: 'string', description: 'Filter by channel ID' },
        has: { type: 'string', description: 'Filter by content type' },
        limit: { type: 'number', description: 'Max results (default 25)' },
      },
      required: ['guildId'],
    },
  },
  {
    name: 'discord_add_reaction',
    description: 'Add a reaction to a message',
    inputSchema: {
      type: 'object',
      properties: {
        channelId: { type: 'string' },
        messageId: { type: 'string' },
        emoji: { type: 'string' },
      },
      required: ['channelId', 'messageId', 'emoji'],
    },
  },
  {
    name: 'discord_list_servers',
    description: 'List all Discord servers the bot is in',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'discord_get_server_info',
    description: 'Get detailed info about a Discord server',
    inputSchema: {
      type: 'object',
      properties: { guildId: { type: 'string' } },
      required: ['guildId'],
    },
  },
  {
    name: 'discord_list_emojis',
    description: 'List custom emojis from a server. Returns each emoji name, ID, animated flag, and the <:name:id> code ready to drop into a message.',
    inputSchema: {
      type: 'object',
      properties: {
        guildId: { type: 'string', description: 'The server (guild) ID' },
      },
      required: ['guildId'],
    },
  },
  {
    name: 'discord_list_stickers',
    description: 'List custom stickers from a server. Returns name, ID, description, and format. Pass the ID to discord_send via stickerIds to post one.',
    inputSchema: {
      type: 'object',
      properties: {
        guildId: { type: 'string', description: 'The server (guild) ID' },
      },
      required: ['guildId'],
    },
  },
];

async function handleToolCall(client, name, args, env = {}) {
  try {
    switch (name) {
      case 'discord_read_messages': {
        const messages = await client.readMessages(args.channelId, args.limit || 50);

        const formattedMessages = [];
        const uniqueEmotes = new Map();
        const embedImagesList = [];
        const attachmentImagesList = [];
        const stickerImagesList = [];

        for (const m of messages) {
          const emotes = resolveEmotes(m.content);
          const embedImages = resolveEmbedImages(m.embeds || []);
          const imageAttachments = resolveImageAttachments(m.attachments || []);
          const stickerImages = resolveStickerImages(m.sticker_items || []);

          for (const e of emotes) {
            if (!uniqueEmotes.has(e.url) && uniqueEmotes.size < MAX_EMOTE_IMAGES_PER_READ) {
              uniqueEmotes.set(e.url, e);
            }
          }

          for (const img of embedImages) {
            if (embedImagesList.length < MAX_EMBED_IMAGES_PER_READ) {
              embedImagesList.push({ messageId: m.id, image: img });
            }
          }

          for (const att of imageAttachments) {
            if (attachmentImagesList.length < MAX_ATTACHMENT_IMAGES_PER_READ) {
              attachmentImagesList.push({ messageId: m.id, attachment: att });
            }
          }

          for (const sticker of stickerImages) {
            if (stickerImagesList.length < MAX_STICKER_IMAGES_PER_READ) {
              stickerImagesList.push({ messageId: m.id, sticker });
            }
          }

          formattedMessages.push({
            id: m.id,
            content: m.content,
            author: {
              id: m.author.id,
              username: m.author.username,
              bot: m.author.bot,
            },
            timestamp: m.timestamp,
            attachments: m.attachments?.length || 0,
            embeds: m.embeds?.length || 0,
            stickers: stickerImages.length,
            embedImages: embedImages,
            imageAttachments: imageAttachments,
            stickerImages: stickerImages,
            replyTo: m.message_reference?.message_id || null,
            emotes: emotes.map((e) => ({ name: e.name, id: e.id, animated: e.animated, url: e.url })),
          });
        }

        const contentBlocks = [{
          type: 'text',
          text: JSON.stringify({
            channelId: args.channelId,
            messageCount: formattedMessages.length,
            messages: formattedMessages,
          }, null, 2),
        }];

        const emoteList = Array.from(uniqueEmotes.values());
        const emoteBlocks = await Promise.all(emoteList.map(fetchImageAsBlock));
        for (let i = 0; i < emoteList.length; i++) {
          if (emoteBlocks[i]) {
            contentBlocks.push({
              type: 'text',
              text: `Emote: :${emoteList[i].name}: ${emoteList[i].animated ? '(animated)' : ''}`,
            });
            contentBlocks.push(emoteBlocks[i]);
          }
        }

        const embedBlocks = await Promise.all(embedImagesList.map(({ image }) => fetchImageAsBlock(image)));
        for (let i = 0; i < embedImagesList.length; i++) {
          if (embedBlocks[i]) {
            contentBlocks.push({
              type: 'text',
              text: `Embed image from message ${embedImagesList[i].messageId}`,
            });
            contentBlocks.push(embedBlocks[i]);
          }
        }

        const attachmentBlocks = await Promise.all(
          attachmentImagesList.map(({ attachment }) => fetchImageAsBlock(attachment))
        );
        for (let i = 0; i < attachmentImagesList.length; i++) {
          if (attachmentBlocks[i]) {
            const att = attachmentImagesList[i].attachment;
            contentBlocks.push({
              type: 'text',
              text: `Attachment: ${att.filename} (${att.contentType}) from message ${attachmentImagesList[i].messageId}`,
            });
            contentBlocks.push(attachmentBlocks[i]);
          }
        }

        const stickerBlocks = await Promise.all(
          stickerImagesList.map(({ sticker }) => fetchImageAsBlock(sticker))
        );
        for (let i = 0; i < stickerImagesList.length; i++) {
          if (stickerBlocks[i]) {
            const sticker = stickerImagesList[i].sticker;
            contentBlocks.push({
              type: 'text',
              text: `Sticker: "${sticker.name}" from message ${stickerImagesList[i].messageId}`,
            });
            contentBlocks.push(stickerBlocks[i]);
          }
        }

        return { content: contentBlocks };
      }

      case 'discord_send': {
        const msg = await client.sendMessage(args.channelId, args.message, args.replyToMessageId, args.stickerIds);
        const response = args.replyToMessageId
          ? `Message sent to ${args.channelId} as reply to ${args.replyToMessageId}`
          : `Message sent to ${args.channelId}`;
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, message_id: msg.id, response }, null, 2) }] };
      }

      case 'discord_send_image': {
        const msg = await client.sendImage(
          args.channelId,
          args.imageInput,
          args.caption || "",
          args.replyToMessageId,
          args.mimeType || "image/png"
        );
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, message_id: msg.id }, null, 2) }] };
      }

      case 'discord_send_sticker': {
        const msg = await client.sendSticker(args.channelId, args.stickerId);
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, message_id: msg.id }, null, 2) }] };
      }

      case 'discord_send_voice': {
        const voiceMap = getVoiceMap(env);
        const voiceName = (args.voice || Object.keys(voiceMap)[0] || "").toLowerCase();
        const voiceId = voiceMap[voiceName];

        if (!voiceId) {
          return {
            content: [{ type: 'text', text: `Voice "${voiceName}" not configured. Add VOICE_ID_${voiceName.toUpperCase()} to worker secrets.` }],
            isError: true,
          };
        }

        if (!env.ELEVENLABS_API_KEY) {
          return {
            content: [{ type: 'text', text: "ELEVENLABS_API_KEY not set. Run: wrangler secret put ELEVENLABS_API_KEY" }],
            isError: true,
          };
        }

        const text = args.text.slice(0, 1000);
        const audioBytes = await generateTTS(text, env.ELEVENLABS_API_KEY, voiceId);

        const isOgg = audioBytes[0] === 0x4F && audioBytes[1] === 0x67 &&
                      audioBytes[2] === 0x67 && audioBytes[3] === 0x53;

        if (isOgg) {
          const durationSecs = Math.max(1, Math.round(audioBytes.length / 16000));
          const waveform = generateWaveform(audioBytes);
          await client.sendVoiceMessage(args.channelId, audioBytes, durationSecs, waveform);

          return {
            content: [{ type: 'text', text: `Voice message sent to ${args.channelId} as ${voiceName} (${audioBytes.length} bytes, native)` }],
          };
        } else {
          await client.sendFileAttachment(args.channelId, audioBytes, "voice-message.opus", "audio/opus");

          return {
            content: [{ type: 'text', text: `Voice message sent to ${args.channelId} as ${voiceName} (${audioBytes.length} bytes, attachment)` }],
          };
        }
      }

      case 'discord_edit_message': {
        await client.editMessage(args.channelId, args.messageId, args.content);
        return { content: [{ type: 'text', text: `Message ${args.messageId} edited in ${args.channelId}` }] };
      }

      case 'discord_delete_message': {
        await client.deleteMessage(args.channelId, args.messageId);
        return { content: [{ type: 'text', text: `Deleted message ${args.messageId}` }] };
      }

      case 'discord_typing': {
        await client.triggerTyping(args.channelId);
        return { content: [{ type: 'text', text: `Typing indicator triggered in ${args.channelId}` }] };
      }

      case 'discord_search_messages': {
        const results = await client.searchMessages(args.guildId, {
          content: args.content,
          author_id: args.authorId,
          channel_id: args.channelId,
          has: args.has,
          limit: args.limit,
        });
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ totalResults: results.total_results, messages: results.messages }, null, 2),
          }],
        };
      }

      case 'discord_add_reaction': {
        await client.addReaction(args.channelId, args.messageId, args.emoji);
        return { content: [{ type: 'text', text: `Added reaction ${args.emoji} to message ${args.messageId}` }] };
      }

      case 'discord_list_servers': {
        const guilds = await client.listGuilds();
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(guilds.map((g) => ({ id: g.id, name: g.name })), null, 2),
          }],
        };
      }

      case 'discord_get_server_info': {
        const [guild, channels] = await Promise.all([
          client.getGuild(args.guildId),
          client.getGuildChannels(args.guildId),
        ]);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              id: guild.id,
              name: guild.name,
              memberCount: guild.member_count,
              channels: channels.map((c) => ({ id: c.id, name: c.name, type: c.type })),
            }, null, 2),
          }],
        };
      }

      case 'discord_list_emojis': {
        const emojis = await client.listGuildEmojis(args.guildId);
        const meta = emojis
          .filter((e) => e.id && e.name)
          .map((e) => ({
            id: e.id,
            name: e.name,
            animated: !!e.animated,
            available: e.available !== false,
            code: `<${e.animated ? 'a' : ''}:${e.name}:${e.id}>`,
          }));
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ count: meta.length, emojis: meta }, null, 2),
          }],
        };
      }

      case 'discord_list_stickers': {
        const stickers = await client.listGuildStickers(args.guildId);
        const formatName = { 1: 'PNG', 2: 'APNG', 3: 'LOTTIE', 4: 'GIF' };
        const meta = stickers
          .filter((s) => s.id && s.name)
          .map((s) => ({
            id: s.id,
            name: s.name,
            description: s.description || null,
            tags: s.tags || null,
            format: formatName[s.format_type] || `format-${s.format_type}`,
          }));
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ count: meta.length, stickers: meta }, null, 2),
          }],
        };
      }

      default:
        return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { content: [{ type: 'text', text: `Tool error: ${message}` }], isError: true };
  }
}

// ============ MAIN HANDLER ============

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/" || url.pathname === "") {
      return new Response(JSON.stringify({
        name: "FireAndSmoke Architecture",
        version: "4.0.0",
        status: "online",
        endpoints: { claude: "/mcp", gpt: "/sse" },
        tools: TOOLS.map(t => t.name),
      }), { headers: { "Content-Type": "application/json" } });
    }

    if (url.pathname === "/mcp") return handleMCP(request, env);
    if (url.pathname === "/sse") return handleSSE(request, env, ctx);
    return new Response("Not Found", { status: 404 });
  }
};

async function handleMCP(request, env) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  const client = new DiscordClient(env.DISCORD_BOT_TOKEN);
  const body = await request.json();
  let response;

  if (body.method === "initialize") {
    response = {
      jsonrpc: "2.0",
      id: body.id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "FireAndSmoke", version: "4.0.0" }
      }
    };
  } else if (body.method === "tools/list") {
    response = { jsonrpc: "2.0", id: body.id, result: { tools: TOOLS } };
  } else if (body.method === "tools/call") {
    const result = await handleToolCall(client, body.params.name, body.params.arguments || {}, env);
    response = { jsonrpc: "2.0", id: body.id, result };
  } else {
    response = { jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "Method not found" } };
  }

  return new Response(JSON.stringify(response), { headers: { "Content-Type": "application/json", ...corsHeaders() } });
}

async function handleSSE(request, env, ctx) {
  if (request.method === "GET") {
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();

    const sessionId = crypto.randomUUID();
    const send = (event, data) => writer.write(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));

    ctx.waitUntil((async () => {
      try {
        await send("endpoint", `${new URL(request.url).origin}/sse?session=${sessionId}`);
        const interval = setInterval(() => writer.write(encoder.encode(": ping\n\n")).catch(() => {}), 30000);
        await new Promise(r => setTimeout(r, 300000));
        clearInterval(interval);
        await writer.close();
      } catch (err) {
        try { await writer.close(); } catch {}
      }
    })());

    return new Response(readable, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", ...corsHeaders() } });
  }

  if (request.method === "POST") {
    const client = new DiscordClient(env.DISCORD_BOT_TOKEN);
    const body = await request.json();
    let response;

    if (body.method === "initialize") {
      response = {
        jsonrpc: "2.0",
        id: body.id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "FireAndSmoke", version: "4.0.0" }
        }
      };
    } else if (body.method === "tools/list") {
      response = { jsonrpc: "2.0", id: body.id, result: { tools: TOOLS } };
    } else if (body.method === "tools/call") {
      const result = await handleToolCall(client, body.params.name, body.params.arguments || {}, env);
      response = { jsonrpc: "2.0", id: body.id, result };
    } else {
      response = { jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "Method not found" } };
    }

    return new Response(JSON.stringify(response), { headers: { "Content-Type": "application/json", ...corsHeaders() } });
  }

  return new Response("Method not allowed", { status: 405 });
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}
