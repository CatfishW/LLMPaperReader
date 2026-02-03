import { useCallback, useRef, useState } from 'react'
import type { DragEvent } from 'react'

const MAX_BYTES = 50 * 1024 * 1024

export type DropzoneProps = {
  onFile: (file: File) => void
}

export default function Dropzone({ onFile }: DropzoneProps) {
  const [isDragging, setIsDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return
      const file = files[0]
      onFile(file)
    },
    [onFile]
  )

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault()
      setIsDragging(false)
      handleFiles(event.dataTransfer.files)
    },
    [handleFiles]
  )

  return (
    <div
      className={`dropzone ${isDragging ? 'is-dragging' : ''}`}
      onDragOver={(event) => {
        event.preventDefault()
        setIsDragging(true)
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
    >
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        className="dropzone-input"
        onChange={(event) => handleFiles(event.target.files)}
      />
      <div className="dropzone-content">
        <div className="dropzone-mark" aria-hidden>
          <span />
        </div>
        <div>
          <p className="dropzone-title">Drop a PDF or browse</p>
          <p className="dropzone-meta">Max {Math.round(MAX_BYTES / 1024 / 1024)}MB. First page becomes the cover.</p>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => inputRef.current?.click()}
        >
          Choose file
        </button>
      </div>
    </div>
  )
}
