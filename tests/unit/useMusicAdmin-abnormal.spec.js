import { afterEach, describe, expect, it, vi } from 'vitest'
import { useMusicAdmin } from '../../src/composables/useMusicAdmin.js'

const toBase64Url = (obj) =>
  Buffer.from(JSON.stringify(obj))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

const credential = (payload) => `${toBase64Url({ alg: 'RS256' })}.${toBase64Url(payload)}.sig`

const TRACK = {
  row: 1, file: 'a.mp3', title: '曲A', description: '', instagram: '',
  suno: 'https://suno/a', youtube: '', publishedAt: '2026-11-13',
  durationSec: 100, lyrics: '', sort: 1, published: true,
}
const META = { tags: '音楽、川口', intro: '導入' }

const routeFetch = (handler) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, opts) => {
      const body = JSON.parse(opts.body)
      return { json: async () => handler(body) }
    }),
  )
}

const signInWithList = async (listResponse) => {
  routeFetch((body) => {
    if (body.action === 'exchange_session') return { ok: true, session_token: 'sess-token' }
    if (body.action === 'list_tracks') return listResponse
    if (body.action === 'check_archive') return { ok: true, exists: false }
    return { ok: true }
  })
  const admin = useMusicAdmin()
  await admin.onCredential(credential({ email: 'owner@example.com' }))
  return admin
}

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
})

// Abnormal cases at the /exec boundary: the response claims ok but
// its track list is null, the wrong shape, or carries entries that
// are not objects, and its meta is not an object. The page must
// land on a sane empty state instead of breaking the list or
// wedging the boot sequence.
describe('useMusicAdmin with deformed list payloads', () => {
  it('treats a null track list as an empty list', async () => {
    const admin = await signInWithList({ ok: true, tracks: null, meta: META })
    expect(admin.phase.value).toBe('ready')
    expect(admin.tracks.value).toEqual([])
    expect(admin.listStatus.value).toBe('0曲')
  })

  it('treats a non-array track list as an empty list', async () => {
    const admin = await signInWithList({ ok: true, tracks: { 0: TRACK }, meta: META })
    expect(admin.phase.value).toBe('ready')
    expect(admin.tracks.value).toEqual([])
    expect(admin.listStatus.value).toBe('0曲')
  })

  it('treats a string track list as an empty list', async () => {
    const admin = await signInWithList({ ok: true, tracks: 'a-string', meta: META })
    expect(admin.tracks.value).toEqual([])
    expect(admin.listStatus.value).toBe('0曲')
  })

  it('treats a numeric track list as an empty list', async () => {
    const admin = await signInWithList({ ok: true, tracks: 42, meta: META })
    expect(admin.tracks.value).toEqual([])
    expect(admin.listStatus.value).toBe('0曲')
  })

  it('drops entries that are not objects and keeps the real rows', async () => {
    const admin = await signInWithList({
      ok: true,
      tracks: [null, 42, 'x', [], TRACK],
      meta: META,
    })
    expect(admin.tracks.value).toEqual([TRACK])
    expect(admin.listStatus.value).toBe('1曲')
  })

  it('keeps a row without a file but gives it no archive badge', async () => {
    const admin = await signInWithList({ ok: true, tracks: [{ row: 7 }], meta: META })
    expect(admin.tracks.value).toEqual([{ row: 7 }])
    expect(admin.listStatus.value).toBe('1曲')
    expect(admin.archive.value).toEqual({})
  })

  it('treats a non-object meta as an empty meta', async () => {
    const admin = await signInWithList({ ok: true, tracks: [], meta: 'a-string' })
    expect(admin.meta.value).toEqual({})
  })

  it('treats an array meta as an empty meta', async () => {
    const admin = await signInWithList({ ok: true, tracks: [], meta: [1, 2, 3] })
    expect(admin.meta.value).toEqual({})
  })

  it('treats a null meta as an empty meta', async () => {
    const admin = await signInWithList({ ok: true, tracks: [], meta: null })
    expect(admin.meta.value).toEqual({})
  })

  it('reports a load failure when the whole response is null', async () => {
    routeFetch((body) => {
      if (body.action === 'exchange_session') return { ok: true, session_token: 'sess-token' }
      if (body.action === 'list_tracks') return null
      return { ok: true }
    })
    const admin = useMusicAdmin()
    const res = await admin.loadTracks()
    expect(res.ok).toBe(false)
    expect(admin.listStatus.value).toBe('読み込みに失敗しました')
    expect(admin.tracks.value).toEqual([])
  })

  it('leaves every badge unknown when a check answers null', async () => {
    routeFetch((body) => {
      if (body.action === 'exchange_session') return { ok: true, session_token: 'sess-token' }
      if (body.action === 'list_tracks') return { ok: true, tracks: [TRACK], meta: META }
      if (body.action === 'check_archive') return null
      return { ok: true }
    })
    const admin = useMusicAdmin()
    await admin.onCredential(credential({ email: 'owner@example.com' }))
    expect(admin.phase.value).toBe('ready')
    expect(admin.archive.value).toEqual({})
  })
})

describe('useMusicAdmin with a malformed share hash', () => {
  it('ignores an undecodable share token and stays at boot', async () => {
    routeFetch(() => ({ ok: true }))
    const admin = useMusicAdmin()
    expect(await admin.initFromHash('#share=%')).toBe(false)
    expect(admin.phase.value).toBe('boot')
    expect(admin.isShareSession.value).toBe(false)
  })

  it('ignores a truncated share token encoding', async () => {
    routeFetch(() => ({ ok: true }))
    const admin = useMusicAdmin()
    expect(await admin.initFromHash('#share=%E0%A4%A')).toBe(false)
    expect(admin.phase.value).toBe('boot')
  })
})
