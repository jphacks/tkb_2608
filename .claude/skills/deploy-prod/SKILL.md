---
name: deploy-prod
model: inherit
description: "staging で確認済みの main のコミットに annotated タグ v* を打って push し，deploy-prod.yml による本番（https://tkb2608.pages.dev）への配信を完了まで見届け，公開 URL で切り替わりを確かめて，docs/02_ENV/ENV_06_デプロイ記録.md に記録を追記する．ユーザーが明示的に起動した時のみ実行する．"
argument-hint: "[vX.Y.Z（省略時は提案）] [対象コミット（省略時は origin/main の先頭）]"
disable-model-invocation: true
---

あなたは **本番リリースの司令塔**です．タグの push は本番リリースの最終判断なので，本スキルは**ユーザーが `/deploy-prod` を明示的に起動した時のみ**動き，タグを打つ前に必ずユーザーの最終確認を取ります．

配信そのものは GitHub Actions（`.github/workflows/deploy-prod.yml`）が行う．本スキルが外部に対して行うのは，`git`（タグの作成と push）・`gh`（Actions の実行結果の取得）・`curl`（公開 URL の読み取り）だけで，**Cloudflare の API・MCP・認証情報は使わない**（CLAUDE.md「手動確認が必要な作業」．外部サービスの操作は人間が行う）．

git・gh の操作は ops-runner に委譲せず，**メインループで直接行う**．リリースは頻度が低く判断の比重が大きいこと，サブエージェントからの git・gh の操作が auto mode の分類器に止められうること（同じ構成の別プロジェクトで実例あり）が理由である．

コマンド・判定条件・記録の書式・失敗時の対処は本スキルの `reference.md`（`.claude/skills/deploy-prod/reference.md`）に従う．配信の仕組みは [ENV_04](../../../docs/02_ENV/ENV_04_開発コマンド.md)「デプロイ」が正である．

## 不変条件 (Invariants)

- ユーザーの最終確認（ステップ 3）に同意を得る前に，タグを作成・push しない
- タグは annotated（`git tag -a`）で，`origin/main` に含まれるコミットにだけ打つ
- force push・既存タグの上書き・タグの削除・ワークフローの再実行はしない．必要になった場合は原因と選択肢を示し，ユーザーの明示指示を得てから行う（`reference.md`「失敗時の対処」）
- `main` へのコミット・push はしない．デプロイ記録の追記はコミットせずに残し，取り込みは人間が `/commit push`（または `/commit merge`）で行う
- 前回タグ以降の変更が配信物に影響しないもの（`docs/`・`.claude/`・`*.md` 等）だけならタグを打たない（本番に出すものが無い）

## ステップ 1: 前提チェック (Pre-check)

`reference.md`「前提チェック」のコマンドで次を確認する．1 つでも満たさなければ，理由と対処を示して終了する．

1. 作業ツリーがクリーンである
2. origin をタグごと fetch し，対象コミット（引数で指定がなければ `origin/main` の先頭）が `origin/main` に含まれる
3. 対象コミットにまだ `v*` タグが無く，`deploy-prod.yml` に完了していない実行が無い
4. 対象コミットが staging に配信されている（`deploy-staging.yml` の push か手動実行のどちらかで，`Deploy to staging` が成功している．配信対象の変更が無く配信がスキップされた場合も可．自動配信を止めている（`STAGING_AUTO_DEPLOY=false`）なら，手動実行で配信されていることが必要）
5. 前回タグから対象コミットまでに，本番に出る変更がある

## ステップ 2: リリース内容とバージョン案 (Release Notes & Version)

- 前回タグから対象コミットまでにマージされた PR の一覧（番号・タイトル）を作る
- バージョン: 引数があればそれを使う（`vX.Y.Z` の書式で，前回タグより大きいことを確かめる）．無ければ `reference.md`「バージョンの上げ方」に従って**自分で判断して**案を出す（初回は `v0.1.0`）
  - major に当たる節目（提出版・Award Day 版等）は案を出さず，ユーザーに判断を求める
- タグメッセージ: コミットメッセージと同じ書式（`[タグ] 内容`）で，体験者から見た主な変更を 1 行にまとめる

## ステップ 3: 最終確認 (Final Confirmation)

`AskUserQuestion` で，対象コミット・バージョン・タグメッセージ・含む PR・staging の状況（どの実行で配信されたか．今の staging がその版のままか）を示し，**staging（https://staging.tkb2608.pages.dev）を iPhone で動作確認したか**を必ず問う．

- 選択肢は「staging 確認済み・この内容で出す」と「中止する」を置く（バージョンやメッセージの変更は Other で受け付け，反映して再確認する）
- 同意が得られなければ何もせず終了する

## ステップ 4: タグの作成と push (Tag & Push)

`reference.md`「タグの作成と push」のコマンドで annotated タグを作り，`origin` に push する．

## ステップ 5: 配信の監視 (Watch)

`reference.md`「配信の監視」に従い，`deploy-prod.yml` の実行を特定して**バックグラウンドで**完了まで待つ（`Bash` の `run_in_background`）．完了通知を受けたら各ジョブ・各手順の結果を確認する．

失敗した場合は `reference.md`「失敗時の対処」に従い，失敗箇所・原因（`gh run view --log-failed` の要点）・本番が今どの状態か（配信なし／配信済み）を報告する．打ち直しや再実行の判断はユーザーに委ねる．

## ステップ 6: 公開 URL での確認 (Verify Live)

配信が成功したら，`reference.md`「公開 URL での確認」に従い，認証の要らない公開 URL を `curl` で読んで次を確かめる．

1. その回の配信の URL（ログの `https://<識別子>.tkb2608.pages.dev`）と本番の URL（`https://tkb2608.pages.dev`）が `200` を返す
2. 本番の `index.html` が参照する JS のファイル名が，その回の配信の URL と同じ（本番が新しい版に切り替わっている）

切り替わっていなければ数十秒おいて数回確かめ直し，それでも違う場合は報告する（配信は成功しているがキャッシュ等で古い版が見えている可能性）．見た目・操作感の確認は人間が iPhone で行う（ステップ 8 で依頼する）．

## ステップ 7: デプロイ記録の追記 (Record)

結果にかかわらず，`docs/02_ENV/ENV_06_デプロイ記録.md` に 1 件追記する（書式は同ファイルの「記録ルール」と `reference.md`「デプロイ記録の追記」）．`main` から `docs/` ブランチを切って追記し，**コミットはしない**．

## ステップ 8: 完了報告 (Report)

次を簡潔に伝える．

- 結果（各ジョブ），実行ログの URL，所要時間，ステップ 6 の確認結果
- 本番（https://tkb2608.pages.dev）を iPhone で確かめてほしい点．まず再読み込みが必要なこと，今回の変更に即した確認項目
- 「デプロイ記録を追記しました．`/commit merge` で取り込んでください」（`docs/` だけの変更なのでタグは不要）
