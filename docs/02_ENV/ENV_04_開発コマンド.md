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
| `npm run dev:record` | 動きの記録用の開発サーバー（`vite --mode record`）．WebSocket を切るため，`src/` を編集しても開いているページが再読み込みされない（自動更新も効かない）．`npm run dev` と同じポート 5173 を使うので，`npm run dev` を止めてから起動する（手順は [TEST_01](../06_TEST/TEST_01_動きの記録の取り方.md)） |
| `npm run tunnel` | 開発サーバーを cloudflared の Quick Tunnel で HTTPS の一時 URL として公開し，URL を QR コードでも表示する（スマホの実機確認用．実体は `scripts/tunnel.mjs`．`npm run dev` と別のターミナルで実行し，張りっぱなしにする．手順は [ENV_02](ENV_02_環境構築手順.md)「スマホの実機で確認する」） |

- `npm run tunnel -- train` のように空間の id（`room`・`train`・`elevator`・`school-parts`）を渡すと，QR コードの URL に `?scene=train` が付き，読み取るだけでその空間が開く
- `npm run tunnel -- /src/input/dev/` のように `/` で始まるパスを渡すと，QR コードの URL にそのパスが付く（使える文字は英数字・`/`・`-`・`_`・`.`）
- 体験の流れ（開始画面 → ホーム → ロビー → シナリオ）は URL に `?app` を付けて開く（例: `http://localhost:5173/?app`．スマホでは QR コードの URL の末尾に `?app` を足す）．`?debug`・`?stereo=1` 等は [SPEC_01](../04_SPEC/SPEC_01_画面遷移とモジュール構成.md)「起動の切り替え」を参照
  - 結果画面だけを確かめる時は `http://localhost:5173/?debrief`（`?debrief=late` で逃げ遅れ，`?debrief=nosmoke` で煙の中にいなかった場合）．デモの校舎と手で作った記録で表示する（開発サーバーでだけ使える）
  - `?app` だけなら入力はスマホのセンサー（`device`）で，頭の向き・足踏み・しゃがみが流れに届く．PC では `?app&input=mock` で開き，下記の `?input=mock` と同じキー・ドラッグで操作する（PC で `?app` だけだと視点は動かない）
- `http://localhost:5173/?input=mock` のように `?input=` を付けると，担当D の `src/input/` の入力で歩く（当たり判定あり．`?scene=` と併用できる．例: `?scene=train&input=mock`）．指定しない時は今までどおりドラッグで視点を回し，画面のボタンで歩く
  - `?input=mock`: PC 用．W で歩く（1.0 m/s）・S でゆっくり歩く（0.5 m/s．足踏みには向きが無いため後ろへは進まない）・C でしゃがみの切り替え・E で近くのドアの開閉・ドラッグで頭の向き（A・D は今は使わない）．手は右手だけで，マウスの位置が右手の位置（画面のマウスの下・目の前 0.45 m の所）・右ボタンか F キーを押している間は握る（`grip: 1`）・ホイールで手の奥行き（0.2〜0.8 m）．マウスが画面の外に出ると手は未認識になる
  - `?input=device`: スマホの実機用（トンネル経由の HTTPS で開く）．画面をタップしてセンサーを許可すると，頭の向き・足踏み・しゃがみの判定で動く．最初に受け取った向きが正面になる．同じタップで背面カメラも取り，手を認識する（`?app` では開始画面で取ったカメラを使う）
  - `?input=replay`: 開発サーバー（`npm run dev`）でだけ使える．`logs/input/` の記録を，記録した時と同じ間隔で本物の入力と同じ判定に流す（実機の動きのとおりの入力で部屋やシナリオを確かめる）．`?log=<ファイル名>` で記録を選ぶ（省くと最も新しい記録），`?from=<秒>` で途中から流す，`?loop=0` で最後まで流したら止める（既定は最初に戻る）．例: `?scene=train&input=replay&log=20261024-143537_o0qich1i.jsonl&from=30`．`?app&input=replay` でも使える．本番のビルドには含まれず，本番で指定すると止まって立ったままになる
  - いずれも画面の左上に `PlayerInput` の中身（`posture`・`walking`・`walkSpeed`・頭のヨー・両手の位置と `grip`）と歩行の状態（位置・エリア・近くのドア）を出す．画面のボタンは出さない
- `npm run tunnel` は外部からアクセスできる経路を開くため，Claude Code の auto mode では実行が止められる．人間が VS Code のターミナルで実行する
- URL を知っていれば誰でも開けるため，使い終わったら `Ctrl+C` で止める

### 担当D の dev ページ (Input Dev Pages)

`src/input/dev/` の HTML は，ビルドの設定を変えずに開発サーバーで直接開ける（本番のビルドには含まれない）．

