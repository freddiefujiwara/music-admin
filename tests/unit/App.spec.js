import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../src/App.vue'

const toBase64Url = (obj) =>
  Buffer.from(JSON.stringify(obj))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

const credential = (payload) => `${toBase64Url({ alg: 'RS256' })}.${toBase64Url(payload)}.sig`

const TRACKS = [
  {
    row: 1, file: 'a.mp3', title: '曲A', description: '説明A', instagram: '',
    suno: 'https://suno/a', youtube: '', publishedAt: '2026-11-13',
    durationSec: 100, lyrics: '歌詞A', sort: 1, published: true,
  },
  {
    row: 2, file: 'b.mp3', title: '曲B', description: '', instagram: '',
    suno: 'https://suno/b', youtube: '', publishedAt: '2026-11-07',
    durationSec: 120, lyrics: '', sort: 2, published: false,
  },
]
const META = { tags: '音楽、川口', suno_profile: 'https://suno.com/@x', intro: '導入文', outro: '締め' }

let calls
let handler
let gisCallback
let wrapper

const defaultHandler = (body) => {
  if (body.action === 'exchange_session') {
    return { ok: true, session_token: 'sess-token', expires_at: '2026-12-15T00:00:00.000Z' }
  }
  if (body.action === 'list_tracks') {
    return {
      ok: true, tracks: TRACKS, meta: META,
      ...(body.share_token ? { _share: { expires_at: '2026-12-15T00:00:00.000Z' } } : {}),
    }
  }
  if (body.action === 'check_archive') {
    return body.file === 'a.mp3'
      ? { ok: true, file: body.file, exists: true, size: 111 }
      : { ok: true, file: body.file, exists: false }
  }
  if (body.action === 'publish_track') {
    return { ok: true, file: body.file, steps: { sheet: 'ok', archive: 'skipped_not_configured', article: 'ok' } }
  }
  if (body.action === 'unpublish_track') {
    return { ok: true, file: body.file, steps: { sheet: 'ok', article: 'ok' } }
  }
  if (body.action === 'issue_share') {
    return { ok: true, share_token: 'sharetoken123', issued_at: '2026-11-15T00:00:00.000Z', expires_at: '2026-12-15T00:00:00.000Z', ttl_seconds: 2592000 }
  }
  if (body.action === 'revoke_share') return { ok: true, revoked: true }
  if (body.action === 'regenerate_article') return { ok: true, paragraphs: 42 }
  return { ok: true, row: body.row || 3 }
}

const mountApp = async (hash = '') => {
  window.location.hash = hash
  wrapper = mount(App, { attachTo: document.body })
  await flushPromises()
  window.dispatchEvent(new Event('load'))
  await flushPromises()
  return wrapper
}

const signIn = async () => {
  gisCallback({ credential: credential({ email: 'owner@example.com' }) })
  await flushPromises()
}

const tabButton = (label) =>
  wrapper.findAll('.main-tab').find((b) => b.text() === label)

beforeEach(() => {
  calls = []
  handler = defaultHandler
  gisCallback = null
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, opts) => {
      const body = JSON.parse(opts.body)
      calls.push(body)
      return { json: async () => handler(body) }
    }),
  )
  window.google = {
    accounts: {
      id: {
        initialize: vi.fn((opts) => { gisCallback = opts.callback }),
        renderButton: vi.fn(),
        disableAutoSelect: vi.fn(),
      },
    },
  }
  window.confirm = vi.fn(() => true)
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  vi.unstubAllGlobals()
})

