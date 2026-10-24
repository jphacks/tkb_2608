# 開発コマンド (Development Commands)

アプリの起動・テスト・lint・ビルド等，日常の開発で使うコマンドの一覧．人間とエージェントはコマンドを推測せず，本ファイルを参照する．
コマンドの実体は `package.json` の `scripts` にまとめてあり，本ファイルは薄い一覧に保つ．コマンドを追加・変更したら両方を更新する．

いずれもコンテナ内のリポジトリ直下で実行する．

## 初回・依存の更新時 (Install)

| コマンド | 内容 |
| --- | --- |
| `npm ci` | `package-lock.json` どおりに依存を入れる．clone 直後や，セッション開始時に `[env-sync]` の警告で促されたときに実行する |
| `npm install <パッケージ>` | 依存を追加する（開発用のツールは `npm install -D <パッケージ>`）．`package-lock.json` も一緒にコミットする |

## 開発 (Development)

| コマンド | 内容 |
| --- | --- |
| `npm run dev` | Vite の開発サーバーを起動する（`http://localhost:5173/`．PC のブラウザで開く） |
| `npm run tunnel` | 開発サーバーを cloudflared の Quick Tunnel で HTTPS の一時 URL として公開し，URL を QR コードでも表示する（スマホの実機確認用．実体は `scripts/tunnel.mjs`．`npm run dev` と別のターミナルで実行し，張りっぱなしにする．手順は [ENV_02](ENV_02_環境構築手順.md)「スマホの実機で確認する」） |

- `npm run tunnel -- train` のように空間の id（`room`・`train`・`elevator`）を渡すと，QR コードの URL に `?scene=train` が付き，読み取るだけでその空間が開く
- `npm run tunnel -- /src/input/dev/` のように `/` で始まるパスを渡すと，QR コードの URL にそのパスが付く（使える文字は英数字・`/`・`-`・`_`・`.`）
- 体験の流れ（開始画面 → ロビー → シナリオ）は URL に `?app` を付けて開く（例: `http://localhost:5173/?app`．スマホでは QR コードの URL の末尾に `?app` を足す）．`?debug`・`?stereo=1` 等は [SPEC_01](../04_SPEC/SPEC_01_画面遷移とモジュール構成.md)「起動の切り替え」を参照
- `npm run tunnel` は外部からアクセスできる経路を開くため，Claude Code の auto mode では実行が止められる．人間が VS Code のターミナルで実行する
- URL を知っていれば誰でも開けるため，使い終わったら `Ctrl+C` で止める

### 担当D の dev ページ (Input Dev Pages)

`src/input/dev/` の HTML は，ビルドの設定を変えずに開発サーバーで直接開ける（本番のビルドには含まれない）．

| ページ | URL（`npm run dev` の後） | 内容 |
| --- | --- | --- |
| 入口 | `http://localhost:5173/src/input/dev/` | 各ページへのリンク．前回開いたページがあれば自動でそこへ移る（止める時は `?stay` を付ける） |
| センサーの確認 | `http://localhost:5173/src/input/dev/sensors.html` | センサーの値・上下の加速度のグラフ・サンプルの周期・記録の状態 |
| 手順の記録 | `http://localhost:5173/src/input/dev/protocol.html` | 決まった手順を表示と音で案内し，案内した時刻からラベルを付けて記録する（約 5 分） |

- スマホでは `npm run tunnel -- /src/input/dev/` の QR コードを読み取る．センサーは HTTPS でないと使えないため，スマホでは必ずトンネル経由で開く
- 一度開けば，PC でコードを保存するとスマホのページも自動で再読み込みされる（Vite の HMR）．センサーの確認ページは，許可済みなら再読み込みの後に自動で記録を再開する（手順の記録ページは音を出すためにタップが要るので，開始ボタンを押し直す）
- iPhone では最初に開始ボタンをタップした時にセンサーの許可を求められる
- 記録は 2 秒ごとに開発サーバーへ送られ，`logs/input/<YYYYMMDD-HHMMSS>_<セッション ID>.jsonl` に追記される（`logs/` は Git の管理外．再読み込みのたびに新しいセッション＝新しいファイルになる）．受け取る口は開発サーバーだけにある（`src/input/dev/inputLogPlugin.ts`．`npm run build` の出力には含まれない）
- 開発サーバーにつながらない間の記録はページのメモリに残り，「記録をダウンロード」で `.jsonl` として保存できる（ページを閉じると消える）

## 確認 (Checks)

PR を作る前に，以下がすべて通ることを確認する．

| コマンド | 内容 |
| --- | --- |
| `npm run lint` | Biome で lint と整形の差分を確認する（書き換えない） |
| `npm run format` | Biome で lint の自動修正と整形を行う（ファイルを書き換える） |
| `npm run typecheck` | TypeScript の型チェック（`tsc`．出力はしない） |
| `npm test` | Vitest で単体テストを実行する（`src/**/*.test.ts`） |
| `npm run build` | 型チェックの後，`dist/` に本番用のファイルを出力する（GitHub Pages 用に `base` が `/tkb_2608/` になる） |
| `npm run preview` | `npm run build` の出力をローカルで配信して確認する |

