# /deploy-prod 手順書 (Reference)

`/deploy-prod` の各ステップで使うコマンド・判定条件・失敗時の対処．ワークフローの挙動は `.github/workflows/deploy-prod.yml`・`deploy-staging.yml` と [ENV_04](../../../docs/02_ENV/ENV_04_開発コマンド.md)「デプロイ」を正とする．

## 前提チェック (Pre-check)

```bash
# 0. 実行者がリポジトリの admin（admin と出なければ止まる）
gh api "repos/{owner}/{repo}/collaborators/$(gh api user -q .login)/permission" -q .role_name

# 1. 作業ツリーがクリーン（出力が空）
git status --porcelain

# 2. 最新化し，対象コミットを決める（引数で指定されたらそのコミット）
git fetch origin --tags --prune
target=$(git rev-parse origin/main)
git merge-base --is-ancestor "$target" origin/main   # 終了コード 0 なら main 上

# 3. 対象コミットに v* タグが無い（出力が空）．本番の実行中が無い（0）
git tag --points-at "$target" --list 'v*'
gh run list --workflow deploy-prod.yml --json status \
  --jq '[.[] | select(.status != "completed")] | length'

# 4. 対象コミットの staging 配信（push と手動実行の両方が出る）と，自動配信の切り替えの状態
gh run list --workflow deploy-staging.yml --commit "$target" \
  --json databaseId,event,status,conclusion,createdAt
gh run view <databaseId> --json jobs --jq '.jobs[] | "\(.name): \(.conclusion)"'
gh variable get STAGING_AUTO_DEPLOY 2>/dev/null || echo "(未設定 = 自動)"

# 5. 前回タグと差分
prev=$(git describe --tags --abbrev=0 --match 'v*' "$target")
git diff --name-only "$prev" "$target"
```

判定:

- 0 は，`admin` のときだけ進む．`write` 等なら止まる（タグの Ruleset により push も拒否されるため，途中まで進めない）
- 4 は，対象コミットの実行（push・手動実行 `workflow_dispatch` のどちらでもよい）のうち，`completed` / `success` で `Deploy to staging` ジョブが `success` のものが 1 つでもあれば可．`Detect changes` の結果で配信不要と判定され `Wait for further merges`・`Deploy to staging` が `skipped` の場合も可（配信物に影響しない変更だけだったことを表す）
  - **自動配信を止めている（`STAGING_AUTO_DEPLOY=false`）場合**: push の実行は `Deploy to staging` が `skipped` になる（「自動配信を止めている」の notice が出る）．これは「staging に出ていない」ことを表すので可としない．手動実行で `Deploy to staging` が `success` の実行が必要．無ければ「Run workflow で staging に出し，iPhone で確かめてから再度 `/deploy-prod`」を案内して止まる
  - 対象コミットより後に別のコミットを手動で staging に出していた場合は，今の staging は別の版になっている．最終確認で「確かめたのはどの版か」を明示して問う
  - **`cancelled` の場合**: 3 分の待ちの間に次のマージが来て，その実行に引き継がれた（`deploy-staging.yml` のまとめる仕組み）．この場合，そのコミット単体は staging に出ていない．`origin/main` の先頭を対象にしているなら，先頭のコミットの実行を見る．古いコミットを指定されていたら，「staging に出ていない版」であることを伝えて止まる
  - 実行が見つからない・失敗・実行中なら止まる．実行中なら完了を待ってから再度 `/deploy-prod` を案内する．Secrets 未登録の警告で配信が飛ばされた場合も止まる
- 5 は，差分のファイルがすべて配信物に影響しないもの（`docs/`・`.claude/`・`*.md`（`CLAUDE.md` を含む）・`.devcontainer/`・`.github/dependabot.yml`・`.github/CODEOWNERS`．`deploy-staging.yml` の判定と同じ）なら「本番に出る変更なし」として止まる．`.github/workflows/` だけの変更も体験者には届かないため，その場合はリリースする意味があるかをユーザーに確認する
- `git describe` がタグを見つけられない（初回リリース）場合は，`main` の全履歴を対象とする．本番には Pages のプロジェクト作成時に手でアップロードした初期版が出ていることを最終確認で伝える

## リリース内容の収集 (Release Notes)

```bash
# 前回タグから対象コミットまでにマージされた PR 番号（初回は "$target" だけを指定して全履歴）
git log --merges --first-parent --format='%s' "$prev..$target" | grep -oE '#[0-9]+'

# 各 PR のタイトル
gh pr view <番号> --json number,title --jq '"#\(.number) \(.title)"'
```

## バージョンの上げ方 (Versioning)

書式は `v<major>.<minor>.<patch>`（先頭の `v` は必須）．ハッカソンの間は `0.x.y` で運用する．

| 桁 | 上げる変更 |
| --- | --- |
| patch | 不具合の修正・文言や調整値の変更・依存の更新など，体験の流れが変わらない変更 |
| minor | 機能や場面の追加，入力（足踏み・しゃがみ・手）の判定の追加・変更など，体験が変わる変更 |
| major | 提出版・Award Day 版などの節目（`v1.0.0` 等）．本スキルからは案を出さず，ユーザーが決める |

- 初回のタグは `v0.1.0`
- 配信済みの内容は巻き戻らない．配信後に不具合が見つかった場合は，修正を `main` に入れて新しい patch のタグを打つ

## タグの作成と push (Tag & Push)

```bash
git tag -a "<vX.Y.Z>" "$target" -m "[タグ] 内容"
git cat-file -t "<vX.Y.Z>"   # tag と出れば annotated
git push origin "<vX.Y.Z>"
```

- ブランチを切り替える必要はない（コミットを明示してタグを打つ）
- push は 1 回だけ行う．失敗した場合は原因（認証・分類器ブロック等）を報告して止まる

