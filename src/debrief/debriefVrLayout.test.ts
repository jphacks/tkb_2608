// VR の中の結果画面の配置・行き先の決まり（debriefVrLayout.ts）のテスト．
// 基準は Issue #146（左右 2 画面で読める文字・手のボタンで「同じ訓練をもう一度」はロビー，「ホームへ」はホーム）
import { describe, expect, it } from "vitest";
import {
  advanceDebriefNoHand,
  type BoardBox,
  DEBRIEF_BOARD,
  DEBRIEF_BOARD_LAYOUT,
  DEBRIEF_BUTTON_Y,
  DEBRIEF_BUTTONS,
  DEBRIEF_CANVAS,
  DEBRIEF_HAND_PROMPT,
  DEBRIEF_LARGE_STATS,
  debriefActionForKey,
  debriefActionTarget,
  debriefTextAngleDeg,
  debriefVrCaption,
  followYaw,
  statRowLayouts,
} from "./debriefVrLayout";

/** 手のボタンの判定の範囲（m．scenes/common/handButtonPress.ts の既定値と同じ） */
const PRESS_RADIUS = 0.12;
/** 手のボタンの文字の板の幅（m．scenes/common/handButton.ts と同じ） */
const LABEL_WIDTH = 0.3;
/** 左右 2 画面で読める文字の視角の下限（度） */
const MIN_READABLE_DEG = 1.0;

function inside(inner: BoardBox, outer: BoardBox): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

function overlaps(a: BoardBox, b: BoardBox): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

const CANVAS_BOX: BoardBox = { x: 0, y: 0, ...DEBRIEF_CANVAS };

describe("DEBRIEF_BOARD", () => {
  it("canvas の縦横比は板と同じ", () => {
    expect(DEBRIEF_CANVAS.width / DEBRIEF_CANVAS.height).toBeCloseTo(
      DEBRIEF_BOARD.width / DEBRIEF_BOARD.height,
      5,
    );
  });

  it("板の下の端は手のボタンより上にある（ボタンが板の文字を隠さない）", () => {
    const bottomAngle = Math.atan2(
      DEBRIEF_BOARD.raise - DEBRIEF_BOARD.height / 2,
      DEBRIEF_BOARD.distance,
    );
    // ボタンの外側のリングの上の端（半径 0.06 m の 1.45 倍）
    const buttonTop = Math.atan2(DEBRIEF_BUTTON_Y + 0.06 * 1.45, 0.5);
    expect(bottomAngle).toBeGreaterThan(buttonTop);
  });

  it("板の上の端は目の高さから 30° 以内（左右 2 画面の 1 画面の縦の画角 70° の内側）", () => {
    const topDeg =
      (Math.atan2(DEBRIEF_BOARD.raise + DEBRIEF_BOARD.height / 2, DEBRIEF_BOARD.distance) * 180) /
      Math.PI;
    expect(topDeg).toBeLessThan(30);
  });
});

describe("DEBRIEF_BOARD_LAYOUT", () => {
  const slots = [
    DEBRIEF_BOARD_LAYOUT.title,
    DEBRIEF_BOARD_LAYOUT.reveal,
    DEBRIEF_BOARD_LAYOUT.legend,
    DEBRIEF_BOARD_LAYOUT.caption,
    DEBRIEF_BOARD_LAYOUT.message,
  ];

  it("どの枠も canvas の中に収まる", () => {
    for (const slot of slots) expect(inside(slot.box, CANVAS_BOX)).toBe(true);
    expect(inside(DEBRIEF_BOARD_LAYOUT.map, CANVAS_BOX)).toBe(true);
    expect(inside(DEBRIEF_BOARD_LAYOUT.side, CANVAS_BOX)).toBe(true);
  });

  it("地図と評価の欄・凡例は重ならない", () => {
    const { map, side, legend } = DEBRIEF_BOARD_LAYOUT;
    expect(overlaps(map, side)).toBe(false);
    expect(overlaps(map, legend.box)).toBe(false);
  });

  it("文字の下限は視角 1° 以上（左右 2 画面で読める大きさ）", () => {
    for (const slot of slots) {
      expect(debriefTextAngleDeg(slot.minFontPx)).toBeGreaterThanOrEqual(MIN_READABLE_DEG);
    }
    for (const row of statRowLayouts(4)) {
      for (const slot of [row.label, row.value, row.note]) {
        if (slot !== null) {
          expect(debriefTextAngleDeg(slot.minFontPx)).toBeGreaterThanOrEqual(MIN_READABLE_DEG);
        }
      }
    }
  });
});

describe("statRowLayouts", () => {
  it("結果画面の 4 項目がすべて評価の欄に収まり，先頭の 2 つを大きく出す", () => {
    const rows = statRowLayouts(4);
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r.size)).toEqual(["large", "large", "small", "small"]);
    expect(DEBRIEF_LARGE_STATS).toBe(2);
    for (const row of rows) {
      expect(inside(row.label.box, DEBRIEF_BOARD_LAYOUT.side)).toBe(true);
      expect(inside(row.value.box, DEBRIEF_BOARD_LAYOUT.side)).toBe(true);
      if (row.note !== null) expect(inside(row.note.box, DEBRIEF_BOARD_LAYOUT.side)).toBe(true);
      // 補足（手が見つからない時の案内）と重ならない
      expect(overlaps(row.label.box, DEBRIEF_BOARD_LAYOUT.caption.box)).toBe(false);
      expect(overlaps(row.note?.box ?? row.value.box, DEBRIEF_BOARD_LAYOUT.caption.box)).toBe(
        false,
      );
    }
  });

  it("上の項目ほど上に置き，項目どうしは重ならない", () => {
    const rows = statRowLayouts(4);
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1];
      const row = rows[i];
      if (prev === undefined || row === undefined) throw new Error("rows");
      const prevBottom = Math.max(
        prev.value.box.y + prev.value.box.height,
        (prev.note?.box.y ?? 0) + (prev.note?.box.height ?? 0),
      );
      expect(row.label.box.y).toBeGreaterThanOrEqual(prevBottom);
    }
  });

  it("欄に収まらない数は収まるだけにする", () => {
    const rows = statRowLayouts(50);
    expect(rows.length).toBeGreaterThanOrEqual(4);
    expect(rows.length).toBeLessThan(50);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])("%s 個は空", (count) => {
    expect(statRowLayouts(count)).toEqual([]);
  });
});

