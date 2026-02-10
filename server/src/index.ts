import express from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { promises as fsp } from 'fs'
import crypto from 'crypto'
import { fileURLToPath } from 'url'
import { spawn } from 'child_process'
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
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

// 360x480 placeholder PNG to avoid "broken" 1x1 thumbnails (e.g. seed imports).
const PLACEHOLDER_COVER_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAWgAAAHgCAYAAACIBvdgAAAFQElEQVR42u3UoQ0AIRREQfovD4HCkKDwd8FB6OITRswWsOKlXOoCIJ50pvUBQCACDSDQAAg0gEADINAAAg2AQAMg0AACDYBAAwg0AAINgEADCDQAAg0g0AAINIBAAyDQAAg0gEADINAAAg2AQAMg0AACDYBAAwg0AAININACDSDQAAg0gEADINAAAg2AQAMg0AACDYBAAwg0AAININACDSDQAAg0gEADINAAjwb6+ycAgQg0gEADINAAAg2AQAMINAACDYBAAwg0AAININAACDQAAg0g0AAINIBAAyDQAAINgEADINAAAg2AQAMINAACDYBAAwg0AAININAACDSAQAs0gEADINAAAg2AQAMINAACDYBAAwg0AAININAACDSAQAs0gEADINAAAg2AQAMINAACDYBAAwg0AAININAACDQAAg0g0AAINIBAAyDQAAINgEADINAAAg2AQAMINAACDYBAAwg0AAININAACDSAQDsDQKABEGgAgQZAoAEEGgCBBkCgAQQaAIEGEGgABBpAoAUaQKABEGgAgQZAoAEEGgCBBkCgAQQaAIEGEGgABBoAgQYQaAAEGkCgARBoAIEGQKABEGgAgQZAoAEEGgCBBkCgAQQaAIEGEGgABBpAoJ0BINAACDSAQAMg0AACDYBAAyDQAAINgEADCDQAAg0g0AININAACDSAQAMg0AACDYBAAyDQAAINgEADCDQAAg2AQAMINAACDSDQAAg0gEADINAACDSAQAMg0AACDYBAAyDQAAINgEADCDQAAg0g0M4AEGgABBpAoAEQaACBBkCgARBoAIEGQKABBBoAgQYQaIEGEGgABBpAoAEQaACBBkCgARBoAIEGQKABBBoAgQZAoAEEGgCBBhBoAAQaQKABEGgABBpAoAEQaACBBkCgARBoAIEGQKABBBoAgQYQaGcACDQAAg0g0AAINIBAAyDQAAg0gEADINAAAg2AQAMItEADCDQAAg0g0AAINIBAAyDQAAg0gEADINAAAg2AQAMg0AACDYBAAwg0AAININAACDQAAg0g0AAINIBAAyDQAAg0gEADINAAAg2AQAMINAACDYBAAwg0AAININAACDQAAg0g0AAINIBAAyDQAAIt0AACDYBAAwg0AAININAACDQAAg0g0AAINIBAAyDQAAg0gEADINAAAg2AQAMINAACDYBAAwg0AAININAACDQAAg0g0AAINIBAAyDQAAINgEADINAAAg2AQAMINAACDYBAAwg0AAININAACDSAQAs0gEADINAAAg2AQAMINAACDYBAAwg0AAININAACDSAQAs0gEADINAAAg2AQAMINAACDYBAAwg0AAININAACDQAAg0g0AAINIBAAyDQAAINgEADINAAAg2AQAMINAACDYBAAwg0AAININAACDSAQDsDQKABEGgAgQZAoAEEGgCBBkCgAQQaAIEGEGgABBpAoAUaQKABEGgAgQZAoAEEGgCBBkCgAQQaAIEGEGgABBoAgQYQaAAEGkCgARBoAIEGQKABEGgAgQZAoAEEGgCBBkCgAQQaAIEGEGgABBpAoJ0BINAACDSAQAMg0AACDYBAAyDQAAINgEADCDQAAg0g0AININAACDSAQAMg0AACDYBAAyDQAAINgEADCDQAAg2AQAMINAACDSDQAAg0gEADINAACDSAQAMg0AACDYBAAyDQAAINgEADCDQAAg0g0M4AEGgABBpAoAEQaACBBkCgARBoAIEGQKABBBoAgQYQaIEGEGgABBpAoAEQaACBBkCgARBogCsDDUA8Gwg3tuje8X9vAAAAAElFTkSuQmCC',
  'base64'
)

function resolveCovergenPython(rootDir: string): string | null {
  if (process.env.COVERGEN_PYTHON) return process.env.COVERGEN_PYTHON
  const venvPython = path.join(rootDir, 'server_py', 'venv', 'bin', 'python')
  if (fs.existsSync(venvPython)) return venvPython
  const py3 = '/usr/bin/python3'
  if (fs.existsSync(py3)) return py3
  return null
}