describe('App', () => {
  it('shows the sign-in gate first', async () => {
    await mountApp()
    expect(wrapper.text()).toContain('川口の歌 管理')
    expect(wrapper.text()).toContain('Googleログインが必要です')
    expect(window.google.accounts.id.initialize).toHaveBeenCalled()
    expect(window.google.accounts.id.renderButton).toHaveBeenCalled()
  })

  it('lists tracks with publish state and IA badges after sign-in', async () => {
    await mountApp()
    await signIn()
    const text = wrapper.text()
    expect(text).toContain('曲A')
    expect(text).toContain('曲B')
    expect(text).toContain('公開中')
    expect(text).toContain('下書き')
    expect(text).toContain('IA あり')
    expect(text).toContain('IA なし')
    expect(text).toContain('2曲')
    expect(text).toContain('owner@example.com')
  })

  it('publishes a draft from the list and reports the steps', async () => {
    await mountApp()
    await signIn()
    const publishButton = wrapper.findAll('button').find((b) => b.text() === '公開する')
    await publishButton.trigger('click')
    await flushPromises()
    expect(calls.some((c) => c.action === 'publish_track' && c.row === 2 && c.file === 'b.mp3')).toBe(true)
    expect(wrapper.text()).toContain('「曲B」を公開しました')
    expect(wrapper.text()).toContain('IA: スキップ（キー未設定）')
  })

  it('unpublishes a published track from the list', async () => {
    await mountApp()
    await signIn()
    const button = wrapper.findAll('button').find((b) => b.text() === '公開をやめる')
    await button.trigger('click')
    await flushPromises()
    expect(calls.some((c) => c.action === 'unpublish_track' && c.row === 1)).toBe(true)
    expect(wrapper.text()).toContain('「曲A」の公開をやめました')
  })

  it('deletes a track after confirmation', async () => {
    await mountApp()
    await signIn()
    const deleteButtons = wrapper.findAll('button[aria-label="削除"]')
    await deleteButtons[0].trigger('click')
    await flushPromises()
    expect(window.confirm).toHaveBeenCalled()
    expect(calls.some((c) => c.action === 'delete_track' && c.row === 1 && c.file === 'a.mp3')).toBe(true)
    expect(wrapper.text()).toContain('削除しました')
  })

  it('does not delete when the confirmation is declined', async () => {
    window.confirm = vi.fn(() => false)
    await mountApp()
    await signIn()
    await wrapper.findAll('button[aria-label="削除"]')[0].trigger('click')
    await flushPromises()
    expect(calls.some((c) => c.action === 'delete_track')).toBe(false)
  })

  it('creates a track from the form', async () => {
    await mountApp()
    await signIn()
    await tabButton('登録').trigger('click')
    await wrapper.find('#f-file').setValue('c-song.mp3')
    expect(wrapper.text()).toContain('freddiefujiwara-c-song')
    await wrapper.find('#f-title').setValue('曲C')
    await wrapper.find('#f-suno').setValue('https://suno/c')
    const submit = wrapper.findAll('button').find((b) => b.text() === '登録する')
    await submit.trigger('click')
    await flushPromises()
    const create = calls.find((c) => c.action === 'create_track')
    expect(create.track.file).toBe('c-song.mp3')
    expect(create.track.title).toBe('曲C')
    expect(wrapper.text()).toContain('登録しました')
  })

  it('rejects an invalid file name in the form', async () => {
    await mountApp()
    await signIn()
    await tabButton('登録').trigger('click')
    await wrapper.find('#f-file').setValue('Bad Name.mp3')
    await wrapper.find('#f-title').setValue('曲C')
    const submit = wrapper.findAll('button').find((b) => b.text() === '登録する')
    await submit.trigger('click')
    await flushPromises()
    expect(calls.some((c) => c.action === 'create_track')).toBe(false)
    expect(wrapper.text()).toContain('ローマ字スラッグ')
  })

  it('uploads the chosen MP3 before saving the row', async () => {
    await mountApp()
    await signIn()
    await tabButton('登録').trigger('click')
    await wrapper.find('#f-file').setValue('c-song.mp3')
    await wrapper.find('#f-title').setValue('曲C')
    const file = new File([new Uint8Array([1, 2, 3])], 'c-song.mp3', { type: 'audio/mpeg' })
    const input = wrapper.find('#f-mp3')
    Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
    await input.trigger('change')
    await flushPromises()
    const submit = wrapper.findAll('button').find((b) => b.text() === '登録する')
    await submit.trigger('click')
    // fileToBase64 goes through the real FileReader, which finishes
    // on a macrotask; wait for the save to land instead of flushing.
    await vi.waitFor(() => {
      expect(calls.some((c) => c.action === 'create_track')).toBe(true)
    })
    const uploadIndex = calls.findIndex((c) => c.action === 'upload_mp3')
    const createIndex = calls.findIndex((c) => c.action === 'create_track')
    expect(uploadIndex).toBeGreaterThanOrEqual(0)
    expect(calls[uploadIndex].file_name).toBe('c-song.mp3')
    expect(calls[uploadIndex].data_base64).toBe(Buffer.from([1, 2, 3]).toString('base64'))
    expect(createIndex).toBeGreaterThan(uploadIndex)
  })

  it('edits a track from the list, with the file name locked', async () => {
    await mountApp()
    await signIn()
    await wrapper.findAll('button[aria-label="編集"]')[1].trigger('click')
    await flushPromises()
    expect(wrapper.find('#f-file').element.disabled).toBe(true)
    expect(wrapper.find('#f-title').element.value).toBe('曲B')
    await wrapper.find('#f-title').setValue('曲B改')
    const submit = wrapper.findAll('button').find((b) => b.text() === '更新する')
    await submit.trigger('click')
    await flushPromises()
    const update = calls.find((c) => c.action === 'update_track')
    expect(update.row).toBe(2)
    expect(update.file).toBe('b.mp3')
    expect(update.track.title).toBe('曲B改')
    expect(wrapper.text()).toContain('更新しました')
  })

  it('cancels an edit back to the list', async () => {
    await mountApp()
    await signIn()
    await wrapper.findAll('button[aria-label="編集"]')[0].trigger('click')
    await flushPromises()
    const cancel = wrapper.findAll('button').find((b) => b.text() === '編集をやめる')
    await cancel.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('登録中の曲')
  })

  it('edits the meta and regenerates the article', async () => {
    await mountApp()
    await signIn()
    await tabButton('メタ情報').trigger('click')
    expect(wrapper.find('#m-tags').element.value).toBe('音楽、川口')
    await wrapper.find('#m-intro').setValue('新しい導入文')
    const save = wrapper.findAll('button').find((b) => b.text() === '保存する')
    await save.trigger('click')
    await flushPromises()
    const update = calls.find((c) => c.action === 'update_meta')
    expect(update.meta.intro).toBe('新しい導入文')
    expect(wrapper.text()).toContain('保存しました')
    const regen = wrapper.findAll('button').find((b) => b.text() === '記事を再生成')
    await regen.trigger('click')
    await flushPromises()
    expect(calls.some((c) => c.action === 'regenerate_article')).toBe(true)
    expect(wrapper.text()).toContain('記事を再生成しました（42 段落）')
  })

  it('issues, copies and revokes a share link', async () => {
    await mountApp()
    await signIn()
    await tabButton('共有').trigger('click')
    const issue = wrapper.findAll('button').find((b) => b.text() === '1か月間有効なURLを発行')
    await issue.trigger('click')
    await flushPromises()
    const input = wrapper.find('.share-url-input')
    expect(input.element.value).toContain('#sharetoken123')
    Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => {}) } })
    const copy = wrapper.findAll('button').find((b) => b.text() === 'URLをコピー')
    await copy.trigger('click')
    await flushPromises()
    expect(navigator.clipboard.writeText).toHaveBeenCalled()
    const revoke = wrapper.findAll('button').find((b) => b.text() === '今すぐ無効化する')
    await revoke.trigger('click')
    await flushPromises()
    expect(calls.some((c) => c.action === 'revoke_share')).toBe(true)
  })

  it('enters through a share link without the sign-in gate', async () => {
    await mountApp('#share=share-tok')
    expect(wrapper.text()).toContain('曲A')
    expect(wrapper.text()).toContain('一時アクセスリンクで利用中')
    expect(tabButton('共有')).toBeUndefined()
  })

  it('shows the expired-link state when the share session is dead', async () => {
    handler = (body) => {
      if (body.action === 'list_tracks') {
        return { ok: false, status: 401, error: 'share session expired or invalid' }
      }
      return defaultHandler(body)
    }
    await mountApp('#share=old-tok')
    expect(wrapper.text()).toContain('リンクの有効期限が切れています')
  })

  it('logs out back to the gate', async () => {
    await mountApp()
    await signIn()
    const logout = wrapper.findAll('button').find((b) => b.text() === 'ログアウト')
    await logout.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Googleログインが必要です')
    expect(window.google.accounts.id.disableAutoSelect).toHaveBeenCalled()
  })

  it('toggles the theme', async () => {
    await mountApp()
    const toggle = wrapper.findAll('button').find((b) => b.text() === 'ライト' || b.text() === 'ダーク')
    await toggle.trigger('click')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    expect(localStorage.getItem('music-admin-theme')).toBe('light')
  })

  it('restores a saved session instead of showing the gate', async () => {
    localStorage.setItem('music-admin-session-token', 'sess-token')
    localStorage.setItem('music-admin-session-email', 'owner@example.com')
    await mountApp()
    expect(wrapper.text()).toContain('曲A')
    expect(window.google.accounts.id.initialize).not.toHaveBeenCalled()
  })

  it('shows the loading row while the list is in flight', async () => {
    let resolveList
    handler = (body) => {
      if (body.action === 'list_tracks') {
        return new Promise((resolve) => { resolveList = resolve })
      }
      return defaultHandler(body)
    }
    localStorage.setItem('music-admin-session-token', 'sess-token')
    window.location.hash = ''
    wrapper = mount(App, { attachTo: document.body })
    await flushPromises()
    expect(wrapper.text()).toContain('読み込み中…')
    resolveList({ ok: true, tracks: TRACKS, meta: META })
    await flushPromises()
    expect(wrapper.text()).toContain('曲A')
  })

  it('renders a track without a Suno URL', async () => {
    handler = (body) => {
      if (body.action === 'list_tracks') {
        return { ok: true, tracks: [{ ...TRACKS[0], suno: '' }], meta: META }
      }
      return defaultHandler(body)
    }
    localStorage.setItem('music-admin-session-token', 'sess-token')
    await mountApp()
    expect(wrapper.text()).toContain('曲A')
    expect(wrapper.text()).not.toContain('https://suno/a')
  })

  it('reloads the list from the reload button', async () => {
    await mountApp()
    await signIn()
    const before = calls.filter((c) => c.action === 'list_tracks').length
    const reload = wrapper.findAll('button').find((b) => b.text() === '再読み込み')
    await reload.trigger('click')
    await flushPromises()
    expect(calls.filter((c) => c.action === 'list_tracks').length).toBe(before + 1)
  })

  it('requires a title in the form', async () => {
    await mountApp()
    await signIn()
    await tabButton('登録').trigger('click')
    await wrapper.find('#f-file').setValue('c-song.mp3')
    const submit = wrapper.findAll('button').find((b) => b.text() === '登録する')
    await submit.trigger('click')
    await flushPromises()
    expect(calls.some((c) => c.action === 'create_track')).toBe(false)
    expect(wrapper.text()).toContain('曲名を入力してください')
  })

  it('reports a create failure with and without an error message', async () => {
    handler = (body) => {
      if (body.action === 'create_track') return { ok: false, error: 'track already exists: c.mp3' }
      return defaultHandler(body)
    }
    await mountApp()
    await signIn()
    await tabButton('登録').trigger('click')
    await wrapper.find('#f-file').setValue('c.mp3')
    await wrapper.find('#f-title').setValue('曲C')
    await wrapper.findAll('button').find((b) => b.text() === '登録する').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('track already exists: c.mp3')

    handler = (body) => {
      if (body.action === 'create_track') return { ok: false }
      return defaultHandler(body)
    }
    await wrapper.findAll('button').find((b) => b.text() === '登録する').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('保存に失敗しました')
  })

  it('reports a transport failure while saving as a generic failure', async () => {
    handler = (body) => {
      if (body.action === 'create_track') throw new Error('offline')
      return defaultHandler(body)
    }
    await mountApp()
    await signIn()
    await tabButton('登録').trigger('click')
    await wrapper.find('#f-file').setValue('c.mp3')
    await wrapper.find('#f-title').setValue('曲C')
    await wrapper.findAll('button').find((b) => b.text() === '登録する').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('保存に失敗しました')
  })

  it('rejects an oversized MP3 before uploading', async () => {
    await mountApp()
    await signIn()
    await tabButton('登録').trigger('click')
    await wrapper.find('#f-file').setValue('big.mp3')
    await wrapper.find('#f-title').setValue('大きな曲')
    const input = wrapper.find('#f-mp3')
    Object.defineProperty(input.element, 'files', {
      value: [{ name: 'big.mp3', size: 10 * 1024 * 1024 + 1 }],
      configurable: true,
    })
    await input.trigger('change')
    await flushPromises()
    await wrapper.findAll('button').find((b) => b.text() === '登録する').trigger('click')
    await flushPromises()
    expect(calls.some((c) => c.action === 'upload_mp3')).toBe(false)
    expect(wrapper.text()).toContain('MP3 が上限の 10MB を超えています')
  })

  it('reports an upload failure and does not save the row', async () => {
    handler = (body) => {
      if (body.action === 'upload_mp3') return { ok: false, error: 'invalid base64 data' }
      return defaultHandler(body)
    }
    await mountApp()
    await signIn()
    await tabButton('登録').trigger('click')
    await wrapper.find('#f-file').setValue('c-song.mp3')
    await wrapper.find('#f-title').setValue('曲C')
    const file = new File([new Uint8Array([1])], 'c-song.mp3', { type: 'audio/mpeg' })
    const input = wrapper.find('#f-mp3')
    Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
    await input.trigger('change')
    await flushPromises()
    await wrapper.findAll('button').find((b) => b.text() === '登録する').trigger('click')
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('invalid base64 data')
    })
    expect(calls.some((c) => c.action === 'create_track')).toBe(false)
  })

  it('fills duration_sec from the measured MP3 length', async () => {
    const listeners = {}
    class FakeAudio {
      addEventListener(name, fn) { listeners[name] = fn }
      set src(_value) {
        this.duration = 95.4
        queueMicrotask(() => listeners.loadedmetadata())
      }
    }
    vi.stubGlobal('Audio', FakeAudio)
    URL.createObjectURL = vi.fn(() => 'blob:fake')
    URL.revokeObjectURL = vi.fn()
    await mountApp()
    await signIn()
    await tabButton('登録').trigger('click')
    const file = new File([new Uint8Array([1])], 'c-song.mp3', { type: 'audio/mpeg' })
    const input = wrapper.find('#f-mp3')
    Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
    await input.trigger('change')
    await flushPromises()
    const durationInput = wrapper.findAll('input[type="number"]')[0]
    expect(durationInput.element.value).toBe('95')
    // Clearing the picker clears the selection again.
    Object.defineProperty(input.element, 'files', { value: [], configurable: true })
    await input.trigger('change')
    await flushPromises()
    delete URL.createObjectURL
    delete URL.revokeObjectURL
  })

  it('deletes from the edit form, and reports a failed delete there', async () => {
    await mountApp()
    await signIn()
    await wrapper.findAll('button[aria-label="編集"]')[0].trigger('click')
    await flushPromises()
    await wrapper.findAll('button').find((b) => b.text() === '削除する').trigger('click')
    await flushPromises()
    expect(calls.some((c) => c.action === 'delete_track' && c.row === 1)).toBe(true)
    expect(wrapper.text()).toContain('削除しました')

    handler = (body) => {
      if (body.action === 'delete_track') return { ok: false, error: 'track row not found: 1' }
      return defaultHandler(body)
    }
    await wrapper.findAll('button[aria-label="編集"]')[0].trigger('click')
    await flushPromises()
    await wrapper.findAll('button').find((b) => b.text() === '削除する').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('track row not found: 1')
  })

  it('does not delete from the form when the confirmation is declined', async () => {
    window.confirm = vi.fn(() => false)
    await mountApp()
    await signIn()
    await wrapper.findAll('button[aria-label="編集"]')[0].trigger('click')
    await flushPromises()
    await wrapper.findAll('button').find((b) => b.text() === '削除する').trigger('click')
    await flushPromises()
    expect(calls.some((c) => c.action === 'delete_track')).toBe(false)
  })

  it('reports publish and unpublish failures', async () => {
    handler = (body) => {
      if (body.action === 'publish_track') return { ok: false, error: 'cannot publish: missing suno' }
      if (body.action === 'unpublish_track') return { ok: false }
      return defaultHandler(body)
    }
    await mountApp()
    await signIn()
    await wrapper.findAll('button').find((b) => b.text() === '公開する').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('cannot publish: missing suno')
    await wrapper.findAll('button').find((b) => b.text() === '公開をやめる').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('公開をやめるのに失敗しました')
  })

  it('reports a failed delete in the list with the server error', async () => {
    handler = (body) => {
      if (body.action === 'delete_track') return { ok: false, error: 'row gone' }
      return defaultHandler(body)
    }
    await mountApp()
    await signIn()
    await wrapper.findAll('button[aria-label="削除"]')[0].trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('row gone')
  })

  it('opens the meta tab with blank fields when meta is missing', async () => {
    handler = (body) => {
      if (body.action === 'list_tracks') return { ok: true, tracks: TRACKS, meta: {} }
      return defaultHandler(body)
    }
    await mountApp()
    await signIn()
    await tabButton('メタ情報').trigger('click')
    expect(wrapper.find('#m-tags').element.value).toBe('')
    expect(wrapper.find('#m-intro').element.value).toBe('')
  })

  it('reports meta save failures and regeneration failures', async () => {
    handler = (body) => {
      if (body.action === 'update_meta') return { ok: false, error: 'meta boom' }
      if (body.action === 'regenerate_article') return { ok: false }
      return defaultHandler(body)
    }
    await mountApp()
    await signIn()
    await tabButton('メタ情報').trigger('click')
    await wrapper.findAll('button').find((b) => b.text() === '保存する').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('meta boom')
    await wrapper.findAll('button').find((b) => b.text() === '記事を再生成').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('再生成に失敗しました')

    handler = (body) => {
      if (body.action === 'update_meta') throw new Error('offline')
      if (body.action === 'regenerate_article') throw new Error('offline')
      return defaultHandler(body)
    }
    await wrapper.findAll('button').find((b) => b.text() === '保存する').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('保存に失敗しました')
    await wrapper.findAll('button').find((b) => b.text() === '記事を再生成').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('再生成に失敗しました')
  })

  it('reports share issue and revoke failures', async () => {
    handler = (body) => {
      if (body.action === 'issue_share') return { ok: false, error: 'issue boom' }
      return defaultHandler(body)
    }
    await mountApp()
    await signIn()
    await tabButton('共有').trigger('click')
    await wrapper.findAll('button').find((b) => b.text() === '1か月間有効なURLを発行').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('issue boom')

    handler = (body) => {
      if (body.action === 'issue_share') throw new Error('offline')
      return defaultHandler(body)
    }
    await wrapper.findAll('button').find((b) => b.text() === '1か月間有効なURLを発行').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('発行に失敗しました')

    handler = defaultHandler
    await wrapper.findAll('button').find((b) => b.text() === '1か月間有効なURLを発行').trigger('click')
    await flushPromises()
    expect(wrapper.find('.share-url-input').exists()).toBe(true)
    handler = (body) => {
      if (body.action === 'revoke_share') return { ok: false, error: 'revoke boom' }
      return defaultHandler(body)
    }
    await wrapper.findAll('button').find((b) => b.text() === '今すぐ無効化する').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('revoke boom')
    handler = (body) => {
      if (body.action === 'revoke_share') throw new Error('offline')
      return defaultHandler(body)
    }
    await wrapper.findAll('button').find((b) => b.text() === '今すぐ無効化する').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('無効化に失敗しました')
  })

  it('reports a clipboard failure when copying the share URL', async () => {
    await mountApp()
    await signIn()
    await tabButton('共有').trigger('click')
    await wrapper.findAll('button').find((b) => b.text() === '1か月間有効なURLを発行').trigger('click')
    await flushPromises()
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn(async () => { throw new Error('denied') }) },
    })
    await wrapper.findAll('button').find((b) => b.text() === 'URLをコピー').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('コピーに失敗しました')
  })

  it('reissues a share link from the share tab', async () => {
    await mountApp()
    await signIn()
    await tabButton('共有').trigger('click')
    await wrapper.findAll('button').find((b) => b.text() === '1か月間有効なURLを発行').trigger('click')
    await flushPromises()
    await wrapper.findAll('button').find((b) => b.text() === '新しいURLを発行し直す').trigger('click')
    await flushPromises()
    expect(calls.filter((c) => c.action === 'issue_share')).toHaveLength(2)
  })

  it('mounts without the Google script and skips the button render', async () => {
    delete window.google
    await mountApp()
    expect(wrapper.text()).toContain('Googleログインが必要です')
  })

  it('switches back to the list tab', async () => {
    await mountApp()
    await signIn()
    await tabButton('登録').trigger('click')
    expect(wrapper.find('#f-file').exists()).toBe(true)
    await tabButton('一覧').trigger('click')
    expect(wrapper.find('#f-file').exists()).toBe(false)
    expect(wrapper.text()).toContain('曲A')
  })

  it('sends every form field on save, including the meta fields', async () => {
    await mountApp()
    await signIn()
    await tabButton('登録').trigger('click')
    await wrapper.find('#f-file').setValue('all-fields.mp3')
    await wrapper.find('#f-title').setValue('全部入り')
    await wrapper.find('#f-description').setValue('説明文')
    await wrapper.find('#f-instagram').setValue('https://instagram/x')
    await wrapper.find('#f-suno').setValue('https://suno/x')
    await wrapper.find('#f-youtube').setValue('https://youtube/x')
    const numbers = wrapper.findAll('input[type="number"]')
    await wrapper.find('input[type="date"]').setValue('2026-11-20')
    await numbers[0].setValue('88')
    await numbers[1].setValue('4')
    await wrapper.find('#f-lyrics').setValue('歌詞です')
    await wrapper.find('input[type="checkbox"]').setValue(true)
    await wrapper.findAll('button').find((b) => b.text() === '登録する').trigger('click')
    await flushPromises()
    const create = calls.find((c) => c.action === 'create_track')
    expect(create.track).toMatchObject({
      file: 'all-fields.mp3',
      title: '全部入り',
      description: '説明文',
      instagram: 'https://instagram/x',
      suno: 'https://suno/x',
      youtube: 'https://youtube/x',
      published_at: '2026-11-20',
      duration_sec: 88,
      sort: 4,
      lyrics: '歌詞です',
      published: true,
    })
    await tabButton('メタ情報').trigger('click')
    await wrapper.find('#m-tags').setValue('音楽、川口')
    await wrapper.find('#m-profile').setValue('https://suno.com/@freddiefujiwara')
    await wrapper.find('#m-outro').setValue('締めです')
    await wrapper.findAll('button').find((b) => b.text() === '保存する').trigger('click')
    await flushPromises()
    const meta = calls.find((c) => c.action === 'update_meta')
    expect(meta.meta).toMatchObject({
      tags: '音楽、川口',
      suno_profile: 'https://suno.com/@freddiefujiwara',
      outro: '締めです',
    })
  })

  it('falls back to generic messages when failures carry no error text', async () => {
    handler = (body) => {
      if (['upload_mp3', 'publish_track', 'update_meta', 'issue_share'].includes(body.action)) {
        return { ok: false }
      }
      return defaultHandler(body)
    }
    await mountApp()
    await signIn()
    // publish without an error text
    await wrapper.findAll('button').find((b) => b.text() === '公開する').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('公開に失敗しました')
    // upload without an error text
    await tabButton('登録').trigger('click')
    await wrapper.find('#f-file').setValue('c-song.mp3')
    await wrapper.find('#f-title').setValue('曲C')
    const file = new File([new Uint8Array([1])], 'c-song.mp3', { type: 'audio/mpeg' })
    const input = wrapper.find('#f-mp3')
    Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
    await input.trigger('change')
    await flushPromises()
    await wrapper.findAll('button').find((b) => b.text() === '登録する').trigger('click')
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('アップロードに失敗しました')
    })
    // meta save without an error text
    await tabButton('メタ情報').trigger('click')
    await wrapper.findAll('button').find((b) => b.text() === '保存する').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('保存に失敗しました')
    // share issue without an error text
    await tabButton('共有').trigger('click')
    await wrapper.findAll('button').find((b) => b.text() === '1か月間有効なURLを発行').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('発行に失敗しました')
  })

  it('falls back to generic messages for deletes and revoke without error text', async () => {
    handler = (body) => {
      if (body.action === 'delete_track' || body.action === 'revoke_share') return { ok: false }
      return defaultHandler(body)
    }
    await mountApp()
    await signIn()
    await wrapper.findAll('button[aria-label="削除"]')[0].trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('削除に失敗しました')
    // form delete
    await wrapper.findAll('button[aria-label="編集"]')[0].trigger('click')
    await flushPromises()
    await wrapper.findAll('button').find((b) => b.text() === '削除する').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('削除に失敗しました')
    await wrapper.findAll('button').find((b) => b.text() === '編集をやめる').trigger('click')
    await tabButton('共有').trigger('click')
    await wrapper.findAll('button').find((b) => b.text() === '1か月間有効なURLを発行').trigger('click')
    await flushPromises()
    await wrapper.findAll('button').find((b) => b.text() === '今すぐ無効化する').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('無効化に失敗しました')
  })

  it('logs out even when the Google script is absent', async () => {
    await mountApp()
    await signIn()
    delete window.google
    await wrapper.findAll('button').find((b) => b.text() === 'ログアウト').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Googleログインが必要です')
  })
})
