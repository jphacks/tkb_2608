# 環境構築手順 (Development Environment Setup)

メンバーの参加時や環境の再構築時に，本手順を上から順に実施する．

## 方針 (Policy)

- 開発 PC は Windows + WSL2 + Docker とし，**Docker は WSL から使う**．
- ソースコードは **WSL のファイルシステム上**（`~/` 配下）に置く．Windows 側（`C:\`，WSL から見た `/mnt/c/`）には置かない．
- 開発は VS Code の **Dev Containers** で行う．WSL 上のリポジトリをコンテナで開き，ターミナル・Claude Code・GitHub CLI はすべてコンテナ内で使う．

### 背景 (Background)

Docker Desktop は Windows から使っても内部では WSL2 上で動くため，エンジン自体の差は無い．差が出るのはソースコードの置き場所である．

| 項目 | Windows 側（`/mnt/c/...`） | WSL 側（`~/...`） |
| --- | --- | --- |
| ファイル I/O | OS 境界を跨ぐため遅い（`npm install` 等で顕著） | 速い |
| ファイル変更検知（HMR） | 変更が伝わりにくく，ポーリング設定が要る | そのまま動く |
| 改行コード・実行権限 | CRLF 混入や権限のずれが起きやすい | 起きにくい |

## 前提 (Prerequisites)

- Windows 10 (22H2) 以降または Windows 11
- WSL2 と Linux ディストリビューション（Ubuntu 推奨）がインストール済み
- Docker（Docker Desktop または WSL 内の Docker Engine）がインストール済み
- Git，GitHub アカウント（`jphacks` Organization のリポジトリにアクセスできること）

## 手順 (Steps)

### WSL2 の確認

PowerShell で以下を実行し，使用するディストリビューションの `VERSION` が `2` であることを確認する．

```powershell
wsl -l -v
```

`1` の場合は以下で WSL2 に変換する（`Ubuntu` は実際のディストリビューション名に置き換える）．

```powershell
wsl --set-version Ubuntu 2
```

### Docker を WSL から使えるようにする

Docker Desktop を使う場合は，Settings → Resources → WSL Integration で使用するディストリビューションを ON にして Apply する．
※ WSL 内に Docker Engine を直接インストールしている場合はこの設定は不要．

以降の操作はすべて **WSL のターミナル**で行う．以下がどちらもバージョンを表示すれば OK．

```bash
docker version
docker compose version
```

`docker version` で `permission denied` が出る場合（WSL 内の Docker Engine を使っているとき）は，ユーザーを `docker` グループに追加してから WSL を開き直す．

```bash
sudo usermod -aG docker $USER
```

### Git の設定

改行コードはリポジトリの `.gitattributes`（`eol=lf`）で LF に統一している．WSL 側の Git で `core.autocrlf` が有効になっていないことを確認する．

```bash
git config --global core.autocrlf   # 何も表示されないか false なら OK
git config --global user.name  "<GitHub のユーザー名>"
git config --global user.email "<GitHub に登録したメールアドレス>"
```

### リポジトリの clone

WSL のホームディレクトリ配下に clone する．

```bash
mkdir -p ~/source
cd ~/source
git clone https://github.com/jphacks/tkb_2608.git
cd tkb_2608
```

※ `pwd` の結果が `/mnt/c/...` で始まっていたら Windows 側にいるため，やり直す．

### Dev Container で開く

VS Code に拡張機能「WSL」（`ms-vscode-remote.remote-wsl`）と「Dev Containers」（`ms-vscode-remote.remote-containers`）をインストールしておく．
WSL のターミナルでリポジトリのルートに移動し，VS Code を開く．

```bash
code .
```

右下に「Reopen in Container」の通知が出たらクリックする（出ない場合はコマンドパレットで `Dev Containers: Reopen in Container`）．
初回はイメージの取得と `.devcontainer/post-create.sh` の実行に数分かかる．ウィンドウ左下に `Dev Container: tkb_2608` と表示されれば完了．

※ エクスプローラーから `\\wsl$\...` のファイルを直接開くと Windows 側のエディタで開かれるため，この方法は使わない．

### コンテナ内での初回ログイン

初回のみ，VS Code のターミナル（コンテナ内）で以下を実行してログインする．

```bash
gh auth login                       # GitHub.com → HTTPS → ブラウザ認証を選ぶ
bash .devcontainer/post-create.sh   # git の push・pull に gh の認証を使う設定をする
claude                              # 起動後の案内に従ってログインする
```

認証情報は名前付きボリューム（`tkb2608-claude-config`，`tkb2608-gh-config`）に保存されるため，Rebuild してもログインし直す必要は無い．
Git のユーザー名・メールアドレスは WSL 側の `~/.gitconfig` が Dev Containers によりコンテナへ自動でコピーされる．

### 動作確認 (Verification)

環境構築が終わったら，コンテナ内のターミナルで確認スクリプトを実行する．`.devcontainer/` を変更して Rebuild した後も同様に実行する．

```bash
bash .devcontainer/check.sh   # 最後に「✓ すべて OK」と出れば成功．✗ の行には対処方法が表示される
```

スクリプトでは確認できない以下の項目は目視で確認する．

- [ ] ウィンドウ左下に `Dev Container: tkb_2608` と表示されている
- [ ] VS Code の Claude Code 拡張（サイドバー）を開くと，ログイン済みの状態で使える
- [ ] 一度 `Dev Containers: Rebuild Container` を実行した後も，ログインし直さずに `bash .devcontainer/check.sh` が「✓ すべて OK」になる
- [ ] Claude Code に「README を読んで」等と頼み，Read・Bash がフックにブロックされずに動く

### コンテナの構成 (Container Configuration)

| 項目 | 内容 |
| --- | --- |
| 設定ファイル | `.devcontainer/devcontainer.json`，`.devcontainer/post-create.sh`，`.devcontainer/check.sh`（動作確認） |
| ベースイメージ | `mcr.microsoft.com/devcontainers/base:ubuntu-24.04`（ユーザー `vscode`，タイムゾーン `Asia/Tokyo`） |
| 導入ツール | GitHub CLI・Python 3・Node.js 24（Dev Container Feature．Python は Claude Code のフック用で，Ubuntu 標準の `python3` のみ），Claude Code（post-create でネイティブインストーラから導入．ボリュームに本体があればダウンロードしない），cloudflared（post-create で公式リリースの `.deb` から導入．スマホの実機確認用） |
| ポート転送 | `5173`（Vite の開発サーバー） |
| VS Code 拡張 | Claude Code（`anthropic.claude-code`） |
| 永続化 | `~/.claude`（`CLAUDE_CONFIG_DIR`），`~/.config/gh`，`~/.local/share/claude`（Claude Code 本体）を名前付きボリュームに置く |

`.devcontainer/` を変更したときは，全員がコマンドパレットで `Dev Containers: Rebuild Container` を実行する．

### トラブルシューティング (Troubleshooting)

- post-create が途中で失敗した: コンテナ内で `bash .devcontainer/post-create.sh` を再実行する（何度実行しても安全）．
- ログイン状態をリセットしたい: コンテナを閉じてから WSL で `docker volume rm tkb2608-claude-config tkb2608-gh-config` を実行し，Rebuild する．
- Claude Code 本体を入れ直したい: コンテナを閉じてから WSL で `docker volume rm tkb2608-claude-bin` を実行し，Rebuild する．

## スマホの実機で確認する (Testing on a Smartphone)

カメラ・傾き・加速度センサーは HTTPS でしか使えない．また WSL2 上の Dev Container で動く開発サーバーには，同じ Wi-Fi のスマホから直接つなげない（WSL2 の既定は NAT 構成のため）．
そこで，cloudflared の **Quick Tunnel**（アカウント不要）で開発サーバーを HTTPS の一時 URL として公開し，スマホからその URL を開く．技術選定の背景は [ENV_01](ENV_01_技術スタック.md)「実機での確認方法」を参照する．

1. 開発サーバーを起動する（コマンドは `ENV_04_開発コマンド.md` を参照する．※ アプリの初期化後に作成する）
2. 別のターミナルでトンネルを張る．

   ```bash
   npm run tunnel
   ```

3. 出力に表示される `https://<ランダムな文字列>.trycloudflare.com` の QR コードをスマホのカメラで読み取り，ブラウザで開く（iPhone は Safari，Android は Chrome）

