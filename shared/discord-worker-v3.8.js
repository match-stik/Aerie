// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// Aerie Architecture - Discord MCP Bridge
// Pure tool layer for companion agents.
//
// v3.9: Added discord_delete_message tool for deleting bot messages.
// v3.8: Sticker image support in discord_read_messages.
// Stickers attached to messages are now fetched and returned as inline
// image blocks (PNG/GIF/APNG). Lottie stickers are skipped (not image-based).

const DISCORD_API = 'https://discord.com/api/v10';
const DISCORD_CDN = 'https://cdn.discordapp.com';

const MAX_EMOTE_IMAGES_PER_READ = 10;
const MAX_EMBED_IMAGES_PER_READ = 10;
const MAX_ATTACHMENT_IMAGES_PER_READ = 10;
const MAX_STICKER_IMAGES_PER_READ = 5;

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
    // Priority: image > thumbnail > video
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
// Discord sticker formats: 1=PNG, 2=APNG, 3=LOTTIE (skip), 4=GIF

function resolveStickerImages(stickerItems) {
  if (!Array.isArray(stickerItems) || stickerItems.length === 0) return [];

  const stickers = [];
  for (const sticker of stickerItems) {
    // Skip Lottie stickers (format_type 3) - they're JSON animations, not images
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

// ============ IMAGE FETCH ============
// Fetch any image URL and return an MCP image block in the flat schema.
// Matches Phone MCP's pattern: { type: "image", data: base64, mimeType }

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

  async deleteMessage(channelId, messageId) {
    await this.request(`/channels/${channelId}/messages/${messageId}`, { method: 'DELETE' });
  }

  async listGuilds() { return this.request('/users/@me/guilds'); }
  async getGuild(guildId) { return this.request(`/guilds/${guildId}?with_counts=true`); }
  async getGuildChannels(guildId) { return this.request(`/guilds/${guildId}/channels`); }

  async listGuildEmojis(guildId) {
    return this.request(`/guilds/${guildId}/emojis`);
  }

  async listGuildStickers(guildId) {
    return this.request(`/guilds/${guildId}/stickers`);
  }
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

async function handleToolCall(client, name, args) {
  try {
    switch (name) {
      case 'discord_read_messages': {
        const messages = await client.readMessages(args.channelId, args.limit || 50);

        const formattedMessages = [];
        const uniqueEmotes = new Map();      // url -> emote
        const embedImagesList = [];           // { messageId, image }
        const attachmentImagesList = [];      // { messageId, attachment }
        const stickerImagesList = [];         // { messageId, sticker }

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

        // Emotes (parallel fetch)
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

        // Embeds (parallel fetch)
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

        // Attachments (parallel fetch)
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

        // Stickers (parallel fetch)
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

      case 'discord_delete_message': {
        await client.deleteMessage(args.channelId, args.messageId);
        return { content: [{ type: 'text', text: `Deleted message ${args.messageId}` }] };
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
        name: "Aerie Discord bridge",
        version: "3.8.0",
        status: "online",
        endpoints: { claude: "/mcp", gpt: "/sse" }
      }), { headers: { "Content-Type": "application/json" } });
    }

    if (url.pathname === "/mcp") return handleMCP(request, env);
    if (url.pathname === "/sse") return handleSSE(request, env);
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
        serverInfo: { name: "aerie-discord", version: "3.8.0" }
      }
    };
  } else if (body.method === "tools/list") {
    response = { jsonrpc: "2.0", id: body.id, result: { tools: TOOLS } };
  } else if (body.method === "tools/call") {
    const result = await handleToolCall(client, body.params.name, body.params.arguments || {});
    response = { jsonrpc: "2.0", id: body.id, result };
  } else {
    response = { jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "Method not found" } };
  }

  return new Response(JSON.stringify(response), { headers: { "Content-Type": "application/json", ...corsHeaders() } });
}

async function handleSSE(request, env) {
  if (request.method === "GET") {
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();

    const sessionId = crypto.randomUUID();
    const send = (event, data) => writer.write(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));

    (async () => {
      await send("endpoint", `${new URL(request.url).origin}/sse?session=${sessionId}`);
      const interval = setInterval(() => writer.write(encoder.encode(": ping\n\n")), 30000);
      await new Promise(r => setTimeout(r, 300000));
      clearInterval(interval);
      writer.close();
    })();

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
          serverInfo: { name: "aerie-discord", version: "3.8.0" }
        }
      };
    } else if (body.method === "tools/list") {
      response = { jsonrpc: "2.0", id: body.id, result: { tools: TOOLS } };
    } else if (body.method === "tools/call") {
      const result = await handleToolCall(client, body.params.name, body.params.arguments || {});
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
