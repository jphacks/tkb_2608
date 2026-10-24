// しきい値の組の読み込みと，記録 × 組の比較の表（compareParams.ts）を確かめる
import { describe, expect, it } from "vitest";
import { DEFAULT_INPUT_PARAMS } from "../params";
import type { InputRecord } from "../recorder/records";
import { testParams } from "../testFixtures";
import {
  compareParamSets,
  DEFAULT_PARAM_SET,
  formatOverallTable,
  formatSegmentTable,
  formatSummaryTables,
  formatTable,
  paramSetsFromJson,
  parseParamSetSpec,
} from "./compareParams";
import { parseRecording } from "./parseRecording";
import { labelPair, restRecords, steppingRecords } from "./testRecords";

const BASE = testParams();

function parse(records: readonly InputRecord[]) {
  return parseRecording(records.map((r) => JSON.stringify(r)).join("\n"));
}

describe("parseParamSetSpec", () => {
  it("「名前:key=値,key=値」を既定値に重ねた組にする", () => {
    const { set, errors } = parseParamSetSpec("low:stepHighStanding=0.8, stepWeakRatio=0.6", BASE);
    expect(errors).toEqual([]);
    expect(set.name).toBe("low");
    expect(set.params).toEqual({ ...BASE, stepHighStanding: 0.8, stepWeakRatio: 0.6 });
  });

  it("名前を省くと文字列そのものを名前にする", () => {
    const { set } = parseParamSetSpec("stepHighStanding=0.8", BASE);
    expect(set.name).toBe("stepHighStanding=0.8");
    expect(set.params.stepHighStanding).toBe(0.8);
  });

  it("負の数・0 も渡せる（てこの位置・ON/OFF）", () => {
    const { set, errors } = parseParamSetSpec("comp:headRotCompensation=1,headLeverZM=-0.08", BASE);
    expect(errors).toEqual([]);
    expect(set.params.headRotCompensation).toBe(1);
    expect(set.params.headLeverZM).toBe(-0.08);
  });

  it("知らない項目・数でない値は errors に入れ，その項目だけ使わない", () => {
    const { set, errors } = parseParamSetSpec(
      "x:foo=1,stepHighStanding=abc,strideM,zuptMs=200",
      BASE,
    );
    expect(errors).toEqual([
      "知らない項目: foo",
      "数でない値: stepHighStanding=abc",
      "数でない値: strideM",
    ]);
    expect(set.params).toEqual({ ...BASE, zuptMs: 200 });
  });

  it("toString 等の継承した名前は知らない項目として扱う", () => {
    expect(parseParamSetSpec("x:toString=1", BASE).errors).toEqual(["知らない項目: toString"]);
  });

  it("基準を省くと DEFAULT_INPUT_PARAMS に重ねる", () => {
    expect(parseParamSetSpec("a:zuptMs=1").set.params).toEqual({
      ...DEFAULT_INPUT_PARAMS,
      zuptMs: 1,
    });
  });
});

describe("paramSetsFromJson", () => {
  it("{ name, params } の配列を読む", () => {
    const { sets, errors } = paramSetsFromJson([{ name: "a", params: { zuptMs: 1 } }], BASE);
    expect(errors).toEqual([]);
    expect(sets).toEqual([{ name: "a", params: { ...BASE, zuptMs: 1 } }]);
  });

  it("{ 名前: params } のオブジェクトを読む", () => {
    const { sets } = paramSetsFromJson({ a: { zuptMs: 1 }, b: { zuptMs: 2 } }, BASE);
    expect(sets.map((s) => [s.name, s.params.zuptMs])).toEqual([
      ["a", 1],
      ["b", 2],
    ]);
  });

  it("形が合わない要素は飛ばして errors に入れる", () => {
    const { sets, errors } = paramSetsFromJson(
      [{ name: 1, params: {} }, 3, { name: "ok", params: {} }],
      BASE,
    );
    expect(sets.map((s) => s.name)).toEqual(["ok"]);
    expect(errors).toHaveLength(2);
  });

  it.each([null, 3, "x"])("配列でもオブジェクトでもない（%s）なら空で errors", (j) => {
    const { sets, errors } = paramSetsFromJson(j, BASE);
    expect(sets).toEqual([]);
    expect(errors).toHaveLength(1);
  });

  it("params の知らない項目・数でない値は無視する", () => {
    const { sets } = paramSetsFromJson({ a: { foo: 1, zuptMs: "2" } }, BASE);
    expect(sets[0].params).toEqual(BASE);
  });
});

