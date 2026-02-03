import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { absoluteUrl, deletePaper, fetchPaper, paperFileUrl } from '../lib/api'
import { formatBytes, formatDate } from '../lib/format'
import { useToasts } from '../components/toastContext'
import ConfirmDialog from '../components/ConfirmDialog'
import PdfViewer from '../components/PdfViewer'
import type { PaperItem } from '../types'

export default function PaperPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { pushToast } = useToasts()
  const [paper, setPaper] = useState<PaperItem | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [showConfirm, setShowConfirm] = useState(false)

  useEffect(() => {
    if (!id) return
    setIsLoading(true)
    fetchPaper(id)
      .then((data) => setPaper(data))
      .catch((error) => {
        const message = error instanceof Error ? error.message : 'Paper not found'
        pushToast(message, 'error')
      })
      .finally(() => setIsLoading(false))
  }, [id, pushToast])

  const downloadUrl = useMemo(() => {
    if (!id) return '#'
    return paperFileUrl(id, true)
  }, [id])

  const publicViewUrl = useMemo(() => {
    if (!paper) return ''
    return absoluteUrl(paperFileUrl(paper.id))
  }, [paper])

  const publicDownloadUrl = useMemo(() => {
    if (!paper) return ''
    return absoluteUrl(paperFileUrl(paper.id, true))
  }, [paper])

  async function copyLink(value: string) {
    try {
      await navigator.clipboard.writeText(value)
      pushToast('Link copied to clipboard.', 'success')
    } catch {
      pushToast('Unable to copy link.', 'error')
    }
  }

  async function handleDelete() {
    if (!id) return
    try {
      await deletePaper(id)
      pushToast('Paper deleted.', 'success')
      navigate('/')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Delete failed'
      pushToast(message, 'error')
    } finally {
      setShowConfirm(false)
    }
  }

  if (isLoading) {
    return <div className="loading">Loading paper…</div>
  }

  if (!paper) {
    return (
      <div className="paper-empty">
        <p>Paper not found.</p>
        <Link to="/" className="btn btn-primary">
          Back to library
        </Link>
      </div>
    )
  }

  return (
    <div className="paper-page">
      <section className="paper-header">
        <div>
          <Link to="/" className="link-muted">
            ← Library
          </Link>
          <h1>{paper.title}</h1>
          <p className="paper-subtitle">{paper.originalFilename}</p>
        </div>
        <div className="paper-actions">
          <a className="btn btn-ghost" href={downloadUrl}>
            Download
          </a>
          <button className="btn btn-danger" type="button" onClick={() => setShowConfirm(true)}>
            Delete
          </button>
        </div>
      </section>

      <section className="paper-meta-panel">
        <div>
          <h3>Details</h3>
          <p className="paper-meta-row">
            <span>Uploaded</span>
            <span>{formatDate(paper.uploadedAt)}</span>
          </p>
          <p className="paper-meta-row">
            <span>Size</span>
            <span>{formatBytes(paper.sizeBytes)}</span>
          </p>
        </div>
        <div>
          <h3>Tags</h3>
          <div className="paper-tags">
            {paper.tags.length > 0 ? (
              paper.tags.map((tag) => (
                <span key={tag} className="tag">
                  {tag}
                </span>
              ))
            ) : (
              <span className="tag tag-muted">No tags</span>
            )}
          </div>
        </div>
      </section>

      <section className="paper-share">
        <div>
          <h3>Share</h3>
          <p className="share-note">Public links for viewing and downloading this paper.</p>
        </div>
        <div className="share-links">
          <div className="share-row">
            <span className="share-label">View</span>
            <input className="share-input" readOnly value={publicViewUrl} onFocus={(event) => event.currentTarget.select()} />
            <button className="btn btn-ghost" type="button" onClick={() => copyLink(publicViewUrl)}>
              Copy
            </button>
            <a className="btn btn-ghost" href={publicViewUrl} target="_blank" rel="noreferrer">
              Open
            </a>
          </div>
          <div className="share-row">
            <span className="share-label">Download</span>
            <input className="share-input" readOnly value={publicDownloadUrl} onFocus={(event) => event.currentTarget.select()} />
            <button className="btn btn-ghost" type="button" onClick={() => copyLink(publicDownloadUrl)}>
              Copy
            </button>
            <a className="btn btn-ghost" href={publicDownloadUrl}>
              Download
            </a>
          </div>
        </div>
      </section>

      <PdfViewer pdfUrl={paperFileUrl(paper.id)} />

      <ConfirmDialog
        open={showConfirm}
        title="Delete paper"
        description="This will remove the PDF, cover, and metadata from disk. This action cannot be undone."
        confirmLabel="Delete"
        onConfirm={handleDelete}
        onCancel={() => setShowConfirm(false)}
      />
    </div>
  )
}
