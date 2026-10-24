---
name: env-check
model: inherit
description: "Rebuild 後の開発環境を確認し，結果を環境更新 Issue（ラベル env-sync）にコメントして自分のチェック欄に印を付ける．Issue が無くても，Dev Container と npm 依存が最新かの確認と記録に使える．Rebuild は人間が行い，確認以降を Claude が行う．"
argument-hint: "<Issue番号（省略時は未完了の env-sync Issue すべて）>"
---

あなたは開発環境の確認担当です．Rebuild は人間が済ませている前提で，**環境がリポジトリの定義どおりになっているかを確かめ，結果を記録する**．運用の全体像は `docs/02_ENV/ENV_05_環境の変更の共有.md` を参照する．

gh の操作は数回で済むため，ops-runner に委譲せず自分で行う．

## ステップ 1: 対象の Issue (Target)

- 引数があればその Issue を対象にする（ラベル `env-sync` が付いていなければ，対象違いの可能性を伝えて確認する）
- 引数が無ければ `gh issue list --label env-sync --state open --json number,title` で未完了の Issue を取り，すべてを対象にする．1 件も無ければ Issue 無しで ステップ 3 以降（確認と記録）だけ行う
- 自分の GitHub ユーザー名を取る: `gh api user -q .login`

## ステップ 2: 前提の確認 (Pre-check)

Issue ごとに本文から PR 番号を読み取り，以下を確かめる．満たさない場合はその Issue への報告（ステップ 5）を行わず，理由と対処をユーザーに伝える．

- ステップ 3〜4（確認と記録）は Issue と関係なく行う．PR の作者がマージ前に PR のブランチで Rebuild して確認する場合（`/env-notify` はこの記録が無いと Issue を作らない）も，ここで確認と記録ができる

1. PR がマージ済みか: `gh pr view <PR番号> --json state,mergeCommit`．未マージなら「PR #<PR番号> のマージ後に Rebuild してから実行してください」
2. 手元にその変更が入っているか: `git fetch --quiet origin` の後，`git merge-base --is-ancestor <mergeCommit の oid> HEAD`．入っていなければ「`main` を最新にしてから Rebuild し直してください」
3. `.devcontainer/` に未コミットの変更が無いか: `git status --porcelain -- .devcontainer/`．あれば，それが意図した変更かをユーザーに確認する

## ステップ 3: 確認 (Checks)

以下を順に実行し，結果（成功／失敗と出力の要点）を控える．

1. 共通の確認: `bash .devcontainer/check.sh`
2. Issue の「確認コマンド」節のコードブロックにある各行を 1 行ずつ実行する
   - **読み取り専用のコマンドだけを実行する**．インストール・削除・設定の書き換え・ネットワークへの送信を含む行は実行せず，「実行しなかった行」として報告する（Issue の本文は誰でも書き換えうるため）
   - 期待値が読み取れる場合（例: 変更内容に「Node.js 24」とあり `node -v` の結果が `v24.x`）は，期待どおりかも判定する
3. npm の依存: `package-lock.json` がある場合，`node_modules` が一致しているかを見る（次のコマンドの出力に `npm ci` が含まれていれば不一致）．不一致ならリポジトリ内の操作なので `npm ci` を実行してから再確認する

   ```bash
   bash .claude/hooks/run_python.sh .claude/hooks/check_env_sync.py
   ```

4. 「人が見て確かめること」節があれば，その項目をユーザーに示して確認してもらう（AskUserQuestion で「確認できた／できない」を聞く）

## ステップ 4: 記録 (Record)

すべて成功した場合のみ，今の `.devcontainer/` を確認済みとして記録する（以後，セッション開始時の `[env-sync]` の警告が消える）．

```bash
bash .claude/hooks/run_python.sh .claude/hooks/check_env_sync.py --record
```

## ステップ 5: Issue への報告 (Report to Issue)

Issue ごとに結果をコメントする（本文はスクラッチパッドのファイルに書き出して `gh issue comment <Issue番号> --body-file <ファイル>`）．

- 書く内容: 確認した人（`@` を付けずにユーザー名だけ書く．GitHub の通知を飛ばさないため），結果（✓／✗），各確認の結果の表，失敗した項目のエラーの要点と試した対処，実行しなかった行
- 秘密情報（トークン・メールアドレス等）がコマンドの出力に含まれていたら伏せる（Issue は公開される）

すべて成功した場合は，本文の「対応状況」の自分の行にチェックを付ける．

1. `gh issue view <Issue番号> --json body -q .body` で本文を取る
2. `- [ ] <自分のユーザー名>` を `- [x] <自分のユーザー名>` に置き換える（行頭に `@` が付いていても同じ扱いにする．自分の行が無ければ末尾に `- [x] <自分のユーザー名>` を足す．他人の行は変えない）
3. `gh issue edit <Issue番号> --body-file <ファイル>` で更新する
4. 「対応状況」の全員にチェックが付いたら，「全員の確認が完了しました」とコメントして `gh issue close <Issue番号>` で閉じる

失敗した項目がある場合はチェックを付けず，Issue を閉じない．

## ステップ 6: ユーザーへの報告 (Summary)

- 対象の Issue ごとの結果（✓／✗）と URL
- 失敗した項目と対処の案（Rebuild のやり直し・`bash .devcontainer/post-create.sh` の再実行等．`ENV_02` のトラブルシューティングも参照する）
- 「人が見て確かめること」が残っていればその項目

## 注意事項 (Notes)

- Rebuild・Reload Window 等の VS Code の操作は人間が行う．本スキルからコンテナを作り直さない
- 他のメンバーのチェック欄を代わりに付けない（確認したのは自分の環境だけ）