| ページ | URL（`npm run dev` の後） | 内容 |
| --- | --- | --- |
| 入口 | `http://localhost:5173/src/input/dev/` | 各ページへのリンク．前回開いたページがあれば自動でそこへ移る（止める時は `?stay` を付ける） |
| センサーの確認 | `http://localhost:5173/src/input/dev/sensors.html` | センサーの値・上下の加速度のグラフ・サンプルの周期・記録の状態 |
| 手順の記録 | `http://localhost:5173/src/input/dev/protocol.html` | 決まった手順を表示と音で案内し，案内した時刻からラベルを付けて記録する（約 5 分） |
| 判定の確認 | `http://localhost:5173/src/input/dev/detect.html` | 足踏み・しゃがみの判定の途中の値（上下の加速度・帯域通過後・しきい値・`Δh`）と状態のグラフ，`PlayerInput`，出来事の一覧．しきい値をスライダーで変えられる |
| ゴーグルでの確認 | `http://localhost:5173/src/input/dev/goggles.html` | 左右 2 画面の最小限の空間（床の格子・1 m ごとの柱・正面の目印）で，判定のとおりに歩く・しゃがむ・見回す．判定の状態を視界の下に出し，1 歩ごと・姿勢の切り替えで音を鳴らす（`?sound=0` で消す）．開始の後に画面をタップすると正面と位置をリセットする |
| 再生と調整（PC） | `http://localhost:5173/src/input/dev/replay.html` | `logs/input/` の記録（または手元の `.jsonl`）を今のコードの判定に流し直す．波形・Δh・判定（基準のしきい値＝前と，スライダーの値＝後）・手順のラベル・印を同じ時間軸に重ね，指標（誤検出・見逃し・動き出しの遅れ）を前後で並べる．決めた値を params の JSON と URL パラメータで書き出す．表示の範囲を回帰テスト用の `.jsonl` に切り出せる．`?log=<ファイル名>` で開いた時に読み込む |
| 手の確認 | `http://localhost:5173/src/input/dev/hands.html` | 背面カメラ（PC ではウェブカメラ）の映像に，認識した 21 点・なめらかにした手のひらの中心と人差し指の先・手の形（握・摘・指）を重ねる．認識の処理（Worker／メインスレッド，GPU／CPU）・頻度・1 回の時間・映像から結果までの遅れ・描画の fps と，左右の手の位置・奥行き・`grip`・つまむ・指を差すを出す．認識の結果（21 点）を `hand` として記録する．`?worker=0` でメインスレッドで認識する．しきい値は `?cameraHfovDeg=60&oneEuroBeta=2` のように渡す（項目名は `src/input/hand/handParams.ts` の `HandParams`） |
| 操作盤（PC） | `http://localhost:5173/src/input/dev/panel.html` | スマホで記録を始めた後に PC で開き，誤判定を見たら `1`（歩いていないのに進んだ）・`2`（歩いたのに進まない）・`3`（立っていないのに立った）・`4`（手が震えた・消えた）・`Space`（その他）を押す．印は開発サーバー経由でスマホの記録に `mark` として書き込まれる．スマホの判定の状態（約 2 秒遅れ）も出す |

- スマホでは `npm run tunnel -- /src/input/dev/` の QR コードを読み取る．センサーは HTTPS でないと使えないため，スマホでは必ずトンネル経由で開く
- 一度開けば，PC でコードを保存するとスマホのページも自動で再読み込みされる（Vite の HMR）．センサーの確認ページは，許可済みなら再読み込みの後に自動で記録を再開する（手順の記録ページは音を出すためにタップが要るので，開始ボタンを押し直す）
- iPhone では最初に開始ボタンをタップした時にセンサーの許可を求められる
- 判定の確認・ゴーグルでの確認のページは，センサーの値に加えて判定の途中の値（`detect`）・結果の変化（`state`）・しきい値（`params`）も記録する
- しきい値は URL パラメータでも渡せる（例: `detect.html?stepHighStanding=1.5&headPredictionMs=20`．項目名は `src/input/params.ts` の `InputParams`）．同じ設定を QR コードで他の端末に配れる
- 記録は 2 秒ごとに開発サーバーへ送られ，`logs/input/<YYYYMMDD-HHMMSS>_<セッション ID>.jsonl` に追記される（`logs/` は Git の管理外．再読み込みのたびに新しいセッション＝新しいファイルになる）．受け取る口は開発サーバーだけにある（`src/input/dev/inputLogPlugin.ts`．`npm run build` の出力には含まれない）
- 記録を始めると，スマホは開発サーバーと時刻を合わせて `clock` を記録する．操作盤の PC も開いた時に合わせ，押した時刻を開発サーバーの時刻を介してスマホの時刻に換算する（合わせる前に付けた印は，スマホの壁時計で換算するため少しずれる．印の `clock` が `wall` になる）．開発サーバーを再起動すると，記録を送り直すまで操作盤にその端末が出ない
- 誤判定の場面を回帰テストにする時は，再生と調整のページで表示の範囲を切り出し，判定の対象と同じフォルダの `fixtures/`（例: `src/input/body/fixtures/`）に `<端末>_<装着状態>_<動作>.jsonl` の名前で置き，テストに期待する判定を足す（`src/input/replay/regression.ts` の `checkExpectations`）
- 開発サーバーにつながらない間の記録はページのメモリに残り，「記録をダウンロード」で `.jsonl` として保存できる（ページを閉じると消える）
- 記録を取る間は `npm run dev` ではなく `npm run dev:record` を使う（誰かが `src/` を保存すると記録中のページが再読み込みされ，記録が途切れるため）．取り方は [TEST_01](../06_TEST/TEST_01_動きの記録の取り方.md)

