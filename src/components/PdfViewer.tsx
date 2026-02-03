import { useEffect, useMemo, useRef, useState } from 'react'
import { renderPdfPages } from '../lib/pdf'

export default function PdfViewer({ pdfUrl }: { pdfUrl: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [rendered, setRendered] = useState<{ key: string; canvases: HTMLCanvasElement[] }>({
    key: '',
    canvases: []
  })
  const [progress, setProgress] = useState<{ key: string; value: number }>({ key: '', value: 0 })
  const [error, setError] = useState<{ key: string; message: string } | null>(null)
  const [width, setWidth] = useState(800)
  const renderKey = useMemo(() => `${pdfUrl}:${Math.round(width)}`, [pdfUrl, width])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 0) {
          setWidth(entry.contentRect.width)
        }
      }
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    let active = true
    renderPdfPages(pdfUrl, width, (value) => {
      if (!active) return
      setProgress({ key: renderKey, value })
    })
      .then((pages) => {
        if (!active) return
        setRendered({ key: renderKey, canvases: pages.map((page) => page.canvas) })
      })
      .catch((err) => {
        if (!active) return
        setError({
          key: renderKey,
          message: err instanceof Error ? err.message : 'Failed to load PDF'
        })
      })

    return () => {
      active = false
    }
  }, [pdfUrl, width, renderKey])

  const activeCanvases = useMemo(
    () => (rendered.key === renderKey ? rendered.canvases : []),
    [rendered, renderKey]
  )
  const activeError = useMemo(
    () => (error?.key === renderKey ? error.message : null),
    [error, renderKey]
  )
  const activeProgress = useMemo(
    () => (progress.key === renderKey ? progress.value : 0),
    [progress, renderKey]
  )

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    container.innerHTML = ''
    activeCanvases.forEach((canvas) => {
      const wrapper = document.createElement('div')
      wrapper.className = 'pdf-page'
      wrapper.appendChild(canvas)
      container.appendChild(wrapper)
    })
  }, [activeCanvases])

  const status = useMemo(() => {
    if (activeError) return activeError
    if (activeCanvases.length === 0) return `Rendering pages… ${Math.round(activeProgress * 100)}%`
    return `${activeCanvases.length} page${activeCanvases.length > 1 ? 's' : ''}`
  }, [activeCanvases.length, activeError, activeProgress])

  return (
    <section className="pdf-viewer">
      <div className="pdf-header">
        <h3>Viewer</h3>
        <span className="pdf-status">{status}</span>
      </div>
      {activeError ? <div className="pdf-error">{activeError}</div> : null}
      <div ref={containerRef} className="pdf-canvas-list" />
    </section>
  )
}
