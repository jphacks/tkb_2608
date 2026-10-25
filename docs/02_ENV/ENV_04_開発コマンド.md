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
| `npm run dev` | Vite の開発サーバーを起動する（`http://localhost:5173/`．PC のブラウザで開く）．コンテナの中では `127.0.0.1:5173` で待ち受ける（`vite.config.ts` の `server.host`）．起動の表示が `Local: http://127.0.0.1:5173/` でない古い手元で，ブラウザが読み込み中のまま開かない時は `npm run dev -- --host 127.0.0.1` で起動する |
| `npm run dev:record` | 動きの記録用の開発サーバー（`vite --mode record`）．WebSocket を切るため，`src/` を編集しても開いているページが再読み込みされない（自動更新も効かない）．`npm run dev` と同じポート 5173 を使うので，`npm run dev` を止めてから起動する（手順は [TEST_01](../06_TEST/TEST_01_動きの記録の取り方.md)） |
| `npm run tunnel` | 開発サーバーを cloudflared の Quick Tunnel で HTTPS の一時 URL として公開し，URL を QR コードでも表示する（スマホの実機確認用．実体は `scripts/tunnel.mjs`．`npm run dev` と別のターミナルで実行し，張りっぱなしにする．手順は [ENV_02](ENV_02_環境構築手順.md)「スマホの実機で確認する」） |

- `npm run tunnel -- train` のように空間の id（`room`・`train`・`elevator`・`school-parts`・`school`）を渡すと，QR コードの URL に `?scene=train` が付き，読み取るだけでその空間が開く
- `npm run tunnel -- /src/input/dev/` のように `/` で始まるパスを渡すと，QR コードの URL にそのパスが付く（使える文字は英数字・`/`・`-`・`_`・`.`）
- `npm run tunnel -- app` を渡すと，QR コードの URL に `?app` が付き，読み取るだけで体験の流れが開く（避難の画面の左上に進み具合と，ロビーから反映した判定のしきい値を出す時は，表示された URL の `?app` を `?app&debug` に書き換えてスマホで開く）
- 体験の流れ（開始画面 → ホーム → ロビー → シナリオ）は URL に `?app` を付けて開く（例: `http://localhost:5173/?app`．スマホでは `npm run tunnel -- app` の QR コードを読み取る）．`?debug`・`?stereo=1` 等は [SPEC_01](../04_SPEC/SPEC_01_画面遷移とモジュール構成.md)「起動の切り替え」を参照
  - 音を確かめる時は `http://localhost:5173/?audio`（効果音・ナレーションをボタンで鳴らし，訓練のシナリオの音を順に流す．最初のタップで音が有効になる．開発サーバーでだけ使える）
  - 結果画面だけを確かめる時は `http://localhost:5173/?debrief`（`?debrief=late` で逃げ遅れ，`?debrief=nosmoke` で煙の中にいなかった場合）．デモの校舎と手で作った記録で表示する（開発サーバーでだけ使える）
