"""`.claude/hooks/check_env_sync.py`（開発環境の同期確認フック）のテスト.

実行（リポジトリルートで）:
    python -B -m unittest discover -s .claude/hooks/tests -v

外部依存なし（標準ライブラリの unittest のみ）．フックはプロセス内で呼び出し，
Dev Container の判定と確認済みの記録の置き場所は環境変数で差し替える．
"""

from __future__ import annotations

import ast
import contextlib
import importlib.util
import io
import json
import os
import shutil
import tempfile
import unittest
from unittest import mock

HOOKS_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO_ROOT = os.path.dirname(os.path.dirname(HOOKS_DIR))
HOOK = os.path.join(HOOKS_DIR, "check_env_sync.py")
SETTINGS = os.path.join(REPO_ROOT, ".claude", "settings.json")
COMMAND = "bash .claude/hooks/run_python.sh .claude/hooks/check_env_sync.py"

_spec = importlib.util.spec_from_file_location("check_env_sync", HOOK)
env_sync = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(env_sync)


class RepoMixin:
    """一時ディレクトリに .devcontainer/・package-lock.json・node_modules を持つ擬似リポジトリを作る."""

    def setUp(self) -> None:
        self.root = tempfile.mkdtemp(prefix="env_sync_")
        self.stamp = os.path.join(self.root, "_stamp", "devcontainer.sha256")

    def tearDown(self) -> None:
        shutil.rmtree(self.root, ignore_errors=True)

    def write(self, rel: str, content: str | bytes) -> None:
        path = os.path.join(self.root, *rel.split("/"))
        os.makedirs(os.path.dirname(path), exist_ok=True)
        mode = "wb" if isinstance(content, bytes) else "w"
        with open(path, mode) as f:
            f.write(content)

    def write_json(self, rel: str, data: dict) -> None:
        self.write(rel, json.dumps(data))

    def lock(self, packages: dict) -> None:
        self.write_json("package-lock.json", {"packages": dict({"": {"name": "app"}}, **packages)})

    def installed(self, packages: dict) -> None:
        self.write_json("node_modules/.package-lock.json", {"packages": packages})

    def run_main(self, args: list, container: bool) -> str:
        env = {
            "CLAUDE_PROJECT_DIR": self.root,
            "ENV_SYNC_STAMP": self.stamp,
            "ENV_SYNC_IN_CONTAINER": "1" if container else "0",
        }
        out = io.StringIO()
        with mock.patch.dict(os.environ, env), contextlib.redirect_stdout(out):
            self.assertEqual(env_sync.main(args), 0)
        return out.getvalue()


class TestDevcontainerHash(RepoMixin, unittest.TestCase):
    def test_none_without_devcontainer_dir(self):
        self.assertIsNone(env_sync.devcontainer_hash(self.root))

    def test_stable_and_ignores_line_endings(self):
        self.write(".devcontainer/devcontainer.json", b'{\n  "a": 1\n}\n')
        first = env_sync.devcontainer_hash(self.root)
        self.write(".devcontainer/devcontainer.json", b'{\r\n  "a": 1\r\n}\r\n')
        self.assertEqual(env_sync.devcontainer_hash(self.root), first)

    def test_changes_when_content_or_files_change(self):
        self.write(".devcontainer/devcontainer.json", "{}")
        first = env_sync.devcontainer_hash(self.root)
        self.write(".devcontainer/devcontainer.json", '{"x": 1}')
        second = env_sync.devcontainer_hash(self.root)
        self.write(".devcontainer/sub/post-create.sh", "echo hi")
        third = env_sync.devcontainer_hash(self.root)
        self.assertEqual(len({first, second, third}), 3)


