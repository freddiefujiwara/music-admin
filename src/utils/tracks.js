import { TRACK_NAME_PATTERN, archiveIdentifier } from '../constants/app.js'
import {
  buildShareUrl,
  formatShareExpiry,
  formatShareRemaining,
  shareSecondsLeft,
} from '../share.js'

// A blank track form (create mode). Sort starts empty so the API
// stores no number until one is given.
export function emptyTrack() {
  return {
    file: '',
    title: '',
    description: '',
    instagram: '',
    suno: '',
    youtube: '',
    published_at: '',
    duration_sec: '',
    lyrics: '',
    sort: '',
    published: false,
  }
}

// Copy a listed track (the API's parsed shape: publishedAt /
// durationSec) into the edit form's sheet-column shape.
export function formFromTrack(track) {
  return {
    file: track.file ?? '',
    title: track.title ?? '',
    description: track.description ?? '',
    instagram: track.instagram ?? '',
    suno: track.suno ?? '',
    youtube: track.youtube ?? '',
    published_at: track.publishedAt ?? '',
    duration_sec: track.durationSec ?? '',
    lyrics: track.lyrics ?? '',
    sort: track.sort ?? '',
    published: Boolean(track.published),
  }
}

// The payload sent to create_track / update_track: numbers as
// numbers when they parse, blank otherwise; published as a boolean.
export function trackPayload(form) {
  const number = (value) => {
    if (value === null || value === undefined || String(value).trim() === '') {
      return ''
    }
    const n = Number(value)
    return Number.isFinite(n) ? n : ''
  }
  return {
    file: String(form.file ?? '').trim(),
    title: String(form.title ?? ''),
    description: String(form.description ?? ''),
    instagram: String(form.instagram ?? '').trim(),
    suno: String(form.suno ?? '').trim(),
    youtube: String(form.youtube ?? '').trim(),
    published_at: String(form.published_at ?? '').trim(),
    duration_sec: number(form.duration_sec),
    lyrics: String(form.lyrics ?? ''),
    sort: number(form.sort),
    published: Boolean(form.published),
  }
}

/** Whether a file name is a valid track name (romaji slug + .mp3). */
export function isValidTrackFile(file) {
  return TRACK_NAME_PATTERN.test(String(file ?? ''))
}

/** "2:00" for a duration in seconds; "" for blank/invalid values. */
export function formatDuration(value) {
  const seconds = Number(value)
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return ''
  }
  const whole = Math.round(seconds)
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

/** The meta line under a track title: date, length, file name. */
export function trackMeta(track) {
  const parts = []
  if (track.publishedAt) {
    parts.push(String(track.publishedAt))
  }
  const duration = formatDuration(track.durationSec)
  if (duration) {
    parts.push(duration)
  }
  if (track.file) {
    parts.push(String(track.file))
  }
  return parts.join(' / ')
}

/** The IA identifier preview shown next to the file name input. */
export function archivePreview(file) {
  if (!isValidTrackFile(file)) {
    return ''
  }
  return archiveIdentifier(file)
}

// The badge state for one track's Internet Archive copy:
// 'ok' (file is there), 'missing' (checked, not there),
// 'unknown' (not checked yet, or the check failed).
export function archiveBadge(entry) {
  if (!entry) {
    return 'unknown'
  }
  if (entry.exists === true) {
    return 'ok'
  }
  if (entry.exists === false) {
    return 'missing'
  }
  return 'unknown'
}

export function archiveBadgeLabel(state) {
  if (state === 'ok') {
    return 'IA あり'
  }
  if (state === 'missing') {
    return 'IA なし'
  }
  return 'IA 未確認'
}

// One-line summary of a publish/unpublish step result, e.g.
// "シート: OK / IA: スキップ（キー未設定） / 記事: OK".
export function publishStepsLabel(steps) {
  if (!steps) {
    return ''
  }
  const label = (value) => {
    if (value === 'ok') {
      return 'OK'
    }
    if (value === 'accepted') {
      return '受付済み（確認待ち）'
    }
    if (value === 'skipped_not_configured') {
      return 'スキップ（キー未設定）'
    }
    if (typeof value === 'string' && value.startsWith('error:')) {
      return `失敗（${value.slice('error:'.length).trim()}）`
    }
    return String(value ?? '')
  }
  const parts = []
  if ('sheet' in steps) {
    parts.push(`シート: ${label(steps.sheet)}`)
  }
  if ('archive' in steps) {
    parts.push(`IA: ${label(steps.archive)}`)
  }
  if ('article' in steps) {
    parts.push(`記事: ${label(steps.article)}`)
  }
  return parts.join(' / ')
}

// The issued-share display values (URL, remaining time, expiry
// label); all blank before a link is issued.
export function shareLinkView(issued, baseUrl, nowMs) {
  if (!issued) {
    return { url: '', remaining: '', expires: '' }
  }
  return {
    url: buildShareUrl(baseUrl, issued.share_token),
    remaining: formatShareRemaining(shareSecondsLeft(issued.expires_at, nowMs)),
    expires: formatShareExpiry(issued.expires_at),
  }
}