- 何も付けない `http://localhost:5173/` は教員用のホーム画面（`src/portal/`．本番でも使う）．「エディタを開く」でエディタへ進む．開発用の空間ビューアは `?viewer`，または `?scene=`・`?input=` を付けた時に開く（例: `http://localhost:5173/?viewer`・`?scene=school`．`npm run tunnel` を引数なしで使うと QR はホーム画面になる）
- 教員用のエディタは `http://localhost:5173/?editor` で開く（PC のブラウザ．本番でも使う）．デモの校舎を開いた状態で始まり，左の道具箱でパーツや教室を選んでクリック・ドラッグで塗る．「訓練条件」の道具で火元・開始地点（教室のマスだけ．向きは 4 方向のボタン）をクリックで置く・外す．集合場所は校庭をドラッグした範囲の屋外のマスに置き，すべて集合場所の範囲をもう一度選ぶと外す（[SPEC_02](../04_SPEC/SPEC_02_校舎データの形式.md)「集合場所の範囲指定」）．元に戻す・やり直すは Ctrl+Z／Ctrl+Shift+Z・Ctrl+Y でもできる．編集は localStorage（キー `tkb2608.editor.plan`）に自動で保存し，次に開いた時に前回の編集で始まる（デモの校舎から始め直すには「保存」の「デモの校舎に戻す」．DevTools でキーを消してもよい）．「保存」の「ファイルに書き出す」「ファイルを読み込む」で `.json` に出し入れする（形式は [SPEC_02](../04_SPEC/SPEC_02_校舎データの形式.md)「ファイルと localStorage への保存」）
  - 「下敷き（図面の写真）」の「写真を選ぶ」で図面の写真を敷く（写真は保存しないので再読み込みで消える．位置・大きさ・回転・線の濃さは覚えていて，同じ写真を選び直すとその位置に置く）．写真がある間はマスの塗りを淡くし，写真を白黒にして図面の線だけを塗りの上に重ねる（「線の濃さ」で調整）．「下敷きを合わせる」の間は塗らずに，ドラッグで移動・Shift+ドラッグで回転・ホイールで拡大縮小・数値の欄で指定し，「合わせ終える」・Esc・道具のボタンで終える．Space を押している間は塗りを隠して写真だけを見る
  - 「延焼の速さ」で火・煙の秒数（1 マス進むのにかかる秒数）と制限時間を入れ，Enter かフォーカスを外して確定する（元に戻すの対象．0 以下・空欄は受け付けず元の値に戻る．煙が火より遅い時は注意だけ出す）．「延焼のプレビュー」の「プレビューを出す」で時刻のスライダー（0 秒〜制限時間）を出し，その時刻の火（赤）と煙（灰色）をマスに重ねる．「再生」は 10 倍速．プレビュー中も編集でき，マウスの下のマスに火・煙が着く時刻を出す
  - 「正解経路」の「経路を提案」で延焼を見た経路の案（`proposeRoute()`）を入れる．「経路を引く」の道具では，経路の最後のマスの隣をクリック・ドラッグで伸ばし，途中のマスをクリック（またはドラッグで戻る）でそこまでに切り詰める（空の時は開始地点から引き始める．1 回のドラッグが 1 回分の元に戻す）．壁をまたぐ一歩・人が入れないマス・隣り合わないマスは加えずに理由を出す．「経路を消す」で空にでき，空のままでも QR を出せる（生徒側は自動の提案を使う）
  - 「モード」で学習／テストを選び（元に戻すの対象），「QR コードを出す」で生徒用の URL（`<エディタを開いた URL>?app#p=...&room=<部屋の ID>`）と QR コードを窓に出す．部屋の ID は同じ校舎の間は同じものを使う（localStorage のキー `tkb2608.editor.monitorRooms`）．QR の横の「見守り画面を開く ↗」で，同じ校舎・部屋の見守り画面（`?monitor#p=...&room=...`）を別のウィンドウで開く（見守りを使うにはビルドに `VITE_MONITOR_RELAY_URL` が要る．下記「見守りの中継」）．校舎に誤りがある時や URL が 1,500 文字を超える時は，QR の代わりに理由を出す．窓を開いた後に編集すると窓は閉じる
  - マップの右上の「3D で見る」で，編集中の校舎を生徒の体験と同じ 3D で確かめる（同じ位置のボタンが「編集に戻る」に変わる）．開始地点に開始の向きで立ち，ドラッグで見回す・W/↑ で前へ・S/↓ で後ろへ・A/D・←/→ で向きを変える・C でしゃがむ・立つ（壁の当たり判定と歩く速さは体験と同じ．時刻は非常ベルから 0 秒で止まり，延焼は進まない）．3D の間は道具箱と編集のキー操作は使えず，編集内容と元に戻すの履歴はそのまま残る．校舎に誤りがある時は 3D にならず理由が出る
  - URL はエディタを開いた配信先から作るので，スマホで読める QR を出すには `npm run tunnel` の公開 URL に `?editor` を付けて PC で開く（`localhost` で開くとスマホからは開けない URL になり，QR の窓に注意が出る）．`http` の画面ではコピーのボタンが使えないので，選ばれた URL 欄から手でコピーする
  - `?app` だけなら入力はスマホのセンサー（`device`）で，頭の向き・足踏み・しゃがみが流れに届く．PC では `?app&input=mock` で開き，下記の `?input=mock` と同じキー・ドラッグで操作する（PC で `?app` だけだと視点は動かない）
