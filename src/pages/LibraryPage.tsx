import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import UploadPanel from '../components/UploadPanel'
import EmptyState from '../components/EmptyState'
import { absoluteUrl, fetchPapers, paperCoverUrl, paperFileUrl } from '../lib/api'
import { formatBytes, formatDate, normalizeSearch } from '../lib/format'
import { useToasts } from '../components/toastContext'
import type { PaperItem } from '../types'

const sortOptions = [
  { value: 'recent', label: 'Most recent' },
  { value: 'title', label: 'Title A–Z' }
] as const

type SortValue = (typeof sortOptions)[number]['value']

export default function LibraryPage() {
  const { pushToast } = useToasts()
  const [papers, setPapers] = useState<PaperItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortValue>('recent')

  const totalBytes = useMemo(() => papers.reduce((sum, paper) => sum + paper.sizeBytes, 0), [papers])

  const load = useCallback(async () => {
    setIsLoading(true)
    try {
      const data = await fetchPapers()
      setPapers(data)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load library'
      pushToast(message, 'error')
    } finally {
      setIsLoading(false)
    }
  }, [pushToast])

  useEffect(() => {
    load()
  }, [load])

  const visible = useMemo(() => {
    const term = normalizeSearch(query)
    const filtered = term
      ? papers.filter((paper) => {
          const haystack = [
            paper.title,
            paper.originalFilename,
            paper.tags.join(' ')
          ]
            .join(' ')
            .toLowerCase()
          return haystack.includes(term)
        })
      : papers

    const sorted = [...filtered]
    if (sort === 'title') {
      sorted.sort((a, b) => a.title.localeCompare(b.title))
    } else {
      sorted.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))
    }
    return sorted
  }, [papers, query, sort])

  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url)
      pushToast('Link copied to clipboard.', 'success')
    } catch {
      pushToast('Unable to copy link.', 'error')
    }
  }

  return (
    <div className="library-page">
      <UploadPanel onUploaded={load} />

      <section className="library-panel">
        <div className="library-header">
          <div>
            <h2>Library</h2>
            <p>
              {papers.length} paper{papers.length === 1 ? '' : 's'} in your library ·{' '}
              {formatBytes(totalBytes)}
            </p>
          </div>
          <div className="library-controls">
            <label className="field field-inline">
              <span>Search</span>
              <div className="field-search">
                <input
                  type="search"
                  placeholder="Title, filename, tag"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
                {query ? (
                  <button type="button" className="btn btn-ghost btn-compact" onClick={() => setQuery('')}>
                    Clear
                  </button>
                ) : null}
              </div>
            </label>
            <label className="field field-inline">
              <span>Sort</span>
              <select value={sort} onChange={(event) => setSort(event.target.value as SortValue)}>
                {sortOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {isLoading ? (
          <div className="loading">Loading library…</div>
        ) : visible.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="library-grid">
            {visible.map((paper) => (
              <Link key={paper.id} to={`/papers/${paper.id}`} className="paper-card">
                <div className="paper-cover">
                  <img src={paperCoverUrl(paper.id)} alt={`${paper.title} cover`} />
                  <div className="paper-actions-inline">
                    <button
                      type="button"
                      className="btn btn-ghost btn-compact"
                      onClick={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        copyLink(absoluteUrl(paperFileUrl(paper.id)))
                      }}
                    >
                      Copy link
                    </button>
                    <a
                      className="btn btn-ghost btn-compact"
                      href={paperFileUrl(paper.id, true)}
                      onClick={(event) => event.stopPropagation()}
                    >
                      Download
                    </a>
                  </div>
                </div>
                <div className="paper-body">
                  <h3>{paper.title}</h3>
                  <p className="paper-meta">{paper.originalFilename}</p>
                  <div className="paper-tags">
                    {paper.tags.length > 0 ? (
                      paper.tags.map((tag) => (
                        <button
                          key={tag}
                          type="button"
                          className="tag"
                          onClick={(event) => {
                            event.preventDefault()
                            setQuery(tag)
                          }}
                        >
                          {tag}
                        </button>
                      ))
                    ) : (
                      <span className="tag tag-muted">No tags</span>
                    )}
                  </div>
                </div>
                <div className="paper-footer">
                  <span>{formatDate(paper.uploadedAt)}</span>
                  <span>{formatBytes(paper.sizeBytes)}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
