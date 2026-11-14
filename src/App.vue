<script setup>
import { computed, onMounted, ref } from 'vue'
import { GOOGLE_CLIENT_ID, archiveUrl } from './constants/app.js'
import { useMusicAdmin } from './composables/useMusicAdmin.js'
import {
  archiveBadge,
  archiveBadgeLabel,
  archivePreview,
  claudeKeyView,
  emptyTrack,
  formFromTrack,
  isValidTrackFile,
  publishStepsLabel,
  shareLinkView,
  trackMeta,
  trackPayload,
} from './utils/tracks.js'
import { MAX_MP3_BYTES, fileToBase64, measureDurationSeconds } from './utils/upload.js'
import { THEME_KEY, applyTheme, nextTheme, resolveTheme } from './theme.js'
import {
  formatShareExpiry,
  formatShareRemaining,
  shareSecondsLeft,
} from './share.js'

const admin = useMusicAdmin()
const {
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
} = admin

const tab = ref('list')
const themeButton = ref(null)
const theme = ref(resolveTheme(localStorage.getItem(THEME_KEY)))
const notice = ref('')

const applyCurrentTheme = () => {
  applyTheme(document.documentElement, themeButton.value, theme.value)
}

const toggleTheme = () => {
  theme.value = nextTheme(theme.value)
  localStorage.setItem(THEME_KEY, theme.value)
  applyCurrentTheme()
}

const shareBanner = computed(() => {
  if (!isShareSession.value || !shareExpiresAt.value) {
    return ''
  }
  const remaining = formatShareRemaining(shareSecondsLeft(shareExpiresAt.value, Date.now()))
  return `一時アクセスリンクで利用中（${formatShareExpiry(shareExpiresAt.value)} まで有効、${remaining}）`
})

// --- Track form (登録 tab doubles as the edit form) ---
const form = ref(emptyTrack())
const editingRow = ref(null)
const editingFile = ref('')
const formStatus = ref('')
const saving = ref(false)
const selectedFile = ref(null)
const selectedFileLabel = ref('')

const formTitle = computed(() =>
  editingRow.value === null ? '新しい曲' : '曲を編集',
)

const iaPreview = computed(() => archivePreview(form.value.file))

const openCreate = () => {
  editingRow.value = null
  editingFile.value = ''
  form.value = emptyTrack()
  selectedFile.value = null
  selectedFileLabel.value = ''
  formStatus.value = ''
  tab.value = 'form'
}

const openEdit = (track) => {
  editingRow.value = track.row
  editingFile.value = track.file
  form.value = formFromTrack(track)
  selectedFile.value = null
  selectedFileLabel.value = ''
  formStatus.value = ''
  tab.value = 'form'
}

const cancelEdit = () => {
  editingRow.value = null
  editingFile.value = ''
  form.value = emptyTrack()
  selectedFile.value = null
  selectedFileLabel.value = ''
  formStatus.value = ''
  tab.value = 'list'
}

// Picking an MP3 measures its duration in the browser (Apps
// Script cannot parse MP3s) and fills duration_sec with it.
const onMp3Selected = async (event) => {
  const file = event.target.files && event.target.files[0]
  selectedFile.value = file || null
  selectedFileLabel.value = file ? `${file.name}（${file.size} バイト）` : ''
  if (file) {
    const seconds = await measureDurationSeconds(file)
    if (seconds > 0) {
      form.value.duration_sec = seconds
    }
  }
}

const submit = async () => {
  saving.value = true
  formStatus.value = ''
  try {
    const payload = trackPayload(form.value)
    if (!isValidTrackFile(payload.file)) {
      formStatus.value = 'ファイル名はローマ字スラッグ + .mp3 で入力してください'
      return
    }
    if (!payload.title) {
      formStatus.value = '曲名を入力してください'
      return
    }
    // One save operation: upload the chosen MP3 first (under the
    // form's file name), then write the sheet row.
    if (selectedFile.value) {
      if (selectedFile.value.size > MAX_MP3_BYTES) {
        formStatus.value = 'MP3 が上限の 10MB を超えています'
        return
      }
      const base64 = await fileToBase64(selectedFile.value)
      const uploaded = await admin.uploadMp3(payload.file, base64)
      if (!uploaded.ok) {
        formStatus.value = uploaded.error || 'アップロードに失敗しました'
        return
      }
    }
    const res =
      editingRow.value === null
        ? await admin.createTrack(payload)
        : await admin.updateTrack(editingRow.value, editingFile.value, payload)
    if (res.ok) {
      notice.value = editingRow.value === null ? '登録しました' : '更新しました'
      cancelEdit()
    } else {
      formStatus.value = res.error || '保存に失敗しました'
    }
  } catch {
    formStatus.value = '保存に失敗しました'
  } finally {
    saving.value = false
  }
}

