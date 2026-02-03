import * as pdfjsLib from 'pdfjs-dist'
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

let initialized = false

export function initPdfjs(): void {
  if (initialized) return
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc
  initialized = true
}

export async function generateThumbnail(file: File): Promise<Blob> {
  initPdfjs()
  const data = new Uint8Array(await file.arrayBuffer())
  const doc = await pdfjsLib.getDocument({ data }).promise
  const page = await doc.getPage(1)
  const viewport = page.getViewport({ scale: 1 })
  const scale = Math.min(1.3, 640 / viewport.width)
  const scaledViewport = page.getViewport({ scale })

  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas not supported')

  canvas.width = Math.floor(scaledViewport.width)
  canvas.height = Math.floor(scaledViewport.height)

  await page.render({ canvasContext: ctx, viewport: scaledViewport }).promise
  await doc.destroy()

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('Thumbnail generation failed'))
    }, 'image/png')
  })
}

export type PdfPage = {
  index: number
  canvas: HTMLCanvasElement
}

export async function renderPdfPages(
  pdfUrl: string,
  width: number,
  onProgress?: (value: number) => void
): Promise<PdfPage[]> {
  initPdfjs()
  const doc = await pdfjsLib.getDocument({ url: pdfUrl }).promise
  const pages: PdfPage[] = []

  for (let i = 1; i <= doc.numPages; i += 1) {
    const page = await doc.getPage(i)
    const viewport = page.getViewport({ scale: 1 })
    const scale = Math.max(0.5, Math.min(2.5, (width - 32) / viewport.width))
    const scaledViewport = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas not supported')
    canvas.width = Math.floor(scaledViewport.width)
    canvas.height = Math.floor(scaledViewport.height)
    await page.render({ canvasContext: ctx, viewport: scaledViewport }).promise
    pages.push({ index: i, canvas })
    if (onProgress) onProgress(i / doc.numPages)
  }

  await doc.destroy()
  return pages
}
