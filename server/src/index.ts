import express from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { promises as fsp } from 'fs'
import crypto from 'crypto'
import { fileURLToPath } from 'url'
import type { Request, Response, NextFunction } from 'express'
import type { FileFilterCallback } from 'multer'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT_DIR = path.resolve(__dirname, '../..')
const DATA_DIR = path.join(ROOT_DIR, 'data')
const PAPERS_DIR = path.join(DATA_DIR, 'papers')
const TMP_DIR = path.join(DATA_DIR, 'tmp')
const INDEX_FILE = path.join(DATA_DIR, 'index.json')
const REMOTE_DATA_DIR = process.env.REMOTE_DATA_DIR
  ? path.resolve(process.env.REMOTE_DATA_DIR)
  : null
const REMOTE_PAPERS_DIR = REMOTE_DATA_DIR ? path.join(REMOTE_DATA_DIR, 'papers') : null
const REMOTE_INDEX_FILE = REMOTE_DATA_DIR ? path.join(REMOTE_DATA_DIR, 'index.json') : null
const MAX_PDF_BYTES = 50 * 1024 * 1024

const app = express()
app.disable('x-powered-by')

function normalizeBasePath(value?: string): string {
  if (!value) return ''
  let base = value.trim()
  if (!base) return ''
  if (!base.startsWith('/')) base = `/${base}`
  if (base.endsWith('/')) base = base.slice(0, -1)
  return base === '/' ? '' : base
}

const BASE_PATH = normalizeBasePath(process.env.BASE_PATH)
const API_BASE = `${BASE_PATH}/api`

function sanitizeFilename(name: string): string {
  const base = path.basename(name)
  const safe = base.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120)
  return safe.length > 0 ? safe : 'file.pdf'
}

function isValidId(id: string): boolean {
  return /^[a-f0-9-]{36}$/i.test(id)
}

async function ensureStorage(): Promise<void> {
  await fsp.mkdir(PAPERS_DIR, { recursive: true })
  await fsp.mkdir(TMP_DIR, { recursive: true })
  if (!fs.existsSync(INDEX_FILE)) {
    await fsp.writeFile(INDEX_FILE, JSON.stringify([], null, 2))
  }
}

async function ensureRemoteStorage(): Promise<void> {
  if (!REMOTE_DATA_DIR || REMOTE_DATA_DIR === DATA_DIR) return
  if (!REMOTE_PAPERS_DIR || !REMOTE_INDEX_FILE) return
  await fsp.mkdir(REMOTE_PAPERS_DIR, { recursive: true })
  if (!fs.existsSync(REMOTE_INDEX_FILE)) {
    await fsp.writeFile(REMOTE_INDEX_FILE, JSON.stringify([], null, 2))
  }
}

