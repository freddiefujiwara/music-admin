import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import {
  archiveBadge,
  emptyTrack,
  formFromTrack,
  formatDuration,
  publishStepsLabel,
  trackMeta,
  trackPayload,
} from '../../src/utils/tracks.js'
import { arrayBufferToBase64, fileToBase64 } from '../../src/utils/upload.js'
import {
  buildShareUrl,
  formatShareExpiry,
  formatShareRemaining,
  parseShareToken,
  shareSecondsLeft,
} from '../../src/share.js'

// Property-based tests for the pure transforms: whatever the sheet
// (or a deformed /exec payload) hands over, the display strings
// must stay well-formed and the mappings must conserve the data.
const NUM_RUNS = { numRuns: 100 }

describe('formatDuration properties', () => {
  // The double generator stays within a day in seconds: beyond
  // ~6e22 the minutes figure itself prints in exponential notation
  // (fast-check found 6e+22), and no caller can hold such a value —
  // duration_sec is measured from a real MP3 or read from the sheet.
  it('always yields blank or an M:SS string, never NaN/undefined text', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.integer(),
          fc.double({ min: -86400, max: 86400 }),
          fc.string(),
          fc.constantFrom(null, undefined, true, {}, []),
        ),
        (value) => {
          const out = formatDuration(value)
          expect(out === '' || /^\d+:\d{2}$/.test(out)).toBe(true)
        },
      ),
      NUM_RUNS,
    )
  })

  it('round-trips through M:SS back to the rounded seconds', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.1, max: 360000, noNaN: true }),
        (value) => {
          const out = formatDuration(value)
          const [minutes, seconds] = out.split(':').map(Number)
          expect(minutes * 60 + seconds).toBe(Math.round(value))
        },
      ),
      NUM_RUNS,
    )
  })
})

describe('trackPayload properties', () => {
  const fieldArb = fc.oneof(
    fc.string(),
    fc.integer(),
    fc.double(),
    fc.boolean(),
    fc.constant(null),
  )
  const formArb = fc.record({
    file: fieldArb,
    title: fieldArb,
    description: fieldArb,
    instagram: fieldArb,
    suno: fieldArb,
    youtube: fieldArb,
    published_at: fieldArb,
    duration_sec: fieldArb,
    lyrics: fieldArb,
    sort: fieldArb,
    published: fieldArb,
  })

  it('always yields the payload shape: strings, finite numbers or blanks, a boolean', () => {
    fc.assert(
      fc.property(formArb, (form) => {
        const payload = trackPayload(form)
        for (const key of ['file', 'title', 'description', 'instagram', 'suno', 'youtube', 'published_at', 'lyrics']) {
          expect(typeof payload[key]).toBe('string')
        }
        for (const key of ['duration_sec', 'sort']) {
          expect(
            payload[key] === '' ||
              (typeof payload[key] === 'number' && Number.isFinite(payload[key])),
          ).toBe(true)
        }
        expect(typeof payload.published).toBe('boolean')
      }),
      NUM_RUNS,
    )
  })

  it('is idempotent: a payload fed back as a form maps to itself', () => {
    fc.assert(
      fc.property(formArb, (form) => {
        expect(trackPayload(trackPayload(form))).toEqual(trackPayload(form))
      }),
      NUM_RUNS,
    )
  })
})

describe('formFromTrack properties', () => {
  it('conserves every field of a listed track under its sheet name', () => {
    const trackArb = fc.record({
      file: fc.string(),
      title: fc.string(),
      description: fc.string(),
      instagram: fc.string(),
      suno: fc.string(),
      youtube: fc.string(),
      publishedAt: fc.string(),
      durationSec: fc.oneof(fc.integer(), fc.string()),
      lyrics: fc.string(),
      sort: fc.oneof(fc.integer(), fc.string()),
      published: fc.boolean(),
    })
    fc.assert(
      fc.property(trackArb, (track) => {
        const form = formFromTrack(track)
        expect(form.file).toBe(track.file)
        expect(form.title).toBe(track.title)
        expect(form.description).toBe(track.description)
        expect(form.instagram).toBe(track.instagram)
        expect(form.suno).toBe(track.suno)
        expect(form.youtube).toBe(track.youtube)
        expect(form.published_at).toBe(track.publishedAt)
        expect(form.duration_sec).toBe(track.durationSec)
        expect(form.lyrics).toBe(track.lyrics)
        expect(form.sort).toBe(track.sort)
        expect(form.published).toBe(track.published)
      }),
      NUM_RUNS,
    )
  })

  it('maps an all-null track to the blank form', () => {
    const nullTrack = Object.fromEntries(
      Object.keys(emptyTrack()).map((key) => [key, null]),
    )
    expect(formFromTrack({ ...nullTrack, publishedAt: null, durationSec: null }))
      .toEqual(emptyTrack())
  })
})

describe('trackMeta properties', () => {
  it('joins date, duration and file with " / " when all three are present', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.integer({ min: 1, max: 7200 }),
        fc.string({ minLength: 1 }),
        (publishedAt, durationSec, file) => {
          expect(trackMeta({ publishedAt, durationSec, file })).toBe(
            `${publishedAt} / ${formatDuration(durationSec)} / ${file}`,
          )
        },
      ),
      NUM_RUNS,
    )
  })
})