- `http://localhost:5173/?input=mock` のように `?input=` を付けると，担当D の `src/input/` の入力で歩く（当たり判定あり．`?scene=` と併用できる．例: `?scene=train&input=mock`）．指定しない時は今までどおりドラッグで視点を回し，画面のボタンで歩く
  - `?input=mock`: PC 用．W で歩く（1.0 m/s）・S でゆっくり歩く（0.5 m/s．足踏みには向きが無いため後ろへは進まない）・C でしゃがみの切り替え・E で近くのドアの開閉・ドラッグで頭の向き（A・D は今は使わない）．手は右手だけで，マウスの位置が右手の位置（画面のマウスの下・目の前 0.45 m の所）・右ボタンか F キーを押している間は握る（`grip: 1`）・ホイールで手の奥行き（0.2〜0.8 m）．マウスが画面の外に出ると手は未認識になる．空間の中では手の形（関節の球と骨．左右とも同じ青．`src/scenes/common/handMarkers.ts`）が出る．モックの手は開いた手・握った手の決め打ちの形（`?input=device` では認識した両手の形．見失うと 0.15 秒で薄くして消す．21 点を一度も受け取っていない手は手のひらの位置に球だけ出す）
  - `?input=device`: スマホの実機用（トンネル経由の HTTPS で開く）．画面をタップしてセンサーを許可すると，頭の向き・足踏み・しゃがみの判定で動く．最初に受け取った向きが正面になる．同じタップで背面カメラ（640x480）も取り，手を認識する（`?app` では開始画面で取ったカメラを使う）．`?app` と `?input=device` でも，手のしきい値を `?recognizeWidthPx=320`（認識に渡す画像の幅．既定 640）・`?skeletonDepthM=1.2`（描く手の形の固定の奥行き）・`?skeletonDepthScale=1.5`・`?skeletonHoldMs=120`（見えない回が続いても手の形を出し続ける時間）のように渡せる（項目名は `src/input/hand/handParams.ts` の `HandParams`）．`?worker=0` でメインスレッドで認識する
  - `?input=replay`: 開発サーバー（`npm run dev`）でだけ使える．`logs/input/` の記録を，記録した時と同じ間隔で本物の入力と同じ判定に流す（実機の動きのとおりの入力で部屋やシナリオを確かめる）．`?log=<ファイル名>` で記録を選ぶ（省くと最も新しい記録），`?from=<秒>` で途中から流す，`?loop=0` で最後まで流したら止める（既定は最初に戻る）．例: `?scene=train&input=replay&log=20261024-143537_o0qich1i.jsonl&from=30`．`?app&input=replay` でも使える．本番のビルドには含まれず，本番で指定すると止まって立ったままになる
  - いずれも画面の左上に `PlayerInput` の中身（`posture`・`walking`・`walkSpeed`・頭のヨー・両手の位置と `grip`）と歩行の状態（位置・エリア・近くのドア）を出す．画面のボタンは出さない
- `?scene=school` では非常ベルからの時刻で火と煙が広がる．ページを開いた時が 0 秒で，`?t=<秒>` で始める時刻を，`?speed=<倍率>` で進む速さを変えられる（例: `?scene=school&input=mock&t=300&speed=5`）．時刻は画面の左上の `alarm` の行に出る．煙の中で立つ・燃えているマスの 1 マス以内にいる間は画面の縁が赤くなり，判定は左上の `error` の行に出る．デモの校舎では，開始地点から廊下の中ほど（z = 7 の列）を東へ歩くとシャッターのくぐり戸を通れる（例: `?scene=school&input=mock&t=10` で歩き出すと 20 秒台で煙の中に着き，36 秒を過ぎると火の 1 マス以内になる．燃えているマスに入れないことは `t=60` 前後で確かめる）
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
| ゴーグルでの確認 | `http://localhost:5173/src/input/dev/goggles.html` | 左右 2 画面の最小限の空間（床の格子・1 m ごとの柱・正面の目印）で，判定のとおりに歩く・しゃがむ・見回す．判定の状態を視界の下に出し，1 歩ごと・姿勢の切り替えで音を鳴らす（`?sound=0` で消す）．開始の後に 10 秒のカウントダウン（装着の間）を挟んで約 15 秒のキャリブレーション（下記）を行い，求めたしきい値で判定する．開始の後に画面をタップすると正面と位置をリセットする |
| 再生と調整（PC） | `http://localhost:5173/src/input/dev/replay.html` | `logs/input/` の記録（または手元の `.jsonl`）を今のコードの判定に流し直す．波形・Δh・判定（基準のしきい値＝前と，スライダーの値＝後）・手順のラベル・印を同じ時間軸に重ね，指標（誤検出・見逃し・動き出しの遅れ）を前後で並べる．決めた値を params の JSON と URL パラメータで書き出す．表示の範囲を回帰テスト用の `.jsonl` に切り出せる．`?log=<ファイル名>` で開いた時に読み込む |
| 手の確認 | `http://localhost:5173/src/input/dev/hands.html` | 背面カメラ（PC ではウェブカメラ）の映像に，認識した 21 点・なめらかにした手のひらの中心と人差し指の先・手の形（握・摘・指）を重ねる．認識の処理（Worker／メインスレッド，GPU／CPU）・頻度・1 回の時間・映像から結果までの遅れ・描画の fps と，左右の手の位置・奥行き・`grip`・つまむ・指を差すを出す．認識の結果（21 点）を `hand` として記録する．`?worker=0` でメインスレッドで認識する．しきい値は `?cameraHfovDeg=60&oneEuroBeta=2` のように渡す（項目名は `src/input/hand/handParams.ts` の `HandParams`） |
| 操作盤（PC） | `http://localhost:5173/src/input/dev/panel.html` | スマホで記録を始めた後に PC で開き，誤判定を見たら `1`（歩いていないのに進んだ）・`2`（歩いたのに進まない）・`3`（立っていないのに立った）・`4`（手が震えた・消えた）・`Space`（その他）を押す．印は開発サーバー経由でスマホの記録に `mark` として書き込まれる．スマホの判定の状態（約 2 秒遅れ）も出す |

