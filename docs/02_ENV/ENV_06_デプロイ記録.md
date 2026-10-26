# デプロイ記録 (Deploy Log)

本番（Cloudflare Pages のプロジェクト `tkb2608`．<https://tkb2608.pages.dev>）への配信の記録．本番への配信は，`main` のコミットに annotated タグ `v*` を push したときに `deploy-prod.yml` が行う（[ENV_04](ENV_04_開発コマンド.md)「デプロイ」）．

staging はマージのたびに自動配信されるため記録しない（GitHub Actions の `Deploy (staging)` の履歴で追う）．

## 記録ルール (How to Record)

- 通常は `/deploy-prod` が配信の完了後に追記する．手でタグを打った場合・ワークフローを再実行した場合・ダッシュボードから手でアップロードした場合は，手で追記する
- 新しいものを上に追加する（一覧・詳細とも）
- 日時は JST で書く．「日時」はタグを push した時刻，「所要」は `deploy-prod.yml` の実行開始から終了まで
- 結果は次のいずれかにする．失敗した場合は詳細に原因と対処を書く
  - `成功`
  - `失敗（配信なし）`: タグの検証・再検証・配信のどこかで止まり，本番は変わっていない
- 「主な内容」は体験者から見た変化を 1 行で書く．含む PR は詳細に列挙する（依存更新・開発環境だけの PR も含める）
- 追記はコミットせずに残し，`/commit merge` で docs の PR にする（`docs/` だけの変更なのでタグは打たない）

## 一覧 (Summary)

