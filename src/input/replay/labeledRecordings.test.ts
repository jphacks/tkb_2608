// logs/input/ の正解付きの記録（protocol.html で取ったもの）を今の既定値の判定に流し直し，SPEC_01「判定の安定性」の目安との
// 照合を表示する．logs/ は Git の管理外のため，記録が無ければ skip する（CI は記録無しで緑）．
// まだ目安に届かない場面が残っているため，目安に届かなくても失敗にはしない（集計が例外なく終わることだけを確かめる）
import { describe, expect, it } from "vitest";
import { DEFAULT_INPUT_PARAMS } from "../params";
import { evaluateRecording } from "./evaluate";
import { loadLabeledRecordings } from "./loadLogs";

const recordings = await loadLabeledRecordings();

describe.skipIf(recordings.length === 0)("正解付きの記録の再生（logs/input/）", () => {
  it.each(recordings.map((r) => [r.name, r] as const))("%s: SPEC の目安と照らす", (_, r) => {
    const ev = evaluateRecording(r.recording, DEFAULT_INPUT_PARAMS);
    expect(ev.segments.length).toBeGreaterThan(0);
    const rows = ev.summary.checks.map(
      (c) =>
        `  ${c.pass === null ? "-" : c.pass ? "OK" : "NG"} ${c.name}: ${c.value === null ? "-" : Number(c.value.toFixed(3))}（目安 ${c.op} ${c.target}）`,
    );
    console.log(`${r.name}\n${rows.join("\n")}`);
  });
});
