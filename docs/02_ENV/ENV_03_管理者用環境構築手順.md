# 管理者用環境構築手順 (Admin Setup)

プロジェクト作成時に管理者（リポジトリ admin．`rintoHasegawa`）が一度だけ行う初期設定をまとめる．
メンバーが参加時に行う手順は [ENV_02](ENV_02_環境構築手順.md)，チーム運用の初期設定（メンバー招待・`main` の保護等）は [GUIDE_03](../01_GUIDE/GUIDE_03_チーム開発ルール.md)「管理者の初期設定」を参照する．

## 実施状況 (Status)

| 項目 | 状態 |
| --- | --- |
| GitHub リポジトリの作成（[jphacks/tkb_2608](https://github.com/jphacks/tkb_2608)） | 済み（運営が作成．public・MIT ライセンス） |
| `main` の保護（Ruleset）・CODEOWNERS | 済み（GUIDE_03） |
| Dependabot alerts / security updates の有効化 | 済み（2026-10-24．`/setup` が `gh api` で有効化・検証） |
| 依存バージョン更新（`.github/dependabot.yml`） | 済み（npm・devcontainers・github-actions を週 1 回） |
| GitHub Pages の有効化 | 未実施（デプロイ用の workflow を追加する時に行う） |

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

## GitHub Pages の有効化 (GitHub Pages)

アプリは GitHub Pages で配信する（[ENV_01](ENV_01_技術スタック.md)）．デプロイ用の workflow（`.github/workflows/` に追加する）を `main` に入れる前に，管理者が GitHub の画面で以下を行う．

1. リポジトリの Settings → Pages を開く
2. 「Build and deployment」の Source を **GitHub Actions** にする
3. workflow が `main` で動いた後，Pages の画面に表示される URL（`https://jphacks.github.io/tkb_2608/` の想定）をスマホで開いて表示を確認する

- ※ リポジトリ名がパスに入るため，Vite の `base` を `/tkb_2608/` にする必要がある（アプリの初期化時に設定する）
- ※ 未検証: Organization（jphacks）の設定で Pages の利用が制限されていないか．Source の選択肢に GitHub Actions が出ない場合は運営に確認する
