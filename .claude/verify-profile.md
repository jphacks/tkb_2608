# 検証プロファイル (Verify Profile)

`/verify` と `/implement` の Phase 1b で verifier が読む，このプロジェクト（ひなんクラフトVR）の検証の手順と規約．雛形は `.claude/skills/verify/profile-template.md`．
検証中に「ここに書いていなかったせいで verifier が間違えた」ことが起きたら，その場で本ファイルに追記する．

## 種別・検証手段 (Target & Method)

- Web アプリ（Vite + TypeScript + three.js．サーバーは持たない）．ヘッドレスブラウザ（Playwright ＋ Chromium）でローカルの開発サーバー（`npm run dev` と同じ `http://127.0.0.1:5173`）を開いて操作する
- 3D（WebGL）は SwiftShader（ソフトウェアの GPU）で描く．スマホのセンサー・背面カメラは使えないため，体の動きと手は `?input=mock`（キーボードとマウス）で代わりに入れる
- 判定・計算の正しさは単体テスト（`npm test`）の担当．verifier は「画面が開く・流れが進む・エラーが出ない・見た目が明らかに壊れていない」を確かめる

## 検証対象の環境 (Target Environments)

- ローカルの接続先: `http://127.0.0.1:5173`（`http://localhost:5173` も同じ）．開発サーバーだけ
- ローカル以外で許可する環境: なし
- 接続を禁止する環境（拒否リスト）: `https://tkb2608.pages.dev`（本番）・`https://staging.tkb2608.pages.dev` を含む `*.tkb2608.pages.dev`・`*.workers.dev`（見守りの中継）・`*.trycloudflare.com`（実機確認用のトンネル）・`generativelanguage.googleapis.com`（Gemini）．どんな場合もアクセスしない
- 開発サーバーの `/api/`（AI の下書き．Vite が `npm run functions:dev` に流し，Gemini の利用料がかかる）も使わない

ランナーはブラウザの全通信を `scripts/verify/guard.mjs` で判定し，許可リスト以外（MediaPipe のモデル等の外部 CDN を含む）を止める．止めた通信は `result.json` の `blocked` に残る．

## 実行コマンド (Run Command)

- シナリオの置き場所: `.verify/<概要（kebab-case）>/scenario.mjs`（`.gitignore` 済み．コミットしない）
- 実行コマンド: `node scripts/verify/run.mjs .verify/<概要>/scenario.mjs`
- 共通のスモーク（ランナーの動作確認・回帰の確認）: `node scripts/verify/run.mjs scripts/verify/smoke`（2 本で約 2 分）．変更が画面全体・体験の流れに関わる時はこれも実行する
- 出力先: 1 本なら `.verify/<概要>/run-<日時>/`，スモークは `.verify/smoke/<名前>/run-<日時>/`．実行ごとに別ディレクトリで，前回の証拠は上書きされない．`<日時>` は手元の時刻（JST）の `YYYYMMDD-HHMMSS`
- ランナーは**1 つずつ**実行する．同時に 2 つ走らせると，後から起動した方は先の方が起動した開発サーバーを使い，先の方が終わった時点でそのサーバーが止まる
- 出力されるもの: `result.json`（チェックの一覧・成否・止めた通信）・`NN-<チェック名>.png`（各チェックの時点のスクリーンショット）・`console.log`（ブラウザのエラーと警告）・`server.log`（ランナーが開発サーバーを起動した時だけ．ディレクトリを渡して一括実行した時は最初のシナリオの出力先にだけ出る）
- 終了コード: 0 = すべて合格，1 = 失敗したチェックがある，2 = 検証不能（前提を満たさない）

## 前提条件と確認方法 (Preconditions)

