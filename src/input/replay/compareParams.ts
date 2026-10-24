// 複数のしきい値（params）を同じ記録に流して，SPEC の指標を表で比べる（しきい値の探索用．experiment_山﨑/11）．
// 純粋な関数: 記録の文字列としきい値の組を受け取り，表の文字列を返す（ファイルの読み書きは呼ぶ側が行う）
import { DEFAULT_INPUT_PARAMS, type InputParams, mergeParams } from "../params";
import {
  DEFAULT_EVALUATE_OPTIONS,
  type EvaluateOptions,
  evaluateRecording,
  type RecordingEvaluation,
  type StabilitySummary,
} from "./evaluate";
import { hasCompleteSegments, type ParsedRecording } from "./parseRecording";

/** 比べるしきい値の 1 組 */
export interface ParamSet {
  readonly name: string;
  readonly params: InputParams;
}

/** 名前の付いた記録 */
export interface NamedRecording {
  readonly name: string;
  readonly recording: ParsedRecording;
}

/** 既定値（DEFAULT_INPUT_PARAMS）の組 */
export const DEFAULT_PARAM_SET: ParamSet = { name: "default", params: DEFAULT_INPUT_PARAMS };

/**
 * "名前:key=値,key=値" の形の文字列をしきい値の組にする（既定値に重ねる）．
 * 名前を省いた時（"key=値"）は文字列そのものを名前にする．知らない項目・数でない値は errors に入れる
 */
export function parseParamSetSpec(
  spec: string,
  base: InputParams = DEFAULT_INPUT_PARAMS,
): { readonly set: ParamSet; readonly errors: readonly string[] } {
  const colon = spec.indexOf(":");
  const hasName = colon >= 0 && !spec.slice(0, colon).includes("=");
  const name = hasName ? spec.slice(0, colon) : spec;
  const body = hasName ? spec.slice(colon + 1) : spec;
  const overrides: Record<string, number> = {};
  const errors: string[] = [];
  for (const part of body.split(",")) {
    const item = part.trim();
    if (item === "") continue;
    const eq = item.indexOf("=");
    const key = eq >= 0 ? item.slice(0, eq).trim() : item;
    const value = eq >= 0 ? Number(item.slice(eq + 1)) : Number.NaN;
    if (!Object.hasOwn(base, key)) errors.push(`知らない項目: ${key}`);
    else if (!Number.isFinite(value)) errors.push(`数でない値: ${item}`);
    else overrides[key] = value;
  }
  return { set: { name, params: mergeParams(base, overrides) }, errors };
}

/**
 * JSON（{ name, params } の配列，または { 名前: params } のオブジェクト）をしきい値の組にする．
 * 形が合わない要素は飛ばし，errors に入れる
 */
export function paramSetsFromJson(
  json: unknown,
  base: InputParams = DEFAULT_INPUT_PARAMS,
): { readonly sets: readonly ParamSet[]; readonly errors: readonly string[] } {
  const sets: ParamSet[] = [];
  const errors: string[] = [];
  const add = (name: unknown, params: unknown) => {
    if (typeof name !== "string" || typeof params !== "object" || params === null) {
      errors.push(`形が合わない組: ${JSON.stringify(name)}`);
      return;
    }
    sets.push({ name, params: mergeParams(base, params as Record<string, unknown>) });
  };
  if (Array.isArray(json)) {
    for (const item of json) {
      if (typeof item === "object" && item !== null) {
        const o = item as Record<string, unknown>;
        add(o.name, o.params);
      } else {
        errors.push("配列の要素がオブジェクトでない");
      }
    }
  } else if (typeof json === "object" && json !== null) {
    for (const [name, params] of Object.entries(json)) add(name, params);
  } else {
    errors.push("JSON が配列でもオブジェクトでもない");
  }
  return { sets, errors };
}

/** 記録 × しきい値の組ごとの結果 */
export interface ComparisonCell {
  readonly recording: string;
  readonly paramSet: string;
  readonly labeled: boolean;
  readonly evaluation: RecordingEvaluation;
}

/** すべての記録にすべての組を流す */
export function compareParamSets(
  recordings: readonly NamedRecording[],
  sets: readonly ParamSet[],
  options: EvaluateOptions = DEFAULT_EVALUATE_OPTIONS,
): ComparisonCell[] {
  const out: ComparisonCell[] = [];
  for (const r of recordings) {
    const labeled = hasCompleteSegments(r.recording);
    for (const set of sets) {
      out.push({
        recording: r.name,
        paramSet: set.name,
        labeled,
        evaluation: evaluateRecording(r.recording, set.params, options),
      });
    }
  }
  return out;
}

function fmt(v: number | null | boolean, digits = 0): string {
  if (v === null) return "-";
  if (typeof v === "boolean") return v ? "OK" : "NG";
  return Number.isFinite(v) ? v.toFixed(digits) : "-";
}

function pct(v: number | null): string {
  return v === null ? "-" : `${(v * 100).toFixed(0)}%`;
}

