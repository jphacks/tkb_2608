// 記録を今の判定（body/）に流し直す rejudgeRecords（experiment_山﨑/10「記録の再生」）．
// 合成の波形で，足踏みは 0.5 秒以内に歩き，しゃがみは 1 秒以内に切り替わる（SPEC_01「判定の安定性」）ことを確かめる
import { describe, expect, it } from "vitest";
import type { InputRecord } from "../recorder/records";
import { testParams } from "../testFixtures";
import { rejudgeRecords } from "./rejudge";
import {
  crouchRecords,
  markRec,
  metaRec,
  motionRec,
  paramsRec,
  restRecords,
  scenarioRecords,
  steppingRecords,
  visibilityRec,
} from "./testRecords";

const P = testParams();

describe("rejudgeRecords", () => {
  it("記録が空なら途中の値も区間も空", () => {
    const r = rejudgeRecords([], P);
    expect(r.timeline.t).toEqual([]);
    expect(r.steps).toEqual([]);
    expect(r.walkingSpans).toEqual([]);
    expect(r.crouchSpans).toEqual([]);
    expect(r.postureChanges).toEqual([]);
  });

  it("motion のサンプルごとに 1 つずつ途中の値を残し，配列はすべて同じ長さ", () => {
    const records: InputRecord[] = [
      metaRec(),
      paramsRec(0, {}),
      ...restRecords(0, 1000),
      markRec({ t: 500 }),
    ];
    const tl = rejudgeRecords(records, P).timeline;
    const n = records.filter((r) => r.type === "motion").length;
    for (const arr of Object.values(tl)) expect(arr).toHaveLength(n);
  });

  it("静止だけなら歩かず，姿勢も変わらない", () => {
    const r = rejudgeRecords(restRecords(0, 5000), P);
    expect(r.steps).toEqual([]);
    expect(r.walkingSpans).toEqual([]);
    expect(r.postureChanges).toEqual([]);
    expect(r.timeline.posture.every((p) => p === "standing")).toBe(true);
  });

  it("足踏みで歩を数え，始めてから 0.5 秒以内に歩き出す", () => {
    const r = rejudgeRecords([...restRecords(0, 2000), ...steppingRecords(2000, 3000)], P);
    expect(r.steps.length).toBeGreaterThanOrEqual(5);
    expect(r.steps.every((t) => t >= 2000)).toBe(true);
    expect(r.walkingSpans.length).toBeGreaterThanOrEqual(1);
    expect(r.walkingSpans[0].startT - 2000).toBeLessThanOrEqual(500);
  });

  it("歩く区間の終わりは止まった最初のサンプルの時刻", () => {
    const r = rejudgeRecords(
      [...restRecords(0, 2000), ...steppingRecords(2000, 3000), ...restRecords(5000, 3000)],
      P,
    );
    expect(r.walkingSpans).toHaveLength(1);
    const end = r.walkingSpans[0].endT;
    const i = r.timeline.t.indexOf(end);
    expect(i).toBeGreaterThan(0);
    expect(r.timeline.walking[i]).toBe(false);
    expect(r.timeline.walking[i - 1]).toBe(true);
  });

  it("最後まで歩き続けた区間は最後のサンプルの時刻で終わる", () => {
    const records = [...restRecords(0, 2000), ...steppingRecords(2000, 3000)];
    const r = rejudgeRecords(records, P);
    const lastT = records[records.length - 1].t;
    expect(r.timeline.walking[r.timeline.walking.length - 1]).toBe(true);
    expect(r.walkingSpans[r.walkingSpans.length - 1].endT).toBe(lastT);
  });

  it("しゃがむと 1 秒以内に crouching に切り替わり，その後は保つ", () => {
    const r = rejudgeRecords(
      [...restRecords(0, 2000), ...crouchRecords(2000, 704), ...restRecords(2704, 3000)],
      P,
    );
    expect(r.postureChanges).toHaveLength(1);
    expect(r.postureChanges[0].posture).toBe("crouching");
    expect(r.postureChanges[0].t - 2000).toBeLessThanOrEqual(1000);
    expect(r.crouchSpans).toHaveLength(1);
    expect(r.crouchSpans[0].startT).toBe(r.postureChanges[0].t);
  });

  it("始めの姿勢を crouching にすると，しゃがんだ姿勢から判定する", () => {
    const r = rejudgeRecords(restRecords(0, 1000), P, "crouching");
    expect(r.timeline.posture.every((p) => p === "crouching")).toBe(true);
    expect(r.postureChanges).toEqual([]);
    expect(r.crouchSpans).toHaveLength(1);
  });

  it("同じ記録・同じしきい値なら同じ結果（並びの順によらない）", () => {
    const records = scenarioRecords();
    const a = rejudgeRecords(records, P);
    const b = rejudgeRecords(records, P);
    const shuffled = [...records].reverse();
    expect(b).toEqual(a);
    expect(rejudgeRecords(shuffled, P)).toEqual(a);
  });

  it("しきい値を変えると判定が変わる（高すぎる T_high では歩を数えない）", () => {
    const records = [...restRecords(0, 2000), ...steppingRecords(2000, 3000)];
    const r = rejudgeRecords(records, testParams({ stepHighStanding: 100 }));
    expect(r.steps).toEqual([]);
    expect(r.walkingSpans).toEqual([]);
  });

  it("visibility（タブの切り替え）で体の判定を初期化する: 歩いている途中で止まる", () => {
    const records = [
      ...restRecords(0, 2000),
      ...steppingRecords(2000, 2000),
      visibilityRec(4000),
      ...restRecords(4000, 500),
    ];
    const r = rejudgeRecords(records, P);
    const i = r.timeline.t.indexOf(4000);
    expect(r.timeline.walking[i - 1]).toBe(true);
    expect(r.timeline.walking[i]).toBe(false);
  });

  it("visibility の後も姿勢は保つ", () => {
    const records = [
      ...restRecords(0, 2000),
      ...crouchRecords(2000, 704),
      ...restRecords(2704, 2000),
      visibilityRec(4704),
      ...restRecords(4704, 2000),
    ];
    const r = rejudgeRecords(records, P);
    expect(r.timeline.posture[r.timeline.posture.length - 1]).toBe("crouching");
    expect(r.postureChanges).toHaveLength(1);
  });

  it("acc・accG・rot が null の motion でも例外を投げない", () => {
    const records = [
      ...restRecords(0, 500),
      motionRec({ t: 500, acc: null, accG: null, rot: null, interval: null }),
      ...restRecords(516, 500),
    ];
    expect(() => rejudgeRecords(records, P)).not.toThrow();
  });
});