| 前提条件 | 確認方法 | 満たされない場合 |
| --- | --- | --- |
| 依存がインストール済み | `ls node_modules/playwright node_modules/vite` | `npm ci` を実行してよい |
| Playwright のブラウザが入っている | ランナーが起動時に確かめ，無ければ終了コード 2 で止まる | `npx playwright install chromium-headless-shell` を実行してよい（ユーザーのキャッシュ `~/.cache/ms-playwright/` に入るだけ） |
| ポート 5173 が開発サーバーか空いている | ランナーが確かめる（`/@vite/client` が応答するかで Vite かを見分けるだけで，どのブランチのコードかまでは見ない）．人間の `npm run dev` が動いていればそれを使い，無ければ自分で起動して終わったら止める | 別のプロセスが 5173 を使っていて起動できない時は検証不能として報告する（そのプロセスは止めない） |

## 認証方法・ロール (Auth & Roles)

- 認証なし．ログインもユーザーも無い（校舎のデータは URL の `#p=...` に入る）

## テストデータの規約 (Test Data Rules)

- サーバー側に保存するデータは無い．ブラウザの状態（localStorage．エディタの編集 `tkb2608.editor.plan` 等）は，シナリオごとに新しいブラウザのコンテキストで始まり，終わると消える．人間のブラウザの状態には触れない
- エディタを特定の校舎で始めたい時は `open(path, { localStorage: { "tkb2608.editor.plan": "<JSON>" } })` で入れる
- 動きの記録（`logs/input/`）には書き込まない．ランナーが `/__input-log` への POST を止める（書くと `?input=replay` が既定で読む「最新の記録」が人間の記録から入れ替わる）．読み出し（`?input=replay&log=<ファイル名>`）は使ってよい
- 後始末: 出力先（`.verify/`）以外にファイルは作らない

## 待ち方・操作の癖 (Waiting & Selectors)

### 画面ごとの開き方

URL の一覧は [ENV_04](../docs/02_ENV/ENV_04_開発コマンド.md)「起動の切り替え」と [SPEC_01](../docs/04_SPEC/SPEC_01_画面遷移とモジュール構成.md)「起動の切り替え」が正．よく使うもの:

| 画面 | パス | 画面の大きさ | DOM で確かめられること |
| --- | --- | --- | --- |
| 教員用のホーム | `/` | `desktop` | 「エディタを開く」等のボタン・文言 |
| エディタ | `/?editor` | `desktop` | 道具箱のボタン・入力欄・メッセージ．マス目は canvas（クリック・ドラッグで塗る） |
| 結果画面だけ | `/?debrief`（`=late`・`=nosmoke`） | `desktop` | 文言・数値（地図は canvas） |
| デモの校舎の 3D | `/?scene=school&input=mock&t=<秒>&speed=<倍率>` | `desktop` | 左上の `<pre>` に位置・姿勢・`alarm`・`error` の行 |
| 体験の流れ | `/?app&input=mock` | `phone` | 開始画面とホームは DOM．ロビー以降（ゴーグルの画面）は 3D の中に描かれ DOM に無い |
| エディタの 3D 表示 | `/?editor` の後，`.editor__view-toggle`（文言が「3D で見る」⇔「編集に戻る」で入れ替わるので `aria-pressed` で状態を見る）を押す | `desktop` | 位置を出す `<pre>` は無い．左下の説明の 2 行目が「立っている／しゃがんでいる」．歩いたかは `.editor__preview` の要素スクリーンショットを前後で比べる（何もしない間は静止画なので対照になる）．キーは `?input=mock` と違い，W/↑ 前・S/↓ 後ろ・A/D・←/→ で向きを変える・C でしゃがむ．開始直後は 1〜2 m 先の壁を向いている |
| 見守り画面 | `/?monitor#p=...&room=...` | `desktop` | 中継（`VITE_MONITOR_RELAY_URL`）が無いローカルでは「つながらない」状態になる．中継を伴う確認はしない |

### 体験の流れ（`?app&input=mock`）の進め方

`scripts/verify/smoke/02-app-flow.mjs` がそのまま動く手本．