const COVERGEN_PYTHON = resolveCovergenPython(ROOT_DIR)
const COVERGEN_SCRIPT = path.join(ROOT_DIR, 'server_py', 'covergen.py')
const COVERGEN_MAX_CONCURRENCY = process.env.COVERGEN_CONCURRENCY ? Number(process.env.COVERGEN_CONCURRENCY) : 2
const covergenFailures = new Map<string, number>() // id -> ms timestamp to retry after
const covergenInFlight = new Map<string, Promise<void>>() // id -> promise
let covergenActive = 0
const covergenWaiters: Array<() => void> = []

async function covergenAcquire(): Promise<void> {
  if (covergenActive < COVERGEN_MAX_CONCURRENCY) {
    covergenActive += 1
    return
  }
  await new Promise<void>((resolve) => covergenWaiters.push(resolve))
  covergenActive += 1
}

function covergenRelease(): void {
  covergenActive = Math.max(0, covergenActive - 1)
  const next = covergenWaiters.shift()
  if (next) next()
}

async function generateCoverWithPython(id: string, pdfPath: string, coverPath: string): Promise<void> {
  if (!COVERGEN_PYTHON) return
  if (!fs.existsSync(COVERGEN_SCRIPT)) return
  if (!fs.existsSync(pdfPath)) return

  const now = Date.now()
  const failedUntil = covergenFailures.get(id)
  if (failedUntil && failedUntil > now) return

  const existing = covergenInFlight.get(id)
  if (existing) return existing

  const job = (async () => {
    await covergenAcquire()
    try {
      await new Promise<void>((resolve, reject) => {
        const proc = spawn(COVERGEN_PYTHON, [COVERGEN_SCRIPT, pdfPath, coverPath, '--max-width', '640'], {
          stdio: ['ignore', 'ignore', 'pipe']
        })
        let stderr = ''
        proc.stderr.on('data', (chunk) => {
          stderr += chunk.toString('utf8')
          if (stderr.length > 8_000) stderr = stderr.slice(-8_000)
        })
        const timeout = setTimeout(() => {
          proc.kill('SIGKILL')
          reject(new Error('covergen timeout'))
        }, 25_000)
        proc.on('error', reject)
        proc.on('exit', (code) => {
          clearTimeout(timeout)
          if (code === 0) resolve()
          else reject(new Error(`covergen failed (${code}): ${stderr.trim()}`))
        })
      })
    } catch (err) {
      console.warn('covergen failed', id, err)
      // Back off for 10 minutes on failure.
      covergenFailures.set(id, Date.now() + 10 * 60 * 1000)
    } finally {
      covergenRelease()
    }
  })().finally(() => {
    covergenInFlight.delete(id)
  })

  covergenInFlight.set(id, job)
  return job
}

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

function pngDimensionsFromHeader(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 29) return null
  if (!buf.subarray(0, 8).equals(PNG_SIG)) return null
  if (buf.subarray(12, 16).toString('ascii') !== 'IHDR') return null
  const width = buf.readUInt32BE(16)
  const height = buf.readUInt32BE(20)
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) return null
  return { width, height }
}

async function isPlaceholderCover(filePath: string): Promise<boolean> {
  try {
    const st = await fsp.stat(filePath)
    if (st.isFile() && st.size === PLACEHOLDER_COVER_PNG.length) {
      const buf = await fsp.readFile(filePath)
      if (buf.equals(PLACEHOLDER_COVER_PNG)) return true
    }
    const fd = await fsp.open(filePath, 'r')
    const head = Buffer.alloc(64)
    await fd.read(head, 0, 64, 0)
    await fd.close()
    const dims = pngDimensionsFromHeader(head)
    return !!dims && dims.width === 1 && dims.height === 1
  } catch {
    return false
  }
}

function sendFileAsync(res: Response, filePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    res.sendFile(filePath, (err) => {
      if (err) reject(err)
      else resolve()
    })
  })
}

function downloadAsync(res: Response, filePath: string, filename: string): Promise<void> {
  return new Promise((resolve, reject) => {
    res.download(filePath, filename, (err) => {
      if (err) reject(err)
      else resolve()
    })
  })
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

let indexWriteChain: Promise<void> = Promise.resolve()

async function withIndexLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = indexWriteChain
  let release: (() => void) | undefined
  indexWriteChain = new Promise<void>((resolve) => {
    release = resolve
  })
  await prev
  try {
    return await fn()
  } finally {
    release?.()
  }
}

