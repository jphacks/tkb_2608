# PR の作成・マージ時の追加作業 (Pull Request Follow-ups)

PR を作成・マージする前後に Claude が自動で行う追加作業を定める．このプロジェクトでの PR の書き方・注意点も，今後は本ファイルに追記していく．

## PR の作成・マージの前: 最新の main に合わせる (Sync with main)

`main` の Ruleset では「マージ前にブランチを最新にする」を必須にしていない（細かくマージするため，必須にすると他の人のマージのたびに全 PR で更新と CI のやり直しが要り，開発が遅くなる．GUIDE_03「main ブランチの保護」）．代わりに，PR を作る時とマージする時に Claude がブランチの古さを確かめ，古ければ最新の `main` を取り込む．最新の `main` と組み合わせた状態で CI を通すことで，組み合わせて初めて壊れる事故を減らす．

- 対象: `/commit push`（PR 作成の前）と `/commit merge`（PR 作成の前とマージの直前）．司令塔が ops-runner への委譲プロンプトに次の手順を含める（`/commit` 本体はテンプレート由来のため変更しない）
- 手順:
  1. `git fetch origin` の後，`git rev-list --count HEAD..origin/main` で遅れを数える．0 なら何もしない
  2. 遅れていれば，ブランチの状態で取り込み方を変える

     | ブランチの状態 | 取り込み方 | 理由 |
     | --- | --- | --- |
     | まだ push していない | `git rebase origin/main` | 履歴を直列にできる．リモートを書き換えないので安全 |
     | push 済み（PR がある） | `git merge origin/main` の後に通常の `git push` | rebase すると force push が要る（禁止） |

  3. 競合したら `git rebase --abort`・`git merge --abort` で元に戻して止まり，競合したファイルをユーザーに報告する（自分で解決しない）
  4. `/commit merge` で取り込んだ場合は CI が再実行されるので，`gh pr checks <PR番号> --watch` で合格を待ってからマージする．不合格なら止めて報告する
- 取り込みの有無（何コミット遅れていたか）は結果報告でユーザーに伝える

## PR の作成・マージの後 (After Creating or Merging a PR)

### 適用するタイミング (When to Apply)

- `/commit push`・`/commit merge` で PR を作成（またはマージ）し，ops-runner の報告を受け取った後（司令塔が行う．ops-runner には判断させない）
- `/deps-update` で Dependabot の PR をマージした後
- ユーザーが手動で PR を作った後に，追加作業の確認を頼まれたとき

### 手順 (Procedure)

1. PR の変更ファイルを取る（ops-runner の事実報告はそのコミットの分しか含まないことがあるため，PR 全体で見る）:

   ```bash
   gh pr diff <PR番号> --name-only
   ```

2. 下表に当てはまる作業を行い，結果を `/commit` 等の結果報告に添えてユーザーに伝える．ユーザーが PR 作成を指示したことを承認とみなし，改めて確認しない

| 変更ファイル | 追加作業 | 理由 |
| --- | --- | --- |
| `.devcontainer/` 配下 | `/env-notify <PR番号>` を実行する（全員に Rebuild を依頼する Issue を作る） | Rebuild しないと手元の環境が古いまま残り，気付かずに作業してしまう |
| `package.json`・`package-lock.json` のみ | 何もしない | 各自のセッション開始時に `[env-sync]` の警告で `npm ci` を促すため，Issue にするほどではない |

- `/env-notify` が「作者の Rebuild の確認が済んでいない」で止まった場合は失敗ではない．「PR のブランチのまま Rebuild し，`/env-check` を実行してから `/env-notify <PR番号>` を実行する」を次の手順としてユーザーに伝える
- 複数に当てはまる場合はすべて行う．当てはまらなければ何もしない（「追加作業なし」とも言わなくてよい）
- 運用の全体像（警告の仕組み・`/env-check`）は `docs/02_ENV/ENV_05_環境の変更の共有.md` を参照する
