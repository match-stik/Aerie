# Semantic Search

Aerie includes local semantic search across all conversation history. Your companion can search by meaning, not just keywords — "that conversation about moving to a new city" will find relevant messages even if those exact words weren't used.

## How It Works

- Uses `all-MiniLM-L6-v2`, a small (30MB) embedding model that runs locally in Node.js
- No external API calls — everything stays on your machine
- Messages are automatically embedded when created
- Search uses cosine similarity to find the most relevant messages

## Setup

### 1. Dependencies

Nothing to install separately — inference runs on `onnxruntime-node`, which is a
normal backend dependency. There is no Python and no external service.

(Aerie used to run this through `@huggingface/transformers`. That package is a
general-purpose toolkit for text, images and audio, and it hard-pins an old
`sharp` for image decoding that Aerie never calls. Since only text embeddings
were ever used, the tokenizing now lives in
`packages/backend/src/services/embeddings/bert-tokenizer.ts` and inference goes
straight to the engine that package was itself using — one fewer dependency
rather than a swap.)

### 2. First run — model files

The weights (`model.onnx`, ~90MB) live in `data/models/all-MiniLM-L6-v2/` and
download automatically on first use. `data/` is gitignored, so a fresh clone
fetches them once.

They deliberately do NOT live under `node_modules` — that folder is rebuilt from
scratch on any dependency change, which would silently discard them.

The tokenizer is checked in at
`packages/backend/assets/all-MiniLM-L6-v2-tokenizer.json`. It is small, and it
is the half that has to keep agreeing with every vector already in the database,
so it is version-controlled next to the code rather than downloaded.

To pre-fetch the weights on an air-gapped machine, copy the folder in from
another install or download `onnx/model.onnx` from
`https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2`.

### 3. Backfill existing messages

New messages are embedded automatically. To index your existing conversation history:

```bash
# From your Aerie root directory (where aerie.yaml is)
node tools/sc.mjs backfill 100    # process 100 messages at a time
```

Run this multiple times or with larger batch sizes to index your full history. Your companion can also do this during autonomous time.

## Usage

### CLI (for your companion via Bash tool)

```bash
# Search all threads
node tools/sc.mjs search "that conversation about the project deadline"

# Search a specific thread
node tools/sc.mjs search "query" --thread THREAD_ID --limit 5

# Check indexing progress
node tools/sc.mjs backfill 0    # processes 0, but shows indexed/total counts
```

### Internal API (for programmatic access)

```bash
# Semantic search
curl -X POST http://localhost:PORT/api/internal/search-semantic \
  -H "Content-Type: application/json" \
  -d '{"query": "your search", "threadId": "optional", "limit": 10}'

# Backfill embeddings
curl -X POST http://localhost:PORT/api/internal/embed-backfill \
  -H "Content-Type: application/json" \
  -d '{"batchSize": 50}'
```

Both endpoints are localhost-only (no auth required).

## Technical Details

- **Model**: `sentence-transformers/all-MiniLM-L6-v2` (384-dimensional vectors), ONNX, run on `onnxruntime-node`
- **Tokenizer**: hand-written BERT WordPiece (`services/embeddings/bert-tokenizer.ts`), pinned to the reference by golden-file test
- **Storage**: `message_embeddings` table in SQLite (separate from messages table)
- **Embedding**: Fire-and-forget on message creation — doesn't block message delivery
- **Search**: Brute-force cosine similarity (fast enough for tens of thousands of messages)
- **Memory**: Model uses ~100MB RAM when loaded; lazy-loads on first search, not on server start

## Troubleshooting

**Model download fails**: Check your internet connection. The two files are fetched from Hugging Face Hub into `data/models/all-MiniLM-L6-v2/`; you can also drop them in by hand.

**Vectors look wrong after a tokenizer change**: `bert-tokenizer.test.ts` holds golden token ids captured from the original reference tokenizer. If it fails, the tokenizer changed and every embedding already stored in the database did not — re-index rather than shipping the change.

**Search returns no results**: Run `node tools/sc.mjs backfill` to index existing messages. New messages are indexed automatically.

**Slow first search**: The first search loads the model into memory (~5-10 seconds). Subsequent searches are fast (<100ms for query embedding + similarity computation).