async function atomicWriteJson(filePath: string, value: unknown): Promise<void> {
  const dir = path.dirname(filePath)
  await fsp.mkdir(dir, { recursive: true })
  const tmpPath = `${filePath}.tmp`
  await fsp.writeFile(tmpPath, JSON.stringify(value, null, 2))
  try {
    await fsp.rename(tmpPath, filePath)
  } catch (err) {
    // Windows can fail to rename over an existing file; fall back to replace.
    await fsp.rm(filePath, { force: true })
    await fsp.rename(tmpPath, filePath)
  }
}

async function writeIndex(items: PaperIndexItem[]): Promise<void> {
  await atomicWriteJson(INDEX_FILE, items)
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
  await atomicWriteJson(REMOTE_INDEX_FILE, items)
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
      // Some clients send `image/x-png` or `application/octet-stream` even for PNGs;
      // validate by magic bytes after upload.
      if (file.mimetype === 'image/png' || file.mimetype === 'image/x-png' || file.mimetype === 'application/octet-stream') {
        return cb(null, true)
      }
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
    const pdfPath = path.join(paperDir, 'paper.pdf')
    const coverPath = path.join(paperDir, 'cover.png')
    const exists = await fsp
      .access(coverPath)
      .then(() => true)
      .catch(() => false)

    // Covers may be regenerated/replaced; avoid immutable caching so fixes show up without a hard refresh.
    res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate')
    res.type('png')

    if (!exists || (await isPlaceholderCover(coverPath))) {
      // Best-effort: generate a real thumbnail from the first PDF page if cover is missing/placeholder.
      // This is a backend-only fix that makes seed papers render real thumbnails without client changes.
      await generateCoverWithPython(id, pdfPath, coverPath)

      const generatedOk = await fsp
        .access(coverPath)
        .then(async () => !(await isPlaceholderCover(coverPath)))
        .catch(() => false)

      if (!generatedOk) {
        res.send(PLACEHOLDER_COVER_PNG)
        return
      }
    }

    await sendFileAsync(res, coverPath)
  } catch {
    res.status(200).type('png').send(PLACEHOLDER_COVER_PNG)
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
      await downloadAsync(res, pdfPath, filename)
      return
    }
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
    res.type('application/pdf')
    await sendFileAsync(res, pdfPath)
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

    // Ensure we stored a real PNG and avoid persisting 1x1 placeholder covers.
    {
      const fd = await fsp.open(coverDest, 'r')
      const head = Buffer.alloc(64)
      await fd.read(head, 0, 64, 0)
      await fd.close()
      const dims = pngDimensionsFromHeader(head)
      if (!dims) {
        throw new Error('Cover must be PNG')
      }
      if (dims.width === 1 && dims.height === 1) {
        await fsp.writeFile(coverDest, PLACEHOLDER_COVER_PNG)
      }
    }

    const metadata: PaperMetadata = {
      title,
      originalFilename,
      tags,
      uploadedAt: new Date().toISOString(),
      sizeBytes: pdfFile.size
    }

    await fsp.writeFile(path.join(paperDir, 'metadata.json'), JSON.stringify(metadata, null, 2))

    const item: PaperIndexItem = { id, ...metadata }
    await withIndexLock(async () => {
      const index = await readIndex()
      index.unshift(item)
      await writeIndex(index)
    })

    await mirrorToRemote(id, metadata, pdfDest, coverDest)

    res.status(201).json(item)
  } catch (err) {
    await safeRemove(pdfPath)
    await safeRemove(coverPath)
    const message = err instanceof Error ? err.message : ''
    if (message.includes('Cover')) return res.status(400).json({ error: 'Cover must be PNG' })
    if (message.includes('PDF') && message.includes('Invalid')) return res.status(400).json({ error: 'Invalid PDF' })
    res.status(500).json({ error: 'Upload failed' })
  }
})

app.delete(`${API_BASE}/papers/:id`, async (req: Request, res: Response) => {
  const { id } = req.params
  if (!id || !isValidId(id)) return res.status(404).json({ error: 'Not found' })
  try {
    const paperDir = resolvePaperDir(id)
    await fsp.rm(paperDir, { recursive: true, force: true })
    await withIndexLock(async () => {
      const index = await readIndex()
      const next = index.filter((entry) => entry.id !== id)
      await writeIndex(next)
    })
    await removeRemotePaper(id)
    res.status(204).end()
  } catch {
    res.status(500).json({ error: 'Delete failed' })
  }
})

app.use((err: Error & { code?: string }, _req: Request, res: Response, _next: NextFunction) => {
  void _next
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'PDF too large' })
  }
  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    return res.status(400).json({ error: 'Unexpected field' })
  }
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
