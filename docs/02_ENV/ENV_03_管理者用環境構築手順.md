# 管理者用環境構築手順 (Admin Setup)

プロジェクト作成時に管理者（リポジトリ admin．`rintoHasegawa`）が一度だけ行う初期設定をまとめる．
メンバーが参加時に行う手順は [ENV_02](ENV_02_環境構築手順.md)，チーム運用の初期設定（メンバー招待・`main` の保護等）は [GUIDE_03](../01_GUIDE/GUIDE_03_チーム開発ルール.md)「管理者の初期設定」を参照する．

## 実施状況 (Status)

| 項目 | 状態 |
| --- | --- |
| GitHub リポジトリの作成（[jphacks/tkb_2608](https://github.com/jphacks/tkb_2608)） | 済み（運営が作成．public・MIT ライセンス） |
| `main` の保護（Ruleset）・CODEOWNERS | 済み（GUIDE_03） |
| CI の合格を `main` へのマージの必須条件にする | 未実施（下記「CI の合格を必須にする」） |
| Dependabot alerts / security updates の有効化 | 済み（2026-10-24．`/setup` が `gh api` で有効化・検証） |
| 依存バージョン更新（`.github/dependabot.yml`） | 済み（npm・devcontainers・github-actions を週 1 回） |
| Cloudflare Pages の準備（アカウント・プロジェクト・API トークン・Secrets） | 未実施（下記「Cloudflare Pages の準備」） |

## GitHub リポジトリのセキュリティ設定 (GitHub Repository Security Settings)

GitHub の Settings → Code security にある **Dependabot alerts**（既知脆弱性の検出．"Vulnerabilities" として表示される）と **Dependabot security updates**（脆弱性を直す PR の自動作成）は，リポジトリごとに既定で OFF になっている．リポジトリを作り直した場合は，作成の直後に以下を実行する．

前提:

- `gh auth login` 済みであること（既定スコープ `repo` で足りる）
- 実行者がリポジトリの **admin 権限**を持つこと（無いと 403）
- カレントディレクトリがリポジトリの clone であること

1. リモートを確認する:

   ```bash
   gh repo view --json nameWithOwner -q .nameWithOwner   # jphacks/tkb_2608 と表示されれば OK
   ```

2. 有効化する（何度実行してもよい）:

   ```bash
   gh api -X PUT repos/{owner}/{repo}/vulnerability-alerts        # Dependabot alerts（依存グラフも同時に有効化される）
   gh api -X PUT repos/{owner}/{repo}/automated-security-fixes    # Dependabot security updates
   ```

3. 有効化を確認する:

   ```bash
   gh api repos/{owner}/{repo}/vulnerability-alerts               # 成功（204）なら有効．404 なら無効
   gh api repos/{owner}/{repo}/automated-security-fixes           # {"enabled":true,...} なら有効
   ```

| 症状 | 原因 | 対処 |
| --- | --- | --- |
| `PUT` が 401 | `gh` のトークンが無効 | `gh auth login -h github.com` で再ログインする |
| `PUT` が 403 | admin 権限が無い，またはトークンのスコープ不足 | 管理者が行うか，Settings → Code security → Dependabot から手動で ON にする |
| `PUT` が 404 | `{owner}/{repo}` の補完に失敗 | `repos/jphacks/tkb_2608/...` のように明示する |

依存パッケージの定期更新は `.github/dependabot.yml` で設定している（上記の脆弱性検出とは独立に動く）．Dependabot が作った PR と alert は `/deps-update` で処理する．

## CI の合格を必須にする (Require CI)

`.github/workflows/ci.yml` の合格を，`main` へのマージの必須条件にする（GUIDE_03 のセルフマージ条件「CI 緑」を仕組みで強制する）．GitHub の画面での操作のため，管理者が行う（Claude は行わない）．

**admin の例外（bypass）を効かせないため，既存の Ruleset に足さず，抜け道の無い Ruleset を新しく作る**．例外は Ruleset ごとに設定されるので，既存の `main: PR 必須と共有設定のレビュー` に足すと，admin が CI が赤のままマージできてしまう．共有設定の Approve は従来どおり admin の例外で飛ばせるが，CI の合格は admin でも飛ばせないようにする．

| Ruleset | 内容 | 例外（bypass） |
| --- | --- | --- |
| `main: 履歴の保護`（既存） | 削除・force push の禁止 | なし |
| `main: PR 必須と共有設定のレビュー`（既存） | PR 必須・共有設定の Approve | admin（PR のマージ時だけ） |
| `main: CI 必須`（新規） | `Lint / typecheck / test / build` の合格必須 | なし |

- 必須にするチェックは，**一度実行されたものしか選択肢に出ない**．`ci.yml` を入れた PR で CI が 1 回動いた後に行う

1. リポジトリの Settings → Rules → Rulesets → New ruleset → New branch ruleset を開く
2. Ruleset Name を `main: CI 必須`，Enforcement status を **Active** にする
3. Bypass list には**何も追加しない**
4. Target branches で Add target → Include default branch（`main`）を追加する
5. Rules で「Require status checks to pass」だけにチェックを入れ，「Add checks」で **`Lint / typecheck / test / build`**（`ci.yml` のジョブ名）を追加する
   - 「Require branches to be up to date before merging」は**付けない**．細かくマージするため，付けると他の人のマージのたびに全 PR で更新と CI のやり直しが要り，開発が遅くなる．代わりに Claude が PR を作る前にブランチが古くないかを確かめ，古ければ最新の `main` を取り込む（`.claude/rules/pr-workflow.md`）
   - `hooks-ci` のジョブ（`hooks (...)`）は追加しない．`.claude/hooks/` を変えた PR でしか動かないため，必須にすると他の PR がマージできなくなる
6. Create で保存する
7. 次の PR で，CI が終わるまでマージボタンが押せないこと（`Required` と表示されること）を確かめる

- docs だけの PR・Dependabot の PR も CI の合格が必要になる（CI は 1〜2 分で終わる）
- CI 自体が壊れた場合: `ci.yml` を直す PR は直した側の `ci.yml` で CI が動くため，その PR は通せる
- GitHub Actions の障害で CI が動かず，どうしてもマージが必要な場合: admin がこの Ruleset の Enforcement status を一時的に Disabled にし，マージ後すぐ Active に戻す．うっかり使われないよう，例外ではなくこの操作を必要にしている

## Cloudflare Pages の準備 (Cloudflare Pages Setup)

アプリは Cloudflare Pages で配信する（[ENV_01](ENV_01_技術スタック.md)．決定の経緯は Issue #21）．GitHub Actions（`.github/workflows/deploy-staging.yml`・`deploy-prod.yml`）が API トークンを使って `wrangler` でアップロードするため，**GitHub アプリの連携（Organization への承認）は不要**．
以下は外部サービスの操作のため，管理者が行う（Claude は行わない）．

### 1. アカウントを作る

- このプロジェクト専用のアカウントを作る（個人の他の利用と混ぜない）．メールアドレスは確認メールを受け取れればよく，Gmail の別名（`<ユーザー名>+tkb2608@gmail.com`）でもよい
- **クレジットカードは登録しない**（無料プランのまま使う．制限を超えても課金されず，配信が止まるだけ）
- 2 段階認証を有効にする
- パスワードはメンバー間で共有しない．他のメンバーにダッシュボードを見せる場合は，Cloudflare のメンバー招待で各自のアカウントを追加する．デプロイは Actions が行うため，通常はメンバーのログインは不要

### 2. Pages のプロジェクトを作る

1. ダッシュボードの Workers & Pages → Create → Pages → **Direct Upload（Upload assets）** を選ぶ（Git 連携は選ばない）
2. プロジェクト名を `tkb2608` にする（URL が `https://tkb2608.pages.dev` になる）．使えない場合は別の名前にし，`.github/workflows/deploy-staging.yml`・`deploy-prod.yml` の `PAGES_PROJECT` と ENV_01・ENV_04 の URL を合わせて直す
3. 最初のアップロードを求められたら，`npm run build` で作った `dist/` を選ぶ（後から Actions が上書きする）
4. プロジェクトの Settings で **Production branch が `main`** になっていることを確認する（`deploy-prod.yml` は `--branch=main` で本番に出す．`main` 以外の名前は staging 等のプレビュー扱いになる）

### 3. API トークンを発行する

1. ダッシュボード右上のプロフィール → API Tokens → Create Token → Create Custom Token
2. 権限は **Account → Cloudflare Pages → Edit** だけにする（他の権限は付けない）．Account Resources は自分のアカウントに限定する
3. 発行されたトークンは一度しか表示されないので，そのまま次の手順で GitHub に登録する．チャット・Issue・ファイルには貼らない
4. アカウント ID はダッシュボードの Workers & Pages の画面右側に表示される

### 4. GitHub の Secrets に登録する

リポジトリの Settings → Secrets and variables → Actions → New repository secret で，次の 2 つを登録する．

| 名前 | 値 |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | 3 で発行したトークン |
| `CLOUDFLARE_ACCOUNT_ID` | アカウント ID |

- 登録前でも `main` へのマージは止まらない（staging の配信は警告を出して飛ばされる）．本番（タグ）は Secrets が無いと失敗する
- 登録後，`main` に配信物の変更（`src/` 等）が入ると staging に配信される．Actions の画面で「Deploy (staging)」が成功し，`https://staging.tkb2608.pages.dev` を iPhone で開けることを確かめる

### 無料プランの制限 (Free Plan Limits)

- ビルド（配信）は月 500 回まで（アカウント全体．Actions からのアップロードが数えられるかは公式に明記なし）．月初めにリセットされる
- 1 回の配信で 20,000 ファイル・1 ファイル 25 MiB まで
- 回数を抑えるため，staging は docs 等だけの変更では配信せず，マージ後 3 分待ってその間の続くマージをまとめ，配信中に来たマージも最新の 1 件だけを配信する（`deploy-staging.yml`）
