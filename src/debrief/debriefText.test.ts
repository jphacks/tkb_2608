// 結果画面の文と数の整形（debriefText.ts）のテスト．
// 基準は docs/03_PLAN/PLAN_04 F7・F8，docs/04_SPEC/SPEC_01「結果の評価」（見せ方），src/core/drill.ts の型の約束，
// Issue #91 の決定（評価は DrillEvaluation の値をそのまま見せ，計算し直さない．「できた」は smokePostureGood が true の時だけ）
import { describe, expect, it } from "vitest";
import type { DrillEvaluation, DrillInterval, DrillMoment } from "../core/drill";
import {
  debriefTitle,
  describeDrill,
  describeEvacuation,
  describeNearFire,
  describeOffRoute,
  describeRouteReveal,
  describeSmokePosture,
  formatPercent,
  formatSeconds,
} from "./debriefText";

const evaluation = (overrides: Partial<DrillEvaluation> = {}): DrillEvaluation => ({
  offRoute: [],
  nearFire: [],
  smokeSeconds: 0,
  smokeCrouchRatio: null,
  smokePostureGood: null,
  smokeStanding: [],
  evacuationSeconds: 28,
  timeLimitSeconds: 150,
  lateEscape: false,
  ...overrides,
});

const interval = (fromIndex: number, toIndex: number): DrillInterval => ({
  fromIndex,
  toIndex,
  fromSeconds: fromIndex * 0.2,
  toSeconds: toIndex * 0.2,
});

const moment = (index: number): DrillMoment => ({ index, t: index * 0.2, floor: 0, x: 1, z: 1 });