- Biome の対象は `src/`・`scripts/`・`vite.config.ts` と設定ファイル（`biome.json`・`tsconfig.json`・`package.json`）だけに絞っている（`biome.json` の `files.includes`）．Biome は Markdown も整形できるため，対象を広げると `docs/`・`.claude/` のフロントマターや表が書き換えられてルールが壊れる（実際に起きた）．対象を広げない
- ビルド時の「500 kB を超えるチャンクがある」という警告は three.js 等の大きさによるもので，現時点では無視してよい（必要になったら分割する）

## デプロイ (Deployment)

Cloudflare Pages に GitHub Actions が配信する（準備は [ENV_03](ENV_03_管理者用環境構築手順.md)「Cloudflare Pages の準備」）．手元からデプロイのコマンドは打たない．

| 環境 | URL | 配信されるタイミング |
| --- | --- | --- |
| staging | `https://staging.tkb2608.pages.dev` | `main` へのマージで自動（`deploy-staging.yml`．下記の切り替えで手動だけにもできる）．無料枠の配信回数を節約するため，マージから 3 分待って続くマージをまとめてから配信する（反映まで 5 分ほど）．docs 等だけの変更では配信しない |
| 本番 | `https://tkb2608.pages.dev` | `main` 上のコミットに `v*` の annotated タグを push したとき（`deploy-prod.yml`） |

PR では CI（`ci.yml`: lint・型チェック・テスト・ビルド）だけが動く．PR ごとのプレビューは今は作っていない（必要になったら追加する）．

### staging の手動実行と自動配信の切り替え

staging への自動配信（`main` へのマージのたび）は，リポジトリの変数 `STAGING_AUTO_DEPLOY` で止められる．

| モード | 設定 | 使う時期 |
| --- | --- | --- |
| 自動（既定） | 変数なし，または `true` | 作業する人が少ない時．マージのたびに staging が最新になる |
| 手動 | `false` | 同時並行でマージが続く時（ハッカソン中等）．staging が勝手に置き換わらないので，確かめたい版を落ち着いて確かめられる．無料枠の配信回数も節約できる |

```bash
gh variable set STAGING_AUTO_DEPLOY --body false   # 手動にする
gh variable set STAGING_AUTO_DEPLOY --body true    # 自動に戻す
gh variable get STAGING_AUTO_DEPLOY                # 今の状態（未設定なら自動）
```

- リポジトリの設定の変更なので，管理者（人間）が行う（GitHub の Settings → Secrets and variables → Actions → Variables でもよい）．切り替えたらチームに伝える
- 手動モードでは，staging に出したい時に下記の手動実行を行う．`/deploy-prod` も，手動実行で staging に出た版だけを本番に出す
- staging に出したい時・配信し直したい時（配信の失敗後・Secrets の登録直後等）は，Claude Code で **`/deploy-staging`** を使う（`main` の先頭を出し，完了まで見届けて，今の staging がどのコミット・どの PR までかを報告する）．手で行う場合は Actions の画面の「Deploy (staging)」→ **Run workflow**（Branch は `main`）で手動実行する．`gh workflow run deploy-staging.yml --ref main` でもよい．手動実行では変更の判定と 3 分の待ちを飛ばしてすぐ配信する

### 本番に出す手順

**本番に出せるのは管理者（リポジトリの admin）だけ**．`v*` タグの作成は Ruleset `release tags: admin のみ` で admin 以外に禁止されている（[ENV_03](ENV_03_管理者用環境構築手順.md)「本番のリリースを管理者だけにする」）．他のメンバーは，本番に出したい版が staging で確かめられたら管理者に依頼する．

通常は管理者が Claude Code で **`/deploy-prod`** を実行する．前提の確認・バージョンの案・最終確認・タグの作成と push・配信の見届け・公開 URL での確認・[ENV_06](ENV_06_デプロイ記録.md) への記録までを行う．手で行う場合は次のとおり（記録は手で ENV_06 に追記する）．

1. staging（`https://staging.tkb2608.pages.dev`）を iPhone で開き，出したい版が動くことを確かめる
2. `main` を最新にして，staging で確かめたコミットに annotated タグを打って push する

   ```bash
   git switch main && git pull
   git tag -a v0.1.0 -m "<リリース内容>"   # -a を付ける（軽量タグは deploy-prod.yml が拒否する）
   git push origin v0.1.0
   ```

3. Actions の「Deploy (prod)」が成功したら，`https://tkb2608.pages.dev` を iPhone で開いて確かめる

- バージョンは `v0.1.0` から始め，出すたびに上げる（同じタグは使い回さない）
- 発表・デモの前に本番を出し，以降は確かめた版だけを出す（`main` に入っただけの変更は本番に出ない）
- タグを間違えた場合は `git push --delete origin <タグ>` と `git tag -d <タグ>` で消してから打ち直す
