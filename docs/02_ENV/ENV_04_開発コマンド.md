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
| `npm run tunnel` | 開発サーバーを cloudflared の Quick Tunnel で HTTPS の一時 URL として公開する（スマホの実機確認用．`npm run dev` と別のターミナルで実行し，張りっぱなしにする．手順は [ENV_02](ENV_02_環境構築手順.md)「スマホの実機で確認する」） |

- `npm run tunnel` は外部からアクセスできる経路を開くため，Claude Code の auto mode では実行が止められる．人間が VS Code のターミナルで実行する
- URL を知っていれば誰でも開けるため，使い終わったら `Ctrl+C` で止める

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

- Biome の対象は `src/`・`vite.config.ts` と設定ファイル（`biome.json`・`tsconfig.json`・`package.json`）だけに絞っている（`biome.json` の `files.includes`）．Biome は Markdown も整形できるため，対象を広げると `docs/`・`.claude/` のフロントマターや表が書き換えられてルールが壊れる（実際に起きた）．対象を広げない
- ビルド時の「500 kB を超えるチャンクがある」という警告は three.js 等の大きさによるもので，現時点では無視してよい（必要になったら分割する）

## 未確定 (To Be Decided)

- デプロイ（開発用・本番の URL と配信方法）．[ENV_03](ENV_03_管理者用環境構築手順.md)「GitHub Pages の有効化」を前提に，管理者が決めて追記する
