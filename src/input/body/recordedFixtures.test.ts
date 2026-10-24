// 記録から切り出した場面（fixtures/*.jsonl）を今の判定と既定のしきい値に流し直し，期待する判定と照らす回帰テスト
// （experiment_山﨑/10「回帰テストへの切り出し」・SPEC_01「記録データでの再現テスト」）．
// 誤判定した場面は，再生と調整のページ（src/input/dev/replay.html）の「表示の範囲を切り出す」で .jsonl にして
// fixtures/ に置き，下の FIXTURES に期待を足す．ファイル名は <端末>_<装着状態>_<動作>.jsonl とし（例:
// iphone15_goggles_look-around-false-walk.jsonl），記録の元のファイル名と場面の説明を期待の note かコメントに残す．
// しきい値を変えた時に過去の誤判定が戻らないことを確かめるのが目的のため，ここだけは既定値（DEFAULT_INPUT_PARAMS）で判定する
import { describe, expect, it } from "vitest";
import { DEFAULT_INPUT_PARAMS } from "../params";
import { computeMetrics } from "../replay/metrics";
import { checkExpectations, rejudgeJsonl, type WindowExpectation } from "../replay/regression";
import { labelSegments, parseRecordsJsonl } from "../replay/replayLog";
// 注意: いまの fixtures/ は合成の波形だけで，実機の記録ではない（実機の記録がまだ無いため．仕組みが動くことを示すサンプル）．
// 実機で誤判定した場面を足したら，合成のものは残しても消してもよい．
// 端末: なし（合成）・装着: なし・動作: 静止 3 秒 → 2 Hz の足踏み 5 秒 → 静止 2 秒 → 0.4 m しゃがむ → しゃがんで静止．
// 時刻は記録の時刻（ms．最初の motion が 1000）
import syntheticStillStepCrouch from "./fixtures/synthetic_none_still-step-crouch.jsonl?raw";

interface RecordedFixture {
  readonly name: string;
  readonly text: string;
  readonly expectations: readonly WindowExpectation[];
}

const FIXTURES: readonly RecordedFixture[] = [
  {
    name: "synthetic_none_still-step-crouch（合成）",
    text: syntheticStillStepCrouch,
    expectations: [
      { note: "静止の間は歩かない", fromT: 1000, toT: 4000, walking: "never", steps: { max: 0 } },
      {
        note: "足踏み 5 秒（2 Hz）で 10 歩前後を数え，1 回だけ歩き始める",
        fromT: 4000,
        toT: 9000,
        steps: { min: 9, max: 11 },
        walkOnsets: { min: 1, max: 1 },
        posture: "standing",
      },
      { note: "足踏みの動き出しは 0.5 秒以内", fromT: 4000, toT: 4500, walking: "some" },
      {
        note: "しゃがんだら 1 回だけ切り替わり，歩かない",
        fromT: 11000,
        toT: 15000,
        postureChanges: { min: 1, max: 1 },
        walking: "never",
      },
      {
        note: "しゃがみは 1 秒以内に確定し，その後は保つ",
        fromT: 12000,
        toT: 15000,
        posture: "crouching",
      },
    ],
  },
];

describe("記録の切り出しの回帰テスト（fixtures/）", () => {
  it.each(FIXTURES)("$name: 期待どおりに判定する", ({ text, expectations }) => {
    const { result, skipped } = rejudgeJsonl(text, DEFAULT_INPUT_PARAMS);
    expect(skipped).toBe(0);
    expect(checkExpectations(result, expectations)).toEqual([]);
  });

  it.each(FIXTURES)(
    "$name: 手順のラベルがあれば，SPEC の指標（誤検出 0・見逃し 0・遅れ 0.5 秒以内）を満たす",
    ({ text }) => {
      const { result } = rejudgeJsonl(text, DEFAULT_INPUT_PARAMS);
      const segments = labelSegments(parseRecordsJsonl(text).records);
      const m = computeMetrics(result, segments);
      expect(m.falseWalks).toBe(0);
      expect(m.falsePostureChanges).toBe(0);
      expect(m.walkMissed).toBe(0);
      expect(m.walkLatencyOver).toBe(0);
    },
  );
});
