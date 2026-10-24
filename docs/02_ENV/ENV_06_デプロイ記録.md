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
| [v0.1.0](#v010-2026-10-24) | 2026-10-24 15:02 | `f775293` | 成功 | 1 分 | 部屋・電車・エレベーターの 3D 空間と，開始画面・ロビーのキャリブレーションを含む初回リリース |
| （初期版） | 2026-10-24（時刻は未記録） | `77d8b2d`（ビルドした時点の `main`） | 成功 | - | Pages のプロジェクト作成時に，管理者がダッシュボードから手でアップロード（タグなし） |

## 詳細 (Details)

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