describe('publishStepsLabel properties', () => {
  const stepArb = fc.oneof(
    fc.constantFrom('ok', 'accepted', 'skipped_not_configured'),
    fc.string(),
    fc.constant(null),
  )

  it('never throws and never leaks undefined for any step values', () => {
    fc.assert(
      fc.property(
        fc.record(
          { sheet: stepArb, archive: stepArb, article: stepArb },
          { requiredKeys: [] },
        ),
        (steps) => {
          const out = publishStepsLabel(steps)
          expect(out).not.toContain('undefined')
          const present = ['sheet', 'archive', 'article'].filter((k) => k in steps)
          expect(out === '' ? 0 : out.split(' / ').length).toBe(present.length)
        },
      ),
      NUM_RUNS,
    )
  })

  it('ignores unknown step keys', () => {
    fc.assert(
      fc.property(
        fc.record({ sheet: stepArb, article: stepArb }, { requiredKeys: [] }),
        fc.string(),
        (steps, junk) => {
          expect(publishStepsLabel({ ...steps, bogus: junk })).toBe(
            publishStepsLabel(steps),
          )
        },
      ),
      NUM_RUNS,
    )
  })
})

describe('archiveBadge properties', () => {
  it('is ok exactly for exists === true and missing exactly for exists === false', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant(null),
          fc.constant(42),
          fc.constant('ok'),
          fc.record({
            exists: fc.oneof(fc.boolean(), fc.string(), fc.integer()),
          }),
        ),
        (entry) => {
          const badge = archiveBadge(entry)
          expect(['ok', 'missing', 'unknown']).toContain(badge)
          expect(badge === 'ok').toBe(entry?.exists === true)
          expect(badge === 'missing').toBe(entry?.exists === false)
        },
      ),
      NUM_RUNS,
    )
  })
})

describe('base64 properties', () => {
  it('encodes any bytes exactly like Buffer, across the chunk boundary', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 70000 }), (bytes) => {
        const copy = new Uint8Array(bytes)
        expect(arrayBufferToBase64(copy.buffer)).toBe(
          Buffer.from(bytes).toString('base64'),
        )
      }),
      NUM_RUNS,
    )
  })

  it('reads any file bytes to the same base64', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uint8Array({ maxLength: 1024 }), async (bytes) => {
        class FakeReader {
          readAsArrayBuffer() {
            this.result = new Uint8Array(bytes).buffer
            this.onload()
          }
        }
        await expect(fileToBase64({}, FakeReader)).resolves.toBe(
          Buffer.from(bytes).toString('base64'),
        )
      }),
      NUM_RUNS,
    )
  })
})

describe('share helper properties', () => {
  // Share tokens are opaque URL-safe strings issued by the server;
  // arbitrary unicode is outside the caller's domain (and
  // encodeURIComponent itself rejects lone surrogates), so the
  // round-trip property generates from the token alphabet.
  const tokenArb = fc
    .array(
      fc.constantFrom(
        ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_',
      ),
      { minLength: 1, maxLength: 48 },
    )
    .map((chars) => chars.join(''))

  it('round-trips a token through the share URL and back', () => {
    fc.assert(
      fc.property(tokenArb, (token) => {
        const url = buildShareUrl('https://example.com/app/', token)
        expect(parseShareToken(url.slice(url.indexOf('#')))).toBe(token)
      }),
      NUM_RUNS,
    )
  })

  it('never reports a negative or fractional seconds-left', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.date({ noInvalidDate: true }).map((d) => d.toISOString()), fc.string()),
        fc.integer({ min: 0, max: 2 ** 45 }),
        (expiresAt, nowMs) => {
          const left = shareSecondsLeft(expiresAt, nowMs)
          expect(
            left === null || (Number.isInteger(left) && left >= 0),
          ).toBe(true)
        },
      ),
      NUM_RUNS,
    )
  })

  // formatShareRemaining is only ever fed shareSecondsLeft's output
  // (null or a non-negative integer), so the property stays in that
  // domain; NaN/Infinity cannot reach it from a real caller.
  it('labels only the documented shapes for reachable inputs', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.constant(null), fc.integer({ min: 0, max: 100000000 })),
        (seconds) => {
          const out = formatShareRemaining(seconds)
          if (seconds === null) {
            expect(out).toBe('')
          } else if (seconds <= 0) {
            expect(out).toBe('期限切れ')
          } else {
            expect(out).toMatch(/^残り約/)
            expect(out).not.toContain('NaN')
          }
        },
      ),
      NUM_RUNS,
    )
  })

  // The date generator stays within 4-digit years: the label's
  // documented shape is YYYYMMDD (fast-check found year 0999, whose
  // unpadded year breaks the shape), and issued links expire within
  // 30 days, so real expiries are always contemporary 4-digit years.
  // noInvalidDate is required: fc.date emits Invalid Dates by default
  // (~0.1% of draws), and toISOString throws on those before the code
  // under test is even reached — CI drew one on the first run.
  it('formats an expiry as YYYYMMDD HH:MM or blank', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc
            .date({
              min: new Date('1000-01-01T00:00:00Z'),
              max: new Date('9999-12-31T23:59:59Z'),
              noInvalidDate: true,
            })
            .map((d) => d.toISOString()),
          fc.constantFrom('', 'not-a-date', '2026-13-45', '2999-01-01T00:00:00.000Z'),
        ),
        (expiresAt) => {
          const out = formatShareExpiry(expiresAt)
          expect(out === '' || /^\d{8} \d{2}:\d{2}$/.test(out)).toBe(true)
        },
      ),
      NUM_RUNS,
    )
  })
})