- スマホでは `npm run tunnel -- /src/input/dev/` の QR コードを読み取る．センサーは HTTPS でないと使えないため，スマホでは必ずトンネル経由で開く
- 一度開けば，PC でコードを保存するとスマホのページも自動で再読み込みされる（Vite の HMR）．センサーの確認ページは，許可済みなら再読み込みの後に自動で記録を再開する（手順の記録ページは音を出すためにタップが要るので，開始ボタンを押し直す）
- iPhone では最初に開始ボタンをタップした時にセンサーの許可を求められる
- 判定の確認・ゴーグルでの確認のページは，センサーの値に加えて判定の途中の値（`detect`）・結果の変化（`state`）・しきい値（`params`）も記録する
- しきい値は URL パラメータでも渡せる（例: `detect.html?stepHighStanding=1.5&headPredictionMs=20`．項目名は `src/input/params.ts` の `InputParams`）．同じ設定を QR コードで他の端末に配れる
- ゴーグルでの確認ページのキャリブレーション: 開始をタップした後，スマホをゴーグルに入れて装着する間として 10 秒のカウントダウン（10, 9, ..., 1 を視界の中央の板に「ゴーグルを付けてください」と一緒に出し，数字が変わるたびに短い音．`?sound=0` では鳴らさない）を挟む．カウントダウンの間も判定と記録は動くが，キャリブレーションの区間のサンプルには入れない．その後に「立って静止 3 秒 → 足踏み 5 秒 → しゃがむ 3 秒（立って待ち，開始の音でしゃがんで動かない）→ しゃがみ歩き 4 秒」を，区間ごとに 3 秒の準備（読み上げと 3・2・1 の音）を挟んで案内する（表示は視界の板）．終わったら立ち上がって正面を向く 3 秒の後に，求めた値で判定を始め直す（立った姿勢・正面・原点から）．求めた値は視界の板の下の 2 行（`*` はキャリブレーションで求めた項目）と，記録の `mark`（`kind: "calibration"`．区間・上書き・測った値）と `params` の行に出る
  - `?calib=0` でキャリブレーションをしない（今までどおり）．区間の長さ（ms）は `?calibStandMs=3000&calibStepMs=5000&calibCrouchMs=3000&calibCrouchWalkMs=4000`，開始の後の待ち時間は `?calibStartDelayMs=10000`（`0` で待たない），準備は `?calibPrepMs=3000`，終わった後の時間は `?calibFinishMs=3000` で変えられる（長さが足りるかを実機で試すため）
  - しきい値は「既定値 → キャリブレーションで求めた値 → URL のしきい値」の順に重ねる（URL で指定した項目はキャリブレーションの値より優先する）．値の求め方は `src/input/body/calibration.ts` の `calibrateParams`
  - 立った足踏みとしゃがみ歩きの山の大きさが両方測れて，2 倍以上違う時だけ，しゃがみ歩きから止まらずに立つ判定（`standWalkPeakStanding`・`standWalkPeakCrouching`・`standWalkSteps`．`src/input/body/posture.ts` の `updateStandWalk`）が有効になる．視界の板の `境`（2 つの山の幾何平均．`-` は無効）と，歩の行の `立歩 数/歩数` で確かめる．立ったら結果は `stand-walk`（記録の `state` の `detail`）．しゃがみ歩きの山は 4 秒では測れないことがあるため，試す時は `?calibCrouchWalkMs=8000` 等と長めにする
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
| 火と煙 | `http://localhost:5173/src/scenes/school/dev/fireSmoke.html` | デモの校舎を簡易な床・柱・天井で並べ，`computeSpread()` の結果で火と煙を描く．下のパネルで時刻を動かす（Space で再生・一時停止，速さ 1・2・5・10 倍，スライダー）．一人称（WASD で歩く・ドラッグで向き・C でしゃがむ）と見下ろす視点（V で切り替え，`?view=top`）．左上に fps・更新の時間（ms）・描画の回数・燃えているマスと煙のあるマスの数・目の位置の煙とフォグの濃さ．`?plan=large` で 2,040 マスの校舎（重い時の確認）．`?plan=smoke` でデモの校舎の西の廊下 (8, 6) に 10 秒から煙だけが出る発生源（`extraSmokes`）を足す（シャッターより西の煙はすべて発生源から来たもの）．下のパネルの「URL に埋め込んで読み直す」で今の校舎を `#p=<埋め込みデータ>` にして開き直し（左上に `#p= から読み込み` と出る），「この校舎で体験する」で同じ校舎を `?app&input=mock` で開く．同じ場面を見比べる時は `?t=<秒>`（始める時刻）・`?at=<x>,<z>`（立つ位置，m）・`?yaw=<度>`（正で左へ回る．-90 で東を向く）・`?pitch=<度>`（正で下を向く）・`?crouch=1`（しゃがんで始める）を付ける（例: `?t=40&at=12.5,2.5&yaw=-90&pitch=-5`）．デモの校舎ではシャッターより西に煙が来ないので，しゃがむと晴れることは廊下を東へ歩いて確かめる |

