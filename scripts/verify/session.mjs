// 検証シナリオから使うヘルパー（ブラウザの起動・ページを開く・チェックの記録・証拠のスクリーンショット）．
// ランナー（run.mjs）が createSession で作ってシナリオの default 関数に渡す．使い方は .claude/verify-profile.md．
import { writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { BASE_URL, isAllowed } from "./guard.mjs";

/**
 * 画面の大きさ（px）．desktop は教員の PC，phone は横向きのスマホ．
 * ?input=mock では左右 2 画面にならず 1 画面で描かれる（VR_BUTTON・VR_PANEL の座標はこの 1 画面での値）
 */
export const VIEWPORTS = {
  desktop: { width: 1280, height: 800 },
  phone: { width: 844, height: 390 },
};

// headless でも three.js（WebGL）を描けるよう，ソフトウェアの GPU（SwiftShader）を使う
const LAUNCH_ARGS = [
  "--use-angle=swiftshader",
  "--enable-unsafe-swiftshader",
  "--ignore-gpu-blocklist",
];

/**
 * 検証用のブラウザを起動する．VS Code のターミナルが渡す WAYLAND_DISPLAY・DISPLAY が残っていると，
 * Chromium が Wayland 向けに GPU を初期化しようとして失敗し，WebGL が作れない（three.js の画面が真っ黒になる）ため外す
 */
export function launchBrowser() {
  const env = { ...process.env };
  delete env.WAYLAND_DISPLAY;
  delete env.DISPLAY;
  return chromium.launch({ args: LAUNCH_ARGS, env });
}

/**
 * 動きの記録（logs/input/）への書き込みか．検証の操作が記録に残ると，?input=replay が既定で読む
 * 「最も新しい記録」が人間の記録から入れ替わってしまうため止める（読み出しの GET は通す）
 */
function isInputLogWrite(method, url) {
  return method !== "GET" && new URL(url).pathname.startsWith("/__input-log");
}

/**
 * ゴーグルの画面（VIEWPORTS.phone・正面を向いたまま）での手のボタンの位置（px）．
 * ?input=mock の右手はマウスの位置にあるため，ここへマウスを置くと手のひらをかざしたことになる
 */
export const VR_BUTTON = {
  /** ロビーの最初の開始ボタン（案内の板の下端） */
  lobbyStart: { x: 422, y: 190 },
  /** 見え方の確認の後のボタン（台の上） */
  lobbyLower: { x: 422, y: 275 },
};

/** 手をかざして押すのにかける時間（ms）．押すには 1 秒かざし続ける必要がある */
const HAND_HOLD_MS = 3000;

/** かざしている間にマウスを動かす間隔（ms）．動かさないとモックの手が見失われることがある */
const HAND_JIGGLE_MS = 200;

/**
 * ?input=mock の手をボタンにかざして押す．
 * 押せたかは pressHandButton の前後で screenChanged を使って確かめる（押せなくても例外にはならない）
 * @param {import("playwright").Page} page
 * @param {{ x: number, y: number }} at 画面の位置（px）
 */
export async function pressHandButton(page, at) {
  for (let t = 0; t < HAND_HOLD_MS; t += HAND_JIGGLE_MS) {
    const d = (t / HAND_JIGGLE_MS) % 2;
    await page.mouse.move(at.x + d, at.y + d);
    await page.waitForTimeout(HAND_JIGGLE_MS);
  }
  // 手を案内の板から外す（板のスクリーンショットに手が写らないように）
  await page.mouse.move(HAND_REST.x, HAND_REST.y);
}

/**
 * ゴーグルの画面（VIEWPORTS.phone）で案内の板が写る範囲（px）．3D の中の文字は DOM に無いため，
 * 段階が進んだかはこの範囲のスクリーンショットが変わったかで確かめる（vrPanel）
 */
export const VR_PANEL = { x: 300, y: 60, width: 245, height: 130 };

/** 手を休ませておく位置（px．案内の板にもボタンにも重ならない画面の左下） */
const HAND_REST = { x: 40, y: 360 };

/**
 * 案内の板のスクリーンショット．押す前と後で比べ，変わっていれば段階が進んだとみなす
 * @param {import("playwright").Page} page
 * @returns {Promise<Buffer>}
 */
export function vrPanel(page) {
  return page.screenshot({ clip: VR_PANEL });
}

/** チェックの名前に使えない文字をファイル名用に置き換える */
function fileSafe(name) {
  return name.replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 80);
}