- `npm run tunnel` は Claude Code の auto mode では実行が止められる（外部から入る経路を開くため）．人間が VS Code のターミナルで実行し，張りっぱなしにする．使い終わったら `Ctrl+C` で止める

- URL はトンネルを張り直すたびに変わる．URL を知っていれば誰でも開けるため，秘密情報を含むページを置かない
- Vite は既定で知らないホスト名からのアクセスを拒否するため，`vite.config.ts` の `server.allowedHosts` に `.trycloudflare.com` を許可する（アプリの初期化時に設定する）
- トンネル経由で開くと `Blocked request. This host (...) is not allowed.` と表示される（HTTP 403）場合は，`npm run dev` を止めて起動し直す．Vite が設定ファイルの変更を検知して自動で再起動すると，`allowedHosts` の設定が反映されないことがある（2026-10-24 に実際に起きた）．トンネルは張ったままでよい
- 確認済み（2026-10-24．iPhone の Safari・モバイル回線）: トンネル経由でページが開き three.js の描画が動くこと，PC 側でファイルを保存すると iPhone の表示が自動で更新されること（Vite の HMR）
- ※ 未検証: Quick Tunnel 経由でのカメラ・センサーの許可．最初の実装（ENV_01「最初に検証すること」）で確認して本手順に反映する
