import { describe, expect, it } from 'vitest'
import {
  archiveBadge,
  archiveBadgeLabel,
  archivePreview,
  claudeKeyView,
  emptyTrack,
  formFromTrack,
  formatDuration,
  isValidTrackFile,
  publishStepsLabel,
  shareLinkView,
  trackMeta,
  trackPayload,
} from '../../src/utils/tracks.js'

describe('track form helpers', () => {
  it('starts from a blank unpublished track', () => {
    expect(emptyTrack()).toEqual({
      file: '', title: '', description: '', instagram: '', suno: '',
      youtube: '', published_at: '', duration_sec: '', lyrics: '',
      sort: '', published: false,
    })
  })

  it('maps a listed track into the form shape', () => {
    expect(formFromTrack({
      file: 'a.mp3', title: '曲A', description: '説明', instagram: 'ig',
      suno: 'suno', youtube: 'yt', publishedAt: '2026-11-13',
      durationSec: 100, lyrics: '歌詞', sort: 1, published: true,
    })).toEqual({
      file: 'a.mp3', title: '曲A', description: '説明', instagram: 'ig',
      suno: 'suno', youtube: 'yt', published_at: '2026-11-13',
      duration_sec: 100, lyrics: '歌詞', sort: 1, published: true,
    })
    expect(formFromTrack({}).published).toBe(false)
    expect(formFromTrack({}).file).toBe('')
  })

  it('builds the API payload with parsed numbers', () => {
    const payload = trackPayload({
      ...emptyTrack(),
      file: ' a.mp3 ',
      title: '曲A',
      duration_sec: '100',
      sort: '2',
      published: true,
    })
    expect(payload.file).toBe('a.mp3')
    expect(payload.duration_sec).toBe(100)
    expect(payload.sort).toBe(2)
    expect(payload.published).toBe(true)
    const blank = trackPayload(emptyTrack())
    expect(blank.duration_sec).toBe('')
    expect(blank.sort).toBe('')
    expect(trackPayload({ ...emptyTrack(), duration_sec: 'abc' }).duration_sec).toBe('')
    expect(trackPayload({}).file).toBe('')
  })

  it('validates track file names', () => {
    expect(isValidTrackFile('night-walk-kawaguchi.mp3')).toBe(true)
    expect(isValidTrackFile('Bad.mp3')).toBe(false)
    expect(isValidTrackFile('')).toBe(false)
    expect(isValidTrackFile(null)).toBe(false)
  })
})

describe('track display helpers', () => {
  it('formats durations as M:SS', () => {
    expect(formatDuration(120)).toBe('2:00')
    expect(formatDuration(48)).toBe('0:48')
    expect(formatDuration('65')).toBe('1:05')
    expect(formatDuration(0)).toBe('')
    expect(formatDuration('')).toBe('')
    expect(formatDuration('abc')).toBe('')
  })

  it('joins the meta line from date, duration and file', () => {
    expect(trackMeta({ publishedAt: '2026-11-13', durationSec: 100, file: 'a.mp3' }))
      .toBe('2026-11-13 / 1:40 / a.mp3')
    expect(trackMeta({ file: 'a.mp3' })).toBe('a.mp3')
    expect(trackMeta({})).toBe('')
  })

  it('previews the archive identifier only for valid files', () => {
    expect(archivePreview('a.mp3')).toBe('freddiefujiwara-a')
    expect(archivePreview('not a slug')).toBe('')
  })
})

describe('archive badge helpers', () => {
  it('maps check results to badge states and labels', () => {
    expect(archiveBadge(null)).toBe('unknown')
    expect(archiveBadge({})).toBe('unknown')
    expect(archiveBadge({ exists: true })).toBe('ok')
    expect(archiveBadge({ exists: false })).toBe('missing')
    expect(archiveBadgeLabel('ok')).toBe('IA あり')
    expect(archiveBadgeLabel('missing')).toBe('IA なし')
    expect(archiveBadgeLabel('unknown')).toBe('IA 未確認')
  })
})

describe('publish steps label', () => {
  it('summarizes every step state', () => {
    expect(publishStepsLabel(null)).toBe('')
    expect(publishStepsLabel({ sheet: 'ok', archive: 'ok', article: 'ok' }))
      .toBe('シート: OK / IA: OK / 記事: OK')
    expect(publishStepsLabel({ sheet: 'ok', archive: 'skipped_not_configured', article: 'ok' }))
      .toBe('シート: OK / IA: スキップ（キー未設定） / 記事: OK')
    expect(publishStepsLabel({ archive: 'accepted' })).toBe('IA: 受付済み（確認待ち）')
    expect(publishStepsLabel({ article: 'error: boom' })).toBe('記事: 失敗（boom）')
    expect(publishStepsLabel({ sheet: 'mystery' })).toBe('シート: mystery')
    expect(publishStepsLabel({ sheet: null })).toBe('シート: ')
  })
})

describe('shareLinkView', () => {
  it('is blank before a link is issued', () => {
    expect(shareLinkView(null, 'https://example.com/app/', 0))
      .toEqual({ url: '', remaining: '', expires: '' })
  })

  it('builds the URL and labels from an issued share', () => {
    const view = shareLinkView(
      { share_token: 'tok', expires_at: '2999-01-01T00:00:00.000Z' },
      'https://example.com/app/',
      Date.parse('2026-01-01T00:00:00Z'),
    )
    expect(view.url).toBe('https://example.com/app/#share=tok')
    expect(view.remaining).not.toBe('')
    expect(view.expires).not.toBe('')
  })
})

describe('claudeKeyView', () => {
  it('is inactive without a status or without a live key', () => {
    expect(claudeKeyView(null, 0)).toEqual({ active: false, remaining: '', expires: '' })
    expect(claudeKeyView({ active: false }, 0))
      .toEqual({ active: false, remaining: '', expires: '' })
  })

  it('labels a live key with its remaining time and expiry', () => {
    const view = claudeKeyView(
      { active: true, issued_at: '2026-01-01T00:00:00Z', expires_at: '2026-01-31T00:00:00Z' },
      Date.parse('2026-01-01T00:00:00Z'),
    )
    expect(view.active).toBe(true)
    expect(view.remaining).not.toBe('')
    expect(view.expires).not.toBe('')
  })
})
