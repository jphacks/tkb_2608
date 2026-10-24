// 誤判定した場面を記録から切り出し，回帰テストで「期待する判定」と照らす（DOM に依存しない純粋な関数）．
// 切り出した記録は対象と同じフォルダの fixtures/ に置き，Vitest で今の判定に流し直して確かめる
// （experiment_山﨑/10「回帰テストへの切り出し」・.claude/rules/testing.md「センサーの記録データ」）
import type { Posture } from "../../core/types";
import type { InputParams } from "../params";
import type { InputRecord } from "../recorder/records";
import { type RejudgeResult, rejudgeRecords } from "./rejudge";
import { parseRecordsJsonl, sortRecordsByTime } from "./replayLog";

/** 切り出しに残す種類（判定に流す値・ラベル・印・文脈．記録した時の判定の結果（detect・state）は今の判定で作り直すので捨てる） */
const CLIP_TYPES = new Set<InputRecord["type"]>(["motion", "visibility", "label", "mark"]);

/**
 * fromT〜toT（ms．両端を含む）の区間を切り出す．小さくするため判定に要る種類だけを残す．
 * 文脈として meta と，区間の始まりまでで最後の params は区間の外でも残す（時刻は元のまま）．
 * 区間が逆向き・数でなければ空にする
 */
export function clipRecords(
  records: readonly InputRecord[],
  fromT: number,
  toT: number,
): InputRecord[] {
  if (!Number.isFinite(fromT) || !Number.isFinite(toT) || fromT > toT) return [];
  const sorted = sortRecordsByTime(records);
  const meta = sorted.find((r) => r.type === "meta");
  let params: InputRecord | undefined;
  for (const r of sorted) {
    if (r.t > fromT) break;
    if (r.type === "params") params = r;
  }
  const body = sorted.filter((r) => CLIP_TYPES.has(r.type) && r.t >= fromT && r.t <= toT);
  return [
    ...(meta === undefined ? [] : [meta]),
    ...(params === undefined ? [] : [params]),
    ...body,
  ];
}

/** 区間（ms）の中の判定のまとめ */
export interface WindowSummary {
  /** 数えた歩 */
  readonly steps: number;
  /** walking が false → true になった回数（区間の始まりで既に歩いていた分は数えない） */
  readonly walkOnsets: number;
  /** walking が true だった時間（ms） */
  readonly walkingMs: number;
  /** 姿勢が切り替わった回数 */
  readonly postureChanges: number;
  /** しゃがんでいた時間（ms） */
  readonly crouchingMs: number;
  /** 区間の中のサンプルの数 */
  readonly samples: number;
  /** 区間の中で現れた姿勢 */
  readonly postures: readonly Posture[];
}

/** fromT〜toT（ms．両端を含む）の判定をまとめる．時間はサンプルの間隔を足し合わせる */
export function summarizeWindow(result: RejudgeResult, fromT: number, toT: number): WindowSummary {
  const tl = result.timeline;
  let walkOnsets = 0;
  let walkingMs = 0;
  let crouchingMs = 0;
  let postureChanges = 0;
  let samples = 0;
  const postures = new Set<Posture>();
  // 数でない・逆向きの区間は空として扱う（clipRecords と同じ．NaN の比較は常に false で全体を見てしまうため）
  const validWindow = Number.isFinite(fromT) && Number.isFinite(toT) && fromT <= toT;
  if (!validWindow) {
    return { steps: 0, walkOnsets, walkingMs, postureChanges, crouchingMs, samples, postures: [] };
  }
  let prev = -1;
  for (let i = 0; i < tl.t.length; i++) {
    const t = tl.t[i];
    if (t < fromT) continue;
    if (t > toT) break;
    samples++;
    postures.add(tl.posture[i]);
    if (prev >= 0) {
      const dt = t - tl.t[prev];
      if (tl.walking[prev]) walkingMs += dt;
      if (tl.posture[prev] === "crouching") crouchingMs += dt;
      if (!tl.walking[prev] && tl.walking[i]) walkOnsets++;
      if (tl.posture[prev] !== tl.posture[i]) postureChanges++;
    }
    prev = i;
  }
  let steps = 0;
  for (const s of result.steps) if (s >= fromT && s <= toT) steps++;
  return {
    steps,
    walkOnsets,
    walkingMs,
    postureChanges,
    crouchingMs,
    samples,
    postures: [...postures],
  };
}

/** 数の期待（両端を含む．省いた側は制限しない） */
export interface CountRange {
  readonly min?: number;
  readonly max?: number;
}

/** 切り出した記録の区間ごとの「期待する判定」 */
export interface WindowExpectation {
  /** 何を確かめるか（失敗の時に出す） */
  readonly note: string;
  /** 区間（ms．記録の時刻） */
  readonly fromT: number;
  readonly toT: number;
  readonly steps?: CountRange;
  readonly walkOnsets?: CountRange;
  readonly postureChanges?: CountRange;
  /** "never": 区間の中でずっと歩かない．"some": 少しでも歩く */
  readonly walking?: "never" | "some";
  /** 区間の中でずっとこの姿勢 */
  readonly posture?: Posture;
}

function checkRange(name: string, value: number, range: CountRange | undefined): string | null {
  if (range === undefined) return null;
  if (range.min !== undefined && value < range.min)
    return `${name} が ${value}（${range.min} 以上のはず）`;
  if (range.max !== undefined && value > range.max)
    return `${name} が ${value}（${range.max} 以下のはず）`;
  return null;
}

/**
 * 期待と照らし，外れたものを説明の文字列で返す（空なら全部合っている）．
 * 区間にサンプルが 1 つも無い期待は，切り出しの誤りとして外れにする
 */
export function checkExpectations(
  result: RejudgeResult,
  expectations: readonly WindowExpectation[],
): string[] {
  const failures: string[] = [];
  for (const e of expectations) {
    const s = summarizeWindow(result, e.fromT, e.toT);
    const where = `${e.note}（${e.fromT}〜${e.toT} ms）`;
    if (s.samples === 0) {
      failures.push(`${where}: 区間にサンプルが無い`);
      continue;
    }
    const problems = [
      checkRange("歩の数", s.steps, e.steps),
      checkRange("歩き始めの回数", s.walkOnsets, e.walkOnsets),
      checkRange("姿勢の切り替わりの回数", s.postureChanges, e.postureChanges),
    ];
    if (e.walking === "never" && s.walkingMs > 0) {
      problems.push(`歩いていた時間が ${Math.round(s.walkingMs)} ms（歩かないはず）`);
    }
    if (e.walking === "some" && s.walkingMs === 0 && s.walkOnsets === 0) {
      problems.push("一度も歩かなかった（歩くはず）");
    }
    if (e.posture !== undefined && s.postures.some((p) => p !== e.posture)) {
      problems.push(`姿勢が ${s.postures.join("・")}（ずっと ${e.posture} のはず）`);
    }
    for (const p of problems) if (p !== null) failures.push(`${where}: ${p}`);
  }
  return failures;
}

/** 切り出した記録（JSONL の文字列）を読み，判定し直す（回帰テスト用）．読めなかった行の数も返す */
export function rejudgeJsonl(
  text: string,
  params: InputParams,
): { readonly result: RejudgeResult; readonly skipped: number } {
  const parsed = parseRecordsJsonl(text);
  return { result: rejudgeRecords(parsed.records, params), skipped: parsed.skipped };
}
