export const API_URL = import.meta.env.VITE_MUSIC_API || '<API>'
export const GOOGLE_CLIENT_ID =
  '728154182351-5ribj1diqcp8jpfo3rnqk9rei1aka98t.apps.googleusercontent.com'

// One track row of the music-db "tracks" sheet, in the sheet's own
// column names. The admin API reads and writes this shape (the API
// also accepts the parsed camelCase names for published_at /
// duration_sec).
export const TRACK_FIELDS = [
  'file',
  'title',
  'description',
  'instagram',
  'suno',
  'youtube',
  'published_at',
  'duration_sec',
  'lyrics',
  'sort',
  'published',
]

// A track file name is a romaji slug plus ".mp3" — the same rule
// the music-gas folder scan uses to recognise a track at all.
export const TRACK_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*\.mp3$/

// The Internet Archive item identifier for a track file, and the
// public download URL the podcast feed uses as its enclosure.
export const ARCHIVE_IDENTIFIER_PREFIX = 'freddiefujiwara-'
export function archiveIdentifier(file) {
  return `${ARCHIVE_IDENTIFIER_PREFIX}${String(file || '').replace(/\.mp3$/i, '')}`
}
export function archiveUrl(file) {
  return `https://archive.org/download/${archiveIdentifier(file)}/${file}`
}
