// Worker から転送する形（Float32Array 1 つ）と MediaPipe の結果の変換
import { describe, expect, it } from "vitest";
import { observationsFromResult, packHands, unpackHands } from "./handPacking";
import { handLandmarks, observation } from "./testHands";

describe("packHands・unpackHands", () => {
  it("往復すると左右・確からしさ・21 点が元に戻る（Float32 の精度で）", () => {
    const hands = [
      observation({ label: "left", score: 0.95, cx: 0.3, z: -0.02 }),
      observation({ label: "right", score: 0.5, cx: 0.7, curls: [1, 1, 1, 1] }),
    ];
    const packed = packHands(hands);
    expect(packed.points).toBeInstanceOf(Float32Array);
    expect(packed.points.length).toBe(2 * 21 * 3);
    const back = unpackHands(packed);
    expect(back).toHaveLength(2);
    back.forEach((h, i) => {
      expect(h.label).toBe(hands[i].label);
      expect(h.score).toBe(hands[i].score);
      expect(h.landmarks).toHaveLength(21);
      h.landmarks.forEach((p, j) => {
        expect(p.x).toBeCloseTo(hands[i].landmarks[j].x, 6);
        expect(p.y).toBeCloseTo(hands[i].landmarks[j].y, 6);
        expect(p.z).toBeCloseTo(hands[i].landmarks[j].z, 6);
      });
    });
  });

  it("手が無ければ空の配列", () => {
    const packed = packHands([]);
    expect(packed.points.length).toBe(0);
    expect(unpackHands(packed)).toEqual([]);
  });

  it("点が 21 個より少ない手は詰めない", () => {
    const short = { ...observation({ label: "left" }), landmarks: handLandmarks().slice(0, 20) };
    const ok = observation({ label: "right" });
    const packed = packHands([short, ok]);
    expect(packed.labels).toEqual(["right"]);
    expect(packed.points.length).toBe(63);
  });

  it("21 点より多い手は最初の 21 点だけを詰める", () => {
    const long = { ...observation(), landmarks: [...handLandmarks(), { x: 9, y: 9, z: 9 }] };
    expect(packHands([long]).points.length).toBe(63);
  });

  it("数が合わない分は捨てる（点・左右・確からしさの最も少ない数に合わせる）", () => {
    const packed = packHands([observation(), observation()]);
    expect(unpackHands({ ...packed, labels: ["left"] })).toHaveLength(1);
    expect(unpackHands({ ...packed, scores: [] })).toHaveLength(0);
    expect(unpackHands({ ...packed, points: packed.points.slice(0, 63 + 10) })).toHaveLength(1);
  });
});

describe("observationsFromResult", () => {
  const lms = () => handLandmarks().map((p) => ({ ...p, visibility: 0 }));

  it("左右の名前（大文字・小文字を問わない）と確からしさを移す", () => {
    const out = observationsFromResult({
      landmarks: [lms(), lms()],
      handedness: [[{ categoryName: "Left", score: 0.8 }], [{ categoryName: "RIGHT", score: 0.7 }]],
    });
    expect(out.map((h) => h.label)).toEqual(["left", "right"]);
    expect(out.map((h) => h.score)).toEqual([0.8, 0.7]);
    // 使う項目（x・y・z）だけにする
    expect(Object.keys(out[0].landmarks[0]).sort()).toEqual(["x", "y", "z"]);
  });

  it("左右が読めない手は right・確からしさ 0 とみなす", () => {
    const out = observationsFromResult({ landmarks: [lms(), lms()], handedness: [[]] });
    expect(out.map((h) => [h.label, h.score])).toEqual([
      ["right", 0],
      ["right", 0],
    ]);
    const none = observationsFromResult({ landmarks: [lms()] });
    expect(none[0]).toMatchObject({ label: "right", score: 0 });
  });

  it("点が 21 個より少ない手は捨て，多い手は 21 点にする", () => {
    const out = observationsFromResult({
      landmarks: [lms().slice(0, 5), [...lms(), { x: 0, y: 0, z: 0 }]],
      handedness: [[{ categoryName: "Left", score: 1 }], [{ categoryName: "Left", score: 1 }]],
    });
    expect(out).toHaveLength(1);
    expect(out[0].landmarks).toHaveLength(21);
  });

  it("手が無ければ空", () => {
    expect(observationsFromResult({ landmarks: [], handedness: [] })).toEqual([]);
  });
});