const remove = async (track) => {
  if (!window.confirm(`「${track.title}」を削除しますか？（シートの行だけを削除し、Drive の MP3 と IA のアイテムは残ります）`)) {
    return
  }
  const res = await admin.deleteTrack(track.row, track.file)
  notice.value = res.ok ? '削除しました' : res.error || '削除に失敗しました'
}

const removeFromForm = async () => {
  if (!window.confirm(`「${form.value.title}」を削除しますか？（シートの行だけを削除し、Drive の MP3 と IA のアイテムは残ります）`)) {
    return
  }
  const res = await admin.deleteTrack(editingRow.value, editingFile.value)
  if (res.ok) {
    notice.value = '削除しました'
    cancelEdit()
  } else {
    formStatus.value = res.error || '削除に失敗しました'
  }
}

// --- Publish / unpublish (the chained flow lives in music-gas) ---
const publish = async (track) => {
  notice.value = ''
  const res = await admin.publishTrack(track.row, track.file)
  notice.value = res.ok
    ? `「${track.title}」を公開しました（${publishStepsLabel(res.steps)}）`
    : res.error || '公開に失敗しました'
}

const unpublish = async (track) => {
  notice.value = ''
  const res = await admin.unpublishTrack(track.row, track.file)
  notice.value = res.ok
    ? `「${track.title}」の公開をやめました（${publishStepsLabel(res.steps)}）`
    : res.error || '公開をやめるのに失敗しました'
}

// --- Meta tab ---
const metaForm = ref({ tags: '', suno_profile: '', intro: '', outro: '' })
const metaStatus = ref('')
const metaSaving = ref(false)
const regenerating = ref(false)

const openMeta = () => {
  metaForm.value = {
    tags: meta.value.tags || '',
    suno_profile: meta.value.suno_profile || '',
    intro: meta.value.intro || '',
    outro: meta.value.outro || '',
  }
  metaStatus.value = ''
  tab.value = 'meta'
}

const saveMeta = async () => {
  metaSaving.value = true
  metaStatus.value = ''
  try {
    const res = await admin.updateMeta({ ...metaForm.value })
    metaStatus.value = res.ok ? '保存しました' : res.error || '保存に失敗しました'
  } catch {
    metaStatus.value = '保存に失敗しました'
  } finally {
    metaSaving.value = false
  }
}

const regenerate = async () => {
  regenerating.value = true
  metaStatus.value = ''
  try {
    const res = await admin.regenerateArticle()
    metaStatus.value = res.ok
      ? `記事を再生成しました（${res.paragraphs} 段落）`
      : res.error || '再生成に失敗しました'
  } catch {
    metaStatus.value = '再生成に失敗しました'
  } finally {
    regenerating.value = false
  }
}

// --- Share link management (owner only, same as the other sites) ---
const issuedShare = ref(null)
const shareError = ref('')

const shareView = computed(() =>
  shareLinkView(
    issuedShare.value,
    `${window.location.origin}${import.meta.env.BASE_URL}`,
    Date.now(),
  ),
)
const shareUrl = computed(() => shareView.value.url)
const shareRemaining = computed(() => shareView.value.remaining)
const shareExpires = computed(() => shareView.value.expires)

const issue = async () => {
  shareError.value = ''
  try {
    const res = await admin.issueShare()
    if (res.ok) {
      issuedShare.value = res
    } else {
      shareError.value = res.error || '発行に失敗しました'
    }
  } catch {
    shareError.value = '発行に失敗しました'
  }
}

const revoke = async () => {
  shareError.value = ''
  try {
    const res = await admin.revokeShare()
    if (res.ok) {
      issuedShare.value = null
    } else {
      shareError.value = res.error || '無効化に失敗しました'
    }
  } catch {
    shareError.value = '無効化に失敗しました'
  }
}

const copyShareUrl = async () => {
  try {
    await navigator.clipboard.writeText(shareUrl.value)
  } catch {
    shareError.value = 'コピーに失敗しました'
  }
}

// --- Muse API key management (owner only, in the share tab) ---
const claudeKeyStatusRes = ref(null)
const issuedClaudeKey = ref(null)
const claudeKeyError = ref('')

const claudeKeyViewState = computed(() => claudeKeyView(claudeKeyStatusRes.value, Date.now()))
const claudeKeyActive = computed(() => claudeKeyViewState.value.active)
const claudeKeyRemaining = computed(() => claudeKeyViewState.value.remaining)
const claudeKeyExpires = computed(() => claudeKeyViewState.value.expires)

