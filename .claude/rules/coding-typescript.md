---
paths: ["src/**", "scripts/**", "vite.config.ts"]
---

# コーディング規約 (Coding Standards)

アプリのコード（TypeScript・three.js）を書くときは本ルールに従うこと．4 人の Claude が並行して書いても，書き方がそろうようにするためのもの．
本ルールは，すでにマージされたコードの書き方を明文化したものである（Issue #39）．新しく書くコードは本ルールに合わせ，既存のコードで本ルールと食い違う箇所は，その機能を触るついでに直す（直すためだけの PR は作らない）．

## モジュールの分け方と依存の向き (Modules & Dependencies)

モジュール（`src/` 直下のフォルダ）の役割・担当・依存の向きは [SPEC_01](../../docs/04_SPEC/SPEC_01_画面遷移とモジュール構成.md)「モジュール構成と担当」「依存の向き」が正である．要点は次のとおり．

- 各モジュールは `core/` だけを import する．**モジュール同士は直接 import しない**．つなぐのは `app/` だけ
- `input/` は three.js を import しない（入力は `core/types.ts` の素のデータで表す）
- `scenes/` はセンサー・カメラの API（`DeviceMotionEvent`・`getUserMedia` 等）に触れない．入力は `FrameInfo.input` だけから受け取る
- `scenario/` は three.js にもブラウザ API にも依存しない（純粋な TypeScript）
- `core/` のうち three.js の型を使うのは `core/scene.ts` だけ（`import type` のみ）
- **自分の担当のフォルダだけを触る**（GUIDE_03「並行開発」）．`core/` の変更は小さい専用 PR にし，全員に周知する
- 新しいモジュール（フォルダ）を足すときは，先に SPEC_01 の表と依存の向きに追記する

## ファイルと命名 (Files & Naming)

| 対象 | 書き方 | 例 |
| --- | --- | --- |
| ファイル名 | camelCase | `roomLayout.ts`・`flightRecorder.ts` |
| テスト | 対象と同じフォルダに `<対象>.test.ts` | `roomLayout.test.ts` |
| 型・インターフェース・クラス | PascalCase | `Space`・`FlightRecorder` |
| 関数・変数 | camelCase | `createRoomScene`・`disposeObjectTree` |
| 固定の定義（寸法・配置の表・ID） | UPPER_SNAKE_CASE | `ROOM`・`DOOR_SPAN_X`・`STOVE_ID` |
| 生成する関数 | `create〜` | `createBox`・`createRoomScene` |
| 型の判定 | `is〜` | `isRoomSpace` |

- 既存の `core/event-bus.ts`・`scenario/samples/earthquake-fire-evacuation.ts` は kebab-case だが，新しいファイルは camelCase にする
- **default export は使わない**．名前付き export だけにする（import 側の名前のぶれを防ぐ）
- モジュールの公開窓口が要る場合は `index.ts` に集める（例: `scenes/index.ts`）

## 型 (Types)

- `strict` を前提にする．`any`・`as any`・`@ts-ignore`・`@ts-expect-error` は使わない（必要なら型を定義する）
- 型だけの import は `import type`（または `import { type X }`）にする
- モジュール間で受け渡すデータの型は `readonly` を付け，受け取った側が書き換えない
- モジュール間の契約（受け渡す型）は `core/` に置く．モジュールの中だけで使う型は，そのモジュールの `types.ts` に置く

## 関数とクラス (Functions & Classes)

- **判定・計算は純粋な関数**（入力 → 出力．副作用なし）にする．ブラウザ API・時刻・乱数に依存させない（時刻は引数で受け取り，乱数は種付きの乱数（`scenes/common/random.ts` 等）を渡す）
- **ブラウザ API は薄い殻に閉じ込める**．イベントや API の値は，必要な項目だけを持つ型（例: `MotionEventLike`）に移してから純粋な関数に渡す．こうすると判定を node 上でテストできる
- クラスは，状態を持つ殻（センサーの購読・記録・操作）に限って使う．計算や判定はクラスのメソッドにせず，関数として外に出す

## three.js (three.js)

- **作ったものは作った側が解放する**．ジオメトリ・マテリアル・テクスチャを作るモジュールは `dispose()` を用意し，画面を切り替える時に呼ばれる前提で書く．配下をまとめて解放する時は `scenes/common/meshHelpers.ts` の `disposeObjectTree`（重複を除いて解放する）を使う
- 同じ形・同じ見た目の物はジオメトリ・マテリアルを共有する（単位立方体を `scale` で伸ばす等）．数が多い物は `InstancedMesh` を検討する
- **毎フレームの処理（`update`）の中で `new` しない**．`Vector3`・`Quaternion` 等の作業用の値はモジュールの外側で 1 回だけ作って使い回す（ガベージコレクションの停止で fps が落ちるのを防ぐ．SPEC_01「処理速度」）
- 座標は Y 軸が上，単位は m．向きは「0 で -Z を向き，正で左へ回る」（`scenes/types.ts` の `startYaw` と同じ）．別の約束を使う場合はコメントで明記する

## コメント (Comments)

- コメントは日本語で書き，句読点は「，」「．」を使う（`.claude/rules/markdown-style.md` と同じ）
- 各ファイルの先頭に，そのファイルの役割を 1〜2 行で書く
- export する関数・型・定数には `/** */` で説明を付ける．**数値には単位を書く**（m・rad・ms・Hz 等）
- 処理の「何を」ではなく「なぜ」を書く（コードを読めば分かることは書かない）

## ログ・デバッグ (Logging)

- 本番のコードに `console.log` を残さない．実機での確認用のログは，開発時だけ読み込む仕組み（`src/input/dev/`・ENV_01「実機のログの確認」）を使う
- 開発用のページ・コードは本番の画面から import しない

## 書いた後の確認 (Checks)

PR を作る前に `npm run lint`・`npm run typecheck`・`npm test`・`npm run build` が通ることを確かめる（[ENV_04](../../docs/02_ENV/ENV_04_開発コマンド.md)．PR では CI が同じものを実行し，合格しないとマージできない）．整形は `npm run format` に任せ，手で揃えない．