/** 列の幅をそろえた表（全角も 2 文字として数える） */
export function formatTable(rows: readonly (readonly string[])[]): string {
  const width = (s: string) => {
    let w = 0;
    for (const ch of s) w += (ch.codePointAt(0) ?? 0) <= 0xff ? 1 : 2;
    return w;
  };
  const cols = Math.max(0, ...rows.map((r) => r.length));
  const widths: number[] = [];
  for (let c = 0; c < cols; c++) widths.push(Math.max(0, ...rows.map((r) => width(r[c] ?? ""))));
  return rows
    .map((r) =>
      r
        .map((cell, c) => (c === r.length - 1 ? cell : cell + " ".repeat(widths[c] - width(cell))))
        .join("  "),
    )
    .join("\n");
}

const SUMMARY_ROWS: readonly [string, (s: StabilitySummary) => string][] = [
  ["歩きの誤検出（静止・見回し・頷き．目安 0 回）", (s) => fmt(s.falseWalks)],
  ["足踏みの検出率（目安 90% 以上）", (s) => pct(s.stepDetectionRate)],
  ["足踏みの動き出しの最大（ms．目安 500 以下）", (s) => fmt(s.stepOnsetMaxMs)],
  ["  （合図からの最大．反応の時間を含む．ms）", (s) => fmt(s.stepOnsetFromCueMaxMs)],
  ["足踏みの途切れ（回）", (s) => fmt(s.stepDropouts)],
  ["しゃがむ・立つの検出率（目安 90% 以上）", (s) => pct(s.postureDetectionRate)],
  ["しゃがみ・立ち上がりの遅れの最大（ms．目安 1000 以下）", (s) => fmt(s.postureLatencyMaxMs)],
  ["しゃがんでいる間に立った（目安 0 回）", (s) => fmt(s.crouchFalseStands)],
  ["しゃがみ歩きの検出率（目安 90% 以上）", (s) => pct(s.crouchWalkDetectionRate)],
  ["合否", (s) => fmt(s.pass)],
];

/** 正解付きの記録ごとに，しきい値の組を列にした集計の表 */
export function formatSummaryTables(cells: readonly ComparisonCell[]): string {
  const out: string[] = [];
  const recordings = [...new Set(cells.filter((c) => c.labeled).map((c) => c.recording))];
  for (const rec of recordings) {
    const row = cells.filter((c) => c.recording === rec);
    const header = ["指標", ...row.map((c) => c.paramSet)];
    const rows = SUMMARY_ROWS.map(([name, f]) => [
      name,
      ...row.map((c) => f(c.evaluation.summary)),
    ]);
    const incomplete = row[0]?.evaluation.segments.filter((s) => !s.complete).length ?? 0;
    out.push(
      `== ${rec}（正解付き${incomplete > 0 ? `．途中で終わった区間 ${incomplete} 個は合否に使わない` : ""}）`,
      formatTable([header, ...rows]),
    );
  }
  return out.join("\n\n");
}

/** 区間ごとの指標の表（1 つの記録 × 1 つの組） */
export function formatSegmentTable(cell: ComparisonCell): string {
  const header = [
    "#",
    "区間",
    "完",
    "歩き出し",
    "歩",
    "目安の歩",
    "検出率",
    "動き出し",
    "合図から",
    "途切れ",
    "止まる",
    "立つ",
    "しゃがむ",
    "姿勢の検出率",
    "合否",
  ];
  const rows = cell.evaluation.segments.map((s) => {
    const judged = s.checks.filter((c) => c.pass !== null);
    const pass = judged.length === 0 ? null : judged.every((c) => c.pass === true);
    return [
      String(s.index),
      s.repeat > 1 ? `${s.label}#${s.repeat}` : s.label,
      s.complete ? "o" : "x",
      String(s.walkStarts),
      String(s.stepsDetected),
      fmt(s.oracleSteps),
      pct(s.stepDetectionRate),
      fmt(s.onsetFromMotionMs),
      fmt(s.onsetFromCueMs),
      fmt(s.dropouts),
      fmt(s.stopDelayMs),
      String(s.toStanding),
      String(s.toCrouching),
      pct(s.postureDetectionRate),
      fmt(pass),
    ];
  });
  return `-- ${cell.recording} × ${cell.paramSet}（時間は ms）\n${formatTable([header, ...rows])}`;
}

/** ラベルの無い記録の全体の数（しきい値の組を列に） */
export function formatOverallTable(cells: readonly ComparisonCell[]): string {
  const unlabeled = cells.filter((c) => !c.labeled);
  if (unlabeled.length === 0) return "";
  const sets = [...new Set(unlabeled.map((c) => c.paramSet))];
  const header = [
    "記録（正解なし）",
    "秒",
    ...sets.flatMap((s) => [`${s}:歩き出し`, `${s}:歩`, `${s}:姿勢`]),
  ];
  const recordings = [...new Set(unlabeled.map((c) => c.recording))];
  const rows = recordings.map((rec) => {
    const row = unlabeled.filter((c) => c.recording === rec);
    return [
      rec,
      fmt(row[0]?.evaluation.overall.durationSec ?? null),
      ...row.flatMap((c) => [
        String(c.evaluation.overall.walkStarts),
        String(c.evaluation.overall.steps),
        String(c.evaluation.overall.postureChanges),
      ]),
    ];
  });
  return formatTable([header, ...rows]);
}
