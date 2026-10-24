// 記録を再生して PlayerInput を作るモック入力（?input=replay．experiment_山﨑/10「PC 用のモック入力」・ENV_04）．
// 合成の記録（body/fixtures/ の静止 → 足踏み → しゃがむ）を記録した時と同じ間隔で流し，本物の入力と同じ判定で
// 足踏みで歩き，しゃがみで crouching になることを確かめる
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlayerInput } from "../../core/types";
import syntheticStillStepCrouch from "../body/fixtures/synthetic_none_still-step-crouch.jsonl?raw";
import type { ReplayOptions } from "../inputSource";
import { DEFAULT_INPUT_PARAMS } from "../params";
import { createReplaySource } from "./replaySource";

/** 合成の記録の最初の motion の時刻（ms） */
const FIRST_MOTION_T = 1000;
/** 再生を始める描画の時刻（ms．記録の時刻とずらす） */
const START = 50_000;
const FRAME_MS = 16;

function source(replay: ReplayOptions = {}) {
  return createReplaySource({
    kind: "replay",
    params: DEFAULT_INPUT_PARAMS,
    replay: { text: syntheticStillStepCrouch, loop: false, fromSec: 0, ...replay },
  });
}

/** 記録の読み込み（非同期）を待つ */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

interface Frame {
  /** 記録の時刻に直した時刻（ms） */
  readonly recT: number;
  readonly input: PlayerInput;
}

/** START から durationMs の間，描画のたびに read する */
function play(
  src: ReturnType<typeof source>,
  durationMs: number,
  recStart = FIRST_MOTION_T,
): Frame[] {
  const out: Frame[] = [];
  for (let now = START; now <= START + durationMs; now += FRAME_MS) {
    out.push({ recT: now - START + recStart, input: src.read(now) });
  }
  return out;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createReplaySource", () => {
  it("kind は replay で，センサーの許可は要らない", async () => {
    const src = source();
    expect(src.kind).toBe("replay");
    await expect(src.activate()).resolves.toEqual({
      motion: "not-required",
      orientation: "not-required",
    });
    expect(src.tracker).not.toBeNull();
    src.dispose();
  });

  it("記録を読み込むまでは止まって立っている", () => {
    const src = source();
    expect(src.read(123)).toMatchObject({
      time: 123,
      posture: "standing",
      walking: false,
      walkSpeed: 0,
    });
    src.dispose();
  });

  it("合成の記録を流すと，静止では歩かず，足踏みで 0.5 秒以内に歩き，しゃがみで crouching になる", async () => {
    const src = source();
    await settle();
    const frames = play(src, 14_000);
    // 静止（1000〜4000 ms）
    expect(frames.filter((f) => f.recT <= 4000).every((f) => !f.input.walking)).toBe(true);
    // 足踏み（4000〜9000 ms）: 4500 ms までに歩き出し，前へ進む速さが出る
    const firstWalk = frames.find((f) => f.input.walking);
    expect(firstWalk).toBeDefined();
    expect(firstWalk?.recT).toBeGreaterThanOrEqual(4000);
    expect(firstWalk?.recT).toBeLessThanOrEqual(4500);
    expect(
      Math.max(...frames.filter((f) => f.recT <= 9000).map((f) => f.input.walkSpeed)),
    ).toBeGreaterThan(0.5);
    expect(frames.filter((f) => f.recT <= 9000).every((f) => f.input.posture === "standing")).toBe(
      true,
    );
    // しゃがむ（11000 ms〜）: 1 秒以内に crouching になり，最後まで保つ．しゃがんだ後は歩かない
    const firstCrouch = frames.find((f) => f.input.posture === "crouching");
    expect(firstCrouch).toBeDefined();
    expect(firstCrouch?.recT).toBeGreaterThanOrEqual(11_000);
    expect(firstCrouch?.recT).toBeLessThanOrEqual(12_000);
    expect(
      frames.filter((f) => f.recT >= 12_000).every((f) => f.input.posture === "crouching"),
    ).toBe(true);
    expect(frames.filter((f) => f.recT >= 11_000).some((f) => f.input.walking)).toBe(false);
    // 時刻は描画の時刻のまま
    expect(frames[0].input.time).toBe(START);
    src.dispose();
  });

  it("?from= の秒から流す（足踏みの始まりから流すと，すぐ歩き出す）", async () => {
    const src = source({ fromSec: 3 });
    await settle();
    const frames = play(src, 2000, FIRST_MOTION_T + 3000);
    const firstWalk = frames.find((f) => f.input.walking);
    expect(firstWalk).toBeDefined();
    expect(firstWalk?.recT).toBeLessThanOrEqual(4500);
    src.dispose();
  });

  it("?from= の秒から流す（足踏みの後の静止から流すと歩かない）", async () => {
    const src = source({ fromSec: 8.5 });
    await settle();
    const frames = play(src, 1400, FIRST_MOTION_T + 8500);
    expect(frames.some((f) => f.input.walking)).toBe(false);
    src.dispose();
  });

  it("loop: false なら最後まで流した後は最初に戻らない（もう歩かない）", async () => {
    const src = source({ loop: false });
    await settle();
    play(src, 14_100);
    const after: PlayerInput[] = [];
    for (let now = START + 14_200; now <= START + 24_000; now += FRAME_MS)
      after.push(src.read(now));
    expect(after.some((i) => i.walking)).toBe(false);
    src.dispose();
  });

  it("loop: true なら最後まで流した後に最初に戻り，また歩く", async () => {
    const src = source({ loop: true });
    await settle();
    play(src, 14_100);
    const after: PlayerInput[] = [];
    for (let now = START + 14_200; now <= START + 30_000; now += FRAME_MS)
      after.push(src.read(now));
    expect(after.some((i) => i.walking)).toBe(true);
    src.dispose();
  });

  it("dispose の後は止まって立っている", async () => {
    const src = source();
    await settle();
    play(src, 6000);
    src.dispose();
    expect(src.read(START + 6100)).toMatchObject({ walking: false, walkSpeed: 0 });
  });

  it("壊れた行・空の記録でも例外を投げず，止まって立っている", async () => {
    for (const text of ["", "broken\n{]\n"]) {
      const src = source({ text });
      await settle();
      expect(() => play(src, 200)).not.toThrow();
      expect(src.read(START + 300).walking).toBe(false);
      src.dispose();
    }
  });

  it("記録を読めない（開発サーバーにつながらない）時は警告を出し，止まって立っている", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const src = createReplaySource({
      kind: "replay",
      params: DEFAULT_INPUT_PARAMS,
      replay: { log: "20261024-143537_abc.jsonl" },
    });
    await settle();
    expect(warn).toHaveBeenCalled();
    expect(src.read(1000)).toMatchObject({ walking: false, posture: "standing" });
    src.dispose();
  });
});
