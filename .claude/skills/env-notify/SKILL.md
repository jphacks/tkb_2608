---
name: env-notify
model: inherit
description: "Dev Container（.devcontainer/）を変更した PR について，全メンバーに Rebuild を依頼する Issue（確認項目・メンバーごとのチェック欄付き）を作り，PR にもリンクを残す．/commit push・/commit merge・/deps-update の後に .claude/rules/pr-workflow.md に従って自動で呼ばれるほか，手動でも使える．"
argument-hint: "<PR番号（省略時は現在のブランチの PR）>"
---

あなたは開発環境の変更を全員に届ける担当です．PR の差分から「各自に何をしてもらい，何を確認すれば良いか」を判断して Issue にまとめます．運用の全体像は `docs/02_ENV/ENV_05_環境の変更の共有.md` を参照する．

gh の操作は数回で済むため，ops-runner に委譲せず自分で行う．

## ステップ 1: 対象の PR と変更ファイル (Target)

1. PR 番号を決める．引数があればそれを使い，無ければ `gh pr view --json number -q .number` で現在のブランチの PR を取る．PR が無ければ「PR を作ってから実行してください」と伝えて終了する
2. 変更ファイルを取る:

   ```bash
   gh pr diff <PR番号> --name-only
   ```

3. `.devcontainer/` 配下の変更が無ければ，「Rebuild が必要な変更はありません（npm の依存の変更は，各自のセッション開始時に `[env-sync]` の警告で通知されます）」と伝えて終了する

## ステップ 2: 重複の確認 (Duplicates)

同じ PR の Issue が既にあれば作らない．

```bash
gh issue list --label env-sync --state all --search "PR #<PR番号> in:body" --json number,title,state
```

- 既にある場合は，その Issue に「PR に追加の変更が入った」旨と追加の確認項目をコメントし，ステップ 5 に進む

## ステップ 3: Issue の中身を作る (Compose)

`.devcontainer/` の差分を読み（`gh pr diff <PR番号>` の該当部分），以下を判断して本文を作る．**ここが品質の要であり，差分から具体的に書く**．

- **変更内容**: 何が入る・変わる・無くなるか（例: Node.js 24 の追加，cloudflared の追加，ポート 5173 の転送）
- **確認コマンド**: Rebuild 後に変更が反映されたことを確かめる**読み取り専用**のコマンド（例: `node -v`，`cloudflared --version`，`command -v <ツール>`）．インストール・削除・設定の書き換えを含むコマンドは書かない（`/env-check` がそのまま実行するため）
- **人が見て確かめること**: コマンドで確かめられない項目があれば書く（例: VS Code の拡張機能が入っている）．無ければ節ごと省く
- **メンバー**: `.github/CODEOWNERS` の `/CLAUDE.md` の行に並ぶ GitHub ユーザー名を全員載せる（PR の作者も含める）．**`@` は付けない**．同じ会場にいて対面で声をかけるうえ，各自のセッション開始時の `[env-sync]` 警告で気付けるため，GitHub の通知は飛ばさない

タイトルは `[env] <変更の要約>（PR #<PR番号>）` とする．本文は次の形にする（`/env-check` が節の見出しとコードブロックを読み取るため，見出しを変えない）．

````markdown
PR #<PR番号> で Dev Container（`.devcontainer/`）が変わります．**マージ後に各自 Rebuild し，`/env-check <この Issue の番号>` を実行してください．**

## 変更内容

- <変更点>

## 対応手順

1. PR #<PR番号> がマージされたら `main` を最新にする（`git switch main && git pull`）
2. VS Code のコマンドパレットで `Dev Containers: Rebuild Container` を実行する
3. Claude Code で `/env-check <この Issue の番号>` を実行する（確認結果がこの Issue にコメントされ，下の対応状況にチェックが付く）

## 確認コマンド

```bash
<読み取り専用のコマンド（1 行に 1 つ）>
```

## 人が見て確かめること

- [ ] <項目>

## 対応状況

- [ ] <メンバー1>
- [ ] <メンバー2>
````

## ステップ 4: 起票 (Create)

1. ラベルを用意する（既にあれば更新されるだけ）:

   ```bash
   gh label create env-sync --color 0E8A16 --description "開発環境の更新（各自の Rebuild が必要）" --force
   ```

2. 本文をスクラッチパッドのファイルに書き出し，Issue を作る（担当者は付けない）:

   ```bash
   gh issue create --title "<タイトル>" --body-file <本文ファイル> --label env-sync
   ```

3. 本文の「この Issue の番号」を実際の番号に置き換えて `gh issue edit <Issue番号> --body-file <本文ファイル>` で更新する

## ステップ 5: PR にリンクを残す (Link)

```bash
gh pr comment <PR番号> --body "Dev Container の変更があるため #<Issue番号> を作成しました．マージ後に各自 Rebuild して \`/env-check <Issue番号>\` を実行してください．"
```

## ステップ 6: 報告 (Report)

- Issue の番号・タイトル・URL
- 確認コマンドとして載せた内容（1 行ずつ）
- 「マージ後に，各メンバーに Rebuild と `/env-check <Issue番号>` の実行を声かけしてください」

## 注意事項 (Notes)

- Rebuild の実行と，Rebuild 後の `/env-check` の実行は各メンバーが行う．本スキルは依頼と記録の場を作るだけで，他人の環境を確認したことにはしない
- 確認コマンドに秘密情報（トークン等）を表示するコマンドを書かない（Issue は public リポジトリで公開される）
