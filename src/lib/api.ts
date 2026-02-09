import type { PaperItem } from '../types'

const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, '')
export const apiBase = `${baseUrl}/api`

export function absoluteUrl(path: string): string {
  return new URL(path, window.location.origin).toString()
}

export function paperCoverUrl(id: string): string {
  return `${apiBase}/papers/${id}/cover?v=2`
}

export function paperFileUrl(id: string, download = false): string {
  const suffix = download ? '?download=1' : ''
  return `${apiBase}/papers/${id}/file${suffix}`
}

export async function fetchPapers(): Promise<PaperItem[]> {
  const res = await fetch(`${apiBase}/papers`)
  if (!res.ok) throw new Error('Failed to load papers')
  return res.json()
}

export async function fetchPaper(id: string): Promise<PaperItem> {
  const res = await fetch(`${apiBase}/papers/${id}`)
  if (!res.ok) throw new Error('Paper not found')
  return res.json()
}

export async function uploadPaper(payload: {
  pdf: File
  cover: Blob
  title: string
  tags: string
}): Promise<PaperItem> {
  const formData = new FormData()
  formData.append('pdf', payload.pdf)
  formData.append('cover', payload.cover, 'cover.png')
  formData.append('title', payload.title)
  formData.append('tags', payload.tags)

  const res = await fetch(`${apiBase}/papers`, {
    method: 'POST',
    body: formData
  })
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Upload failed' }))
    throw new Error(error.error || 'Upload failed')
  }
  return res.json()
}

export async function deletePaper(id: string): Promise<void> {
  const res = await fetch(`${apiBase}/papers/${id}`, { method: 'DELETE' })
  if (!res.ok && res.status !== 204) throw new Error('Delete failed')
}
