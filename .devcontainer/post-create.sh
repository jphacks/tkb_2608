#!/usr/bin/env bash
# Dev Container 作成時の初期セットアップ（devcontainer.json の postCreateCommand から実行される）．
# 再実行しても安全なので，失敗したときはコンテナ内で `bash .devcontainer/post-create.sh` を再実行すればよい
set -euo pipefail

CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
CLAUDE_BIN_DIR="$HOME/.local/share/claude"
GH_DIR="$HOME/.config/gh"
export PATH="$HOME/.local/bin:$PATH"

echo "▶ 1/3: 名前付きボリュームの所有者を修正"
# 名前付きボリュームは初回マウント時に root 所有で作られるため，remoteUser に直す
sudo mkdir -p "$CLAUDE_DIR" "$CLAUDE_BIN_DIR" "$GH_DIR"
sudo chown -R "$(id -u):$(id -g)" "$CLAUDE_DIR" "$HOME/.local" "$HOME/.config"

echo "▶ 2/3: Claude Code のインストール"
# 本体（~/.local/share/claude/versions）はボリュームに残るが，~/.local/bin のリンクは Rebuild で消える．
# 本体があればダウンロードせず，最新版へのリンクだけ張り直す（自動更新で入った版もここに溜まる）
latest="$(ls -1 "$CLAUDE_BIN_DIR/versions" 2>/dev/null | sort -V | tail -n 1 || true)"
if [ -n "$latest" ]; then
  mkdir -p "$HOME/.local/bin"
  ln -sf "$CLAUDE_BIN_DIR/versions/$latest" "$HOME/.local/bin/claude"
  echo "  ✓ インストール済みの $latest を使用"
else
  curl -fsSL https://claude.ai/install.sh | bash
fi
# ネイティブインストーラは ~/.local/bin に入れるが，VS Code のターミナルでは PATH に入らないため
# /usr/local/bin にリンクを張る（リンク先の ~/.local/bin/claude は自動更新で張り替わるので追従する）
sudo ln -sf "$HOME/.local/bin/claude" /usr/local/bin/claude
claude --version

echo "▶ 3/3: git と GitHub CLI の連携"
# gh が認証済みなら git の credential helper として gh を使う（push・pull が通る）．
# `gh auth setup-git` は ~/.gitconfig に書き込むが，VS Code は ~/.gitconfig が既にあるとホストの
# .gitconfig（user.name / user.email）をコピーしないため，同じ設定を /etc/gitconfig（--system）に書く
if gh auth status >/dev/null 2>&1; then
  GH_BIN="$(command -v gh)"
  for host in https://github.com https://gist.github.com; do
    sudo git config --system --unset-all "credential.$host.helper" || true
    sudo git config --system --add "credential.$host.helper" ""
    sudo git config --system --add "credential.$host.helper" "!$GH_BIN auth git-credential"
  done
  echo "  ✓ git の credential helper に gh を設定"
else
  echo "  ✗ gh 未認証です．'gh auth login' を一度実行してから，このスクリプトを再実行してください（以後は Rebuild しても保持されます）"
fi

if [ ! -f "$CLAUDE_DIR/.credentials.json" ]; then
  echo "ℹ Claude Code 未ログインです．ターミナルで 'claude' を起動してログインしてください（以後は Rebuild しても保持されます）"
fi

echo "✓ セットアップ完了"
