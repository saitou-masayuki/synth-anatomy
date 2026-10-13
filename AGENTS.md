# AGENTS.md — AI エージェント向けの作業ルール（synth-anatomy）

Claude Code・Codex など、このリポジトリで作業する AI エージェントは、最初にこのファイルを読むこと。

## 作業の約束

- main に直接 push しない。必ず作業用ブランチ（例: `feature/<内容>`）を切り、プルリクエストを作る。マージは本人が行う。
- 変更する前に、関係する既存コードと `docs/design.md` を読む。
- 完了を報告する前に `node --test test/*.test.mjs` を実行し、全件成功を確認する。失敗したままで「完了」と言わない。
- テストが対象にするのは純粋ロジック層だけ。画面・音声・Service Worker を変更したときは、対応する動作確認をブラウザで行い、実行できなかった確認とその理由を報告する。
- 応答・コミットメッセージ・プルリクエストの説明は日本語で書く。略語は初出で正式名称や説明を添える（ファイル名・コマンド・コード内の識別子は変えない）。
- 秘密情報（API トークン、Cloudflare のアカウント情報など）をリポジトリに入れない。`.wrangler/` は `.gitignore` で除外済み。

## 環境

- Node.js 22。`package.json` はなく、依存関係の導入は不要（ビルドなしのバニラ JavaScript）。
- テスト: `node --test test/*.test.mjs`（Node.js 組み込みのテストランナー。純粋ロジック層が対象）
- ローカル確認: `python3 -m http.server 8767 --bind 127.0.0.1` を起動して http://localhost:8767/ を開く（`--bind` を付けないと同じネットワークの他の端末からも接続できてしまう）

## デプロイ

- 公開先は Cloudflare Pages（https://synth-anatomy.pages.dev/）。デプロイは本人が手元から行う。エージェントはデプロイしない。

## 構成の要点

- 全機能（エンジン・UI・解説・診断チャレンジ）が `content-params.js` の統一パラメーター定義を参照する。
- ファイルごとの役割は `README.md` の表、設計の詳細は `docs/design.md` を参照。
