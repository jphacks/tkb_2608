"""SessionStart フック: 手元の開発環境がリポジトリの定義に追いついているかを確認する.

- Dev Container: `.devcontainer/` の中身のハッシュを，`/env-check` が最後に確認した時の記録と比べる．
  記録はコンテナ内（名前付きボリュームの外）に置くため Rebuild で消え，「Rebuild 後に未確認」も検出できる
- npm: `package-lock.json` の各パッケージが `node_modules` に同じバージョンで入っているかを比べる

使い方:
    bash .claude/hooks/run_python.sh .claude/hooks/check_env_sync.py           # 確認して JSON を出力する（SessionStart）
    bash .claude/hooks/run_python.sh .claude/hooks/check_env_sync.py --record  # 今の .devcontainer/ を確認済みとして記録する（/env-check）

読み取り専用（--record を除く）．失敗してもセッション開始は阻害しない（常に exit 0）．
運用は docs/02_ENV/ENV_05_環境の変更の共有.md を参照．
"""

from __future__ import annotations

import hashlib
import json
import os
import sys

PREFIX = "[env-sync]"
DEVCONTAINER_DIR = ".devcontainer"


def repo_root() -> str:
    return os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd()


def stamp_path() -> str:
    # テストから差し替えられるよう環境変数を優先する
    override = os.environ.get("ENV_SYNC_STAMP")
    if override:
        return override
    return os.path.join(os.path.expanduser("~"), ".cache", "env-sync", "devcontainer.sha256")


def in_container() -> bool:
    override = os.environ.get("ENV_SYNC_IN_CONTAINER")
    if override in ("0", "1"):
        return override == "1"
    if os.environ.get("REMOTE_CONTAINERS") or os.environ.get("CODESPACES"):
        return True
    return os.path.exists("/.dockerenv")


def devcontainer_hash(root: str) -> str | None:
    """`.devcontainer/` 配下の全ファイルのパスと中身から 1 つのハッシュを作る（無ければ None）."""
    base = os.path.join(root, DEVCONTAINER_DIR)
    if not os.path.isdir(base):
        return None
    files = []
    for dirpath, _dirnames, filenames in os.walk(base):
        for name in filenames:
            full = os.path.join(dirpath, name)
            rel = os.path.relpath(full, base).replace(os.sep, "/")
            files.append((rel, full))
    digest = hashlib.sha256()
    for rel, full in sorted(files):
        with open(full, "rb") as f:
            # OS ごとの改行コードの違いで別物と判定しない
            content = f.read().replace(b"\r\n", b"\n")
        digest.update(rel.encode("utf-8") + b"\0" + content + b"\0")
    return digest.hexdigest()


def read_stamp(path: str) -> str | None:
    try:
        with open(path, encoding="utf-8") as f:
            return f.read().strip() or None
    except OSError:
        return None


def npm_status(root: str) -> str | None:
    """None: npm を使っていない / "ok" / "missing": node_modules が無い / "outdated": 不一致."""
    lock_path = os.path.join(root, "package-lock.json")
    if not os.path.isfile(lock_path):
        return None
    hidden_path = os.path.join(root, "node_modules", ".package-lock.json")
    if not os.path.isfile(hidden_path):
        return "missing"
    try:
        with open(lock_path, encoding="utf-8") as f:
            wanted = json.load(f).get("packages", {})
        with open(hidden_path, encoding="utf-8") as f:
            installed = json.load(f).get("packages", {})
    except (OSError, ValueError):
        return "outdated"
    for key, meta in wanted.items():
        if not key.startswith("node_modules/"):
            continue
        # OS によって入らない optional 依存とローカルのリンクは比較しない
        if meta.get("optional") or meta.get("link"):
            continue
        got = installed.get(key)
        if got is None or got.get("version") != meta.get("version"):
            return "outdated"
    return "ok"


def build_messages(root: str, stamp: str, container: bool) -> list[str]:
    """警告の一覧を返す．確認対象が 1 つも無ければ空，すべて最新なら ✓ の 1 行."""
    warnings = []
    checked = False

    current = devcontainer_hash(root) if container else None
    if current is not None:
        checked = True
        recorded = read_stamp(stamp)
        if recorded is None:
            warnings.append(
                "⚠ このコンテナでは環境の確認が未実施 — Rebuild 後なら `/env-check` を実行（未対応の環境更新 Issue は `gh issue list --label env-sync`）"
            )
        elif recorded != current:
            warnings.append(
                "⚠ .devcontainer/ が最後に確認した時から変わっている — Rebuild してから `/env-check` を実行"
            )

    npm = npm_status(root)
    if npm is not None:
        checked = True
        if npm == "missing":
            warnings.append("⚠ node_modules が無い — `npm ci` を実行")
        elif npm == "outdated":
            warnings.append("⚠ node_modules が package-lock.json と一致しない — `npm ci` を実行")

    if warnings:
        return [f"{PREFIX} {w}" for w in warnings]
    if checked:
        return [f"{PREFIX} ✓ 開発環境は最新"]
    return []


def emit(messages: list[str]) -> None:
    msg = "\n".join(messages)
    print(json.dumps({
        "systemMessage": msg,
        "hookSpecificOutput": {
            "hookEventName": "SessionStart",
            "additionalContext": msg,
        },
    }, ensure_ascii=False))


def record(root: str, stamp: str, container: bool) -> int:
    if not container:
        print(f"{PREFIX} コンテナ外のため記録しない")
        return 0
    current = devcontainer_hash(root)
    if current is None:
        print(f"{PREFIX} {DEVCONTAINER_DIR}/ が無いため記録しない")
        return 0
    os.makedirs(os.path.dirname(stamp), exist_ok=True)
    with open(stamp, "w", encoding="utf-8") as f:
        f.write(current + "\n")
    print(f"{PREFIX} 確認済みとして記録した: {stamp}")
    return 0


def main(argv: list[str]) -> int:
    root = repo_root()
    stamp = stamp_path()
    container = in_container()
    if "--record" in argv:
        return record(root, stamp, container)
    try:
        messages = build_messages(root, stamp, container)
    except Exception as exc:  # セッション開始を止めない
        messages = [f"{PREFIX} 確認に失敗: {exc}"]
    if messages:
        emit(messages)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