1. 開始画面: 「はじめる」→ headless ではセンサーの許可が取れないので「センサーなしで進む」を押す
2. ホーム: 「スタート」は手で押すボタンでもあり，普通の click は待ち続けて失敗する．`click({ force: true })` で押す．続く「このまま始める」も `force: true`
3. ロビー（ゴーグルの画面）: 案内の板の文字は 3D の中にある．手のボタンは `pressHandButton(page, VR_BUTTON.lobbyStart)`（最初の開始ボタン）→ `VR_BUTTON.lobbyLower`（見え方の確認の後）で押す．押せたかは `vrPanel(page)`（案内の板の範囲のスクリーンショット）が押す前と変わったかで確かめる
4. キャリブレーション（5 手順．1 分ほど）: `W` を押し続けると足踏みの手順も通る．終わると「今日の訓練」「避難の注意」の説明に進む
5. ゴーグルの画面に入った後の段階は，スクリーンショットを Read で見て確かめる．「OK」の判定だけを信じない（手を押せずに止まっていても，待つだけのチェックは合格する）

### キー・マウス（`?input=mock`）

- `W` 歩く（押し続ける）・`S` ゆっくり・`C` しゃがむ／立つの切り替え・`E` 近くのドアの開閉・ドラッグで頭の向き
- 右手はマウスの位置．右ボタンか `F` で握る．マウスを動かさないと手が出ないので，かざす間は動かし続ける（`pressHandButton` が行う）
- キーは `page.keyboard.down("KeyW")` → `waitForTimeout` → `up` で押し続ける

### 一般

- 3D の画面は描画を待つ API が無い．DOM の要素の出現で待てない所だけ `waitForTimeout` を使う
- セレクタは `getByRole("button", { name })`・`getByText` で，文言は推測せずソース（`src/portal/`・`src/lobby/`・`src/editor/` 等）で確かめてから書く
- 延焼を確かめる時は `?t=`・`?speed=` で時刻を進め，実時間で待たない

## 既知のノイズ (Known Noise)

- `result.json` の `blocked` は，ふだん（`?input=mock`・エディタ・結果画面）は空．外部の URL（MediaPipe のモデル `storage.googleapis.com` 等）が並ぶのは手の認識を使う `?input=device` の時で，ガードが止めた結果であり不具合ではない．ただしそのせいで機能が動かない場合（例: `?input=device` の手の認識）は検証の対象外として人間に回す
- 開始画面でセンサーの許可が取れず「もう一度試す／センサーなしで進む」が出るのは headless だからで不具合ではない
- ゴーグルの画面で最初に「手が見つかりません」と出るのは，マウスを動かす前だから（`pressHandButton` で解消する）
- `?scene=school&input=mock` の開始直後は壁の正面を向いていて，スクリーンショットが一面の壁になり，W を押しても進まない（向きを変えてから歩く．スモーク 01 はドラッグで右後ろへ向いてから歩く）
- 左上の `<pre>` の `alarm` の行は毎フレーム進むため，表示全体の文字列を前後で比べても「変わった」ことにしかならない．比べる時は `pos` 等の行だけを取り出す
- 開発サーバーの起動直後の 1 回目は依存の事前バンドルで遅い．タイムアウトしたら 1 回だけ再実行してよい

## 禁止操作 (Prohibited Operations)

- 「検証対象の環境」の許可リスト以外への接続（本番・staging・中継・Gemini）．CLI・MCP 経由も含む
- `npm run tunnel`・`npm run relay:dev`・`npm run functions:dev`・`npm run dev:record` の起動（外部への公開・API の利用料・記録用サーバーとの取り合いになる）
- `logs/` の中のファイルの作成・変更・削除（人間の動きの記録）
- 自分が起動していないプロセスの停止（人間が起動した `npm run dev` は使うだけで止めない）
- `.verify/` 以外へのファイルの書き込み（プロダクトのコード・テスト・`scripts/verify/smoke/` は変えない）

