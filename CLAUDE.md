# 防災体験VR（仮称）

スマホ＋簡易VRゴーグルだけで遊べる Web の防災体験シミュレーター．足踏み歩行・しゃがみ・ハンドトラッキングで体を動かし，ナレーションと音響の中で災害時の行動を体験する（JPHACKS 2026 チーム `tkb_2608`）．

## 開発進捗

進捗・タスクは GitHub Issues と git 履歴で追う（GUIDE_03）．現在のタスクは `gh issue list` で確認する．`CLAUDE.md` と `docs/PROGRESS.md` には進捗を書かない．

## 必須ルール（コード実装時）

<!-- プロジェクト固有の必須ルールの要点があればここに追記する．コーディング規約等の本体は規約整備フェーズで .claude/rules/ に path-scoped rule として作成する（GUIDE_01 参照） -->

### Git 運用

- ブランチ名・コミットメッセージの書式は `.claude/rules/git-conventions.md` に従う（常時ロードされる）
- コミットは `/commit` を使用する（push・PR 作成は `/commit push`，マージ・プルまで行う場合は `/commit merge`）
- **`/commit` はユーザーが明示的に指示した時のみ実行する．Claude が自発的に `/commit` や `git commit` を呼んではならない**（`/implement` 完了後も，案内するだけで自分ではコミットしない．`/commit` skill は `disable-model-invocation` によりユーザー起動限定として強制されている）
  - **例外**: 以下（無人運転ループ）はユーザー承認済みの例外として専用ブランチに自律コミットする．いずれも push・PR・マージ・`main` への操作はしない（取り込みは人間が `/commit push` 等で行う）
    - `/auto-refactor`（リファクタ／ドキュメント整理ループ）→ `refactor/` 専用ブランチ
    - `/auto-audit`（バグ／脆弱性の巡回監査ループ）→ `fix/` 専用ブランチ
  - **例外（`main` へのマージ）**: `/deps-update` は，Dependabot が作成した依存更新 PR に限り，ゲート（メジャー更新でない・競合なし・CI 緑またはローカル検証緑）を満たすものを `gh pr merge` で `main` に取り込む（ユーザーが明示的に起動した時のみ．メジャー更新・CI 赤・PR が付かない alert は報告して人間が判断する）
- セッション開始時に `[sync-check]` の警告（ローカルが origin と同期していない等）が表示されたら，必ず認識し，作業前にユーザーへ伝えて `git pull` 等の対処を促す
- **ops-runner によるマージは承認済みの定常操作**: `/commit merge` および `/deps-update` では，ユーザーが明示的に起動したことを受けて，ops-runner サブエージェント（軽量モデル）が手順書に従い `git push` → `gh pr create` → `gh pr merge --merge --delete-branch` で自リポジトリの PR を `main` にマージする．force push・`--admin`・`main` への直接 push は行わない（権限設定は `docs/01_GUIDE/GUIDE_01` の「Claude Code の権限設定」）

### テンプレート同期

- テンプレートの更新は `/sync-template` で取り込む
- テンプレート由来のファイル（`.claude/agents/`・`skills/`・`rules/`・`hooks/`，`docs/01_GUIDE/`）を**このプロジェクトの都合で意図的に変更した**ときは，`.claude/template-overrides.md`（テンプレート改変台帳）に理由付きで記録する（`.claude/rules/template-customization.md`．該当ファイル編集時に自動ロードされる）．記録が無いと次回同期で改変が消えうる

### タスク管理（任意）

- やるべきことを GitHub Issues で管理してよい（solo / team 共通）．`/task-create`（起票・事前計画）→ `/task-start <Issue番号>`（着手準備）→ `/task-handoff`（中断時の引継ぎメモ投稿）を使う
- Issue は必須ではない．小さい変更や試験的作業は Issue 無しで進めてよい
- solo モードでは進捗記録（`.claude/rules/progress-log.md`）は従来どおり運用し，Issue はタスクの管理・引継ぎの補助として使う

### チーム開発（GUIDE_03 準拠）

- 期限が短いため，できるだけ多くの人が並行して作業する（1 人が同時に持つタスクは 1 件）．衝突を減らすため，タスクは触るファイルが重ならないように分け，小さく保って早めにマージする（GUIDE_03「並行開発」）
- タスクは GitHub Issues で管理する（`/task-create` → `/task-start <Issue番号>` → 中断時は `/task-handoff`）．Claude へのタスク文脈は `gh issue view <Issue番号>` で Issue から取得する
- GitHub Projects（ボード）は使わない．2 日間・同じ会場での開発のため，Issue の担当者と open / closed で管理する．Projects 用のスコープ（`gh auth refresh -s project`）は勧めない
- 通常の機能 PR は条件付きセルフマージ（CI 緑・作者の動作確認済み・`/implement` 完走・Issue の完了条件を満たす・共有設定を含まない）
- 共有設定（`CLAUDE.md` のルール部・`.claude/`）を変更する PR は機能 PR に混ぜず専用 PR とし，他メンバー 1 名の Approve を必須とする（セルフマージ不可．`.github/CODEOWNERS` と `main` の Ruleset で強制）
- `main` は Ruleset で保護している（直接 push・force push・削除の禁止．GUIDE_03「main ブランチの保護」）．admin の例外（bypass）は人間が GitHub の画面で使うものであり，Claude は `gh pr merge --admin` 等で保護を迂回しない．マージが拒否されたら停止して報告する