## 配信の監視 (Watch)

push 直後は実行の登録が数秒遅れるため，見つかるまで待ってから監視する．`Bash` の `run_in_background` で実行し，完了通知を待つ．

```bash
for i in $(seq 1 20); do
  id=$(gh run list --workflow deploy-prod.yml -L 5 --json databaseId,headBranch \
    --jq '.[] | select(.headBranch=="<vX.Y.Z>") | .databaseId' | head -1)
  [ -n "$id" ] && break
  sleep 6
done
echo "run=$id"
gh run watch "$id" --interval 20 --exit-status > /dev/null
gh run view "$id" --json status,conclusion,createdAt,updatedAt,url,jobs \
  --jq '{status, conclusion, createdAt, updatedAt, url,
         jobs: [.jobs[] | "\(.name): \(.conclusion)"],
         steps: [.jobs[].steps[] | select(.name | test("Deploy|Lint|Typecheck|Test|Build|Verify")) | "\(.name): \(.conclusion)"]}'
```

ジョブの構成は `Verify release tag` → `Validate and deploy to production`（Secrets の確認 → lint → 型チェック → テスト → ビルド → `Deploy to Cloudflare Pages (production)`）．所要は 2〜3 分程度．

## 公開 URL での確認 (Verify Live)

認証の要らない公開 URL を読むだけで，Cloudflare の API は使わない．

```bash
# その回の配信の URL（wrangler のログに出る）
deploy_url=$(gh run view "$id" --log | grep -oE 'https://[0-9a-f]+\.tkb2608\.pages\.dev' | head -1)
echo "deploy_url=$deploy_url"

# 1. どちらも 200 を返す
curl -s -o /dev/null -w 'deploy=%{http_code}\n' "$deploy_url/"
curl -s -o /dev/null -w 'prod=%{http_code}\n' "https://tkb2608.pages.dev/"

# 2. index.html が参照する JS のファイル名が一致する（本番が新しい版に切り替わっている）
asset() { curl -s "$1/" | grep -oE '/assets/index-[A-Za-z0-9_-]+\.js' | head -1; }
echo "deploy: $(asset "$deploy_url")"
echo "prod:   $(asset "https://tkb2608.pages.dev")"
```

- 一致しない場合は 30 秒ほどおいて 3 回まで確かめ直す（`sleep` はバックグラウンドの実行の中で行う）．それでも違えば，「配信は成功したが本番の URL では古い版が見えている」として報告する
- `deploy_url` がログから取れない場合は，Actions の画面の「Deploy to Cloudflare Pages (production)」のログを見るよう報告し，本番の URL の `200` だけを確かめる

## 失敗時の対処 (On Failure)

失敗箇所ごとに本番の状態が異なる．どの対処も**ユーザーの指示を得てから**行う．

| 失敗箇所 | 本番の状態 | 主な原因 | 対処 |
| --- | --- | --- | --- |
| タグの push が拒否される | 変わっていない（配信なし） | 実行者が admin でない（Ruleset `release tags: admin のみ`） | 管理者に依頼する．Ruleset は迂回しない |
| `Verify release tag` | 変わっていない（配信なし） | 軽量タグ・`main` 外のコミット | タグを削除して打ち直す（下記コマンド） |
| `Check secrets` | 変わっていない（配信なし） | `CLOUDFLARE_API_TOKEN`・`CLOUDFLARE_ACCOUNT_ID` が未登録 | 人間が Secrets を登録してから `gh run rerun <id> --failed`（ENV_03「Cloudflare Pages の準備」） |
| Lint・Typecheck・Test・Build | 変わっていない（配信なし） | 検証の失敗（フレーク・ツールの版の差等） | フレークなら `gh run rerun <id> --failed`．実際の不具合なら修正を PR で `main` に入れ，staging で確認後に新しいタグを打つ |
| `Deploy to Cloudflare Pages (production)` | 変わっていない（Cloudflare のデプロイは全ファイルのアップロード後に切り替わる） | API トークンの失効・権限不足，プロジェクト名の不一致，無料枠の上限（月 500 回） | トークン・権限なら人間が Cloudflare と Secrets を直してから `gh run rerun <id> --failed`．無料枠なら月が替わるまで待つか，人間がダッシュボードから手でアップロードする |

```bash
# 失敗したジョブのログ
gh run view <id> --log-failed | tail -80

# タグの削除と打ち直し（配信されていない場合のみ）
git tag -d <vX.Y.Z>
git push --delete origin <vX.Y.Z>
```

## デプロイ記録の追記 (Record)

```bash
git switch main && git pull --ff-only
git switch -c docs/deploy-record-<vX-Y-Z>   # 例: docs/deploy-record-v0-1-0

# 記録に使う値
git for-each-ref "refs/tags/<vX.Y.Z>" --format='%(taggerdate:iso8601)'   # 日時（JST に直す）
gh run view <id> --json conclusion,createdAt,updatedAt,url                # 結果・所要・URL
```

- `docs/02_ENV/ENV_06_デプロイ記録.md` の「一覧」表の先頭行と「詳細」節の先頭に追記する（新しいものを上）
- 日時は JST（`TZ=Asia/Tokyo date -d '<ISO 8601>' '+%Y-%m-%d %H:%M'`）．所要は `createdAt` から `updatedAt` まで（分単位で丸める）
- 結果は `成功` / `失敗（配信なし）`．失敗した場合は詳細に原因と対処を書く
- 詳細には，タグメッセージ・実行ログの URL・その回の配信の URL・公開 URL での確認結果・含む PR（全件．PR へのリンク付き）・備考（既知の問題等）を書く
- コミットはしない．ユーザーに `/commit merge` を案内する