## シナリオのテンプレート (Scenario Template)

```js
// .verify/<概要>/scenario.mjs — 実行: node scripts/verify/run.mjs .verify/<概要>/scenario.mjs
// default export の関数がセッションのヘルパーを受け取る．各チェックは失敗しても次へ進み，page を渡すとその時点のスクリーンショットが残る
import { BASE_URL } from "../../scripts/verify/guard.mjs";

export default async function ({ open, check, expect, consoleLines }) {
  const errorsSince = (start) => consoleLines.slice(start).filter((l) => /pageerror|error:/.test(l));

  // 画面を伴うチェック: open(パス, { viewport: "desktop" | "phone", localStorage? }) → check(名前, 関数, page)
  const start = consoleLines.length;
  const page = await open("/?editor");
  await check(
    "エディタの「QR コードを出す」を押すと生徒用の URL が出る",
    async () => {
      await page.getByRole("button", { name: "QR コードを出す" }).click();
      const url = await page.getByLabel("生徒用の QR コード").locator("input").inputValue();
      expect(url.includes("?app#p="), `URL の形が違う: ${url}`);
      const errors = errorsSince(start);
      expect(errors.length === 0, `エラー: ${errors.join(" / ")}`);
      return url.slice(0, 80); // 返した文字列は result.json の detail に残る
    },
    page,
  );

  // 画面を伴わないチェック（page を渡さない）．fetch はガードを通らないため，BASE_URL（ローカルの開発サーバー）だけに使う
  await check("開発サーバーがホーム画面の HTML を返す", async () => {
    const res = await fetch(BASE_URL);
    expect(res.ok, `HTTP ${res.status}`);
  });
}
```

- ヘルパー（`createSession` が渡すもの）: `open(path, options)`・`check(name, fn, page?)`・`expect(条件, メッセージ)`・`screenshot(page, name)`・`consoleLines`（ブラウザのエラーと警告）・`blocked`（止めた通信）
- `session.mjs` から import するもの: `pressHandButton(page, { x, y })`・`VR_BUTTON`・`vrPanel(page)`・`VR_PANEL`・`VIEWPORTS`
- チェックの名前は「何がどうなるべきか」にする．`expect` の文言は「何が起きたか」
- 後始末（ブラウザ・開発サーバー）はランナーが行うため，シナリオには書かない
- 体験の流れ（手のボタン）を使う時は `pressHandButton`・`VR_BUTTON`・`vrPanel` を `session.mjs` から import する（手本は `scripts/verify/smoke/02-app-flow.mjs`）

## 実行基盤の要件 (Runner Requirements)

ランナーは `scripts/verify/`（`run.mjs`・`session.mjs`・`guard.mjs`）．雛形の要件に対する実装:

- 判断はエージェント，決定的な処理はスクリプト: 開発サーバーの起動と停止・ブラウザの起動・結果の集計はランナーが行う
- 後始末: 開発サーバーはランナーが起動した時だけ止める．ブラウザはシナリオごとに閉じる．サーバー側のデータは無い
- 実行ごとに `run-<日時>/` を分ける
- ガード: `guard.mjs` の許可リスト（ローカルの 5173 だけ）と拒否リスト（本番・staging・中継・トンネル・Gemini・`/api/`）をブラウザの全通信に適用する．テストは `src/scripts/verifyGuard.test.ts`
- 前提を満たさない時は終了コード 2 と理由で止まる
- 計測アーティファクト: VS Code のターミナルが渡す `WAYLAND_DISPLAY`・`DISPLAY` があると Chromium が WebGL を作れない（three.js の画面が描かれない）ため，`launchBrowser()` がこの 2 つを外して起動する

1 回の検証は，スモーク込みで数分かかる．挙動に関係しない変更（ドキュメント・テストのみ）では走らせない．