const refreshClaudeKeyStatus = async () => {
  try {
    const res = await admin.claudeKeyStatus()
    if (res.ok) {
      claudeKeyStatusRes.value = res
    }
  } catch {
    // A failed status read leaves the last known state in place.
  }
}

const openShare = () => {
  tab.value = 'share'
  refreshClaudeKeyStatus()
}

const issueClaudeKey = async () => {
  claudeKeyError.value = ''
  try {
    const res = await admin.issueClaudeKey()
    if (res.ok) {
      issuedClaudeKey.value = res
      claudeKeyStatusRes.value = {
        active: true,
        issued_at: res.issued_at,
        expires_at: res.expires_at,
      }
    } else {
      claudeKeyError.value = res.error || '発行に失敗しました'
    }
  } catch {
    claudeKeyError.value = '発行に失敗しました'
  }
}

const revokeClaudeKey = async () => {
  claudeKeyError.value = ''
  try {
    const res = await admin.revokeClaudeKey()
    if (res.ok) {
      issuedClaudeKey.value = null
      claudeKeyStatusRes.value = { active: false }
    } else {
      claudeKeyError.value = res.error || '無効化に失敗しました'
    }
  } catch {
    claudeKeyError.value = '無効化に失敗しました'
  }
}

const copyClaudeKey = async () => {
  try {
    await navigator.clipboard.writeText(issuedClaudeKey.value.claude_key)
  } catch {
    claudeKeyError.value = 'コピーに失敗しました'
  }
}

const initGoogleSignIn = () => {
  if (!window.google?.accounts?.id) {
    return
  }
  window.google.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    callback: (response) => admin.onCredential(response.credential),
  })
  window.google.accounts.id.renderButton(document.getElementById('signin'), {
    theme: 'outline',
    size: 'large',
    text: 'signin_with',
  })
}

onMounted(async () => {
  applyCurrentTheme()
  if (await admin.initFromHash(window.location.hash)) {
    return
  }
  if (await admin.restoreSession()) {
    return
  }
  window.addEventListener('load', initGoogleSignIn, { once: true })
})

const onLogout = () => {
  issuedShare.value = null
  if (window.google?.accounts?.id) {
    window.google.accounts.id.disableAutoSelect()
  }
  admin.logout()
}
</script>

