// 記録の一部を切り出して小さな JSONL にする（誤判定した場面を回帰テストの fixtures/ に置くため．experiment_山﨑/10「回帰テストへの切り出し」）．
// 判定に要る行（motion）と，手順の行（label・cue・mark）だけを残す．純粋な関数
const KEEP_TYPES = new Set(["motion", "label", "cue", "mark"]);

/**
 * JSONL の text から，時刻 [fromT, toT]（記録の時刻．ms）の行を取り出す．
 * 残すのは motion・label・cue・mark の行だけ（orientation・detect 等は大きいため落とす）．
 * 末尾に改行を付ける．該当する行が無ければ空文字列
 */
export function sliceRecordingText(text: string, fromT: number, toT: number): string {
  const out: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "") continue;
    let o: unknown;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof o !== "object" || o === null) continue;
    const r = o as { type?: unknown; t?: unknown };
    if (typeof r.type !== "string" || !KEEP_TYPES.has(r.type) || typeof r.t !== "number") continue;
    if (r.t >= fromT && r.t <= toT) out.push(line);
  }
  return out.length === 0 ? "" : `${out.join("\n")}\n`;
}

/** 記録の最初の motion の時刻（ms）．無ければ NaN（切り出しの時刻を記録の始まりからの秒で指定するため） */
export function firstMotionT(text: string): number {
  for (const raw of text.split("\n")) {
    if (!raw.includes('"motion"')) continue;
    try {
      const o = JSON.parse(raw) as { type?: unknown; t?: unknown };
      if (o.type === "motion" && typeof o.t === "number" && Number.isFinite(o.t)) return o.t;
    } catch {
      // 壊れた行は飛ばす
    }
  }
  return Number.NaN;
}