### 見守りの中継 (Monitor Relay)

見守り（SPEC_01「見守り」）の中継は，Pages（アプリの配信）とは別の Cloudflare Worker として `relay/` に置く（Pages Functions では Durable Object を定義できず，Pages の `functions/` に置くと Pages Functions として扱われるため，別の名前のフォルダにしている）．`relay/src/index.ts` が Worker と Durable Object（`Room`．部屋の ID ごとに 1 つ），`relay/src/rules.ts` が役割・部屋の ID・大きさの判定，`relay/wrangler.jsonc` が設定．

| コマンド | 内容 |
| --- | --- |
| `npm run relay:dev` | 中継をローカルで起動する（`wrangler dev`．`ws://127.0.0.1:8787`）．Cloudflare へのログインは要らない．`npm run dev` と別のターミナルで実行し，`Ctrl+C` で止める |
| `npm run relay:check` | 起動した中継に student 2 つ・monitor 2 つをつなぎ，流れること・4 KiB を超えるものと monitor から届いたものが捨てられること・役割や部屋の ID が不正な接続を断ることを確かめる（`relay/scripts/relayCheck.mjs`．毎回乱数の部屋の ID を使う）．最後に `ALL OK` と出れば合格 |
| `npm run relay:check -- wss://<中継>` | デプロイした中継に対して同じことを確かめる（発表の前日の確認等） |

- 接続の URL: `<中継の住所>/rooms/<部屋の ID>?role=student`（生徒．送るだけ）と `?role=monitor`（見守り画面．受け取るだけ）．部屋の ID は base64url の文字で 8〜64 文字．形が合わない・`role` が無いか不正なら，中継は WebSocket にせず 400 を返す（別のパスは 404，WebSocket でない要求は 426）
- 中継は中身を読まず，student から届いたもの（テキスト・バイナリとも）を同じ部屋の monitor 全員にそのまま流す．monitor から届いたものと 4 KiB（4096 バイト．テキストは UTF-8 で数える）を超えるものは捨てる．何も保存せず，メモリにも持たない．WebSocket Hibernation API を使うので，何も届かない間は Durable Object が眠って費用がかからない
- `relay/` の型チェックは `npm run typecheck`（`tsc -p relay` を含む）で，lint は `npm run lint` で行う
- `wrangler dev` の作る `relay/.wrangler/` は Git の管理外（`relay/.gitignore`）

#### 中継の住所の渡し方 (Relay Address)