describe("formatTable", () => {
  it("列の幅をそろえる（全角は 2 文字として数える．最後の列は埋めない）", () => {
    expect(
      formatTable([
        ["指標", "a"],
        ["x", "bb"],
      ]),
    ).toBe("指標  a\nx     bb");
  });

  it("空なら空文字列", () => {
    expect(formatTable([])).toBe("");
  });
});

describe("compareParamSets と表", () => {
  const labeled = parse([
    ...labelPair("still", 0, 0, 2000),
    ...labelPair("step_in_place", 1, 2000, 5000),
    ...restRecords(0, 2000),
    ...steppingRecords(2000, 3000),
    ...restRecords(5000, 2000),
  ]);
  const unlabeled = parse([...restRecords(0, 1000), ...steppingRecords(1000, 3000)]);
  const sets = [
    { name: "base", params: BASE },
    { name: "high", params: { ...BASE, stepHighStanding: 100 } },
  ];
  const cells = compareParamSets(
    [
      { name: "rec-a", recording: labeled },
      { name: "rec-b", recording: unlabeled },
    ],
    sets,
  );

  it("記録 × 組のすべての組み合わせを流し，正解付きかを付ける", () => {
    expect(cells.map((c) => [c.recording, c.paramSet, c.labeled])).toEqual([
      ["rec-a", "base", true],
      ["rec-a", "high", true],
      ["rec-b", "base", false],
      ["rec-b", "high", false],
    ]);
  });

  it("しきい値の組ごとに結果が変わる（T_high を上げすぎると足踏みを数えない）", () => {
    expect(cells[0].evaluation.summary.stepDetectionRate).toBeGreaterThanOrEqual(0.9);
    expect(cells[1].evaluation.summary.stepDetectionRate).toBe(0);
    expect(cells[1].evaluation.summary.pass).toBe(false);
  });

  it("集計の表は正解付きの記録だけで，組を列にする", () => {
    const text = formatSummaryTables(cells);
    expect(text).toContain("== rec-a（正解付き）");
    expect(text).not.toContain("rec-b");
    const header = text.split("\n").find((l) => l.startsWith("指標")) ?? "";
    expect(header).toMatch(/^指標\s+base\s+high$/);
    expect(text).toMatch(/合否\s+OK\s+NG/);
  });

  it("途中で終わった区間があれば，集計の表の見出しにその数を書く", () => {
    const partial = parse([
      ...labelPair("still", 0, 0, 2000),
      {
        type: "label",
        t: 2000,
        plannedT: 2000,
        label: "nod",
        edge: "start",
        segment: 1,
        repeat: 1,
        repeatCount: 1,
      },
      ...restRecords(0, 3000),
    ]);
    const text = formatSummaryTables(
      compareParamSets([{ name: "p", recording: partial }], [DEFAULT_PARAM_SET]),
    );
    expect(text).toContain("途中で終わった区間 1 個は合否に使わない");
  });

  it("区間の表は区間ごとに 1 行（見出しと合わせて区間の数 + 2 行）", () => {
    const text = formatSegmentTable(cells[0]);
    expect(text.split("\n")).toHaveLength(2 + cells[0].evaluation.segments.length);
    expect(text.split("\n")[0]).toBe("-- rec-a × base（時間は ms）");
  });

  it("全体の表はラベルの無い記録だけ．無ければ空文字列", () => {
    const text = formatOverallTable(cells);
    expect(text).toContain("rec-b");
    expect(text).not.toContain("rec-a");
    expect(text.split("\n")[0]).toContain("base:歩き出し");
    expect(formatOverallTable(cells.filter((c) => c.labeled))).toBe("");
  });
});
