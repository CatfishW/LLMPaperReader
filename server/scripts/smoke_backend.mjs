import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

function normalizeBase(url) {
  return String(url || '').replace(/\/+$/, '')
}

const baseUrl = normalizeBase(process.env.BASE_URL || 'http://127.0.0.1:3001/LLM')
const apiBase = `${baseUrl}/api`

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function fetchOk(url, init) {
  const res = await fetch(url, init)
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Request failed: ${res.status} ${res.statusText} ${url}\n${text}`)
  }
  return res
}

function pngDimensions(buf) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (buf.length < 24) return null
  if (!buf.subarray(0, 8).equals(sig)) return null
  if (buf.subarray(12, 16).toString('ascii') !== 'IHDR') return null
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

async function main() {
  console.log(`BASE_URL=${baseUrl}`)

  // Health + list.
  {
    const health = await (await fetchOk(`${apiBase}/health`)).json()
    assert(health && health.ok === true, 'health check failed')
    const list = await (await fetchOk(`${apiBase}/papers`)).json()
    assert(Array.isArray(list), 'papers list is not an array')
  }

  // Seed cover should not be a placeholder (requires covergen dependency).
  {
    const placeholder = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAWgAAAHgCAYAAACIBvdgAAAFQElEQVR42u3UoQ0AIRREQfovD4HCkKDwd8FB6OITRswWsOKlXOoCIJ50pvUBQCACDSDQAAg0gEADINAAAg2AQAMg0AACDYBAAwg0AAINgEADCDQAAg0g0AAINIBAAyDQAAg0gEADINAAAg2AQAMg0AACDYBAAwg0AAININACDSDQAAg0gEADINAAAg2AQAMg0AACDYBAAwg0AAININACDSDQAAg0gEADINAAjwb6+ycAgQg0gEADINAAAg2AQAMINAACDYBAAwg0AAININAACDQAAg0g0AAINIBAAyDQAAINgEADINAAAg2AQAMINAACDYBAAwg0AAININAACDSAQAs0gEADINAAAg2AQAMINAACDYBAAwg0AAININAACDSAQAs0gEADINAAAg2AQAMINAACDYBAAwg0AAININAACDQAAg0g0AAINIBAAyDQAAINgEADINAAAg2AQAMINAACDYBAAwg0AAININAACDSAQDsDQKABEGgAgQZAoAEEGgCBBkCgAQQaAIEGEGgABBpAoAUaQKABEGgAgQZAoAEEGgCBBkCgAQQaAIEGEGgABBoAgQYQaAAEGkCgARBoAIEGQKABEGgAgQZAoAEEGgCBBkCgAQQaAIEGEGgABBpAoJ0BINAACDSAQAMg0AACDYBAAyDQAAINgEADCDQAAg0g0AININAACDSAQAMg0AACDYBAAyDQAAINgEADCDQAAg2AQAMINAACDSDQAAg0gEADINAACDSAQAMg0AACDYBAAyDQAAINgEADCDQAAg0g0M4AEGgABBpAoAEQaACBBkCgARBoAIEGQKABBBoAgQYQaIEGEGgABBpAoAEQaACBBkCgARBoAIEGQKABBBoAgQZAoAEEGgCBBhBoAAQaQKABEGgABBpAoAEQaACBBkCgARBoAIEGQKABBBoAgQYQaGcACDQAAg0g0AAINIBAAyDQAAg0gEADINAAAg2AQAMItEADCDQAAg0g0AAINIBAAyDQAAg0gEADINAAAg2AQAMg0AACDYBAAwg0AAININAACDQAAg0g0AAINIBAAyDQAAg0gEADINAAAg2AQAMINAACDYBAAwg0AAININAACDQAAg0g0AAINIBAAyDQAAIt0AACDYBAAwg0AAININAACDQAAg0g0AAINIBAAyDQAAg0gEADINAAAg2AQAMINAACDYBAAwg0AAININAACDQAAg0g0AAINIBAAyDQAAINgEADINAAAg2AQAMINAACDYBAAwg0AAININAACDSAQAs0gEADINAAAg2AQAMINAACDYBAAwg0AAININAACDSAQAs0gEADINAAAg2AQAMINAACDYBAAwg0AAININAACDQAAg0g0AAINIBAAyDQAAINgEADINAAAg2AQAMINAACDYBAAwg0AAININAACDSAQDsDQKABEGgAgQZAoAEEGgCBBkCgAQQaAIEGEGgABBpAoAUaQKABEGgAgQZAoAEEGgCBBkCgAQQaAIEGEGgABBoAgQYQaAAEGkCgARBoAIEGQKABEGgAgQZAoAEEGgCBBkCgAQQaAIEGEGgABBpAoJ0BINAACDSAQAMg0AACDYBAAyDQAAINgEADCDQAAg0g0AININAACDSAQAMg0AACDYBAAyDQAAINgEADCDQAAg2AQAMINAACDSDQAAg0gEADINAACDSAQAMg0AACDYBAAyDQAAINgEADCDQAAg0g0M4AEGgABBpAoAEQaACBBkCgARBoAIEGQKABBBoAgQYQaIEGEGgABBpAoAEQaACBBkCgARBogCsDDUA8Gwg3tuje8X9vAAAAAElFTkSuQmCC',
      'base64'
    )

    const list = await (await fetchOk(`${apiBase}/papers`)).json()
    const seed = Array.isArray(list) ? list.find((p) => Array.isArray(p?.tags) && p.tags.includes('seed')) : null
    if (seed && seed.id) {
      const res = await fetchOk(`${apiBase}/papers/${seed.id}/cover`)
      const buf = Buffer.from(await res.arrayBuffer())
      assert(!buf.equals(placeholder), 'seed cover is still placeholder (covergen did not run)')
    } else {
      console.warn('No seed papers found; skipping seed cover check')
    }
  }

  // Upload: use a real PDF + 1x1 PNG cover to verify server-side cover fix.
  const pdfPath = process.env.PDF_PATH
    ? path.resolve(process.env.PDF_PATH)
    : path.resolve('output/playwright/llmpr/attention_is_all_you_need.pdf')

  const pdfBuf = await fs.readFile(pdfPath)
  assert(pdfBuf.subarray(0, 4).toString('ascii') === '%PDF', 'PDF fixture is not a PDF')

  const oneByOnePng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    'base64'
  )

  const form = new FormData()
  form.append('pdf', new File([pdfBuf], path.basename(pdfPath), { type: 'application/pdf' }))
  form.append('cover', new File([oneByOnePng], 'cover.png', { type: 'image/png' }))
  form.append('title', 'Smoke Test Paper')
  form.append('tags', 'smoke,playwright')

  const created = await (
    await fetchOk(`${apiBase}/papers`, {
      method: 'POST',
      body: form
    })
  ).json()

  assert(created && typeof created.id === 'string', 'upload did not return an id')
  const id = created.id
  console.log(`Uploaded id=${id}`)

  // Verify list includes it.
  {
    const list = await (await fetchOk(`${apiBase}/papers`)).json()
    assert(Array.isArray(list) && list.some((p) => p && p.id === id), 'uploaded paper not found in list')
  }

  // Cover should not be 1x1 after upload.
  {
    const res = await fetchOk(`${apiBase}/papers/${id}/cover`)
    const ct = res.headers.get('content-type') || ''
    assert(ct.includes('image/png'), `cover content-type unexpected: ${ct}`)
    const buf = Buffer.from(await res.arrayBuffer())
    const dims = pngDimensions(buf.subarray(0, 64))
    assert(dims && !(dims.width === 1 && dims.height === 1), `cover is still 1x1 (${dims?.width}x${dims?.height})`)
  }

  // File should be a PDF and download should set an attachment disposition.
  {
    const inline = await fetchOk(`${apiBase}/papers/${id}/file`)
    const inlineCt = inline.headers.get('content-type') || ''
    assert(inlineCt.includes('application/pdf'), `file content-type unexpected: ${inlineCt}`)
    const head = Buffer.from(await inline.arrayBuffer()).subarray(0, 4).toString('ascii')
    assert(head === '%PDF', 'inline file did not start with %PDF')

    const download = await fetchOk(`${apiBase}/papers/${id}/file?download=1`)
    const cd = download.headers.get('content-disposition') || ''
    assert(cd.toLowerCase().includes('attachment'), `download did not set attachment content-disposition: ${cd}`)
  }

  // Delete and verify removal.
  {
    const del = await fetch(`${apiBase}/papers/${id}`, { method: 'DELETE' })
    assert(del.status === 204, `delete status expected 204, got ${del.status}`)
    const list = await (await fetchOk(`${apiBase}/papers`)).json()
    assert(Array.isArray(list) && !list.some((p) => p && p.id === id), 'paper still present after delete')
  }

  console.log('SMOKE OK')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
