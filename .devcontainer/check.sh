#!/usr/bin/env bash
# Dev Container の環境構築が完了しているかを確認する（docs/02_ENV/ENV_02 の「動作確認」）．
# コンテナ内のリポジトリ直下で `bash .devcontainer/check.sh` を実行する．何も変更しないので何度実行してもよい
set -uo pipefail

failed=0
ok() { echo "  ✓ $1"; }
ng() { echo "  ✗ $1"; echo "    → $2"; failed=$((failed + 1)); }

echo "▶ Claude Code のフック"
# フックと同じ経路（run_python.sh）で Python が起動できるかを見る
if bash .claude/hooks/run_python.sh -c 'import sys; sys.exit(0 if sys.version_info >= (3, 7) else 1)' 2>/dev/null; then
  ok "Python $(python3 --version 2>&1 | cut -d' ' -f2)"
else
  ng "Python 3.7 以上が起動できない（Claude Code の Read・Bash 等がすべてブロックされる）" "Rebuild する．直らなければ devcontainer.json の python feature を確認する"
fi

echo "▶ Claude Code"
if command -v claude >/dev/null 2>&1; then
  ok "$(claude --version 2>/dev/null)"
else
  ng "claude コマンドが無い" "bash .devcontainer/post-create.sh を再実行する"
fi
if [ -f "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/.credentials.json" ]; then
  ok "ログイン済み"
else
  ng "未ログイン" "ターミナルで claude を起動してログインする"
fi

echo "▶ GitHub CLI と git"
if gh auth status >/dev/null 2>&1; then
  ok "gh: $(gh api user --jq .login 2>/dev/null || echo 'ログイン済み')"
else
  ng "gh が未ログイン" "gh auth login の後，bash .devcontainer/post-create.sh を再実行する"
fi
name="$(git config user.name || true)"
email="$(git config user.email || true)"
if [ -n "$name" ] && [ -n "$email" ]; then
  ok "git ユーザー: $name <$email>"
else
  ng "git の user.name / user.email が未設定" "WSL 側で git config --global を設定し，VS Code で Reload Window する"
fi
if git ls-remote origin HEAD >/dev/null 2>&1; then
  ok "GitHub への接続（git ls-remote）"
else
  ng "GitHub に接続できない" "gh が認証済みなら bash .devcontainer/post-create.sh を再実行する"
fi

echo "▶ 名前付きボリューム（Rebuild しても消えない）"
for dir in "${CLAUDE_CONFIG_DIR:-$HOME/.claude}" "$HOME/.config/gh" "$HOME/.local/share/claude"; do
  if mountpoint -q "$dir"; then
    ok "$dir"
  else
    ng "$dir がボリュームではない（Rebuild で消える）" "devcontainer.json の mounts を確認して Rebuild する"
  fi
done

echo "▶ その他"
if [ "$(date +%Z)" = "JST" ]; then
  ok "タイムゾーン: JST"
else
  ng "タイムゾーンが JST でない（$(date +%Z)）" "devcontainer.json の containerEnv.TZ を確認して Rebuild する"
fi

echo
if [ "$failed" -eq 0 ]; then
  echo "✓ すべて OK"
else
  echo "✗ $failed 件の問題があります"
  exit 1
fi
