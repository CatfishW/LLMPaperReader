# LLMPaperReader

LLMPaperReader is a lightweight local library for PDF papers. Upload PDFs, auto-generate cover thumbnails from the first page, tag and search your collection, and read papers in an inline PDF viewer.

## Features
- Drag-and-drop PDF uploads (max 50MB)
- Client-side thumbnail generation via `pdfjs-dist`
- Local disk storage with metadata index
- Search by title, filename, or tags; sort by recent or title
- Inline PDF viewer with download and delete actions
- Toasts, empty states, and keyboard-accessible dialogs

## Project Structure
- `src/` — Vite + React + TypeScript frontend
- `server/` — Express + TypeScript backend
- `data/` — Local storage for PDFs and metadata

## Setup

Install dependencies:

```bash
npm install
```

## Development

Run client + server in parallel:

```bash
npm run dev
```

The Vite client runs on `http://localhost:5173` and proxies `/api` to the Express server at `http://localhost:3001`.

## Production

Build client and server:

```bash
npm run build
```

Start the production server (serves `dist/` plus API):

```bash
npm run start
```

Optional remote mirror (best-effort backup to another path, e.g. an NFS mount):

```bash
REMOTE_DATA_DIR=/mnt/backup/LLMPaperReader npm run start
```

## API Overview
- `GET /api/papers` — list papers
- `POST /api/papers` — upload (`pdf`, `cover`, `title`, `tags`)
- `GET /api/papers/:id` — metadata
- `GET /api/papers/:id/cover` — cover image
- `GET /api/papers/:id/file` — inline PDF (`?download=1` to download)
- `DELETE /api/papers/:id` — delete paper

## Storage Layout
- `data/papers/<id>/paper.pdf`
- `data/papers/<id>/cover.png`
- `data/papers/<id>/metadata.json`
- `data/index.json`
