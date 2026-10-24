/// <reference types="node" />
// logs/input/ の記録を Node で読む薄い殻（Vitest と scripts/replay.mjs から使う．ブラウザでは使わない）．
// 読んだ文字列は parseRecording.ts の純粋な関数に渡す
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { NamedRecording } from "./compareParams";
import { hasCompleteSegments, parseRecording } from "./parseRecording";

/** 記録の置き場所（リポジトリ直下からの相対．Git の管理外） */
export const INPUT_LOG_DIR = path.join("logs", "input");

/** dir の .jsonl を名前の順に返す（無ければ空） */
export async function listLogFiles(dir: string = INPUT_LOG_DIR): Promise<string[]> {
  try {
    const names = await readdir(dir);
    return names
      .filter((n) => n.endsWith(".jsonl"))
      .sort()
      .map((n) => path.join(dir, n));
  } catch {
    return [];
  }
}

/** ファイルを読んで記録にする（読めないファイルは飛ばす） */
export async function loadRecordings(files: readonly string[]): Promise<NamedRecording[]> {
  const out: NamedRecording[] = [];
  for (const file of files) {
    try {
      const text = await readFile(file, "utf8");
      out.push({ name: path.basename(file, ".jsonl"), recording: parseRecording(text) });
    } catch {
      // 読めないファイルは飛ばす
    }
  }
  return out;
}

/** dir の記録のうち，正解（手順のラベル）付きで，終わりまで記録された区間が 1 つ以上あるものだけを読む */
export async function loadLabeledRecordings(
  dir: string = INPUT_LOG_DIR,
): Promise<NamedRecording[]> {
  const all = await loadRecordings(await listLogFiles(dir));
  return all.filter((r) => hasCompleteSegments(r.recording));
}