### 担当B の確認用ページ (Scene Dev Pages)

`src/scenes/school/dev/` の HTML も，開発サーバーで直接開ける（本番のビルドには含まれない）．

| ページ | URL（`npm run dev` の後） | 内容 |
| --- | --- | --- |
| 床の正解経路の矢印 | `http://localhost:5173/src/scenes/school/dev/routeArrows.html` | デモの校舎のマス目を種類ごとの色の板で並べ，その上に正解経路の矢印を出す（開始地点は黄色の輪，集合場所は白い輪）．左上に矢印の数と種類ごとの内訳．ドラッグで回す・ホイールで寄る・右ドラッグで動かす．`?mode=test` で矢印を作らない（テストモード），`?route=broken` で異常を混ぜた経路 |

### 正解付きの記録の集計 (Replay & Evaluate)

`protocol.html` で取った正解付きの記録を今の判定に流し直し，区間ごとの指標を SPEC_01「判定の安定性」の目安と照らして端末に表で出す（`src/input/replay/replayCli.ts`．実体は `scripts/replay.mjs`）．

| コマンド | 内容 |
| --- | --- |
| `npm run replay` | `logs/input/` の記録をすべて流し直し，正解付きの記録ごとに指標と合否を出す |
| `npm run replay -- <ファイル/フォルダ> --segments` | 対象を絞り，区間ごとの表も出す．`--unlabeled` で正解の無い記録の全体の数も出す |
| `npm run replay -- --set "名前:key=値,..."` | しきい値の組を既定値に重ねて列に並べて比べる（何度でも指定できる．`--sets <JSON>` でも渡せる．`--no-default` で既定値の列を外す） |
| `npm run --silent replay -- --slice <ファイル> <始まり秒> <終わり秒> > <出力>.jsonl` | 回帰テスト用に記録の一部を切り出す（秒は記録の始まりから） |
| `npm run replay -- --help` | 使い方 |

- `npm test` の `src/input/replay/labeledRecordings.test.ts` も，手元の `logs/input/` に正解付きの記録があれば同じ集計を表示する（目安に届かなくても失敗にはしない．記録が無ければ skip）

### ハンドトラッキングのモデルと wasm (Hand Tracking Assets)

手の認識（`@mediapipe/tasks-vision` の `HandLandmarker`）に使うモデルと wasm は `public/mediapipe/` に同梱して自前で配信する（ENV_01「ハンドトラッキング」．外部の CDN に依存しない）．`npm run build` で `dist/mediapipe/` にそのまま写る．どちらも手の認識を始めた時に初めて読み込む．

| ファイル | 大きさ | 取得元 |
| --- | --- | --- |
| `public/mediapipe/wasm/vision_wasm_module_internal.js` | 約 330 KB | npm の `@mediapipe/tasks-vision`（`package.json` で版を固定．今は `1.1.1`）の `wasm/` |
| `public/mediapipe/wasm/vision_wasm_module_internal.wasm` | 約 13 MB | 同上 |
| `public/mediapipe/hand_landmarker.task` | 約 7.5 MB | `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`（Google の公式の配信元．float16 の版 1） |

- wasm は ES モジュールの版（`_module_`）だけを置く．Worker（`type: "module"`）でもメインスレッドでも `import()` で読める（`src/input/hand/landmarkerCore.ts`）．SIMD の無い版（`_nosimd_`）は置かない（iPhone の Safari 16.4 以降は SIMD に対応している）
- `@mediapipe/tasks-vision` の版を上げた時は，wasm も必ず同じ版のものに置き換える（ライブラリと wasm の版がずれると動かない）

```bash
# @mediapipe/tasks-vision の版を変えた後に wasm を取り直す
npm install --save-exact @mediapipe/tasks-vision@<版>
cp node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_module_internal.js \
   node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_module_internal.wasm public/mediapipe/wasm/

# モデルを取り直す
curl -fL -o public/mediapipe/hand_landmarker.task \
  https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task
```

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
