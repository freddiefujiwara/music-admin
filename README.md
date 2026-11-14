# music-admin

「川口の歌」（Suno で作った川口の歌）の管理画面です。バックエンドは music-gas の管理 API（doPost）で、曲データの正本はスプレッドシート `music-db` です。

公開パス: https://freddiefujiwara.com/music-admin/（ステージングは `/music-admin/staging/`）

## できること

- 曲の一覧（未公開を含む全曲、公開状態と Internet Archive の有無のバッジ付き）
- 曲の登録・編集・削除（削除はシートの行だけ。Drive の MP3 と IA のアイテムは残ります）
- MP3 のアップロード（保存時に Drive の曲フォルダへ。長さはブラウザで計測して `duration_sec` に入ります。上限 10MB）
- 公開連動（一覧の「公開する」: シートの公開フラグ → Internet Archive へアップロード → 記事の再生成、を music-gas 側で直列実行）
- メタ情報（tags / suno_profile / intro / outro）の編集と、記事の再生成
- 一時アクセスリンクの発行・無効化（オーナー同等、30 日）

## 認証

他の管理系サイトと同じ方式です。Google ログイン → ID トークンを music-gas が検証（許可リスト `AVAILABLE_GMAILS`）→ 30 日間のオーナーセッションへ交換。セッションは music-db 内のタブにハッシュ保存されます。共有リンクは `#share=` で受け取ります。

## ビルドと API の向き先

- 本番: `src/constants/app.js` の `<API>` プレースホルダを CI が GitHub Secret `API`（本番 music-gas の /exec URL）で置換してからビルドします
- ステージング: ワークフローの環境変数 `VITE_MUSIC_API`（ステージング music-gas の /exec URL）と `VITE_STAGING=1` で切り替えます
- `npm run build`（本番）/ `npm run build:staging`（ステージング）/ `npm test`（Vitest、カバレッジ閾値 100%）/ `npm run test:staging`（Playwright のステージング確認）

## 注意

- ステージングの music-gas は、本番とは別の music-db コピーと曲フォルダ（`music-staging`）を向いています。ステージングで編集・アップロードしても本番には影響しません
- IA へのアップロードには本番 music-gas のスクリプトプロパティ `IA_ACCESS_KEY` / `IA_SECRET_KEY` が必要です（未設定のまま公開すると IA だけスキップされ、結果に表示されます）