| バージョン | 日時 (JST) | コミット | 結果 | 所要 | 主な内容 |
| --- | --- | --- | --- | --- | --- |
| [v0.3.0](#v030-2026-10-26) | 2026-10-26 15:36 | `e10254f` | 成功 | 1 分 | 手で押すボタン（ロビー・結果画面・ゴーグルの付け外しの案内）を指先が重なって見えれば押せるようにし，指先にピンクの印を出す．ホーム画面に追加したときのアイコンと名前を設定 |
| [v0.2.0](#v020-2026-10-26) | 2026-10-26 08:15 | `92f4820` | 成功 | 1 分 | 小学校の火災避難訓練を最初から結果画面まで通す体験に作り替え，校舎エディタ・見守り画面・PC モードを追加 |
| [v0.1.0](#v010-2026-10-24) | 2026-10-24 15:02 | `f775293` | 成功 | 1 分 | 部屋・電車・エレベーターの 3D 空間と，開始画面・ロビーのキャリブレーションを含む初回リリース |
| （初期版） | 2026-10-24（時刻は未記録） | `77d8b2d`（ビルドした時点の `main`） | 成功 | - | Pages のプロジェクト作成時に，管理者がダッシュボードから手でアップロード（タグなし） |

## 詳細 (Details)

### v0.3.0 (2026-10-26)

- タグメッセージ: `[update] 手で押すボタンを指先が重なって見えれば押せるようにし指先に印を出しホーム画面のアイコンを設定する`
- 実行ログ: <https://github.com/jphacks/tkb_2608/actions/runs/40280785711>
- この回の配信の URL: <https://5307c162.tkb2608.pages.dev>
- 公開 URL での確認: この回の配信の URL・本番の URL とも `200`．本番の `index.html` が読む JS（`/assets/index-D4W9ithu.js`）がこの回の配信と一致し，新しい版に切り替わったことを確認した
- staging: 2026-10-26 15:33 の手動配信（`e10254f`．run 40280487768）で確認済み（本番と同じ JS）
- 含む PR（7 件）:
  - [#225](https://github.com/jphacks/tkb_2608/pull/225) [fix] 結果画面と付け外しの案内の手のボタンもロビーと同じ見た目の判定と指先の印にそろえる
  - [#224](https://github.com/jphacks/tkb_2608/pull/224) [add] ホーム画面に追加したときのアイコンと名前を設定する
  - [#223](https://github.com/jphacks/tkb_2608/pull/223) [fix] ロビーの開始ボタンを見た目で指先が重なれば押せるようにし人差し指の先に印を出す
  - [#222](https://github.com/jphacks/tkb_2608/pull/222) [update] README に PC で体験できることと後半の機能を書き解決出来ることと注力したことを整理する
  - [#221](https://github.com/jphacks/tkb_2608/pull/221) [add] README のデバイスにゴーグルの実物の写真を追加する
  - [#220](https://github.com/jphacks/tkb_2608/pull/220) [remove] README の冒頭から ?app のリンクを消す
  - [#219](https://github.com/jphacks/tkb_2608/pull/219) [update] v0.2.0 のデプロイ記録を追加

### v0.2.0 (2026-10-26)

- タグメッセージ: `[add] 火災避難訓練を最初から結果画面まで通し，校舎エディタ・見守り画面・PC モードを足す`
- 実行ログ: <https://github.com/jphacks/tkb_2608/actions/runs/40243918926>
- この回の配信の URL: <https://8577e342.tkb2608.pages.dev>
- 公開 URL での確認: この回の配信の URL・本番の URL とも `200`．本番の `index.html` が読む JS（`/assets/index-CO05W2ga.js`）がこの回の配信と一致し，新しい版に切り替わったことを確認した
- staging: 2026-10-26 08:09 の手動配信（`dc006da`．run 40243467624）で確認済み．その後の `92f4820` までの変更は `README.md` と `docs/images/` だけで，配信物は staging と同じ
- 含む PR（101 件）:
  - [#218](https://github.com/jphacks/tkb_2608/pull/218) [add] README の特長 2 に立つ・しゃがむの避難画面を追加する
  - [#217](https://github.com/jphacks/tkb_2608/pull/217) [update] README の先頭の画像をトップ画面に差し替える
  - [#216](https://github.com/jphacks/tkb_2608/pull/216) [add] README にトップ画面・結果画面・ロビーの画像を追加する
  - [#215](https://github.com/jphacks/tkb_2608/pull/215) [update] PC とスマホの体験の校舎を火元が隣でくぐり戸を通る校舎にする
  - [#214](https://github.com/jphacks/tkb_2608/pull/214) [update] 手で押すボタンの判定点を人差し指の先にする
  - [#213](https://github.com/jphacks/tkb_2608/pull/213) [fix] README の使用技術とテストの数を実装に合わせる
  - [#212](https://github.com/jphacks/tkb_2608/pull/212) [update] README の注力したことにハンドトラッキング・見守り・酔い対策・描画の工夫を追記する
  - [#211](https://github.com/jphacks/tkb_2608/pull/211) [update] エディタにトップへ戻るリンクと道具箱の開閉を足す
  - [#210](https://github.com/jphacks/tkb_2608/pull/210) [add] README の特長 1 にエディタと 3D の画面を追加する
  - [#209](https://github.com/jphacks/tkb_2608/pull/209) [add] 審査員が PC だけで体験できる PC モードとトップの入口を足す
  - [#208](https://github.com/jphacks/tkb_2608/pull/208) [add] README の製品説明に使い方の流れ図を追加する
  - [#207](https://github.com/jphacks/tkb_2608/pull/207) [add] README の背景に課題と解決を対比した図を追加する
  - [#206](https://github.com/jphacks/tkb_2608/pull/206) [update] README に学校向けの意義とゴーグルの値段を書く
  - [#17](https://github.com/jphacks/tkb_2608/pull/17) [update]: Bump ghcr.io/devcontainers/features/node from 1.7.1 to 2.1.1 in the devcontainers group across 1 directory
  - [#203](https://github.com/jphacks/tkb_2608/pull/203) [add] ブラウザでの自動検証（verify プロファイル・ランナー）を追加する
  - [#202](https://github.com/jphacks/tkb_2608/pull/202) [fix] undici の脆弱性に対応するため overrides で 7.30.1 に上げる
  - [#201](https://github.com/jphacks/tkb_2608/pull/201) [add] 結果画面を VR の中の板で見て手のボタンでもう一度・ホームへ進む
  - [#200](https://github.com/jphacks/tkb_2608/pull/200) [add] ホームのスタートを手をかざして押せるようにする
  - [#195](https://github.com/jphacks/tkb_2608/pull/195) [update] ゴーグルの付け外しの案内を手で押すボタンで確認して進める
  - [#188](https://github.com/jphacks/tkb_2608/pull/188) [update] 読み上げの声を自然にする（声の選び方と調整）
  - [#196](https://github.com/jphacks/tkb_2608/pull/196) [fix] 手の印が視界の端の近くまで届くように手の位置を広げ，縦長の映像の画角を直す
  - [#193](https://github.com/jphacks/tkb_2608/pull/193) [fix] スマホを 180° 回して画面が逆さのまま残った時に持ち直しの案内を出す
  - [#194](https://github.com/jphacks/tkb_2608/pull/194) [update] エディタの集合場所をドラッグした範囲で置く・外すようにし，まとまりで描く
  - [#16](https://github.com/jphacks/tkb_2608/pull/16) [update]: Bump the actions group across 1 directory with 2 updates
  - [#192](https://github.com/jphacks/tkb_2608/pull/192) [update] ページのタイトルと開始画面の見出しを製品名のひなんクラフトVRにする
  - [#191](https://github.com/jphacks/tkb_2608/pull/191) [add] デモ用の起動で火と煙が生徒の側へ来てシャッターを経路の先に見せる校舎を使う
  - [#190](https://github.com/jphacks/tkb_2608/pull/190) [update] 提出用に README を JPHACKS のフォーマットで書く
  - [#187](https://github.com/jphacks/tkb_2608/pull/187) [add] デモ用に開始画面から火災の放送で訓練を始める起動とキャリブレーションの保存を追加
  - [#186](https://github.com/jphacks/tkb_2608/pull/186) [remove] ホーム画面のボタンの下の説明文を消す
  - [#185](https://github.com/jphacks/tkb_2608/pull/185) [fix] ロビーのキャリブレーションの後に姿勢を立ちに戻す
  - [#183](https://github.com/jphacks/tkb_2608/pull/183) [add] 何も付けない URL に教員用のホーム画面を作る
  - [#182](https://github.com/jphacks/tkb_2608/pull/182) [add] エディタに編集中の校舎を 3D で確かめる view モードを足す
  - [#180](https://github.com/jphacks/tkb_2608/pull/180) [update] 提出フォームの回答に審査員へのアピールとスポンサー賞の選び方を反映
  - [#179](https://github.com/jphacks/tkb_2608/pull/179) [update] 結果画面の地図をエディタの見た目にそろえる
  - [#178](https://github.com/jphacks/tkb_2608/pull/178) [add] デモと提出の準備・提出フォームの回答の下書きを追加
  - [#177](https://github.com/jphacks/tkb_2608/pull/177) [update] ロビーの見え方の調整の印を十字の無い丸にする
  - [#168](https://github.com/jphacks/tkb_2608/pull/168) [add] エディタで見取り図から Gemini で部屋の矩形を受け取りマス目の下書きを作る
  - [#173](https://github.com/jphacks/tkb_2608/pull/173) [update] 手の形の描画を VRtest の方式に寄せて精度を上げる
  - [#172](https://github.com/jphacks/tkb_2608/pull/172) [add] エディタの QR に部屋の ID を入れて見守り画面を開くボタンを足す
  - [#149](https://github.com/jphacks/tkb_2608/pull/149) [add] 画面の切り替えでゴーグルの付け外しを案内する画面を追加
  - [#170](https://github.com/jphacks/tkb_2608/pull/170) [add] 体験の流れ（?app）で火災訓練を最初から結果画面まで通す
  - [#166](https://github.com/jphacks/tkb_2608/pull/166) [add] 見守り画面で生徒と同じ音を鳴らす
  - [#161](https://github.com/jphacks/tkb_2608/pull/161) [add] 集合場所を校舎の 3D で床の印にし SPEC_01 のエリアの ID を出す
  - [#157](https://github.com/jphacks/tkb_2608/pull/157) [add] 煙だけが出る場所（煙の発生源）を校舎に置けるようにする
  - [#152](https://github.com/jphacks/tkb_2608/pull/152) [add] 校舎の空間で認識した手の位置に手の印を出す
  - [#159](https://github.com/jphacks/tkb_2608/pull/159) [fix] iPhone でタップしてもセンサーとカメラの許可が出ない不具合を直す
  - [#156](https://github.com/jphacks/tkb_2608/pull/156) [add] 校舎で赤い表示を出し燃えているマスとくぐり戸の当たり判定と歩く速さの倍率を入れる
  - [#154](https://github.com/jphacks/tkb_2608/pull/154) [add] エディタで図面の写真を下敷きにし位置・大きさ・回転を合わせる
  - [#153](https://github.com/jphacks/tkb_2608/pull/153) [update] staging と本番のビルドに見守りの中継の住所を渡す
  - [#150](https://github.com/jphacks/tkb_2608/pull/150) [add] 短いキャリブレーションで判定のしきい値を当てはめて試せるようにする
  - [#144](https://github.com/jphacks/tkb_2608/pull/144) [add] エディタの校舎を自動保存しファイルに書き出し・読み込みする
  - [#143](https://github.com/jphacks/tkb_2608/pull/143) [add] 見守りの段階 1 で生徒の見ている画面を PC に映す
  - [#142](https://github.com/jphacks/tkb_2608/pull/142) [add] エディタで正解経路を提案し手で直せるようにし空の経路は生徒側で提案を使う
  - [#141](https://github.com/jphacks/tkb_2608/pull/141) [update] 炎と煙の見た目をよりリアルにする
  - [#140](https://github.com/jphacks/tkb_2608/pull/140) [add] 避難の音（効果音の合成・ナレーション・終わりの signal）を追加
  - [#139](https://github.com/jphacks/tkb_2608/pull/139) [add] 音の ID と音の Cue を作る関数を core に追加
  - [#138](https://github.com/jphacks/tkb_2608/pull/138) [add] エディタで延焼の速さを設定し時刻のスライダーで延焼をプレビューする
  - [#137](https://github.com/jphacks/tkb_2608/pull/137) [update] 見守りのために要件と仕様を書き換え段階 1 と段階 2 に分ける
  - [#131](https://github.com/jphacks/tkb_2608/pull/131) [add] エディタで学習／テストモードを選び生徒用の URL と QR コードを出す
  - [#122](https://github.com/jphacks/tkb_2608/pull/122) [add] エディタで火元・開始地点・集合場所を置く道具を追加
  - [#118](https://github.com/jphacks/tkb_2608/pull/118) [add] 校舎に床の矢印と火と煙を差し込み向きの変換を 1 か所にまとめる
  - [#117](https://github.com/jphacks/tkb_2608/pull/117) [update] ロビーを防災学習室にし手で触れて始める方式と訓練の説明を追加
  - [#115](https://github.com/jphacks/tkb_2608/pull/115) [add] エディタの土台とマス目にパーツを塗る編集を追加
  - [#114](https://github.com/jphacks/tkb_2608/pull/114) [add] 火と煙の見た目を作る部品を追加
  - [#113](https://github.com/jphacks/tkb_2608/pull/113) [update] 校内放送の火元の名前を narration の params で渡す形に移す
  - [#112](https://github.com/jphacks/tkb_2608/pull/112) [add] Cue の narration に params（校内放送の教室名等）を追加
  - [#98](https://github.com/jphacks/tkb_2608/pull/98) [add] SchoolPlan から 1 フロアの校舎の 3D を組み立てる
  - [#109](https://github.com/jphacks/tkb_2608/pull/109) [add] 体験中の赤い表示に使うエラー行動の判定（detectErrorBehaviors）を追加
  - [#107](https://github.com/jphacks/tkb_2608/pull/107) [fix] 開発サーバーを IPv4 で待ち受けトンネルの URL の取り違えを直す
  - [#106](https://github.com/jphacks/tkb_2608/pull/106) [add] 結果画面（地図と評価の表示）を追加
  - [#105](https://github.com/jphacks/tkb_2608/pull/105) [update] Session に避難の記録と評価（drill）を追加
  - [#103](https://github.com/jphacks/tkb_2608/pull/103) [update] 体験中のエラー行動を画面の赤い表示で示す要件と規則を追記
  - [#102](https://github.com/jphacks/tkb_2608/pull/102) [add] 学習モードで床に正解経路の矢印を出す部品を追加
  - [#100](https://github.com/jphacks/tkb_2608/pull/100) [add] 火災訓練のシナリオ（buildDrillScenario）とテストを追加
  - [#97](https://github.com/jphacks/tkb_2608/pull/97) [add] 起動時に URL の校舎データを読み込んで Session に書く処理を追加
  - [#93](https://github.com/jphacks/tkb_2608/pull/93) [add] 延焼・避難経路・評価の計算（src/sim/）とテストを追加
  - [#90](https://github.com/jphacks/tkb_2608/pull/90) [add] 避難の記録と評価の型（DrillTrack・DrillEvaluation）を core に追加
  - [#81](https://github.com/jphacks/tkb_2608/pull/81) [add] 校舎のパーツと確認用の空間（?scene=school-parts）を追加
  - [#89](https://github.com/jphacks/tkb_2608/pull/89) [update] ロビーでしゃがみ歩きを足し手順の区間を記録して渡すように変更
  - [#88](https://github.com/jphacks/tkb_2608/pull/88) [update] CalibrationProfile にキャリブレーションの区間（segments）を追加
  - [#87](https://github.com/jphacks/tkb_2608/pull/87) [add] Session に校舎データと読み込み失敗の理由を追加
  - [#85](https://github.com/jphacks/tkb_2608/pull/85) [add] 校舎データを URL に埋め込む encodePlan・decodePlan・validatePlan を追加
  - [#83](https://github.com/jphacks/tkb_2608/pull/83) [add] デモの校舎と文字の行からマス目を組み立てる関数を追加
  - [#82](https://github.com/jphacks/tkb_2608/pull/82) [add] 校舎データ SchoolPlan の型を core に追加
  - [#75](https://github.com/jphacks/tkb_2608/pull/75) [update] CLAUDE.md のプロダクト説明を火災避難訓練の方針に更新
  - [#74](https://github.com/jphacks/tkb_2608/pull/74) [update] 仕様と追加機能の候補を火災避難訓練の方針で見直す
  - [#72](https://github.com/jphacks/tkb_2608/pull/72) [update] 正解付きの記録で足踏み・しゃがみの判定を直す
  - [#71](https://github.com/jphacks/tkb_2608/pull/71) [add] ホームに音量・明るさ・消灯の設定とスタート前の確認を追加
  - [#70](https://github.com/jphacks/tkb_2608/pull/70) [update] 要件定義書を小学校の火災避難訓練シミュレーションに方向転換
  - [#66](https://github.com/jphacks/tkb_2608/pull/66) [add] 背面カメラの手の認識と握る・つまむ・指を差す判定を追加
  - [#65](https://github.com/jphacks/tkb_2608/pull/65) [add] アイディア候補 4 案と類似事例の調査をまとめる
  - [#63](https://github.com/jphacks/tkb_2608/pull/63) [add] 動きの記録の再生・判定の調整ページ・印の操作盤・回帰テストの仕組みを追加
  - [#62](https://github.com/jphacks/tkb_2608/pull/62) [update] 追加機能の候補にマップエディタと AI による見取り図の読み取りを追記
  - [#60](https://github.com/jphacks/tkb_2608/pull/60) [add] 類似事例の調査（防災VR・見取り図からVR）をまとめる
  - [#59](https://github.com/jphacks/tkb_2608/pull/59) [add] 体験の流れに入力とキャリブレーションの正面リセットをつなぐ
  - [#57](https://github.com/jphacks/tkb_2608/pull/57) [add] 開始画面の後のホーム画面と背景・横向き案内・頭の向きの仮実装を追加
  - [#56](https://github.com/jphacks/tkb_2608/pull/56) [update] SceneId にホーム（home）を追加
  - [#55](https://github.com/jphacks/tkb_2608/pull/55) [add] 担当D の入力を歩行につなぎ ?input でも当たり判定を効かせる
  - [#46](https://github.com/jphacks/tkb_2608/pull/46) [add] 3 空間の歩行と当たり判定・エリアのイベントと確認用の仮の入力を追加
  - [#47](https://github.com/jphacks/tkb_2608/pull/47) [add] 担当D の入力の入口と足踏み・しゃがみ・頭の向きの判定を追加
  - [#45](https://github.com/jphacks/tkb_2608/pull/45) [update] v0.1.0 のデプロイ記録を追加

### v0.1.0 (2026-10-24)

- タグメッセージ: `[add] 部屋・電車・エレベーターの 3D 空間と開始画面・ロビーのキャリブレーションを含む初回リリース`
- 実行ログ: <https://github.com/jphacks/tkb_2608/actions/runs/40068597983>
- この回の配信の URL: <https://383ba480.tkb2608.pages.dev>
- 公開 URL での確認: **未完了**．配信は成功したが，確認する側の環境（Dev Container）で `*.pages.dev` の名前解決ができなかった（`curl` の終了コード 6．`github.com` は解決できた）．iPhone での表示確認で代える
- staging: 2026-10-24 14:45 の自動配信（`f775293`）で確認済み
- 含む PR（初回のため `main` の全履歴）:
  - [#44](https://github.com/jphacks/tkb_2608/pull/44) [add] 本番リリースの /deploy-prod と staging の配信の仕組みを追加
  - [#43](https://github.com/jphacks/tkb_2608/pull/43) [add] 開始画面とロビーのキャリブレーションを追加
  - [#42](https://github.com/jphacks/tkb_2608/pull/42) [add] コーディング規約とテスト方針を追加
  - [#38](https://github.com/jphacks/tkb_2608/pull/38) [update] Cloudflare Pages の準備を実施済みに更新
  - [#37](https://github.com/jphacks/tkb_2608/pull/37) [update] 部屋をシナリオ H1 の配置に合わせコンロ・ブレーカー・窓ガラス・廊下を追加
  - [#36](https://github.com/jphacks/tkb_2608/pull/36) [add] 担当D の動きの記録の土台（フライトレコーダー・dev ページ）を追加
  - [#35](https://github.com/jphacks/tkb_2608/pull/35) [add] staging の配信を手動でも実行できるようにする
  - [#34](https://github.com/jphacks/tkb_2608/pull/34) [add] エレベーター（かご内）の 3D 空間を追加
  - [#33](https://github.com/jphacks/tkb_2608/pull/33) [add] 担当D の入力モジュールの技術設計メモを experiment_山﨑 に追加
  - [#30](https://github.com/jphacks/tkb_2608/pull/30) [add] 電車（通勤電車の車内）の 3D 空間を追加
  - [#29](https://github.com/jphacks/tkb_2608/pull/29) [update] 追加機能の候補に Bluesky への体験結果の投稿を追加
  - [#27](https://github.com/jphacks/tkb_2608/pull/27) [update] PR の作成・マージ前に main を取り込むルールと CI 必須の Ruleset を追記
  - [#26](https://github.com/jphacks/tkb_2608/pull/26) [add] Cloudflare Pages への staging・本番デプロイと CI を追加
  - [#25](https://github.com/jphacks/tkb_2608/pull/25) [update] 体験シナリオを地震の 5 種類（家・電車・エレベーター）に決定
  - [#24](https://github.com/jphacks/tkb_2608/pull/24) [add] 部屋（リビング）の 3D 空間と空間切り替えの共通構造を追加
  - [#23](https://github.com/jphacks/tkb_2608/pull/23) [add] 仕様書 SPEC_01 と共有の型・シナリオ進行エンジンを追加
  - [#20](https://github.com/jphacks/tkb_2608/pull/20) [add] npm run tunnel で URL の QR コードを表示し実機確認の結果を手順に反映
  - [#19](https://github.com/jphacks/tkb_2608/pull/19) [add] Vite と three.js の雛形と開発コマンドを追加
  - [#15](https://github.com/jphacks/tkb_2608/pull/15) [update] env-check で post-create の完了を待ってから確認するように変更
  - [#14](https://github.com/jphacks/tkb_2608/pull/14) [update] 環境更新 Issue は作者の Rebuild 確認後にのみ作るように変更
  - [#12](https://github.com/jphacks/tkb_2608/pull/12) [add] 環境構築手順と設定ファイルを整備
  - [#11](https://github.com/jphacks/tkb_2608/pull/11) [add] 開発環境の変更を共有し Rebuild 後に自動確認する仕組みを追加
  - [#10](https://github.com/jphacks/tkb_2608/pull/10) [add] 要件定義書と技術スタックを作成
  - [#8](https://github.com/jphacks/tkb_2608/pull/8) [add] main ブランチの保護ルールと CODEOWNERS を追加
  - [#7](https://github.com/jphacks/tkb_2608/pull/7) [update] 直列運用をやめて並行開発の運用に変更
  - [#6](https://github.com/jphacks/tkb_2608/pull/6) [update] リファクタリングを既定で実行せず指定時と大規模変更時のみ行うように変更
  - [#5](https://github.com/jphacks/tkb_2608/pull/5) [update] テンプレートを同期し Projects を既定で使わない運用を取り込み
  - [#3](https://github.com/jphacks/tkb_2608/pull/3) [update] 開発モードをチーム開発（team）に切り替え
  - [#2](https://github.com/jphacks/tkb_2608/pull/2) [add] Dev Container の開発環境と環境構築手順を追加
  - [#1](https://github.com/jphacks/tkb_2608/pull/1) [add] Claude Code チーム開発環境と JPHACKS 2026 大会情報を追加

### 初期版 (2026-10-24)

- 方法: Cloudflare のダッシュボードで Pages のプロジェクト `tkb2608` を Direct Upload で作成した際に，手元で `npm run build` した `dist/` をアップロードした（[ENV_03](ENV_03_管理者用環境構築手順.md)「Cloudflare Pages の準備」）
- 目的: プロジェクトの作成に最初のアップロードが要るため．以後の本番は `v*` タグでのみ更新する
- 確認: iPhone で本番の URL が開けることを確かめた