describe("formatSeconds", () => {
  it.each([
    [28, "28 秒"],
    [27.6, "28 秒"],
    [27.4, "27 秒"],
    [27.5, "28 秒"],
    [0, "0 秒"],
    [150, "150 秒"],
  ])("%s 秒は「%s」（整数に四捨五入）", (seconds, text) => {
    expect(formatSeconds(seconds)).toBe(text);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "有限でない時は「―」（%s）",
    (seconds) => {
      expect(formatSeconds(seconds)).toBe("―");
    },
  );
});

describe("formatPercent", () => {
  it.each([
    [0, "0%"],
    [0.184, "18%"],
    [0.995, "100%"],
    [4 / 9, "44%"],
    [1, "100%"],
    [1.2, "120%"],
  ])("%s は「%s」（整数の % に四捨五入）", (ratio, text) => {
    expect(formatPercent(ratio)).toBe(text);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY])("有限でない時は「―」（%s）", (ratio) => {
    expect(formatPercent(ratio)).toBe("―");
  });
});

describe("describeEvacuation", () => {
  it("着いた時は秒数と，制限時間の何割で着いたか", () => {
    const stat = describeEvacuation(evaluation({ evacuationSeconds: 27.6 }));
    expect(stat.label).toBe("避難時間");
    expect(stat.value).toBe("28 秒");
    expect(stat.note).toBe("制限時間 150 秒の 18%で集合場所に着きました");
    expect(stat.tone).toBe("good");
  });

  it("割合は評価の秒数（丸める前）と制限時間から出す", () => {
    // 1.4 / 10 = 14%（丸めた 1 秒で割ると 10% になる）
    const stat = describeEvacuation(evaluation({ evacuationSeconds: 1.4, timeLimitSeconds: 10 }));
    expect(stat.value).toBe("1 秒");
    expect(stat.note).toBe("制限時間 10 秒の 14%で集合場所に着きました");
  });

  it("ちょうど制限時間に着いた時は 100%", () => {
    const stat = describeEvacuation(evaluation({ evacuationSeconds: 150 }));
    expect(stat.value).toBe("150 秒");
    expect(stat.note).toBe("制限時間 150 秒の 100%で集合場所に着きました");
    expect(stat.tone).toBe("good");
  });

  it("逃げ遅れ（lateEscape・秒数が null）は「逃げ遅れ」", () => {
    const stat = describeEvacuation(evaluation({ evacuationSeconds: null, lateEscape: true }));
    expect(stat.value).toBe("逃げ遅れ");
    expect(stat.note).toBe("制限時間 150 秒のうちに集合場所に着けませんでした");
    expect(stat.tone).toBe("warn");
  });

  it("lateEscape と秒数の両方がある時は逃げ遅れを優先する", () => {
    const stat = describeEvacuation(evaluation({ evacuationSeconds: 28, lateEscape: true }));
    expect(stat.value).toBe("逃げ遅れ");
    expect(stat.tone).toBe("warn");
  });

  it.each([null, Number.NaN, Number.POSITIVE_INFINITY])(
    "lateEscape が false でも秒数が %s なら逃げ遅れとして出す",
    (seconds) => {
      const stat = describeEvacuation(
        evaluation({ evacuationSeconds: seconds, lateEscape: false }),
      );
      expect(stat.value).toBe("逃げ遅れ");
      expect(stat.tone).toBe("warn");
    },
  );

  it.each([0, Number.NaN, -10, Number.POSITIVE_INFINITY])(
    "制限時間が正の有限の数でない（%s）時は割合を出さない",
    (limit) => {
      const arrived = describeEvacuation(evaluation({ timeLimitSeconds: limit }));
      expect(arrived.value).toBe("28 秒");
      expect(arrived.note).toBe("集合場所に着きました");
      expect(arrived.note).not.toMatch(/%|NaN|Infinity/);
      const late = describeEvacuation(
        evaluation({ timeLimitSeconds: limit, evacuationSeconds: null, lateEscape: true }),
      );
      expect(late.note).toBe("集合場所に着けませんでした");
    },
  );
});

describe("describeSmokePosture", () => {
  it("smokePostureGood が true なら「できた」と，煙の中にいた時間としゃがんでいた割合", () => {
    const stat = describeSmokePosture(
      evaluation({ smokeSeconds: 9, smokeCrouchRatio: 0.8, smokePostureGood: true }),
    );
    expect(stat.label).toBe("煙の中の姿勢");
    expect(stat.value).toBe("できた");
    expect(stat.note).toBe("煙の中にいた 9 秒のうち，80%の間しゃがんでいました");
    expect(stat.tone).toBe("good");
  });

  it("smokePostureGood が false なら「もう少し」", () => {
    const stat = describeSmokePosture(
      evaluation({ smokeSeconds: 9, smokeCrouchRatio: 4 / 9, smokePostureGood: false }),
    );
    expect(stat.value).toBe("もう少し");
    expect(stat.note).toBe("煙の中にいた 9 秒のうち，44%の間しゃがんでいました");
    expect(stat.tone).toBe("warn");
  });

  it("「できた」かは割合から計算し直さず smokePostureGood に従う", () => {
    // 割合が低くても評価が true なら「できた」，高くても false なら「もう少し」
    expect(
      describeSmokePosture(
        evaluation({ smokeSeconds: 5, smokeCrouchRatio: 0.1, smokePostureGood: true }),
      ).value,
    ).toBe("できた");
    expect(
      describeSmokePosture(
        evaluation({ smokeSeconds: 5, smokeCrouchRatio: 1, smokePostureGood: false }),
      ).value,
    ).toBe("もう少し");
  });

  it("smokePostureGood が null で割合がある時は「もう少し」", () => {
    const stat = describeSmokePosture(
      evaluation({ smokeSeconds: 5, smokeCrouchRatio: 0.9, smokePostureGood: null }),
    );
    expect(stat.value).toBe("もう少し");
    expect(stat.note).toBe("煙の中にいた 5 秒のうち，90%の間しゃがんでいました");
  });

  it.each([null, Number.NaN])(
    "割合が %s（煙の中にいなかった）なら「―」と「煙の中にいませんでした」",
    (ratio) => {
      const stat = describeSmokePosture(
        evaluation({ smokeSeconds: 0, smokeCrouchRatio: ratio, smokePostureGood: null }),
      );
      expect(stat.value).toBe("―");
      expect(stat.note).toBe("煙の中にいませんでした");
      expect(stat.tone).toBe("neutral");
    },
  );

  it.each([
    [1.5, "100%"],
    [-0.2, "0%"],
  ])("範囲外の割合 %s は 0〜1 に切り詰めて「%s」", (ratio, text) => {
    const stat = describeSmokePosture(
      evaluation({ smokeSeconds: 4, smokeCrouchRatio: ratio, smokePostureGood: false }),
    );
    expect(stat.note).toBe(`煙の中にいた 4 秒のうち，${text}の間しゃがんでいました`);
  });

  it("煙の中にいた時間が有限でない時は秒数を出さない", () => {
    const stat = describeSmokePosture(
      evaluation({ smokeSeconds: Number.NaN, smokeCrouchRatio: 0.5, smokePostureGood: false }),
    );
    expect(stat.note).toBe("煙の中で50%の間しゃがんでいました");
    expect(stat.note).not.toMatch(/NaN|―/);
  });
});

describe("describeOffRoute", () => {
  it("外れた区間が無ければ「0 か所」と外れずに進めたこと", () => {
    const stat = describeOffRoute(evaluation());
    expect(stat.value).toBe("0 か所");
    expect(stat.note).toBe("正解経路から外れずに進めました");
    expect(stat.tone).toBe("good");
  });

  it("外れた区間の数を「N か所」で出し，地図の橙色の線を指す", () => {
    const stat = describeOffRoute(evaluation({ offRoute: [interval(1, 3), interval(8, 9)] }));
    expect(stat.value).toBe("2 か所");
    expect(stat.note).toContain("橙");
    expect(stat.tone).toBe("warn");
  });
});

describe("describeNearFire", () => {
  it("火に近づいた点が無ければ「0 回」と近づかなかったこと", () => {
    const stat = describeNearFire(evaluation());
    expect(stat.value).toBe("0 回");
    expect(stat.note).toBe("火に近づきませんでした");
    expect(stat.tone).toBe("good");
  });

  it("火に近づいた点の数を「N 回」で出し，地図の赤い点を指す", () => {
    const stat = describeNearFire(evaluation({ nearFire: [moment(3), moment(10), moment(20)] }));
    expect(stat.value).toBe("3 回");
    expect(stat.note).toContain("赤");
    expect(stat.tone).toBe("warn");
  });
});

describe("describeDrill", () => {
  it("避難時間・煙の中の姿勢・外れた所・火に近づいた回数の順に並べる（F8 の 3 項目を含む）", () => {
    const ev = evaluation({ smokeSeconds: 9, smokeCrouchRatio: 0.5, smokePostureGood: false });
    const stats = describeDrill(ev);
    expect(stats.map((s) => s.label)).toEqual([
      "避難時間",
      "煙の中の姿勢",
      "正解経路から外れた所",
      "火に近づいた回数",
    ]);
    expect(stats).toEqual([
      describeEvacuation(ev),
      describeSmokePosture(ev),
      describeOffRoute(ev),
      describeNearFire(ev),
    ]);
  });
});

describe("describeRouteReveal", () => {
  it("テストモード（F7）では，避難中に正解経路を出していなかったことと緑の線が正解経路であることを伝える", () => {
    const text = describeRouteReveal("test");
    expect(text).toContain("避難中に正解経路を出していませんでした");
    expect(text).toContain("緑の線が正解経路です");
  });

  it("学習モードでは，緑の線が避難中に床に出ていた正解経路であることを伝える", () => {
    const text = describeRouteReveal("learn");
    expect(text).toContain("緑の線は，避難中に床に出ていた正解経路です");
    expect(text).not.toContain("出していませんでした");
  });

  it("どちらのモードも自分の経路（青）と比べるよう促す", () => {
    expect(describeRouteReveal("test")).toContain("自分の経路（青）");
    expect(describeRouteReveal("learn")).toContain("自分の経路（青）");
  });
});

describe("debriefTitle", () => {
  it("「<校舎名>　避難の結果」", () => {
    expect(debriefTitle("デモ小学校 北校舎")).toBe("デモ小学校 北校舎　避難の結果");
  });

  it("前後の空白は除く", () => {
    expect(debriefTitle("  北校舎 ")).toBe("北校舎　避難の結果");
  });

  it.each(["", "   "])("校舎名が空（%j）なら「避難の結果」だけ", (name) => {
    expect(debriefTitle(name)).toBe("避難の結果");
  });
});