中継の住所は URL に入れず，ビルドの環境変数 **`VITE_MONITOR_RELAY_URL`** で渡す（生徒の端末・見守り画面とも `import.meta.env.VITE_MONITOR_RELAY_URL` で読む．#127・#128）．値は `ws://` か `wss://` で始まる住所で，末尾に `/` を付けない（例: `wss://tkb2608-relay.<アカウントのサブドメイン>.workers.dev`）．読む側が後ろに `/rooms/<部屋の ID>?role=…` を足す．未設定・空のビルドでは見守りを使わない（生徒の端末は何もせず，見守り画面は「中継の住所が設定されていません」と出す）．

- ローカル: `VITE_MONITOR_RELAY_URL=ws://127.0.0.1:8787 npm run dev`（`npm run relay:dev` と並べて起動する）．毎回書かない時は `.env.development.local` に `VITE_MONITOR_RELAY_URL=ws://127.0.0.1:8787` と書く（`.env.*` は Git の管理外）．PC の同じブラウザの別のタブで `?app&input=mock#room=<部屋の ID>` と `?monitor#room=<部屋の ID>` を開けば試せる（手順は下記「見守りをローカルで試す」）
- スマホの実機（トンネル経由の `https`）からは `ws://127.0.0.1:8787` につなげない（https のページから `ws://` は使えず，`127.0.0.1` はスマホ自身を指す）．実機で試す時は，デプロイした中継の `wss://` の住所を `VITE_MONITOR_RELAY_URL` に入れて `npm run dev` を起動する
- staging・本番: `deploy-staging.yml`・`deploy-prod.yml` のビルド（`npm run build`）が，リポジトリの変数 `MONITOR_RELAY_URL` を環境変数 `VITE_MONITOR_RELAY_URL` として渡す（変数は設定済み．中継の住所を変えた時は変数を直す．下記「中継のデプロイ」）

#### 中継のデプロイ (Relay Deployment)

中継のデプロイと Cloudflare 側の作成は人間（管理者）が行う．Claude は `wrangler login`・`wrangler deploy` を実行しない．

1. `npx wrangler login` でチームの Cloudflare アカウントにログインする（Pages と同じアカウント）
2. `npx wrangler deploy --config relay/wrangler.jsonc` で Worker `tkb2608-relay` と Durable Object（SQLite 版．無料プランで使える）を作る．表示された `https://tkb2608-relay.<サブドメイン>.workers.dev` の `https` を `wss` に替えたものが中継の住所
3. `npm run relay:check -- wss://tkb2608-relay.<サブドメイン>.workers.dev` で `ALL OK` を確かめる
4. 中継の住所を Pages のビルドに渡す: リポジトリの変数 `MONITOR_RELAY_URL` を作り（`gh variable set MONITOR_RELAY_URL --body wss://…`），`deploy-staging.yml`・`deploy-prod.yml` のビルドの手順に `env: VITE_MONITOR_RELAY_URL: ${{ vars.MONITOR_RELAY_URL }}` を足す（足し済み．変数も作成済み）
5. 費用の確認: Workers・Durable Objects の無料枠（リクエスト数・Durable Object の実行時間）を Cloudflare の画面で確かめる．WebSocket のメッセージは 20 件で 1 リクエストとして数えられ，生徒 1 人が 1 秒に 20〜30 回送るので，発表・練習の数十分では無料枠に収まる見込み．長く開きっぱなしにしない

中継のコードを変えた時は，手順 2・3 をもう一度行う（Pages の配信とは別で，GitHub Actions からは配信しない）．

#### 見守りをローカルで試す (Local Monitor Check)

生徒の画面（送る側．`src/app/monitorSender.ts`）と見守り画面（`?monitor`．`src/monitor/`）を，PC の 1 つのブラウザで一緒に試す．

1. 部屋の ID を作る（base64url の 16 文字．生徒と見守り画面で同じものを使う）

   ```bash
   node -e "console.log(require('crypto').randomBytes(12).toString('base64url'))"
   ```

2. ターミナル 1 で `npm run relay:dev`（`Ready on http://127.0.0.1:8787` が出るまで待つ）
3. ターミナル 2 で `VITE_MONITOR_RELAY_URL=ws://127.0.0.1:8787 npm run dev`
4. 見守り画面 `http://localhost:5173/?monitor#room=<部屋の ID>` を開き，「体験者の接続を待っています」が出ることを確かめる（`F` で全画面）．画面の下の「クリックして音を出す」が出たら，画面を 1 回クリックして音を有効にする（押すまでは音を鳴らさない）
5. 別のタブで生徒の画面 `http://localhost:5173/?app&input=mock#room=<同じ部屋の ID>` を開いて進める．ホームの間は「体験者は準備中です」，ロビーでは同じ部屋と指示の板が生徒の向きで，避難の画面では生徒の目線が，終わると同じ結果画面（ボタンなし）が見守り画面に出る．ロビーのナレーションと避難の画面の音（非常ベル・ナレーション等）は，見守り画面のタブからも鳴る

