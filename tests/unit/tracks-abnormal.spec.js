import { describe, expect, it } from 'vitest'
import {
  archiveBadge,
  archivePreview,
  emptyTrack,
  formFromTrack,
  formatDuration,
  isValidTrackFile,
  publishStepsLabel,
  shareLinkView,
  trackMeta,
  trackPayload,
} from '../../src/utils/tracks.js'
import { parseShareToken } from '../../src/share.js'

// Abnormal cases for the pure shaping helpers: list rows and step
// results arrive from the /exec payload, so a row can be null, a
// primitive, or carry fields of the wrong type. The helpers must
// degrade to the blank/unknown shape instead of throwing — the
// list renders whatever they return.
describe('formFromTrack with deformed rows', () => {
  it('maps a null or undefined row to the blank form', () => {
    expect(formFromTrack(null)).toEqual(emptyTrack())
    expect(formFromTrack(undefined)).toEqual(emptyTrack())
  })

  it('maps a non-object row to the blank form', () => {
    expect(formFromTrack('a.mp3')).toEqual(emptyTrack())
    expect(formFromTrack(42)).toEqual(emptyTrack())
    expect(formFromTrack([])).toEqual(emptyTrack())
  })

  it('keeps blank defaults when every field is null', () => {
    expect(
      formFromTrack({
        file: null, title: null, description: null, instagram: null,
        suno: null, youtube: null, publishedAt: null, durationSec: null,
        lyrics: null, sort: null, published: null,
      }),
    ).toEqual(emptyTrack())
  })

  it('passes scalar fields through and defaults the missing ones', () => {
    const form = formFromTrack({ file: 'a.mp3', durationSec: '100', published: 1 })
    expect(form.file).toBe('a.mp3')
    expect(form.duration_sec).toBe('100')
    expect(form.published).toBe(true)
    expect(form.title).toBe('')
  })
})

describe('trackMeta with deformed rows', () => {
  it('is blank for a null or undefined row', () => {
    expect(trackMeta(null)).toBe('')
    expect(trackMeta(undefined)).toBe('')
    expect(trackMeta(42)).toBe('')
    expect(trackMeta([])).toBe('')
  })

  it('stringifies scalar fields and skips an unusable duration', () => {
    expect(
      trackMeta({ publishedAt: 20261113, durationSec: 'abc', file: 42 }),
    ).toBe('20261113 / 42')
    expect(
      trackMeta({ publishedAt: '2026-11-13', durationSec: {}, file: 'a.mp3' }),
    ).toBe('2026-11-13 / a.mp3')
  })
})

describe('trackPayload with deformed forms', () => {
  it('builds the blank payload from a null or undefined form', () => {
    expect(trackPayload(null)).toEqual(trackPayload(emptyTrack()))
    expect(trackPayload(undefined)).toEqual(trackPayload(emptyTrack()))
    expect(trackPayload([])).toEqual(trackPayload(emptyTrack()))
    expect(trackPayload('x')).toEqual(trackPayload(emptyTrack()))
  })

  it('reads numeric fields arriving as strings, blanks, and junk', () => {
    expect(trackPayload({ ...emptyTrack(), duration_sec: ' 65 ' }).duration_sec).toBe(65)
    expect(trackPayload({ ...emptyTrack(), duration_sec: true }).duration_sec).toBe('')
    expect(trackPayload({ ...emptyTrack(), duration_sec: [] }).duration_sec).toBe('')
    expect(trackPayload({ ...emptyTrack(), duration_sec: [65] }).duration_sec).toBe('')
    expect(trackPayload({ ...emptyTrack(), duration_sec: Infinity }).duration_sec).toBe('')
    expect(trackPayload({ ...emptyTrack(), sort: {} }).sort).toBe('')
    expect(trackPayload({ ...emptyTrack(), sort: '3' }).sort).toBe(3)
  })
})

describe('publishStepsLabel with deformed step results', () => {
  it('is blank for a non-object result', () => {
    expect(publishStepsLabel('ok')).toBe('')
    expect(publishStepsLabel(42)).toBe('')
    expect(publishStepsLabel(true)).toBe('')
  })

  it('is blank for an array result', () => {
    expect(publishStepsLabel([])).toBe('')
  })

  it('labels the steps it knows and skips unknown keys', () => {
    expect(publishStepsLabel({ sheet: 'ok', bogus: 'ok' })).toBe('シート: OK')
  })

  it('never throws for object step values', () => {
    expect(() => publishStepsLabel({ sheet: {}, archive: [] })).not.toThrow()
  })
})

describe('shareLinkView with deformed issued shares', () => {
  const blank = { url: '', remaining: '', expires: '' }

  it('is blank when the issue result carries no token', () => {
    expect(shareLinkView({}, 'https://example.com/app/', 0)).toEqual(blank)
    expect(
      shareLinkView({ expires_at: '2999-01-01T00:00:00.000Z' }, 'https://example.com/app/', 0),
    ).toEqual(blank)
  })

  it('is blank for a non-object issue result', () => {
    expect(shareLinkView('tok', 'https://example.com/app/', 0)).toEqual(blank)
    expect(shareLinkView(42, 'https://example.com/app/', 0)).toEqual(blank)
  })

  it('builds the URL but no labels when only the token is present', () => {
    const view = shareLinkView({ share_token: 'tok' }, 'https://example.com/app/', 0)
    expect(view.url).toBe('https://example.com/app/#share=tok')
    expect(view.remaining).toBe('')
    expect(view.expires).toBe('')
  })
})

describe('parseShareToken with malformed hashes', () => {
  it('treats an undecodable token as no token', () => {
    expect(parseShareToken('#share=%')).toBe('')
    expect(parseShareToken('#share=%E0%A4%A')).toBe('')
  })

  it('still parses a well-formed token next to junk params', () => {
    expect(parseShareToken('#x=%&share=tok')).toBe('tok')
  })
})

describe('display helpers with deformed values', () => {
  it('formats only positive finite durations', () => {
    expect(formatDuration(-5)).toBe('')
    expect(formatDuration(Infinity)).toBe('')
    expect(formatDuration(null)).toBe('')
    expect(formatDuration({})).toBe('')
    expect(formatDuration([])).toBe('')
    expect(formatDuration(' 65 ')).toBe('1:05')
  })

  it('rejects non-string file names without throwing', () => {
    expect(isValidTrackFile(42)).toBe(false)
    expect(isValidTrackFile({})).toBe(false)
    expect(isValidTrackFile([])).toBe(false)
  })

  it('keeps the badge unknown for non-boolean exists values', () => {
    expect(archiveBadge({ exists: 'yes' })).toBe('unknown')
    expect(archiveBadge({ exists: 1 })).toBe('unknown')
    expect(archiveBadge(42)).toBe('unknown')
    expect(archiveBadge('ok')).toBe('unknown')
  })

  it('previews no identifier for a deformed file name', () => {
    expect(archivePreview(null)).toBe('')
    expect(archivePreview(42)).toBe('')
  })
})
