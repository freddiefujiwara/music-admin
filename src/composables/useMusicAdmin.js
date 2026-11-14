import { ref } from 'vue'
import { API_URL } from '../constants/app.js'
import { callApi } from '../api.js'
import { decodeJwtPayload } from '../auth.js'
import { parseShareToken } from '../share.js'
import {
  loadSavedSessionToken,
  loadSavedSessionEmail,
  saveSessionToken,
  saveSessionEmail,
  clearSavedSession,
} from '../session.js'

// State and API orchestration for the music admin page, mirroring
// the list-of-stuff admin: the owner's session token (exchanged
// from the Google ID token at sign-in) or a share token from a
// temporary access link authenticates every call, and a
// share-auth failure moves the page to the expired-link state.
export function useMusicAdmin() {
  const phase = ref('gate') // 'gate' | 'ready' | 'share-expired'
  const email = ref('')
  const isShareSession = ref(false)
  const shareExpiresAt = ref('')
  const tracks = ref([])
  const meta = ref({})
  const archive = ref({}) // file -> { exists, size? } from check_archive
  const loading = ref(false)
  const listStatus = ref('')
  const gateError = ref('')

  let sessionToken = null
  let shareToken = null

  const isShareError = (res) =>
    Boolean(
      shareToken &&
        res &&
        typeof res.error === 'string' &&
        res.error.includes('share session'),
    )

  const isSessionError = (res) =>
    Boolean(sessionToken && res && res.error === 'session expired or invalid')

  const api = async (body) => {
    const res = shareToken
      ? await callApi(API_URL, null, { ...body, share_token: shareToken })
      : await callApi(API_URL, null, { ...body, session_token: sessionToken })
    if (isShareError(res)) {
      phase.value = 'share-expired'
    } else if (isSessionError(res)) {
      // The saved owner session is dead (expired or revoked): drop
      // it and return to the sign-in gate.
      sessionToken = null
      clearSavedSession()
      phase.value = 'gate'
    } else if (res && res._share) {
      shareExpiresAt.value = res._share.expires_at
    }
    return res
  }

  // Reads go through apiRead: when a call fails at the transport
  // level (the fetch rejects, or the response is not JSON — the
  // GAS redirect chain drops out now and then, especially on
  // mobile networks), retry up to twice before surfacing the
  // failure. Business errors ({ ok: false }) are definitive and
  // return at once; mutations are never retried, because a retry
  // could apply a change whose response was lost.
  const RETRY_DELAYS_MS = [500, 1500]
  const apiRead = async (body) => {
    let lastError
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      try {
        return await api(body)
      } catch (err) {
        lastError = err
        if (attempt < RETRY_DELAYS_MS.length) {
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]))
        }
      }
    }
    throw lastError
  }

  // Load the full track list (unpublished rows included) and the
  // article meta. IA badges are refreshed separately so a slow
  // archive.org cannot hold up the list itself.
  const loadTracks = async () => {
    loading.value = true
    listStatus.value = ''
    try {
      const res = await apiRead({ action: 'list_tracks' })
      if (!res.ok) {
        listStatus.value = res.error || '読み込みに失敗しました'
        return res
      }
      tracks.value = res.tracks || []
      meta.value = res.meta || {}
      listStatus.value = `${tracks.value.length}曲`
      return res
    } catch (err) {
      listStatus.value = '読み込みに失敗しました'
      return { ok: false, error: String(err) }
    } finally {
      loading.value = false
    }
  }

  // Ask the API which of the listed files actually exist on
  // Internet Archive, for the list's IA badges. Best-effort: a
  // failed check leaves the badge at 未確認.
  const refreshArchiveBadges = async () => {
    const results = {}
    for (const track of tracks.value) {
      try {
        const res = await apiRead({ action: 'check_archive', file: track.file })
        if (res.ok) {
          results[track.file] = { exists: Boolean(res.exists), size: res.size }
        }
      } catch {
        // Leave this file unchecked.
      }
    }
    archive.value = { ...archive.value, ...results }
    return results
  }

  const reload = async () => {
    await loadTracks()
    await refreshArchiveBadges()
  }

  // Start from a #share= link: the token replaces the sign-in gate.
  const initFromHash = async (hash) => {
    const token = parseShareToken(hash)
    if (!token) {
      return false
    }
    shareToken = token
    isShareSession.value = true
    phase.value = 'ready'
    await loadTracks()
    await refreshArchiveBadges()
    return true
  }

  const onCredential = async (credential) => {
    // No client-side authorization gate: music-gas verifies the
    // token and the account, and rejects unauthorized calls
    // server-side.
    try {
      email.value = decodeJwtPayload(credential).email || ''
    } catch {
      email.value = ''
    }
    gateError.value = ''
    // Exchange the (1-hour) ID token for a 30-day owner session
    // and save that, so the next visit restores the session
    // instead of starting at the gate.
    let res
    try {
      res = await callApi(API_URL, credential, { action: 'exchange_session' })
    } catch {
      res = null
    }
    if (!res || !res.ok || !res.session_token) {
      phase.value = 'gate'
      gateError.value = 'このアカウントでは利用できません'
      return
    }
    sessionToken = res.session_token
    saveSessionToken(sessionToken)
    saveSessionEmail(email.value)
    phase.value = 'ready'
    await loadTracks()
    await refreshArchiveBadges()
  }

  // Restore a saved owner session at boot, without a Google
  // sign-in. Returns false when there is no saved session, or
  // when the saved session turned out to be dead (the load drops
  // back to the gate).
  const restoreSession = async () => {
    const saved = loadSavedSessionToken()
    if (!saved) {
      return false
    }
    sessionToken = saved
    email.value = loadSavedSessionEmail()
    phase.value = 'ready'
    await loadTracks()
    await refreshArchiveBadges()
    return phase.value === 'ready'
  }

  const logout = () => {
    const endingSession = sessionToken
    sessionToken = null
    clearSavedSession()
    if (endingSession) {
      // Revoke the owner session server-side; local logout
      // proceeds regardless of the outcome.
      callApi(API_URL, null, {
        action: 'revoke_session',
        session_token: endingSession,
      }).catch(() => {})
    }
    email.value = ''
    phase.value = 'gate'
  }

  const createTrack = async (payload) => {
    const res = await api({ action: 'create_track', track: payload })
    if (res.ok) {
      await loadTracks()
    }
    return res
  }

  const updateTrack = async (row, file, payload) => {
    const res = await api({ action: 'update_track', row, file, track: payload })
    if (res.ok) {
      await loadTracks()
    }
    return res
  }

  // After a delete the list is always re-read, whatever the
  // outcome, so the screen matches the sheet even when the
  // delete itself failed partway.
  const deleteTrack = async (row, file) => {
    const res = await api({ action: 'delete_track', row, file })
    await loadTracks()
    return res
  }

  const updateMeta = async (nextMeta) => {
    const res = await api({ action: 'update_meta', meta: nextMeta })
    if (res.ok) {
      meta.value = { ...meta.value, ...nextMeta }
    }
    return res
  }

  const uploadMp3 = async (fileName, dataBase64) =>
    api({ action: 'upload_mp3', file_name: fileName, data_base64: dataBase64 })

  // Publish and unpublish return per-step results; the list and
  // the IA badges are refreshed afterwards either way.
  const publishTrack = async (row, file) => {
    const res = await api({ action: 'publish_track', row, file })
    await loadTracks()
    await refreshArchiveBadges()
    return res
  }

  const unpublishTrack = async (row, file) => {
    const res = await api({ action: 'unpublish_track', row, file })
    await loadTracks()
    return res
  }

  const regenerateArticle = async () => api({ action: 'regenerate_article' })

  const issueShare = async () =>
    callApi(API_URL, null, { action: 'issue_share', session_token: sessionToken })

  const revokeShare = async () =>
    callApi(API_URL, null, { action: 'revoke_share', session_token: sessionToken })

  return {
    phase,
    email,
    isShareSession,
    shareExpiresAt,
    tracks,
    meta,
    archive,
    loading,
    listStatus,
    gateError,
    initFromHash,
    onCredential,
    restoreSession,
    logout,
    loadTracks,
    refreshArchiveBadges,
    reload,
    createTrack,
    updateTrack,
    deleteTrack,
    updateMeta,
    uploadMp3,
    publishTrack,
    unpublishTrack,
    regenerateArticle,
    issueShare,
    revokeShare,
  }
}
