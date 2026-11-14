import { describe, expect, it } from 'vitest'
import {
  API_URL,
  GOOGLE_CLIENT_ID,
  TRACK_FIELDS,
  TRACK_NAME_PATTERN,
  archiveIdentifier,
  archiveUrl,
} from '../../src/constants/app.js'

describe('constants', () => {
  it('keeps the API placeholder the CI injects', () => {
    expect(API_URL).toBe('<API>')
  })

  it('uses the shared Google client ID', () => {
    expect(GOOGLE_CLIENT_ID).toContain('.apps.googleusercontent.com')
  })

  it('lists the tracks sheet columns in sheet order', () => {
    expect(TRACK_FIELDS).toEqual([
      'file', 'title', 'description', 'instagram', 'suno', 'youtube',
      'published_at', 'duration_sec', 'lyrics', 'sort', 'published',
    ])
  })

  it('accepts only romaji-slug mp3 names as track files', () => {
    expect(TRACK_NAME_PATTERN.test('night-walk-kawaguchi.mp3')).toBe(true)
    expect(TRACK_NAME_PATTERN.test('a.mp3')).toBe(true)
    expect(TRACK_NAME_PATTERN.test('Bad.mp3')).toBe(false)
    expect(TRACK_NAME_PATTERN.test('two words.mp3')).toBe(false)
    expect(TRACK_NAME_PATTERN.test('song.wav')).toBe(false)
  })

  it('derives the Internet Archive identifier and URL from the file name', () => {
    expect(archiveIdentifier('')).toBe('freddiefujiwara-')
    expect(archiveIdentifier('hatogaya-urawa.mp3')).toBe('freddiefujiwara-hatogaya-urawa')
    expect(archiveUrl('hatogaya-urawa.mp3')).toBe(
      'https://archive.org/download/freddiefujiwara-hatogaya-urawa/hatogaya-urawa.mp3',
    )
  })
})