class TestNpmStatus(RepoMixin, unittest.TestCase):
    def test_none_without_lockfile(self):
        self.assertIsNone(env_sync.npm_status(self.root))

    def test_missing_node_modules(self):
        self.lock({"node_modules/three": {"version": "1.0.0"}})
        self.assertEqual(env_sync.npm_status(self.root), "missing")

    def test_ok_when_versions_match(self):
        self.lock({"node_modules/three": {"version": "1.0.0"}})
        self.installed({"node_modules/three": {"version": "1.0.0"}})
        self.assertEqual(env_sync.npm_status(self.root), "ok")

    def test_outdated_when_version_differs_or_missing_package(self):
        self.lock({"node_modules/three": {"version": "2.0.0"}})
        self.installed({"node_modules/three": {"version": "1.0.0"}})
        self.assertEqual(env_sync.npm_status(self.root), "outdated")
        self.lock({"node_modules/vite": {"version": "1.0.0"}})
        self.assertEqual(env_sync.npm_status(self.root), "outdated")

    def test_optional_and_link_packages_are_ignored(self):
        self.lock({
            "node_modules/fsevents": {"version": "2.0.0", "optional": True},
            "node_modules/local": {"version": "0.0.0", "link": True},
        })
        self.installed({})
        self.assertEqual(env_sync.npm_status(self.root), "ok")

    def test_broken_json_is_outdated(self):
        self.write("package-lock.json", "{")
        self.installed({})
        self.assertEqual(env_sync.npm_status(self.root), "outdated")


class TestMessages(RepoMixin, unittest.TestCase):
    def test_nothing_to_check_outputs_nothing(self):
        self.assertEqual(self.run_main([], container=True), "")

    def test_outside_container_skips_devcontainer(self):
        self.write(".devcontainer/devcontainer.json", "{}")
        self.assertEqual(self.run_main([], container=False), "")

    def test_unrecorded_container_warns(self):
        self.write(".devcontainer/devcontainer.json", "{}")
        out = json.loads(self.run_main([], container=True))
        self.assertIn("未実施", out["systemMessage"])
        self.assertEqual(out["hookSpecificOutput"]["hookEventName"], "SessionStart")
        self.assertEqual(out["hookSpecificOutput"]["additionalContext"], out["systemMessage"])

    def test_record_then_ok_then_changed(self):
        self.write(".devcontainer/devcontainer.json", "{}")
        self.assertIn("記録した", self.run_main(["--record"], container=True))
        self.assertTrue(os.path.isfile(self.stamp))
        self.assertIn("✓", json.loads(self.run_main([], container=True))["systemMessage"])
        self.write(".devcontainer/devcontainer.json", '{"features": {}}')
        self.assertIn("変わっている", json.loads(self.run_main([], container=True))["systemMessage"])

    def test_record_outside_container_writes_nothing(self):
        self.write(".devcontainer/devcontainer.json", "{}")
        self.run_main(["--record"], container=False)
        self.assertFalse(os.path.exists(self.stamp))

    def test_npm_warnings(self):
        self.lock({"node_modules/three": {"version": "1.0.0"}})
        self.assertIn("npm ci", json.loads(self.run_main([], container=False))["systemMessage"])
        self.installed({"node_modules/three": {"version": "1.0.0"}})
        self.assertIn("✓", json.loads(self.run_main([], container=False))["systemMessage"])

    def test_multiple_warnings_are_listed(self):
        self.write(".devcontainer/devcontainer.json", "{}")
        self.lock({"node_modules/three": {"version": "1.0.0"}})
        lines = json.loads(self.run_main([], container=True))["systemMessage"].splitlines()
        self.assertEqual(len(lines), 2)
        for line in lines:
            self.assertTrue(line.startswith("[env-sync] ⚠"), line)


class TestEnvSyncWiring(unittest.TestCase):
    def test_registered_as_session_start_hook(self):
        with open(SETTINGS, encoding="utf-8") as f:
            settings = json.load(f)
        commands = [
            hook["command"]
            for group in settings.get("hooks", {}).get("SessionStart", [])
            for hook in group.get("hooks", [])
        ]
        self.assertIn(COMMAND, commands)

    def test_py37_compatible(self):
        with open(HOOK, encoding="utf-8") as f:
            tree = ast.parse(f.read(), filename=HOOK, feature_version=(3, 7))
        future = [n for n in tree.body if isinstance(n, ast.ImportFrom) and n.module == "__future__"]
        self.assertTrue(future and "annotations" in [a.name for a in future[0].names])


if __name__ == "__main__":
    unittest.main()