- 5173 番を別のサーバーが使っていると，Vite は次の番号（5174 等）で起動する．URL のポートは `npm run dev` が表示したものに合わせる
- エディタの校舎で試す時は，両方のフラグメントに同じ `p=` を付ける（`#p=<埋め込みデータ>&room=<部屋の ID>`）．`p=` が違うと見守り画面は描かずに案内を出す
- `room=` が無い・`VITE_MONITOR_RELAY_URL` が無い時，見守り画面は案内だけを出して止まり，生徒の画面はいつもどおり動く（送らない）
- 1 つの PC で試すと，生徒のタブと見守り画面のタブの両方から同じ音が鳴る（読み上げは重なると片方が止まることがある）．見守り画面の音だけを聞く時は，見守り画面を `http://127.0.0.1:5173/?monitor#…` で開き（別のオリジンになる），生徒のタブ（`localhost`）のサイトをミュートする（効果音は消えるが，読み上げはミュートでは消えない）
- `relay:dev` を止めると見守り画面は「中継につながりません．つなぎ直しています」と出し，起動し直すと 3 秒おきのつなぎ直しで自動で戻る（生徒の端末は 5 秒おき）

### 配置の下書きのサーバー関数 (Floor Draft Function)

エディタの「AI で下書きを作る」（ES3．SPEC_02「配置の下書き」）が呼ぶサーバー関数 `POST /api/floor-draft` は，Cloudflare Pages Functions として `functions/api/floor-draft.ts` に置く．Vite の開発サーバーでは動かないので，別のターミナルで `wrangler pages dev` を起動し，Vite が `/api` へのリクエストをそこへ流す（`vite.config.ts` の `server.proxy`）．

| コマンド | 内容 |
| --- | --- |
| `npm run functions:dev` | サーバー関数をローカルで起動する（`wrangler pages dev`．`http://127.0.0.1:8788`）．`Ready on http://127.0.0.1:8788` が出るまで待ち，`npm run dev` と並べて使う．`x` か `Ctrl+C` で止める．Cloudflare へのログインは要らない |

1. Google AI Studio（`https://aistudio.google.com/apikey`）で Gemini の API キーを発行する．チーム用の Google アカウントの「Default Gemini API Key」を使う．課金の設定（「お支払い情報を設定」）はしない（無料枠のまま）
2. `.dev.vars.example` を `.dev.vars` に写し，`GEMINI_API_KEY=` の後にキーを入れる（`.dev.vars` は Git の管理外．キーをチャット・Issue・PR に貼らない）．`GEMINI_MODEL=` は空でよい（既定は `gemini-3.5-flash`）
3. ターミナル 1 で `npm run functions:dev`，ターミナル 2 で `npm run dev` を実行し，`http://localhost:5173/?editor` を開く
4. 下敷きに見取り図を読み込んでマス目に合わせ，「AI で下書きを作る」を押す（応答まで 10〜30 秒ほど）

- `.dev.vars` は起動した時にしか読まれない．書き換えたら `npm run functions:dev` を起動し直す
- `functions:dev` を起動していない時・キーが無い時は，ボタンが失敗の理由を出すだけで，エディタの他の機能は変わらない
- 502 で 90 秒ほどかかる時は，Gemini の応答が遅く打ち切られている．`GEMINI_MODEL` を `gemini-flash-latest` 等の遅いモデルにしていないかを確かめる．429 は無料枠の回数の上限なので，少し待ってから押し直す
- `functions/` の型チェックは `npm run typecheck`（`tsc -p functions` を含む）で，lint は `npm run lint` で行う．テストは `src/functions/` に置く（`functions/` の中に置くと Pages Functions の経路として読まれるため）
- 本番・staging では，Cloudflare Pages の環境変数 `GEMINI_API_KEY` を使う（下の「デプロイ」）

### 正解付きの記録の集計 (Replay & Evaluate)

