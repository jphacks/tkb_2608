# PR 作成後の追加作業 (Pull Request Follow-ups)

PR を作成・マージした後に，変更の内容に応じて Claude が自動で行う追加作業を定める．このプロジェクトでの PR の書き方・注意点も，今後は本ファイルに追記していく．

## 適用するタイミング (When to Apply)

- `/commit push`・`/commit merge` で PR を作成（またはマージ）し，ops-runner の報告を受け取った後（司令塔が行う．ops-runner には判断させない）
- `/deps-update` で Dependabot の PR をマージした後
- ユーザーが手動で PR を作った後に，追加作業の確認を頼まれたとき

## 手順 (Procedure)

1. PR の変更ファイルを取る（ops-runner の事実報告はそのコミットの分しか含まないことがあるため，PR 全体で見る）:

   ```bash
   gh pr diff <PR番号> --name-only
   ```

2. 下表に当てはまる作業を行い，結果を `/commit` 等の結果報告に添えてユーザーに伝える．ユーザーが PR 作成を指示したことを承認とみなし，改めて確認しない

| 変更ファイル | 追加作業 | 理由 |
| --- | --- | --- |
| `.devcontainer/` 配下 | `/env-notify <PR番号>` を実行する（全員に Rebuild を依頼する Issue を作る） | Rebuild しないと手元の環境が古いまま残り，気付かずに作業してしまう |
| `package.json`・`package-lock.json` のみ | 何もしない | 各自のセッション開始時に `[env-sync]` の警告で `npm ci` を促すため，Issue にするほどではない |

- 複数に当てはまる場合はすべて行う．当てはまらなければ何もしない（「追加作業なし」とも言わなくてよい）
- 運用の全体像（警告の仕組み・`/env-check`）は `docs/02_ENV/ENV_05_環境の変更の共有.md` を参照する
