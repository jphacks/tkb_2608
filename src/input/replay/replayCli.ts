/// <reference types="node" />
// 記録の再生と集計のコマンド（npm run replay．scripts/replay.mjs が vite の runnerImport で読み込む）．
// 記録を今の判定に流し直し，しきい値の組ごとに SPEC の指標を表で出す．切り出し（--slice）で fixtures 用の小さな JSONL も作る
import { readFile, stat } from "node:fs/promises";
import {
  type CalibrationConfig,
  compareCalibrations,
  DEFAULT_CALIBRATION_LENGTHS,
  describeCalibrationLengths,
  formatCalibrationTable,
  parseCalibrationLengths,
  scaleCalibrationLengths,
} from "./calibrationReplay";
import {
  compareParamSets,
  DEFAULT_PARAM_SET,
  formatOverallTable,
  formatSegmentTable,
  formatSummaryTables,
  type ParamSet,
  paramSetsFromJson,
  parseParamSetSpec,
} from "./compareParams";
import { listLogFiles, loadRecordings } from "./loadLogs";
import { firstMotionT, sliceRecordingText } from "./sliceRecording";

/** 使い方（--help） */
export const REPLAY_USAGE = `使い方: npm run replay -- [記録のファイル・フォルダ ...] [オプション]
  記録を省くと logs/input/ の .jsonl をすべて使う
  --set "名前:key=値,key=値"   比べるしきい値の組を足す（既定値に重ねる．何度でも指定できる）
  --sets <JSON ファイル>        しきい値の組を JSON で足す（[{ "name", "params" }] か { 名前: params }）
  --no-default                  既定値（default）の組を比べない
  --segments                    区間ごとの表も出す
  --unlabeled                   正解の無い記録も全体の数（歩き出し・歩・姿勢の切り替え）を出す
  --calib                       正解付きの記録から 4 区間（静止 3・足踏み 5・しゃがむ 3・しゃがみ歩き 4 秒）を
                                切り出してしきい値を求め，その値で全体を判定し直した列（calib）を足す
  --calib-scale <倍率,...>      区間の長さを倍にした列（calib×倍率）を足す（例: 0.5,2．--calib が無くても足す）
  --calib-ms "名前:stand=ms,step=ms,crouch=ms,crouchWalk=ms"
                                区間ごとの長さを指定した列を足す（省いた区間は既定の長さ．何度でも指定できる）
  --slice <ファイル> <始まり秒> <終わり秒>
                                記録の始まりからの秒で区間を切り出し，motion・label・cue・mark の行を標準出力に出す
例: npm run replay -- --set "gyro90:stepGyroRejectDps=90" --set "comp:headRotCompensation=1" --segments
    npm run replay -- logs/input/<記録>.jsonl --calib --calib-scale 0.5,2 --segments`;

interface CliOptions {
  paths: string[];
  setSpecs: string[];
  setsFiles: string[];
  includeDefault: boolean;
  segments: boolean;
  unlabeled: boolean;
  slice: { file: string; fromSec: number; toSec: number } | null;
  calib: boolean;
  calibScales: number[];
  calibMsSpecs: string[];
  help: boolean;
  errors: string[];
}

/** 引数を読む（純粋な関数） */
export function parseCliArgs(argv: readonly string[]): CliOptions {
  const o: CliOptions = {
    paths: [],
    setSpecs: [],
    setsFiles: [],
    includeDefault: true,
    segments: false,
    unlabeled: false,
    slice: null,
    calib: false,
    calibScales: [],
    calibMsSpecs: [],
    help: false,
    errors: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[i + 1];
      if (v === undefined) o.errors.push(`${a} の値がありません`);
      i++;
      return v ?? "";
    };
    switch (a) {
      case "--set":
        o.setSpecs.push(next());
        break;
      case "--sets":
        o.setsFiles.push(next());
        break;
      case "--no-default":
        o.includeDefault = false;
        break;
      case "--segments":
        o.segments = true;
        break;
      case "--unlabeled":
        o.unlabeled = true;
        break;
      case "--slice": {
        const file = next();
        const fromSec = Number(next());
        const toSec = Number(next());
        if (!Number.isFinite(fromSec) || !Number.isFinite(toSec) || !(toSec > fromSec)) {
          o.errors.push("--slice の秒が不正です（始まり < 終わり）");
        } else {
          o.slice = { file, fromSec, toSec };
        }
        break;
      }
      case "--calib":
        o.calib = true;
        break;
      case "--calib-scale":
        for (const part of next().split(",")) {
          const v = Number(part.trim());
          if (Number.isFinite(v) && v > 0) o.calibScales.push(v);
          else o.errors.push(`--calib-scale の倍率が不正です: ${part}`);
        }
        break;
      case "--calib-ms":
        o.calibMsSpecs.push(next());
        break;
      case "-h":
      case "--help":
        o.help = true;
        break;
      default:
        if (a.startsWith("--")) o.errors.push(`知らないオプション: ${a}`);
        else o.paths.push(a);
    }
  }
  return o;
}

