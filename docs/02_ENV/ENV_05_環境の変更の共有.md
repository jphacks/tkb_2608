# 環境の変更の共有 (Sharing Environment Changes)

誰かが開発環境（Dev Container の設定・npm の依存）を変えたときに，全員の手元の環境を追いつかせるための仕組みと手順をまとめる．
Rebuild 等の VS Code の操作は人間が行い，変更の通知・確認・記録は Claude が行う．

## 変更の種類と必要な操作 (Change Types)

| 変更 | 例 | 各メンバーの操作 | 通知のされ方 |
| --- | --- | --- | --- |
| Dev Container（`.devcontainer/`） | Node.js の版の変更，ツールの追加，ポート転送の追加 | Rebuild → `/env-check <Issue番号>` | 作者からの声かけ＋セッション開始時の警告．対応状況は環境更新 Issue（ラベル `env-sync`）で管理する |
| npm の依存（`package.json`・`package-lock.json`） | three.js の追加・更新 | `npm ci` | セッション開始時の警告のみ |

## 仕組み (How It Works)

### セッション開始時の警告

Claude Code のセッション開始時に，フック（`.claude/hooks/check_env_sync.py`）が次を確認し，ずれていれば `[env-sync] ⚠ ...` を表示する．Claude にも同じ内容が伝わる．

- **Dev Container**: `.devcontainer/` の中身を，その人が最後に `/env-check` で確認した時の記録と比べる．記録はコンテナ内（`~/.cache/env-sync/`）にあり，Rebuild すると消えるため「Rebuild したが未確認」も分かる
- **npm**: `package-lock.json` の各パッケージが，`node_modules` に同じバージョンで入っているかを比べる

### 環境更新 Issue

`.devcontainer/` を変えた PR を `/commit push`・`/commit merge` で作ると，Claude が `/env-notify` を自動で実行し（`.claude/rules/pr-workflow.md`），次を載せた Issue を作る．

- 変更内容
- 対応手順（`main` を最新にする → Rebuild → `/env-check`）
- 確認コマンド（Rebuild 後に変更が反映されたかを確かめるコマンド）
- メンバーごとの対応状況のチェック欄

Issue では `@` を使わず，GitHub の通知は飛ばさない．同じ会場にいるので作者が対面で声をかけ，声かけが漏れても各自のセッション開始時の警告（`main` が古ければ `[sync-check]`，Rebuild していなければ `[env-sync]`）で気付けるため．

手動で PR を作った場合などは，`/env-notify <PR番号>` を自分で実行する．

## 環境を変える人の手順 (For the Author)

1. `.devcontainer/` を変更してコミットし，そのブランチのまま Rebuild する
2. `/env-check`（引数無し）を実行し，確認を通す．確認済みとして記録される
3. `/commit push`（または `/commit merge`）で PR を作る．Claude が環境更新 Issue を作り，PR にリンクをコメントする
   - 2 の確認が済んでいないと，Claude は Issue を作らずに止まる（作者の環境で通らない変更を全員に配らないため）．その場合は 1〜2 を行ってから `/env-notify <PR番号>` を実行する
4. マージしたら，メンバーに Rebuild と `/env-check <Issue番号>` の実行を声かけする
5. 作者自身も，マージ後に `/env-check <Issue番号>` を実行して自分の分のチェックを付ける（Rebuild し直す必要は無い）

## 各メンバーの手順 (For Members)

1. 声をかけられたら（またはセッション開始時に警告が出たら），PR がマージされたことを確認して `main` を最新にする

   ```bash
   git switch main && git pull
   ```

2. VS Code のコマンドパレットで `Dev Containers: Rebuild Container` を実行する
3. Claude Code で `/env-check <Issue番号>` を実行する．Claude が以下を行う
   - `bash .devcontainer/check.sh` と，Issue の確認コマンドを実行する
   - 結果を Issue にコメントし，すべて成功なら自分のチェック欄に印を付ける
   - 全員のチェックが揃ったら Issue を閉じる
4. 失敗した場合は Claude の報告に従って対処し，もう一度 `/env-check` を実行する

npm の依存だけが変わった場合は，警告が出たら `npm ci` を実行すればよい（`/env-check` を実行しても，`npm ci` まで行われる）．

## 補足 (Notes)

- 未対応の環境更新 Issue は `gh issue list --label env-sync` で確認できる
- Issue を使わずに確認と記録だけ行いたい場合は，引数無しで `/env-check` を実行する（未完了の Issue があればそれも対象になる）
- このリポジトリは public のため，確認結果のコメントにトークン等の秘密情報を載せない（`/env-check` は出力に含まれていれば伏せる）
