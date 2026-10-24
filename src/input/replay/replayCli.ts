/// <reference types="node" />
// 記録の再生と集計のコマンド（npm run replay．scripts/replay.mjs が vite の runnerImport で読み込む）．
// 記録を今の判定に流し直し，しきい値の組ごとに SPEC の指標を表で出す．切り出し（--slice）で fixtures 用の小さな JSONL も作る
import { readFile, stat } from "node:fs/promises";
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
  --slice <ファイル> <始まり秒> <終わり秒>
                                記録の始まりからの秒で区間を切り出し，motion・label・cue・mark の行を標準出力に出す
例: npm run replay -- --set "gyro90:stepGyroRejectDps=90" --set "comp:headRotCompensation=1" --segments`;

interface CliOptions {
  paths: string[];
  setSpecs: string[];
  setsFiles: string[];
  includeDefault: boolean;
  segments: boolean;
  unlabeled: boolean;
  slice: { file: string; fromSec: number; toSec: number } | null;
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
  if (sets.length === 0) return "比べるしきい値の組がありません";

  const recordings = await loadRecordings(await expandPaths(o.paths));
  const cells = compareParamSets(recordings, sets);
  const out: string[] = [];
  if (errors.length > 0) out.push(errors.join("\n"));
  const labeledCount = new Set(cells.filter((c) => c.labeled).map((c) => c.recording)).size;
  out.push(
    `記録 ${recordings.length} 件（正解付き ${labeledCount} 件）× しきい値 ${sets.length} 組: ${sets.map((s) => s.name).join(", ")}`,
  );
  if (labeledCount === 0) {
    out.push("正解付きの記録（protocol.html で取ったもの）がありません");
  } else {
    out.push(formatSummaryTables(cells));
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