/**
 * 1 回の検証のセッションを作る．
 * @param {string} outDir 証拠（スクリーンショット・result.json・console.log）の出力先
 */
export async function createSession(outDir) {
  const browser = await launchBrowser();
  /** @type {{ name: string, ok: boolean, detail: string, screenshot: string | null }[]} */
  const checks = [];
  /** @type {string[]} */
  const consoleLines = [];
  /** @type {string[]} */
  const blocked = [];
  let shotCount = 0;

  /**
   * ページを開く．path は開発サーバーからの相対（例: "/?editor"）．ローカル以外への通信はすべて止める．
   * @param {string} urlPath
   * @param {{ viewport?: keyof typeof VIEWPORTS, mobile?: boolean, localStorage?: Record<string, string> }} [options]
   */
  async function open(urlPath, options = {}) {
    const viewport = VIEWPORTS[options.viewport ?? "desktop"];
    const context = await browser.newContext({
      viewport,
      isMobile: options.mobile ?? false,
      hasTouch: options.mobile ?? false,
    });
    if (options.localStorage) {
      await context.addInitScript((entries) => {
        for (const [k, v] of Object.entries(entries)) window.localStorage.setItem(k, v);
      }, options.localStorage);
    }
    await context.route("**/*", (route) => {
      const request = route.request();
      const url = request.url();
      if (isAllowed(url) && !isInputLogWrite(request.method(), url)) return route.continue();
      blocked.push(`${request.method()} ${url}`);
      return route.abort("blockedbyclient");
    });
    const page = await context.newPage();
    const tag = `[${urlPath}]`;
    page.on("console", (msg) => {
      if (msg.type() === "error" || msg.type() === "warning") {
        consoleLines.push(`${tag} ${msg.type()}: ${msg.text()}`);
      }
    });
    page.on("pageerror", (err) => consoleLines.push(`${tag} pageerror: ${err.message}`));
    await page.goto(new URL(urlPath, BASE_URL).toString(), { waitUntil: "load" });
    return page;
  }

  /** 証拠のスクリーンショットを撮り，出力先からの相対パスを返す */
  async function screenshot(page, name) {
    shotCount += 1;
    const file = `${String(shotCount).padStart(2, "0")}-${fileSafe(name)}.png`;
    await page.screenshot({ path: path.join(outDir, file) });
    return file;
  }

  /**
   * チェックを 1 つ実行して記録する．fn が例外を投げたら失敗（次のチェックへは進む）．
   * page を渡すと，成否どちらでもその時点のスクリーンショットを残す．
   * @param {string} name 何がどうなるべきか（例: "エディタの道具箱が出る"）
   * @param {() => Promise<string | void>} fn 成功時に詳細を返してよい
   * @param {import("playwright").Page} [page]
   */
  async function check(name, fn, page) {
    let ok = true;
    let detail = "";
    try {
      detail = (await fn()) ?? "";
    } catch (err) {
      ok = false;
      detail = err instanceof Error ? err.message : String(err);
    }
    let shot = null;
    if (page) {
      try {
        shot = await screenshot(page, name);
      } catch (err) {
        // 撮れない時も証拠なしでチェックは記録する（理由は detail に残す）
        detail += `${detail ? " / " : ""}スクリーンショットを撮れない: ${err instanceof Error ? err.message.split("\n")[0] : err}`;
      }
    }
    checks.push({ name, ok, detail, screenshot: shot });
    console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
    return ok;
  }

  /** 条件を満たさなければ失敗にする（check の中で使う） */
  function expect(condition, message) {
    if (!condition) throw new Error(message);
  }

  /** 結果を書き出してブラウザを閉じる．失敗したチェックの数を返す */
  async function finish() {
    await browser.close();
    const failed = checks.filter((c) => !c.ok).length;
    writeFileSync(
      path.join(outDir, "result.json"),
      `${JSON.stringify({ passed: checks.length - failed, failed, checks, blocked }, null, 2)}\n`,
    );
    writeFileSync(path.join(outDir, "console.log"), `${consoleLines.join("\n")}\n`);
    return failed;
  }

  return { open, check, expect, screenshot, finish, consoleLines, blocked };
}
