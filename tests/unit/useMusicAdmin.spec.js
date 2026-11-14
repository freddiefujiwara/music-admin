import { afterEach, describe, expect, it, vi } from 'vitest'
import { useMusicAdmin } from '../../src/composables/useMusicAdmin.js'

const toBase64Url = (obj) =>
  Buffer.from(JSON.stringify(obj))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

const credential = (payload) => `${toBase64Url({ alg: 'RS256' })}.${toBase64Url(payload)}.sig`

const TRACKS = [
  {
    row: 1, file: 'a.mp3', title: '曲A', description: '', instagram: '',
    suno: 'https://suno/a', youtube: '', publishedAt: '2026-11-13',
    durationSec: 100, lyrics: '', sort: 1, published: true,
  },
  {
    row: 2, file: 'b.mp3', title: '曲B', description: '', instagram: '',
    suno: 'https://suno/b', youtube: '', publishedAt: '2026-11-07',
    durationSec: 120, lyrics: '', sort: 2, published: false,
  },
]
const META = { tags: '音楽、川口', suno_profile: 'https://suno.com/@x', intro: '導入', outro: '締め' }

const routeFetch = (handler) => {
  const calls = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, opts) => {
      const body = JSON.parse(opts.body)
      calls.push(body)
      return { json: async () => handler(body) }
    }),
  )
  return calls
}