describe("debriefTextAngleDeg", () => {
  it("大きい文字ほど角度が大きい", () => {
    expect(debriefTextAngleDeg(40)).toBeGreaterThan(debriefTextAngleDeg(30));
  });

  it.each([0, -10, Number.NaN])("%s px は 0°", (px) => {
    expect(debriefTextAngleDeg(px)).toBe(0);
  });
});

describe("DEBRIEF_BUTTONS", () => {
  it("左に「同じ訓練をもう一度」，右に「ホームへ」", () => {
    expect(DEBRIEF_BUTTONS.map((b) => b.action)).toEqual(["retry", "home"]);
    const [retry, home] = DEBRIEF_BUTTONS;
    if (retry === undefined || home === undefined) throw new Error("buttons");
    expect(retry.position.x).toBeLessThan(home.position.x);
  });

  it("2 つのボタンの判定の範囲と文字の板が重ならない", () => {
    const [retry, home] = DEBRIEF_BUTTONS;
    if (retry === undefined || home === undefined) throw new Error("buttons");
    const gap = home.position.x - retry.position.x;
    expect(gap).toBeGreaterThan(PRESS_RADIUS * 2);
    expect(gap).toBeGreaterThan(LABEL_WIDTH);
  });

  it("ボタンは正面 0.5 m（ロビーの開始ボタンと同じ距離）・背面カメラの画角の内側（左右 25° 以内）", () => {
    for (const b of DEBRIEF_BUTTONS) {
      expect(b.position.z).toBe(-0.5);
      expect(Math.abs((Math.atan2(b.position.x, 0.5) * 180) / Math.PI)).toBeLessThan(25);
    }
  });
});

describe("debriefActionTarget", () => {
  it("「同じ訓練をもう一度」はロビー，「ホームへ」はホーム", () => {
    expect(debriefActionTarget("retry")).toBe("lobby");
    expect(debriefActionTarget("home")).toBe("home");
  });
});

describe("debriefActionForKey", () => {
  it.each([
    ["Enter", "retry"],
    [" ", "retry"],
    ["Escape", "home"],
    ["a", null],
    ["", null],
  ])("%j は %s", (key, expected) => {
    expect(debriefActionForKey(key)).toBe(expected);
  });
});

describe("debriefVrCaption", () => {
  it("手が使える時はボタンにかざすよう案内し，実機ではタップでも選べると添える", () => {
    const text = debriefVrCaption(true, false, true);
    expect(text).toContain("ボタン");
    expect(text).toContain("タップ");
    expect(debriefVrCaption(true, false, false)).not.toContain("タップ");
  });

  it("手が見つからない時は手を出すよう案内する", () => {
    expect(debriefVrCaption(true, true, true)).toBe(DEBRIEF_HAND_PROMPT);
  });

  it("手が使えない時はボタンに触れず，タップ（実機）かキー（PC）を案内する", () => {
    expect(debriefVrCaption(false, false, true)).toContain("タップ");
    expect(debriefVrCaption(false, false, true)).not.toContain("ボタン");
    expect(debriefVrCaption(false, false, false)).toContain("Enter");
  });
});

describe("advanceDebriefNoHand", () => {
  it("手が見つからない間は秒数を足し，見つかったら 0 に戻す", () => {
    expect(advanceDebriefNoHand(1, 0.5, false)).toBe(1.5);
    expect(advanceDebriefNoHand(5, 0.5, true)).toBe(0);
  });

  it.each([0, -1, Number.NaN])("dt が %s の時は変えない", (dt) => {
    expect(advanceDebriefNoHand(2, dt, false)).toBe(2);
  });
});

describe("followYaw", () => {
  it("目標の向きへ dt × 速さの割合だけ近づく", () => {
    expect(followYaw(0, 1, 0.5, 1)).toBeCloseTo(0.5);
  });

  it("割合は 1 を超えない（行き過ぎない）", () => {
    expect(followYaw(0, 1, 10, 1)).toBeCloseTo(1);
  });

  it("±π をまたぐ時は近い側から回る", () => {
    const next = followYaw(Math.PI - 0.1, -Math.PI + 0.1, 0.5, 1);
    expect(next).toBeGreaterThan(Math.PI - 0.1);
  });

  it("dt・目標が有限でない時は今の向きのまま", () => {
    expect(followYaw(0.3, 1, Number.NaN)).toBe(0.3);
    expect(followYaw(0.3, Number.NaN, 0.1)).toBe(0.3);
    expect(followYaw(0.3, 1, 0)).toBe(0.3);
  });

  it("今の向きが有限でない時は目標の向きにする", () => {
    expect(followYaw(Number.NaN, 0.7, 0.1)).toBe(0.7);
  });
});