<template>
  <div class="layout">
    <header class="header">
      <h1>川口の歌 管理</h1>
      <div class="header-actions">
        <div class="header-buttons">
          <button ref="themeButton" class="theme-toggle" type="button" @click="toggleTheme">
            ライト
          </button>
          <button
            v-if="phase === 'ready' && !isShareSession"
            class="theme-toggle"
            type="button"
            @click="onLogout"
          >
            ログアウト
          </button>
          <template v-else></template>
        </div>
      </div>
    </header>
    <main>
      <nav v-if="phase === 'ready'" class="main-tabs" aria-label="画面切り替え">
        <button
          type="button"
          class="main-tab"
          :class="{ active: tab === 'list' }"
          :aria-selected="tab === 'list'"
          @click="tab = 'list'"
        >
          一覧
        </button>
        <button
          type="button"
          class="main-tab"
          :class="{ active: tab === 'form' }"
          :aria-selected="tab === 'form'"
          @click="openCreate"
        >
          登録
        </button>
        <button
          type="button"
          class="main-tab"
          :class="{ active: tab === 'meta' }"
          :aria-selected="tab === 'meta'"
          @click="openMeta"
        >
          メタ情報
        </button>
        <button
          v-if="!isShareSession"
          type="button"
          class="main-tab"
          :class="{ active: tab === 'share' }"
          :aria-selected="tab === 'share'"
          @click="openShare"
        >
          共有
        </button>
        <template v-else></template>
      </nav>
      <template v-else></template>
      <div id="status"></div>

      <section v-if="phase === 'gate'" class="table-wrap auth-gate">
        <h2 class="section-title">Googleログインが必要です</h2>
        <p class="meta">許可されたアカウントでサインインしてください。</p>
        <div id="signin" class="google-login-button"></div>
        <p class="error">{{ gateError }}</p>
      </section>
      <template v-else></template>

      <section v-if="phase === 'share-expired'" class="table-wrap">
        <h2 class="section-title">リンクの有効期限が切れています</h2>
        <p class="meta">
          この一時アクセスリンクは失効しています。発行者に新しいリンクを依頼してください。
        </p>
      </section>
      <template v-else></template>

      <section v-if="phase === 'ready' && tab === 'list'" class="table-wrap">
        <div class="section-head">
          <h2 class="section-title">登録中の曲</h2>
          <button class="theme-toggle" type="button" @click="admin.reload()">再読み込み</button>
        </div>
        <p v-if="notice" class="meta">{{ notice }}</p>
        <template v-else></template>
        <p v-if="shareBanner" class="meta">{{ shareBanner }}</p>
        <template v-else></template>
        <p v-if="email" class="meta">{{ email }}</p>
        <template v-else></template>
        <div v-if="loading" class="alarm-row">
          <span class="meta">読み込み中…</span>
        </div>
        <template v-else>
          <div v-for="track in tracks" :key="track.row" class="alarm-row">
            <div class="item-main">
              <div>
                <div class="item-title">
                  {{ track.title }}<span v-if="track.published" class="sheet-badge">公開中</span><span v-else class="flag-badge">下書き</span><span class="sheet-badge" :class="{ 'flag-badge': archiveBadge(archive[track.file]) === 'missing' }">{{ archiveBadgeLabel(archiveBadge(archive[track.file])) }}</span>
                </div>
                <div class="alarm-commands">{{ trackMeta(track) }}</div>
                <div v-if="track.suno" class="alarm-commands">{{ track.suno }}</div>
                <template v-else></template>
              </div>
            </div>
            <div class="row-actions">
              <button
                v-if="!track.published"
                type="button"
                class="theme-toggle"
                @click="publish(track)"
              >
                公開する
              </button>
              <button
                v-else
                type="button"
                class="theme-toggle"
                @click="unpublish(track)"
              >
                公開をやめる
              </button>
              <button
                type="button"
                class="icon-btn"
                title="編集"
                aria-label="編集"
                @click="openEdit(track)"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /></svg>
              </button>
              <button
                type="button"
                class="icon-btn"
                title="削除"
                aria-label="削除"
                @click="remove(track)"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
          </div>
        </template>
        <p class="meta">{{ listStatus }}</p>
      </section>
      <template v-else></template>

      <section v-if="phase === 'ready' && tab === 'form'" class="table-wrap">
        <h2 class="section-title">{{ formTitle }}</h2>

        <label class="form-label" for="f-file">ファイル名（ローマ字スラッグ + .mp3）</label>
        <input id="f-file" v-model="form.file" type="text" :disabled="editingRow !== null" placeholder="night-walk-kawaguchi.mp3" />
        <p v-if="iaPreview" class="meta">Internet Archive の ID: {{ iaPreview }} / {{ archiveUrl(form.file) }}</p>
        <template v-else></template>

        <label class="form-label" for="f-title">曲名</label>
        <input id="f-title" v-model="form.title" type="text" />

        <label class="form-label" for="f-description">説明</label>
        <textarea id="f-description" v-model="form.description" rows="3"></textarea>

        <label class="form-label" for="f-instagram">Instagram URL</label>
        <input id="f-instagram" v-model="form.instagram" type="url" />
        <label class="form-label" for="f-suno">Suno URL</label>
        <input id="f-suno" v-model="form.suno" type="url" />
        <label class="form-label" for="f-youtube">YouTube URL</label>
        <input id="f-youtube" v-model="form.youtube" type="url" />

        <div class="field-row">
          <label>公開日 <input v-model="form.published_at" type="date" /></label>
          <label>長さ（秒） <input v-model="form.duration_sec" type="number" min="0" /></label>
          <label>並び順 <input v-model="form.sort" type="number" /></label>
        </div>

        <label class="form-label" for="f-lyrics">歌詞</label>
        <textarea id="f-lyrics" v-model="form.lyrics" rows="8"></textarea>

        <label class="form-label" for="f-mp3">MP3 ファイル（選択すると保存時にアップロードされ、長さが自動で入ります）</label>
        <input id="f-mp3" type="file" accept=".mp3,audio/mpeg" @change="onMp3Selected" />
        <p v-if="selectedFileLabel" class="meta">{{ selectedFileLabel }}</p>
        <template v-else></template>

        <div class="field-row">
          <label><input v-model="form.published" type="checkbox" /> 公開する（シートの公開フラグ）</label>
        </div>
        <p class="meta">公開連動（IA アップロードと記事再生成）は一覧の「公開する」から実行します。ここでのチェックはシートのフラグだけを変更します。</p>

        <div class="composer-row">
          <span class="meta">{{ formStatus }}</span>
          <span class="row-actions">
            <button v-if="editingRow !== null" class="theme-toggle" type="button" @click="removeFromForm">
              削除する
            </button>
            <template v-else></template>
            <button v-if="editingRow !== null" class="theme-toggle" type="button" @click="cancelEdit">
              編集をやめる
            </button>
            <template v-else></template>
            <button class="post-button" type="button" :disabled="saving" @click="submit">
              {{ editingRow === null ? '登録する' : '更新する' }}
            </button>
          </span>
        </div>
      </section>
      <template v-else></template>

      <section v-if="phase === 'ready' && tab === 'meta'" class="table-wrap">
        <h2 class="section-title">メタ情報</h2>
        <label class="form-label" for="m-tags">タグ</label>
        <input id="m-tags" v-model="metaForm.tags" type="text" />
        <label class="form-label" for="m-profile">Suno プロフィール URL</label>
        <input id="m-profile" v-model="metaForm.suno_profile" type="url" />
        <label class="form-label" for="m-intro">導入文（intro）</label>
        <textarea id="m-intro" v-model="metaForm.intro" rows="6"></textarea>
        <label class="form-label" for="m-outro">締めの文（outro）</label>
        <textarea id="m-outro" v-model="metaForm.outro" rows="4"></textarea>
        <p class="meta">
          Internet Archive への自動アップロードには、本番 music-gas のスクリプトプロパティ
          IA_ACCESS_KEY / IA_SECRET_KEY の登録が必要です。未設定のまま公開すると IA だけがスキップされ、公開結果に表示されます。
        </p>
        <div class="composer-row">
          <span class="meta">{{ metaStatus }}</span>
          <span class="row-actions">
            <button class="theme-toggle" type="button" :disabled="regenerating" @click="regenerate">
              記事を再生成
            </button>
            <button class="post-button" type="button" :disabled="metaSaving" @click="saveMeta">
              保存する
            </button>
          </span>
        </div>
      </section>
      <template v-else></template>

      <section v-if="phase === 'ready' && tab === 'share' && !isShareSession" class="table-wrap">
        <h2 class="section-title">一時アクセスリンク</h2>
        <p class="meta">
          ログイン不要で1か月間このページを使えるURLを発行します。新しいURLを発行すると、前のURLは無効になります。この画面を閉じると発行したURLは再表示できません。
        </p>
        <p class="error">{{ shareError }}</p>
        <div v-if="!issuedShare">
          <p>
            <button class="theme-toggle" type="button" @click="issue">
              1か月間有効なURLを発行
            </button>
          </p>
        </div>
        <div v-else>
          <p>
            <strong>{{ shareRemaining }}</strong>
            <span class="meta">（{{ shareExpires }} まで有効）</span>
          </p>
          <p>
            <input class="share-url-input" type="text" readonly aria-label="一時アクセスURL" :value="shareUrl" />
            <button class="theme-toggle" type="button" @click="copyShareUrl">URLをコピー</button>
          </p>
          <p>
            <button class="theme-toggle" type="button" @click="issue">新しいURLを発行し直す</button>
            <button class="theme-toggle" type="button" @click="revoke">今すぐ無効化する</button>
          </p>
        </div>
      </section>
      <template v-else></template>

      <section v-if="phase === 'ready' && tab === 'share' && !isShareSession" class="table-wrap">
        <h2 class="section-title">Muse 用キー</h2>
        <p class="meta">
          Muse が管理APIを使うためのキーです。有効期限は1か月で、新しいキーを発行すると前のキーは無効になります。キーが表示されるのは発行直後の1回だけで、この画面を閉じると再表示できません。
        </p>
        <p class="error">{{ claudeKeyError }}</p>
        <p v-if="claudeKeyActive">
          <strong>{{ claudeKeyRemaining }}</strong>
          <span class="meta">（{{ claudeKeyExpires }} まで有効）</span>
        </p>
        <p v-else class="meta">有効なキーは発行されていません。</p>
        <div v-if="issuedClaudeKey">
          <p>
            <input class="claude-key-input" type="text" readonly aria-label="Muse 用キー" :value="issuedClaudeKey.claude_key" />
            <button class="theme-toggle" type="button" @click="copyClaudeKey">キーをコピー</button>
          </p>
        </div>
        <template v-else></template>
        <p>
          <button class="theme-toggle" type="button" @click="issueClaudeKey">
            {{ claudeKeyActive ? '新しいキーを発行し直す' : '1か月間有効なキーを発行' }}
          </button>
          <button v-if="claudeKeyActive" class="theme-toggle" type="button" @click="revokeClaudeKey">
            今すぐ無効化する
          </button>
          <template v-else></template>
        </p>
      </section>
      <template v-else></template>
    </main>
  </div>
</template>