async function readIndex(): Promise<PaperIndexItem[]> {
  try {
    const raw = await fsp.readFile(INDEX_FILE, 'utf8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function writeIndex(items: PaperIndexItem[]): Promise<void> {
  await fsp.writeFile(INDEX_FILE, JSON.stringify(items, null, 2))
}

async function readRemoteIndex(): Promise<PaperIndexItem[]> {
  if (!REMOTE_INDEX_FILE) return []
  try {
    const raw = await fsp.readFile(REMOTE_INDEX_FILE, 'utf8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function writeRemoteIndex(items: PaperIndexItem[]): Promise<void> {
  if (!REMOTE_INDEX_FILE) return
  await fsp.writeFile(REMOTE_INDEX_FILE, JSON.stringify(items, null, 2))
}

async function safeRemove(filePath?: string): Promise<void> {
  if (!filePath) return
  try {
    await fsp.rm(filePath, { force: true })
  } catch {
    // ignore cleanup errors
  }
}

function resolvePaperDir(id: string): string {
  const target = path.join(PAPERS_DIR, id)
  const resolved = path.resolve(target)
  const base = path.resolve(PAPERS_DIR)
  if (!resolved.startsWith(base)) {
    throw new Error('Invalid path')
  }
  return resolved
}

function resolveRemotePaperDir(id: string): string {
  if (!REMOTE_PAPERS_DIR) throw new Error('Remote storage not configured')
  const target = path.join(REMOTE_PAPERS_DIR, id)
  const resolved = path.resolve(target)
  const base = path.resolve(REMOTE_PAPERS_DIR)
  if (!resolved.startsWith(base)) {
    throw new Error('Invalid path')
  }
  return resolved
}

async function mirrorToRemote(id: string, metadata: PaperMetadata, pdfPath: string, coverPath: string): Promise<void> {
  if (!REMOTE_DATA_DIR || REMOTE_DATA_DIR === DATA_DIR) return
  try {
    await ensureRemoteStorage()
    const remoteDir = resolveRemotePaperDir(id)
    await fsp.mkdir(remoteDir, { recursive: true })
    await fsp.copyFile(pdfPath, path.join(remoteDir, 'paper.pdf'))
    await fsp.copyFile(coverPath, path.join(remoteDir, 'cover.png'))
    await fsp.writeFile(path.join(remoteDir, 'metadata.json'), JSON.stringify(metadata, null, 2))
    const index = await readRemoteIndex()
    const next = [{ id, ...metadata }, ...index.filter((entry) => entry.id !== id)]
    await writeRemoteIndex(next)
  } catch (err) {
    console.warn('Remote mirror failed', err)
  }
}

async function removeRemotePaper(id: string): Promise<void> {
  if (!REMOTE_DATA_DIR || REMOTE_DATA_DIR === DATA_DIR) return
  try {
    const remoteDir = resolveRemotePaperDir(id)
    await fsp.rm(remoteDir, { recursive: true, force: true })
    const index = await readRemoteIndex()
    const next = index.filter((entry) => entry.id !== id)
    await writeRemoteIndex(next)
  } catch (err) {
    console.warn('Remote delete failed', err)
  }
}

const storage = multer.diskStorage({
  destination: (_req: Request, _file: Express.Multer.File, cb) => cb(null, TMP_DIR),
  filename: (_req: Request, file: Express.Multer.File, cb) => {
    const ext = path.extname(file.originalname) || '.bin'
    const unique = crypto.randomUUID()
    cb(null, `${unique}${ext}`)
  }
})

const upload = multer({
  storage,
  limits: { fileSize: MAX_PDF_BYTES },
  fileFilter: (_req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
    if (file.fieldname === 'pdf') {
      if (file.mimetype === 'application/pdf') return cb(null, true)
      return cb(new Error('PDF only'))
    }
    if (file.fieldname === 'cover') {
      if (file.mimetype === 'image/png') return cb(null, true)
      return cb(new Error('Cover must be PNG'))
    }
    return cb(new Error('Unexpected field'))
  }
})

app.get(`${API_BASE}/health`, (_req: Request, res: Response) => {
  res.json({ ok: true })
})

app.get(`${API_BASE}/papers`, async (_req: Request, res: Response) => {
  const index = await readIndex()
  res.json(index)
})

app.get(`${API_BASE}/papers/:id`, async (req: Request, res: Response) => {
  const { id } = req.params
  if (!id || !isValidId(id)) return res.status(404).json({ error: 'Not found' })
  try {
    const paperDir = resolvePaperDir(id)
    const metaPath = path.join(paperDir, 'metadata.json')
    const raw = await fsp.readFile(metaPath, 'utf8')
    const metadata = JSON.parse(raw)
    res.json({ id, ...metadata })
  } catch {
    res.status(404).json({ error: 'Not found' })
  }
})

app.get(`${API_BASE}/papers/:id/cover`, async (req: Request, res: Response) => {
  const { id } = req.params
  if (!id || !isValidId(id)) return res.status(404).end()
  try {
    const paperDir = resolvePaperDir(id)
    const coverPath = path.join(paperDir, 'cover.png')
    await fsp.access(coverPath)
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
    res.type('png')
    res.sendFile(coverPath)
  } catch {
    res.status(404).end()
  }
})

app.get(`${API_BASE}/papers/:id/file`, async (req: Request, res: Response) => {
  const { id } = req.params
  if (!id || !isValidId(id)) return res.status(404).end()
  try {
    const paperDir = resolvePaperDir(id)
    const pdfPath = path.join(paperDir, 'paper.pdf')
    await fsp.access(pdfPath)
    const index = await readIndex()
    const item = index.find((entry) => entry.id === id)
    const filename = item ? sanitizeFilename(item.originalFilename) : 'paper.pdf'
    if (req.query.download === '1') {
      res.download(pdfPath, filename)
      return
    }
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
    res.type('application/pdf')
    res.sendFile(pdfPath)
  } catch {
    res.status(404).end()
  }
})

app.post(`${API_BASE}/papers`, upload.fields([{ name: 'pdf', maxCount: 1 }, { name: 'cover', maxCount: 1 }]), async (req: Request, res: Response) => {
  let pdfPath: string | undefined
  let coverPath: string | undefined
  try {
    const files = req.files as { [field: string]: Express.Multer.File[] }
    const pdfFile = files?.pdf?.[0]
    const coverFile = files?.cover?.[0]
    pdfPath = pdfFile?.path
    coverPath = coverFile?.path
    if (!pdfFile || !coverFile) {
      await safeRemove(pdfFile?.path)
      await safeRemove(coverFile?.path)
      return res.status(400).json({ error: 'Missing files' })
    }
    if (pdfFile.size > MAX_PDF_BYTES) {
      await safeRemove(pdfFile.path)
      await safeRemove(coverFile.path)
      return res.status(413).json({ error: 'PDF too large' })
    }

    const fileHandle = await fsp.open(pdfFile.path, 'r')
    const headerBuffer = Buffer.alloc(4)
    await fileHandle.read(headerBuffer, 0, 4, 0)
    await fileHandle.close()
    if (headerBuffer.toString('utf8') !== '%PDF') {
      await safeRemove(pdfFile.path)
      await safeRemove(coverFile.path)
      return res.status(400).json({ error: 'Invalid PDF' })
    }

    const rawTitle = typeof req.body.title === 'string' ? (req.body.title as string) : ''
    const rawTags = typeof req.body.tags === 'string' ? (req.body.tags as string) : ''
    const originalFilename = sanitizeFilename(pdfFile.originalname)
    const title = rawTitle.trim() || path.basename(originalFilename, path.extname(originalFilename))

    const tags = rawTags
      .split(',')
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0)
      .slice(0, 12)

    const id = crypto.randomUUID()
    const paperDir = resolvePaperDir(id)
    await fsp.mkdir(paperDir, { recursive: true })

    const pdfDest = path.join(paperDir, 'paper.pdf')
    const coverDest = path.join(paperDir, 'cover.png')
    await fsp.rename(pdfFile.path, pdfDest)
    await fsp.rename(coverFile.path, coverDest)

    const metadata: PaperMetadata = {
      title,
      originalFilename,
      tags,
      uploadedAt: new Date().toISOString(),
      sizeBytes: pdfFile.size
    }

    await fsp.writeFile(path.join(paperDir, 'metadata.json'), JSON.stringify(metadata, null, 2))

    const index = await readIndex()
    const item: PaperIndexItem = { id, ...metadata }
    index.unshift(item)
    await writeIndex(index)

    await mirrorToRemote(id, metadata, pdfDest, coverDest)

    res.status(201).json(item)
  } catch {
    await safeRemove(pdfPath)
    await safeRemove(coverPath)
    res.status(500).json({ error: 'Upload failed' })
  }
})

app.delete(`${API_BASE}/papers/:id`, async (req: Request, res: Response) => {
  const { id } = req.params
  if (!id || !isValidId(id)) return res.status(404).json({ error: 'Not found' })
  try {
    const paperDir = resolvePaperDir(id)
    await fsp.rm(paperDir, { recursive: true, force: true })
    const index = await readIndex()
    const next = index.filter((entry) => entry.id !== id)
    await writeIndex(next)
    await removeRemotePaper(id)
    res.status(204).end()
  } catch {
    res.status(500).json({ error: 'Delete failed' })
  }
})

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  void _next
  if (err.message.includes('PDF') || err.message.includes('Cover')) {
    return res.status(400).json({ error: err.message })
  }
  if (err.message.includes('File too large')) {
    return res.status(413).json({ error: 'PDF too large' })
  }
  return res.status(500).json({ error: 'Server error' })
})

const clientDist = path.join(ROOT_DIR, 'dist')
if (fs.existsSync(clientDist)) {
  app.use(BASE_PATH, express.static(clientDist, {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'public, max-age=0')
      } else {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
      }
    }
  }))
  app.get([BASE_PATH || '/', `${BASE_PATH}/*`], (_req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=0')
    res.sendFile(path.join(clientDist, 'index.html'))
  })
}

const PORT = process.env.PORT ? Number(process.env.PORT) : 3001

ensureStorage()
  .then(() => ensureRemoteStorage())
  .then(() => {
    app.listen(PORT, () => {
      console.log(`LLMPaperReader server running on http://localhost:${PORT}`)
    })
  })

interface PaperMetadata {
  title: string
  originalFilename: string
  tags: string[]
  uploadedAt: string
  sizeBytes: number
}

interface PaperIndexItem extends PaperMetadata {
  id: string
}