`protocol.html` で取った正解付きの記録を今の判定に流し直し，区間ごとの指標を SPEC_01「判定の安定性」の目安と照らして端末に表で出す（`src/input/replay/replayCli.ts`．実体は `scripts/replay.mjs`）．

| コマンド | 内容 |
| --- | --- |
| `npm run replay` | `logs/input/` の記録をすべて流し直し，正解付きの記録ごとに指標と合否を出す |
| `npm run replay -- <ファイル/フォルダ> --segments` | 対象を絞り，区間ごとの表も出す．`--unlabeled` で正解の無い記録の全体の数も出す |
| `npm run replay -- --set "名前:key=値,..."` | しきい値の組を既定値に重ねて列に並べて比べる（何度でも指定できる．`--sets <JSON>` でも渡せる．`--no-default` で既定値の列を外す） |
| `npm run replay -- <記録> --calib --segments` | 正解付きの記録から，キャリブレーションの 4 区間にあたる部分（`still` の始め 3 秒・1 回目の `step_in_place` の始め 5 秒・`squat_stand` の 1 回目の `crouch` の合図から 3 秒・1 回目の `crouch_walk` の始め 4 秒）を切り出してしきい値を求め，その値で全体を判定し直した列（`calib`）を足す．求めた値の表も出す．切り出した部分も評価に含まれる |
| `npm run replay -- <記録> --calib --calib-scale 0.5,2` | 区間の長さを倍にした列（`calib×0.5` 等）も足す．`--calib-ms "名前:stand=ms,step=ms,crouch=ms,crouchWalk=ms"` で区間ごとの長さを指定した列も足せる（省いた区間は既定の長さ．何度でも指定できる） |
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
| `npm run typecheck` | TypeScript の型チェック（`tsc` と，見守りの中継の `tsc -p relay`，配置の下書きのサーバー関数の `tsc -p functions`．出力はしない） |
| `npm test` | Vitest で単体テストを実行する（`src/**/*.test.ts` と，見守りの中継の `relay/src/**/*.test.ts`） |
| `npm run build` | 型チェックの後，`dist/` に本番用のファイルを出力する（GitHub Pages 用に `base` が `/tkb_2608/` になる） |
| `npm run preview` | `npm run build` の出力をローカルで配信して確認する |

- Biome の対象は `src/`・`scripts/`・`relay/src/`・`relay/scripts/`・`functions/`・`vite.config.ts` と設定ファイル（`biome.json`・`tsconfig.json`・`package.json`・`relay/tsconfig.json`）だけに絞っている（`biome.json` の `files.includes`）．Biome は Markdown も整形できるため，対象を広げると `docs/`・`.claude/` のフロントマターや表が書き換えられてルールが壊れる（実際に起きた）．対象を広げない
- ビルド時の「500 kB を超えるチャンクがある」という警告は three.js 等の大きさによるもので，現時点では無視してよい（必要になったら分割する）

## デプロイ (Deployment)

Cloudflare Pages に GitHub Actions が配信する（準備は [ENV_03](ENV_03_管理者用環境構築手順.md)「Cloudflare Pages の準備」）．手元からデプロイのコマンドは打たない．

| 環境 | URL | 配信されるタイミング |
| --- | --- | --- |
| staging | `https://staging.tkb2608.pages.dev` | `main` へのマージで自動（`deploy-staging.yml`．下記の切り替えで手動だけにもできる）．無料枠の配信回数を節約するため，マージから 3 分待って続くマージをまとめてから配信する（反映まで 5 分ほど）．docs 等だけの変更では配信しない |
| 本番 | `https://tkb2608.pages.dev` | `main` 上のコミットに `v*` の annotated タグを push したとき（`deploy-prod.yml`） |

PR では CI（`ci.yml`: lint・型チェック・テスト・ビルド）だけが動く．PR ごとのプレビューは今は作っていない（必要になったら追加する）．

配置の下書きのサーバー関数（`functions/`）は，`wrangler pages deploy dist` がリポジトリ直下の `functions/` を一緒に配信する（ワークフローの変更は要らない）．API キーは管理者が Cloudflare のダッシュボードで登録する（Claude は登録しない）．

1. Workers & Pages → プロジェクト → Settings → Variables and Secrets を開く
2. `GEMINI_API_KEY` を種類「Secret」で，**Production と Preview の両方**に登録する（staging は Preview の値を使う）
3. `GEMINI_MODEL` は登録しなくてよい（既定は `gemini-3.5-flash`）
4. 登録した値は次の配信から効くので，登録の後に staging・本番を配信し直す

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
