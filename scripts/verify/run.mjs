// 検証シナリオのランナー（verifier が使う．.claude/verify-profile.md）．
//   node scripts/verify/run.mjs <シナリオ.mjs>      … 1 本を実行する
//   node scripts/verify/run.mjs scripts/verify/smoke … ディレクトリの *.mjs を名前順にすべて実行する
// 開発サーバー（127.0.0.1:5173）が動いていなければ自分で起動し，終わったら自分が起動したものだけを止める．
// 出力は実行ごとに run-<日時>/ を作る（前回の証拠を上書きしない）．失敗したチェックがあれば終了コード 1，検証不能なら 2．
import { spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { BASE_URL, DEV_PORT } from "./guard.mjs";
import { createSession, launchBrowser } from "./session.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SMOKE_DIR = path.join(REPO_ROOT, "scripts/verify/smoke");
/** 開発サーバーの起動を待つ上限（ms） */
const SERVER_WAIT_MS = 60_000;

function fail(message) {
  console.error(`検証不能: ${message}`);
  process.exit(2);
}

const target = process.argv[2];
if (!target) fail("usage: node scripts/verify/run.mjs <シナリオ.mjs | ディレクトリ>");

const abs = path.resolve(target);
if (!existsSync(abs)) fail(`シナリオが見つかりません: ${abs}`);
const isBatch = statSync(abs).isDirectory();
const scenarios = isBatch
  ? readdirSync(abs)
      .filter((f) => f.endsWith(".mjs"))
      .sort()
      .map((f) => path.join(abs, f))
  : [abs];
if (scenarios.length === 0) fail(`シナリオ（*.mjs）がありません: ${abs}`);

// headless の既定は chromium-headless-shell のため，実際に起動して確かめる
try {
  await (await launchBrowser()).close();
} catch (err) {
  fail(
    `Playwright のブラウザを起動できません（npx playwright install chromium-headless-shell で入れてから再実行してください）: ${err.message.split("\n")[0]}`,
  );
}

/**
 * 出力先．コミット済みの smoke は .verify/smoke/<名前>/，それ以外はシナリオの隣に run-<日時>/ を作る．
 * 一括実行ではシナリオごとに <名前>/ で分ける．
 */
function outDirFor(scenarioPath, stamp) {
  const name = path.basename(scenarioPath, ".mjs");
  if (scenarioPath.startsWith(`${SMOKE_DIR}${path.sep}`)) {
    return path.join(REPO_ROOT, ".verify/smoke", name, `run-${stamp}`);
  }
  const base = path.dirname(scenarioPath);
  return isBatch ? path.join(base, name, `run-${stamp}`) : path.join(base, `run-${stamp}`);
}

/** 5173 で Vite の開発サーバーが応答しているか（Vite だけが返す /@vite/client で見分ける．別のプロセスなら使わない） */
async function isUp() {
  try {
    const res = await fetch(`${BASE_URL}/@vite/client`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

/** 開発サーバーを起動して応答するまで待つ．ログは logFile に書く */
async function startDevServer(logFile) {
  const log = createWriteStream(logFile);
  const child = spawn(
    path.join(REPO_ROOT, "node_modules/.bin/vite"),
    ["--host", "127.0.0.1", "--port", String(DEV_PORT), "--strictPort"],
    { cwd: REPO_ROOT, stdio: ["ignore", "pipe", "pipe"] },
  );
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  const deadline = Date.now() + SERVER_WAIT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) fail(`開発サーバーが起動できませんでした（${logFile}）`);
    if (await isUp()) return child;
    await new Promise((r) => setTimeout(r, 500));
  }
  child.kill();
  fail(`開発サーバーが ${SERVER_WAIT_MS / 1000} 秒以内に応答しませんでした（${logFile}）`);
}

/** 出力先の日時（手元の時刻．人間が新しい順に探しやすいよう UTC にしない）．例: 20261026-003015 */
function localStamp(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

const stamp = localStamp(new Date());
const firstOut = outDirFor(scenarios[0], stamp);
mkdirSync(firstOut, { recursive: true });

// 人間が起動済みの開発サーバーは使うだけで止めない
let server = null;
if (await isUp()) {
  console.log(`起動済みの開発サーバーを使います: ${BASE_URL}`);
} else {
  console.log(`開発サーバーを起動します: ${BASE_URL}`);
  server = await startDevServer(path.join(firstOut, "server.log"));
}

let totalFailed = 0;
try {
  for (const scenario of scenarios) {
    const outDir = outDirFor(scenario, stamp);
    mkdirSync(outDir, { recursive: true });
    console.log(`\n▶ ${path.relative(REPO_ROOT, scenario)} → ${path.relative(REPO_ROOT, outDir)}`);
    const session = await createSession(outDir);
    try {
      const mod = await import(pathToFileURL(scenario).href);
      await mod.default(session);
    } catch (err) {
      // シナリオ自体が落ちた時も，それまでのチェックと証拠は残す
      await session.check("シナリオが最後まで実行できる", () => {
        throw err;
      });
    }
    const failed = await session.finish();
    totalFailed += failed;
    console.log(
      `結果: ${failed === 0 ? "OK" : `NG（${failed} 件失敗）`} — ${path.relative(REPO_ROOT, outDir)}/result.json`,
    );
  }
} finally {
  if (server) server.kill();
}

process.exit(totalFailed === 0 ? 0 : 1);