const okHandler = (body) => {
  if (body.action === 'exchange_session') {
    return { ok: true, session_token: 'sess-token', expires_at: '2026-12-15T00:00:00.000Z' }
  }
  if (body.action === 'list_tracks') return { ok: true, tracks: TRACKS, meta: META }
  if (body.action === 'check_archive') {
    return body.file === 'a.mp3'
      ? { ok: true, file: body.file, exists: true, size: 111 }
      : { ok: true, file: body.file, exists: false }
  }
  if (body.action === 'publish_track') {
    return { ok: true, file: body.file, steps: { sheet: 'ok', archive: 'ok', article: 'ok' } }
  }
  if (body.action === 'unpublish_track') {
    return { ok: true, file: body.file, steps: { sheet: 'ok', article: 'ok' } }
  }
  if (body.action === 'issue_share') {
    return { ok: true, share_token: 'tok', expires_at: '2026-12-15T00:00:00.000Z' }
  }
  if (body.action === 'revoke_share') return { ok: true, revoked: true }
  if (body.action === 'issue_claude_key') {
    return {
      ok: true, claude_key: 'mk_testkey', issued_at: '2026-11-15T00:00:00.000Z',
      expires_at: '2026-12-15T00:00:00.000Z', ttl_seconds: 2592000,
    }
  }
  if (body.action === 'revoke_claude_key') return { ok: true, revoked: true }
  if (body.action === 'claude_key_status') {
    return { ok: true, active: true, expires_at: '2026-12-15T00:00:00.000Z' }
  }
  if (body.action === 'regenerate_article') return { ok: true, paragraphs: 42 }
  return { ok: true, row: body.row || 3 }
}

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe('useMusicAdmin', () => {
  it('stays on the gate without a share hash', async () => {
    const admin = useMusicAdmin()
    expect(await admin.initFromHash('')).toBe(false)
    expect(admin.phase.value).toBe('gate')
  })

  it('loads tracks, meta and IA badges after a Google credential', async () => {
    const calls = routeFetch(okHandler)
    const admin = useMusicAdmin()
    await admin.onCredential(credential({ email: 'owner@example.com' }))
    expect(admin.phase.value).toBe('ready')
    expect(admin.email.value).toBe('owner@example.com')
    expect(admin.tracks.value).toEqual(TRACKS)
    expect(admin.meta.value).toEqual(META)
    expect(admin.listStatus.value).toBe('2曲')
    expect(admin.archive.value['a.mp3']).toEqual({ exists: true, size: 111 })
    expect(admin.archive.value['b.mp3']).toEqual({ exists: false, size: undefined })
    expect(calls[0]).toMatchObject({ action: 'exchange_session' })
    expect(calls[1]).toMatchObject({ action: 'list_tracks' })
    expect(calls[1].session_token).toBe('sess-token')
    expect(localStorage.getItem('music-admin-session-token')).toBe('sess-token')
    expect(localStorage.getItem('music-admin-session-email')).toBe('owner@example.com')
  })

  it('rejects a sign-in when the exchange fails at the transport level', async () => {
    routeFetch((body) => {
      if (body.action === 'exchange_session') throw new Error('offline')
      return okHandler(body)
    })
    const admin = useMusicAdmin()
    await admin.onCredential(credential({ email: 'owner@example.com' }))
    expect(admin.phase.value).toBe('gate')
    expect(admin.gateError.value).toBe('このアカウントでは利用できません')
  })

  it('rejects a sign-in when the exchange returns no session token', async () => {
    routeFetch((body) => {
      if (body.action === 'exchange_session') return { ok: true }
      return okHandler(body)
    })
    const admin = useMusicAdmin()
    await admin.onCredential(credential({ email: 'owner@example.com' }))
    expect(admin.phase.value).toBe('gate')
    expect(admin.gateError.value).toBe('このアカウントでは利用できません')
  })

  it('keeps the email empty when the credential carries none', async () => {
    routeFetch(okHandler)
    const admin = useMusicAdmin()
    await admin.onCredential(credential({ sub: 'x' }))
    expect(admin.email.value).toBe('')
    expect(admin.phase.value).toBe('ready')
  })

  it('does not reload after a failed update', async () => {
    const calls = routeFetch((body) => {
      if (body.action === 'update_track') return { ok: false, error: 'nope' }
      return okHandler(body)
    })
    const admin = useMusicAdmin()
    await admin.onCredential(credential({ email: 'owner@example.com' }))
    const before = calls.filter((c) => c.action === 'list_tracks').length
    const res = await admin.updateTrack(1, 'a.mp3', { title: 'x' })
    expect(res.ok).toBe(false)
    expect(calls.filter((c) => c.action === 'list_tracks').length).toBe(before)
  })

  it('logs out of a share session without an owner session to revoke', async () => {
    const calls = routeFetch(okHandler)
    const admin = useMusicAdmin()
    await admin.initFromHash('#share=share-tok')
    expect(admin.phase.value).toBe('ready')
    admin.logout()
    expect(admin.phase.value).toBe('gate')
    expect(calls.some((c) => c.action === 'revoke_session')).toBe(false)
  })

  it('logs out even when the server-side revoke fails', async () => {
    routeFetch((body) => {
      if (body.action === 'revoke_session') throw new Error('offline')
      return okHandler(body)
    })
    const admin = useMusicAdmin()
    await admin.onCredential(credential({ email: 'owner@example.com' }))
    admin.logout()
    // Let the rejected revoke settle into its catch handler.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(admin.phase.value).toBe('gate')
  })

  it('returns to the gate when the server rejects the account', async () => {
    routeFetch(() => ({ ok: false, status: 403, error: 'forbidden email' }))
    const admin = useMusicAdmin()
    await admin.onCredential(credential({ email: 'stranger@example.com' }))
    expect(admin.phase.value).toBe('gate')
    expect(admin.gateError.value).toBe('このアカウントでは利用できません')
  })

  it('tolerates an undecodable credential and still asks the server', async () => {
    routeFetch(() => ({ ok: false, status: 401, error: 'token verification failed' }))
    const admin = useMusicAdmin()
    await admin.onCredential('not-a-jwt')
    expect(admin.email.value).toBe('')
    expect(admin.phase.value).toBe('gate')
  })

  it('enters through a share link and shows the expired state on failure', async () => {
    const calls = routeFetch(okHandler)
    const admin = useMusicAdmin()
    expect(await admin.initFromHash('#share=share-tok')).toBe(true)
    expect(admin.phase.value).toBe('ready')
    expect(admin.isShareSession.value).toBe(true)
    expect(calls[0].share_token).toBe('share-tok')

    routeFetch(() => ({ ok: false, status: 401, error: 'share session expired or invalid' }))
    const expired = useMusicAdmin()
    await expired.initFromHash('#share=old-tok')
    expect(expired.phase.value).toBe('share-expired')
  })

  it('captures the share expiry from _share responses', async () => {
    routeFetch((body) => {
      if (body.action === 'list_tracks') {
        return { ok: true, tracks: [], meta: {}, _share: { expires_at: '2026-12-15T00:00:00.000Z' } }
      }
      return { ok: true, exists: false }
    })
    const admin = useMusicAdmin()
    await admin.initFromHash('#share=tok')
    expect(admin.shareExpiresAt.value).toBe('2026-12-15T00:00:00.000Z')
  })

  it('drops a dead saved session back to the gate', async () => {
    localStorage.setItem('music-admin-session-token', 'dead-token')
    routeFetch(() => ({ ok: false, status: 401, error: 'session expired or invalid' }))
    const admin = useMusicAdmin()
    expect(await admin.restoreSession()).toBe(false)
    expect(admin.phase.value).toBe('gate')
    expect(localStorage.getItem('music-admin-session-token')).toBeNull()
  })

  it('restores a live saved session without a sign-in', async () => {
    localStorage.setItem('music-admin-session-token', 'sess-token')
    localStorage.setItem('music-admin-session-email', 'owner@example.com')
    routeFetch(okHandler)
    const admin = useMusicAdmin()
    expect(await admin.restoreSession()).toBe(true)
    expect(admin.email.value).toBe('owner@example.com')
    expect(admin.tracks.value).toEqual(TRACKS)
  })

  it('returns false from restoreSession when nothing is saved', async () => {
    const admin = useMusicAdmin()
    expect(await admin.restoreSession()).toBe(false)
  })

  it('logs out, clearing the saved session and revoking it server-side', async () => {
    const calls = routeFetch(okHandler)
    const admin = useMusicAdmin()
    await admin.onCredential(credential({ email: 'owner@example.com' }))
    admin.logout()
    expect(admin.phase.value).toBe('gate')
    expect(localStorage.getItem('music-admin-session-token')).toBeNull()
    expect(calls[calls.length - 1]).toMatchObject({
      action: 'revoke_session', session_token: 'sess-token',
    })
  })

  it('reports a network failure while loading, after retries', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    const admin = useMusicAdmin()
    const res = await admin.loadTracks()
    expect(res.ok).toBe(false)
    expect(admin.listStatus.value).toBe('読み込みに失敗しました')
  })

  it('shows a server error while loading', async () => {
    routeFetch(() => ({ ok: false, error: 'music-db has no "tracks" sheet' }))
    const admin = useMusicAdmin()
    await admin.loadTracks()
    expect(admin.listStatus.value).toBe('music-db has no "tracks" sheet')
  })

  it('falls back to a generic message when a load error has no text', async () => {
    routeFetch(() => ({ ok: false }))
    const admin = useMusicAdmin()
    await admin.loadTracks()
    expect(admin.listStatus.value).toBe('読み込みに失敗しました')
  })

  it('creates, updates and deletes tracks with a reload after each', async () => {
    const calls = routeFetch(okHandler)
    const admin = useMusicAdmin()
    await admin.onCredential(credential({ email: 'owner@example.com' }))
    const created = await admin.createTrack({ file: 'c.mp3', title: '曲C' })
    expect(created.ok).toBe(true)
    expect(calls.some((c) => c.action === 'create_track' && c.track.file === 'c.mp3')).toBe(true)
    const updated = await admin.updateTrack(2, 'b.mp3', { title: '曲B改' })
    expect(updated.ok).toBe(true)
    expect(calls.some((c) => c.action === 'update_track' && c.row === 2 && c.file === 'b.mp3')).toBe(true)
    const deleted = await admin.deleteTrack(2, 'b.mp3')
    expect(deleted.ok).toBe(true)
    expect(calls.some((c) => c.action === 'delete_track' && c.row === 2)).toBe(true)
  })

  it('reloads after a delete even when the delete failed', async () => {
    const calls = routeFetch((body) => {
      if (body.action === 'delete_track') return { ok: false, error: 'track row not found: 9' }
      return okHandler(body)
    })
    const admin = useMusicAdmin()
    await admin.onCredential(credential({ email: 'owner@example.com' }))
    const before = calls.filter((c) => c.action === 'list_tracks').length
    const res = await admin.deleteTrack(9, 'zzz.mp3')
    expect(res.ok).toBe(false)
    expect(calls.filter((c) => c.action === 'list_tracks').length).toBe(before + 1)
  })

  it('updates meta and keeps the local copy in sync', async () => {
    routeFetch(okHandler)
    const admin = useMusicAdmin()
    await admin.onCredential(credential({ email: 'owner@example.com' }))
    const res = await admin.updateMeta({ intro: '新しい導入' })
    expect(res.ok).toBe(true)
    expect(admin.meta.value.intro).toBe('新しい導入')
    expect(admin.meta.value.tags).toBe('音楽、川口')
  })

  it('uploads an MP3 and publishes with per-step results', async () => {
    const calls = routeFetch(okHandler)
    const admin = useMusicAdmin()
    await admin.onCredential(credential({ email: 'owner@example.com' }))
    const uploaded = await admin.uploadMp3('c.mp3', 'AAAA')
    expect(uploaded.ok).toBe(true)
    expect(calls.some((c) => c.action === 'upload_mp3' && c.file_name === 'c.mp3')).toBe(true)
    const published = await admin.publishTrack(2, 'b.mp3')
    expect(published.steps).toEqual({ sheet: 'ok', archive: 'ok', article: 'ok' })
    const unpublished = await admin.unpublishTrack(1, 'a.mp3')
    expect(unpublished.steps.sheet).toBe('ok')
    const regenerated = await admin.regenerateArticle()
    expect(regenerated).toEqual({ ok: true, paragraphs: 42 })
  })

  it('issues and revokes share links with the owner session', async () => {
    routeFetch(okHandler)
    const admin = useMusicAdmin()
    await admin.onCredential(credential({ email: 'owner@example.com' }))
    const issued = await admin.issueShare()
    expect(issued.share_token).toBe('tok')
    const revoked = await admin.revokeShare()
    expect(revoked.revoked).toBe(true)
  })

  it('issues, checks and revokes the Muse key with the owner session', async () => {
    const calls = routeFetch(okHandler)
    const admin = useMusicAdmin()
    await admin.onCredential(credential({ email: 'owner@example.com' }))
    const issued = await admin.issueClaudeKey()
    expect(issued.claude_key).toBe('mk_testkey')
    const status = await admin.claudeKeyStatus()
    expect(status.active).toBe(true)
    const revoked = await admin.revokeClaudeKey()
    expect(revoked.revoked).toBe(true)
    const keyCalls = calls.filter((c) => c.action.includes('claude_key'))
    expect(keyCalls.map((c) => c.action)).toEqual([
      'issue_claude_key', 'claude_key_status', 'revoke_claude_key',
    ])
    expect(keyCalls.every((c) => c.session_token === 'sess-token')).toBe(true)
  })

  it('defaults tracks and meta when the response omits them', async () => {
    routeFetch((body) => {
      if (body.action === 'list_tracks') return { ok: true }
      return okHandler(body)
    })
    const admin = useMusicAdmin()
    await admin.onCredential(credential({ email: 'owner@example.com' }))
    expect(admin.tracks.value).toEqual([])
    expect(admin.meta.value).toEqual({})
    expect(admin.listStatus.value).toBe('0曲')
  })

  it('leaves meta unchanged when an update fails', async () => {
    routeFetch((body) => {
      if (body.action === 'update_meta') return { ok: false, error: 'nope' }
      return okHandler(body)
    })
    const admin = useMusicAdmin()
    await admin.onCredential(credential({ email: 'owner@example.com' }))
    const res = await admin.updateMeta({ intro: '変わらない' })
    expect(res.ok).toBe(false)
    expect(admin.meta.value.intro).toBe('導入')
  })

  it('keeps the badge unknown when a check answers without ok', async () => {
    routeFetch((body) => {
      if (body.action === 'check_archive') return { ok: false, error: 'nope' }
      return okHandler(body)
    })
    const admin = useMusicAdmin()
    await admin.onCredential(credential({ email: 'owner@example.com' }))
    expect(admin.archive.value).toEqual({})
  })

  it('does not reload after a failed create', async () => {
    const calls = routeFetch((body) => {
      if (body.action === 'create_track') return { ok: false, error: 'duplicate' }
      return okHandler(body)
    })
    const admin = useMusicAdmin()
    await admin.onCredential(credential({ email: 'owner@example.com' }))
    const before = calls.filter((c) => c.action === 'list_tracks').length
    const res = await admin.createTrack({ file: 'a.mp3' })
    expect(res.ok).toBe(false)
    expect(calls.filter((c) => c.action === 'list_tracks').length).toBe(before)
  })

  it('reloads through the reload helper', async () => {
    const calls = routeFetch(okHandler)
    const admin = useMusicAdmin()
    await admin.onCredential(credential({ email: 'owner@example.com' }))
    const before = calls.filter((c) => c.action === 'list_tracks').length
    await admin.reload()
    expect(calls.filter((c) => c.action === 'list_tracks').length).toBe(before + 1)
  })

  it('keeps the badge unknown when a check fails at the transport level', async () => {
    let count = 0
    vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
      const body = JSON.parse(opts.body)
      if (body.action === 'check_archive') throw new Error('offline')
      count += 1
      return { json: async () => okHandler(body) }
    }))
    const admin = useMusicAdmin()
    await admin.onCredential(credential({ email: 'owner@example.com' }))
    expect(admin.archive.value).toEqual({})
    expect(count).toBeGreaterThan(0)
  })
})