async function expandPaths(paths: readonly string[]): Promise<string[]> {
  if (paths.length === 0) return listLogFiles();
  const out: string[] = [];
  for (const p of paths) {
    try {
      if ((await stat(p)).isDirectory()) out.push(...(await listLogFiles(p)));
      else out.push(p);
    } catch {
      out.push(p); // 読めないファイルは loadRecordings が飛ばす
    }
  }
  return out;
}

/** コマンドを実行して，標準出力に出す文字列を返す（エラーは例外にせず文字列で返す） */
export async function runReplayCli(argv: readonly string[]): Promise<string> {
  const o = parseCliArgs(argv);
  if (o.help) return REPLAY_USAGE;
  if (o.errors.length > 0) return `${o.errors.join("\n")}\n\n${REPLAY_USAGE}`;

  if (o.slice !== null) {
    const text = await readFile(o.slice.file, "utf8");
    const t0 = firstMotionT(text);
    if (!Number.isFinite(t0)) return "motion の行がありません";
    return sliceRecordingText(text, t0 + o.slice.fromSec * 1000, t0 + o.slice.toSec * 1000);
  }

  const sets: ParamSet[] = o.includeDefault ? [DEFAULT_PARAM_SET] : [];
  const errors: string[] = [];
  for (const spec of o.setSpecs) {
    const r = parseParamSetSpec(spec);
    errors.push(...r.errors.map((e) => `--set ${spec}: ${e}`));
    sets.push(r.set);
  }
  for (const file of o.setsFiles) {
    try {
      const r = paramSetsFromJson(JSON.parse(await readFile(file, "utf8")));
      errors.push(...r.errors.map((e) => `--sets ${file}: ${e}`));
      sets.push(...r.sets);
    } catch (e) {
      errors.push(`--sets ${file}: 読めません（${e instanceof Error ? e.message : String(e)}）`);
    }
  }
  const calibConfigs: CalibrationConfig[] = [];
  if (o.calib) calibConfigs.push({ name: "calib", lengths: DEFAULT_CALIBRATION_LENGTHS });
  for (const k of o.calibScales) {
    calibConfigs.push({
      name: `calib×${k}`,
      lengths: scaleCalibrationLengths(DEFAULT_CALIBRATION_LENGTHS, k),
    });
  }
  for (const spec of o.calibMsSpecs) {
    const colon = spec.indexOf(":");
    const hasName = colon >= 0 && !spec.slice(0, colon).includes("=");
    const r = parseCalibrationLengths(hasName ? spec.slice(colon + 1) : spec);
    errors.push(...r.errors.map((e) => `--calib-ms ${spec}: ${e}`));
    calibConfigs.push({ name: hasName ? spec.slice(0, colon) : spec, lengths: r.lengths });
  }
  if (sets.length === 0 && calibConfigs.length === 0) return "比べるしきい値の組がありません";

  const recordings = await loadRecordings(await expandPaths(o.paths));
  const calibration = compareCalibrations(recordings, calibConfigs);
  // 記録ごとに，しきい値の組の列の後にキャリブレーションの列を並べる
  const cells = compareParamSets(recordings, sets).flatMap((c, i, all) =>
    all[i + 1]?.recording === c.recording
      ? [c]
      : [c, ...calibration.cells.filter((x) => x.recording === c.recording)],
  );
  if (sets.length === 0) cells.push(...calibration.cells);
  const out: string[] = [];
  if (errors.length > 0) out.push(errors.join("\n"));
  const labeledCount = new Set(cells.filter((c) => c.labeled).map((c) => c.recording)).size;
  const columns = [...sets.map((s) => s.name), ...calibConfigs.map((c) => c.name)];
  out.push(
    `記録 ${recordings.length} 件（正解付き ${labeledCount} 件）× しきい値 ${columns.length} 組: ${columns.join(", ")}`,
  );
  if (calibConfigs.length > 0) {
    out.push(
      [
        "キャリブレーションの組（正解付きの記録から区間を切り出して求めた値を既定値に重ねる．切り出した部分も評価に含む）:",
        ...calibConfigs.map((c) => `  ${c.name}: ${describeCalibrationLengths(c.lengths)}`),
      ].join("\n"),
    );
  }
  if (labeledCount === 0) {
    out.push("正解付きの記録（protocol.html で取ったもの）がありません");
  } else {
    out.push(formatSummaryTables(cells));
  }
  for (const rec of new Set(calibration.runs.map((r) => r.recording))) {
    out.push(formatCalibrationTable(calibration.runs.filter((r) => r.recording === rec)));
  }
  if (o.segments) {
    for (const c of cells)
      if (c.labeled && c.evaluation.segments.length > 0) out.push(formatSegmentTable(c));
  }
  if (o.unlabeled) {
    const table = formatOverallTable(cells);
    if (table !== "") out.push(table);
  }
  return out.join("\n\n");
}