### エージェントチーム（GUIDE_02 準拠）

- 実装は `/implement <タスク>` で開始する（コーディング → テスト →（指定時のみ）リファクタリング → ドキュメント更新）
- Phase 1 後に人間が動作確認，Phase 2 でテスト失敗時のみ方針判断
- Phase 2 成功後は Phase 4 まで自動で進む（Phase 3 は実行する場合のみ挟む．Phase 4 で更新がある場合のみ確認）
- テストをスキップしない
- リファクタリング（Phase 3）は既定では実行しない．`/implement` の指示で明示された場合と，Phase 1 の追加行数（テスト・ドキュメント・ロックファイル・自動生成を除く）が 2000 行を超えて人間が実行を選んだ場合のみ行う（GUIDE_02）
- 区切りのよいところ（1 日目の終わり・提出前等）で，人間の指示により一度だけコード全体を整理する（refactorer にコード全体を対象として委譲する）
- 検証プロファイル（`.claude/verify-profile.md`）を用意したプロジェクトでは，Phase 1 の後に Phase 1b（verifier による動作確認．対象はローカル環境と，プロファイルが根拠つきで許可した検証用環境のみ．本番は対象外）が入り，人間が確認する範囲が絞られる（単独実行は `/verify`）．プロファイルが無ければ Phase 1b はスキップされ，動作確認は従来どおり人間が行う．**verifier の OK は人間の動作確認の代わりにならない**

### 開発コマンド

- 起動・テスト・lint 等の開発コマンドは `docs/02_ENV/ENV_04_開発コマンド.md` にまとめる．**存在する場合は実行前に必ず参照し，推測でコマンドを試さない**
- コマンドが新しく確定・変更された時は同ファイルに反映する（無ければその時点で作成する．`/implement` の Phase 4 でも見直される）

### 手動確認が必要な作業（自分で完了させないこと）

以下は実装完了後にユーザーへ報告し，確認・実施を依頼すること．

- 外部サービスの設定（コンソール操作，セキュリティルール変更等）
  - 例外: `gh` CLI で操作できる GitHub リポジトリ設定（Dependabot alerts / security updates の有効化）は Claude が `gh api` で行う（手順は `.claude/skills/setup/reference.md`，背景は GUIDE_01「環境構築」）
- リポジトリ外のファイルの削除・上書き（既存ファイルの移動を含む）
  - フックが検出できない書き方であっても Claude は自分で実行しない（変数・スクリプトファイル・`python -c` 等による迂回も禁止）．必要な操作であれば，実行するコマンドをそのまま提示し，ユーザーにプロンプトで `! <コマンド>` として実行するよう依頼する
- 実機・ブラウザでの動作確認（`verifier` による自動検証は前段であり，これを置き換えない）
- ストアへのアップロード・リリース作業

## ドキュメント

設計・規約に関する情報は docs/ にある．
コードを書く前に関連するファイルを読むこと．

### 01_GUIDE（規約・ルール）

- プロジェクト立ち上げフロー: docs/01_GUIDE/GUIDE_01_プロジェクト立ち上げフロー.md
- エージェント運用ルール: docs/01_GUIDE/GUIDE_02_エージェント運用ルール.md
- チーム開発ルール: docs/01_GUIDE/GUIDE_03_チーム開発ルール.md
- ※ Git 規約・ドキュメント書式・命名規則・進捗記録・テンプレート改変記録・フックのクロスプラットフォーム対応は `.claude/rules/`（git-conventions / markdown-style / docs-naming / progress-log / template-customization / hooks-cross-platform）に定義されている（git-conventions は常時，他は該当ファイル編集時に自動ロード）
- ※ コーディング規約，テスト方針等はプロジェクト立ち上げ時に path-scoped rules（`.claude/rules/`）として作成する（GUIDE_01 参照）

### 02_ENV（環境）

- 環境構築手順（WSL + Docker + Dev Containers）: docs/02_ENV/ENV_02_環境構築手順.md
- 環境の変更の共有（Rebuild の依頼・`/env-notify`・`/env-check`）: docs/02_ENV/ENV_05_環境の変更の共有.md

<!-- プロジェクト立ち上げ時に追加する -->

### 03_PLAN（計画）

- JPHACKS 2026 大会概要・日程・当日タイムライン（チーム `tkb_2608`／東京B会場）: docs/03_PLAN/PLAN_01_大会概要とスケジュール.md
- 開発ルール（事前開発の扱い）・提出物（README／提出フォーム／発表）: docs/03_PLAN/PLAN_02_開発ルールと提出方法.md
- 開発テーマ・審査基準・東京B会場のスポンサー賞: docs/03_PLAN/PLAN_03_審査基準とアワード.md

<!-- プロジェクト立ち上げ時に追加する -->

### 04_SPEC（仕様・設計）

- 画面遷移・モジュール構成と担当・受け渡すデータ・シナリオ定義の形式: docs/04_SPEC/SPEC_01_画面遷移とモジュール構成.md

### 05_TECH（技術設計）

<!-- 実装フェーズで必要になった時に追加する（立ち上げ時の対象外） -->

### 06_TEST（テスト）

<!-- 実装フェーズで必要になった時に追加する（立ち上げ時の対象外） -->
