import { useMemo, useState } from 'react'
import Dropzone from './Dropzone'
import { generateThumbnail } from '../lib/pdf'
import { uploadPaper } from '../lib/api'
import { useToasts } from './toastContext'
import { formatBytes } from '../lib/format'

const MAX_BYTES = 50 * 1024 * 1024

type UploadPanelProps = {
  onUploaded: () => void
}

export default function UploadPanel({ onUploaded }: UploadPanelProps) {
  const { pushToast } = useToasts()
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [tags, setTags] = useState('')
  const [isUploading, setIsUploading] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [coverBlob, setCoverBlob] = useState<Blob | null>(null)

  const helper = useMemo(() => {
    if (!file) return 'Select a PDF to get started.'
    return `${file.name} • ${formatBytes(file.size)}`
  }, [file])

  async function handleFile(nextFile: File) {
    if (!nextFile) return
    if (nextFile.size > MAX_BYTES) {
      pushToast('PDF must be 50MB or less.', 'error')
      return
    }
    if (nextFile.type !== 'application/pdf' && !nextFile.name.toLowerCase().endsWith('.pdf')) {
      pushToast('Only PDF files are supported.', 'error')
      return
    }
    setFile(nextFile)
    setTitle(nextFile.name.replace(/\.pdf$/i, ''))
    try {
      const cover = await generateThumbnail(nextFile)
      const url = URL.createObjectURL(cover)
      setCoverBlob(cover)
      setPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return url
      })
    } catch {
      pushToast('Could not generate thumbnail.', 'error')
      setCoverBlob(null)
      setPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return null
      })
    }
  }

  async function handleUpload() {
    if (!file) return
    setIsUploading(true)
    try {
      const cover = coverBlob ?? (await generateThumbnail(file))
      await uploadPaper({ pdf: file, cover, title: title.trim(), tags })
      pushToast('Paper uploaded.', 'success')
      setFile(null)
      setTitle('')
      setTags('')
      setCoverBlob(null)
      setPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return null
      })
      onUploaded()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Upload failed'
      pushToast(message, 'error')
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2>Upload a paper</h2>
          <p>Drag a PDF or browse your files. We'll capture the first page as a cover.</p>
        </div>
        <span className="panel-pill">Secure server storage</span>
      </div>
      <div className="panel-grid">
        <div>
          <Dropzone onFile={handleFile} />
          <p className="panel-helper">{helper}</p>
        </div>
        <div className="panel-form">
          <label className="field">
            <span>Title</span>
            <input
              type="text"
              placeholder="Paper title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              disabled={!file}
            />
          </label>
          <label className="field">
            <span>Tags</span>
            <input
              type="text"
              placeholder="LLM, evaluation, reasoning"
              value={tags}
              onChange={(event) => setTags(event.target.value)}
              disabled={!file}
            />
          </label>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleUpload}
            disabled={!file || isUploading}
          >
            {isUploading ? 'Uploading…' : 'Upload paper'}
          </button>
        </div>
        <div className="panel-preview">
          {previewUrl ? (
            <img src={previewUrl} alt="PDF thumbnail preview" />
          ) : (
            <div className="preview-placeholder">
              <span>PDF cover preview</span>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
