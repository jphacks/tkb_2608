---
name: deploy-staging
model: inherit
description: "main の先頭を staging（https://staging.tkb2608.pages.dev）に配信する．deploy-staging.yml を手動実行し，完了まで見届け，公開 URL で切り替わりを確かめて，今の staging がどのコミット・どの PR までかを報告する．自動配信を止めている時（STAGING_AUTO_DEPLOY=false）に staging へ出す標準の方法．ユーザーに「staging に出して」等と頼まれた時に使う（Claude が自発的に配信しない）．"
argument-hint: "（引数なし．常に main の先頭を出す）"
---

あなたは **staging への配信の担当**です．`.github/workflows/deploy-staging.yml` を手動実行（`workflow_dispatch`）して，`main` の先頭を staging に出し，**今の staging がどの版か**をはっきりさせます．仕組みと自動・手動の切り替えは [ENV_04](../../../docs/02_ENV/ENV_04_開発コマンド.md)「デプロイ」が正である．

- staging は何度出し直してもよく，本番（`/deploy-prod`）と違ってタグのような取り返しのつかない操作は無い．そのため最終確認は 1 回だけにする
- ユーザーに頼まれた時だけ使う．マージの後などに Claude が自発的に配信しない（他のメンバーが staging で確かめている版を置き換えてしまうため）
- 使うのは `gh`（手動実行と実行結果の取得）と `curl`（公開 URL の読み取り）だけ．Cloudflare の API・MCP・認証情報は使わない
- git・gh の操作は ops-runner に委譲せず，メインループで直接行う（数回で済むため）

## ステップ 1: 前提の確認 (Pre-check)

```bash
git fetch origin --prune
target=$(git rev-parse origin/main)
git log -1 --format='%h %s' "$target"
git log --merges --first-parent -3 --format='%h %s' "$target"     # 直近にマージされた PR
gh variable get STAGING_AUTO_DEPLOY 2>/dev/null || echo "(未設定 = 自動)"
gh run list --workflow deploy-staging.yml -L 5 --json databaseId,event,status,conclusion,headSha,createdAt
```

- staging に出るのは**手元のブランチではなく `origin/main` の先頭**であることを確かめる．ユーザーが作業ブランチの内容を出したいと思っている様子なら，「`main` にマージされたものだけが staging に出る」ことを伝えて止まる
- **実行中の配信がある場合**: `deploy-staging.yml` に実行中（`status` が `completed` 以外）のものがあり，その `headSha` が `target` と同じなら，「数分待てば同じ版が自動で出る」と伝えて**待つことを勧める**（手動で出すと同じ版を 2 回配信し，無料枠を余計に使う）．待つ場合は手動実行せず，その実行の完了を見届けてステップ 4 に進む
- **すでに最新の版が出ている場合**: 直前の成功した実行の `headSha` が `target` と同じなら，「すでにこの版が staging に出ている」と伝え，それでも出し直すかを確かめる
- **自動モードの場合**（`STAGING_AUTO_DEPLOY` が未設定または `true`）: ステップ 2 で警告する

## ステップ 2: 確認 (Confirmation)

`AskUserQuestion` で 1 回だけ確かめる．

- 示す内容: 出すコミット（`origin/main` の先頭．ハッシュと件名），直近にマージされた PR，今の staging の版（直前の成功した実行の `headSha`），自動配信のモード
- 注意: staging を他のメンバーが確かめている最中なら，その人の確かめている版が置き換わる
- **自動モードの場合は警告を添える**: 「自動モードなので，`main` にマージされると数分で自動的に置き換わります．手動で出す必要は通常ありません」．手動で出す意味があるのは，配信の失敗後・Secrets の登録直後など，同じ版を出し直したい時くらいである
- 選択肢:
  - 手動モード: 「staging に出す」と「やめる」
  - 自動モード: 「それでも今出す」と「やめる」（既定はやめる側として示す）

## ステップ 3: 手動実行と監視 (Run & Watch)

```bash
gh workflow run deploy-staging.yml --ref main

# 実行の登録が数秒遅れるため，手動実行の新しい実行が見つかるまで待つ（Bash の run_in_background で実行し，完了通知を待つ）
for i in $(seq 1 20); do
  id=$(gh run list --workflow deploy-staging.yml --event workflow_dispatch -L 1 \
    --json databaseId,headSha,createdAt \
    --jq ".[] | select(.headSha==\"$target\") | .databaseId" | head -1)
  [ -n "$id" ] && break
  sleep 6
done
echo "run=$id"
gh run watch "$id" --interval 15 --exit-status > /dev/null
gh run view "$id" --json conclusion,createdAt,updatedAt,url,jobs \
  --jq '{conclusion, createdAt, updatedAt, url, jobs: [.jobs[] | "\(.name): \(.conclusion)"]}'
```

- 手動実行では変更の判定と 3 分の待ちを飛ばすので，1〜2 分で終わる
- 失敗したら `gh run view "$id" --log-failed | tail -60` で原因を確かめ，報告して止まる（Secrets の未登録・失効はユーザーに ENV_03 の対処を案内する）．出し直しはユーザーの指示を待つ

## ステップ 4: 公開 URL での確認 (Verify Live)

```bash
deploy_url=$(gh run view "$id" --log | grep -oE 'https://[0-9a-f]+\.tkb2608\.pages\.dev' | head -1)
curl -s -o /dev/null -w 'deploy=%{http_code}\n' "$deploy_url/"
curl -s -o /dev/null -w 'staging=%{http_code}\n' "https://staging.tkb2608.pages.dev/"
asset() { curl -s "$1/" | grep -oE '/assets/index-[A-Za-z0-9_-]+\.js' | head -1; }
echo "deploy:  $(asset "$deploy_url")"
echo "staging: $(asset "https://staging.tkb2608.pages.dev")"
```

- どちらも `200` で，JS のファイル名が一致すれば，staging は新しい版に切り替わっている
- 一致しない場合は 30 秒ほどおいて 3 回まで確かめ直す（バックグラウンドの実行の中で待つ）．それでも違えば報告する

## ステップ 5: 報告 (Report)

次を簡潔に伝える．

- **今の staging = コミット `<短いハッシュ>`（`<件名>`）**．直近にマージされた PR（番号・タイトル）
- その回の配信の URL（`https://<識別子>.tkb2608.pages.dev`．後から変わらないので，この版を固定で見返したい時に使える）
- 実行ログの URL と所要時間，公開 URL での確認結果
- 「iPhone で https://staging.tkb2608.pages.dev を開いて確かめてください（開いたままのページは再読み込みが必要）」
- この版を本番に出す場合は `/deploy-prod` を使うこと
