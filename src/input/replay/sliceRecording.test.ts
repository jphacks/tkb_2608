// 記録の切り出し（sliceRecording.ts）を小さな合成の記録で確かめる
import { describe, expect, it } from "vitest";
import { firstMotionT, sliceRecordingText } from "./sliceRecording";

const lines = [
  { type: "meta", t: 0 },
  { type: "motion", t: 100, acc: [0, 0, 0] },
  { type: "orientation", t: 150 },
  { type: "label", t: 200, label: "still", edge: "start", segment: 0 },
  { type: "cue", t: 250, cue: "crouch", segment: 0 },
  { type: "detect", t: 260 },
  { type: "mark", t: 300, kind: "other" },
  { type: "motion", t: 400, acc: [0, 0, 0] },
  { type: "motion", t: 500, acc: [0, 0, 0] },
].map((o) => JSON.stringify(o));
const TEXT = lines.join("\n");

describe("sliceRecordingText", () => {
  it("時刻 [from, to]（両端を含む）の motion・label・cue・mark の行だけを残し，末尾に改行を付ける", () => {
    expect(sliceRecordingText(TEXT, 100, 400)).toBe(
      `${[lines[1], lines[3], lines[4], lines[6], lines[7]].join("\n")}\n`,
    );
  });

  it("該当する行が無ければ空文字列", () => {
    expect(sliceRecordingText(TEXT, 1000, 2000)).toBe("");
    expect(sliceRecordingText("", 0, 1000)).toBe("");
  });

  it("壊れた行・時刻の無い行・種類の無い行は飛ばす", () => {
    const text = ["{broken", '{"type":"motion"}', '{"t":100}', "null", lines[1]].join("\n");
    expect(sliceRecordingText(text, 0, 1000)).toBe(`${lines[1]}\n`);
  });

  it("切り出した記録をもう一度切り出しても同じ（前後の空白は除く）", () => {
    const once = sliceRecordingText(TEXT, 0, 1000);
    expect(sliceRecordingText(once, 0, 1000)).toBe(once);
  });
});

describe("firstMotionT", () => {
  it("最初の motion の時刻", () => {
    expect(firstMotionT(TEXT)).toBe(100);
  });

  it.each([
    ["motion が無い", lines[0]],
    ["空", ""],
    ["壊れた motion の行だけ", '{"type":"motion",'],
    ["時刻が数でない", '{"type":"motion","t":"1"}'],
  ])("%s なら NaN", (_, text) => {
    expect(firstMotionT(text)).toBeNaN();
  });

  it("壊れた行を飛ばして次の motion を使う", () => {
    expect(firstMotionT(`{"type":"motion",\n${lines[7]}`)).toBe(400);
  });
});
