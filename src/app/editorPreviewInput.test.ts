// エディタの view モード（3D の確認）のキー操作の純粋な関数（previewMove・advanceKeyTurn・walkLook）のテスト．
// 基準は Issue #169（view では PC のマウス・キーボードで 3D の中を見回し・動いて確かめる）と
// docs/04_SPEC/SPEC_01「依存の向き」（キーの購読は app/ の殻が行い，判定は純粋な関数に出す）．
// 決まり: W/↑ で前・S/↓ で後ろ・A/← で左・D/→ で右（同時押しは打ち消す），向きを変える速さは 0.6π rad/s，
// 角度は (-π, π]（yaw と同じく左が正），後ろへ下がる時の歩行用の yaw は半回転，pitch は 0
import { describe, expect, it } from "vitest";
import {
  advanceKeyTurn,
  BACKWARD_KEYS,
  CROUCH_KEY,
  FORWARD_KEYS,
  KEY_TURN_SPEED,
  PREVIEW_KEYS,
  previewMove,
  TURN_LEFT_KEYS,
  TURN_RIGHT_KEYS,
  walkLook,
} from "./editorPreviewInput";

const keys = (...codes: string[]): ReadonlySet<string> => new Set(codes);

const inRange = (angle: number): void => {
  expect(angle).toBeGreaterThan(-Math.PI);
  expect(angle).toBeLessThanOrEqual(Math.PI);
};

describe("キーの割り当て", () => {
  it("前は W と ↑，後ろは S と ↓，左は A と ←，右は D と →", () => {
    expect([...FORWARD_KEYS].sort()).toEqual(["ArrowUp", "KeyW"]);
    expect([...BACKWARD_KEYS].sort()).toEqual(["ArrowDown", "KeyS"]);
    expect([...TURN_LEFT_KEYS].sort()).toEqual(["ArrowLeft", "KeyA"]);
    expect([...TURN_RIGHT_KEYS].sort()).toEqual(["ArrowRight", "KeyD"]);
    expect(CROUCH_KEY).toBe("KeyC");
  });

  it("view で扱うキーは移動・回転・しゃがみのキーだけ（Ctrl+Z 等の Z・Y・Space・Escape は含まない）", () => {
    for (const code of [
      ...FORWARD_KEYS,
      ...BACKWARD_KEYS,
      ...TURN_LEFT_KEYS,
      ...TURN_RIGHT_KEYS,
      CROUCH_KEY,
    ]) {
      expect(PREVIEW_KEYS.has(code)).toBe(true);
    }
    expect(PREVIEW_KEYS.size).toBe(9);
    for (const code of ["KeyZ", "KeyY", "Space", "Escape", "Enter", "Tab"]) {
      expect(PREVIEW_KEYS.has(code)).toBe(false);
    }
  });
});

describe("previewMove", () => {
  it("何も押していなければ止まっている", () => {
    expect(previewMove(keys())).toEqual({ forward: 0, turn: 0 });
  });

  it.each([
    ["KeyW", 1, 0],
    ["ArrowUp", 1, 0],
    ["KeyS", -1, 0],
    ["ArrowDown", -1, 0],
    ["KeyA", 0, 1],
    ["ArrowLeft", 0, 1],
    ["KeyD", 0, -1],
    ["ArrowRight", 0, -1],
  ] as const)("%s だけなら forward=%d・turn=%d", (code, forward, turn) => {
    expect(previewMove(keys(code))).toEqual({ forward, turn });
  });

  it.each([
    [["KeyW", "KeyS"]],
    [["ArrowUp", "ArrowDown"]],
    [["KeyW", "ArrowDown"]],
    [["ArrowUp", "KeyS"]],
    [["KeyW", "ArrowUp", "KeyS", "ArrowDown"]],
  ])("前と後ろを同時に押すと打ち消して進まない（%j）", (codes) => {
    expect(previewMove(keys(...codes)).forward).toBe(0);
  });

  it.each([[["KeyA", "KeyD"]], [["ArrowLeft", "ArrowRight"]], [["KeyA", "ArrowRight"]]])(
    "左と右を同時に押すと打ち消して回らない（%j）",
    (codes) => {
      expect(previewMove(keys(...codes)).turn).toBe(0);
    },
  );

  it("同じ向きのキーを 2 つ押しても 1 のまま（速くならない）", () => {
    expect(previewMove(keys("KeyW", "ArrowUp"))).toEqual({ forward: 1, turn: 0 });
    expect(previewMove(keys("KeyA", "ArrowLeft"))).toEqual({ forward: 0, turn: 1 });
  });

  it("進むと回るは別々に決まる（W と D で前へ進みながら右へ回る）", () => {
    expect(previewMove(keys("KeyW", "KeyD"))).toEqual({ forward: 1, turn: -1 });
    expect(previewMove(keys("ArrowDown", "ArrowLeft"))).toEqual({ forward: -1, turn: 1 });
  });

  it("しゃがみのキーや関係の無いキーは動きに影響しない", () => {
    expect(previewMove(keys("KeyC", "KeyZ", "Space", "ShiftLeft"))).toEqual({
      forward: 0,
      turn: 0,
    });
  });

  it("KeyboardEvent.code の名前どおりに扱い，key の値（小文字の w 等）は受け付けない", () => {
    expect(previewMove(keys("w", "a", "keyw", "arrowup"))).toEqual({ forward: 0, turn: 0 });
  });
});

describe("advanceKeyTurn", () => {
  it("向きを変える速さは 0.6π rad/s", () => {
    expect(KEY_TURN_SPEED).toBeCloseTo(Math.PI * 0.6);
  });

  it("左（turn=1）は増え，右（turn=-1）は減る", () => {
    expect(advanceKeyTurn(0, 1, 0.5)).toBeCloseTo(Math.PI * 0.3);
    expect(advanceKeyTurn(0, -1, 0.5)).toBeCloseTo(-Math.PI * 0.3);
  });

  it("dt に比例して進む（1 フレーム分を 2 回でも 2 フレーム分を 1 回でも同じ）", () => {
    const once = advanceKeyTurn(0.2, 1, 1 / 30);
    const twice = advanceKeyTurn(advanceKeyTurn(0.2, 1, 1 / 60), 1, 1 / 60);
    expect(twice).toBeCloseTo(once);
  });

  it("turn が 0 なら変えない", () => {
    expect(advanceKeyTurn(1.25, 0, 0.5)).toBe(1.25);
  });

  it.each([0, -0.016, -1, Number.NaN, Number.NEGATIVE_INFINITY])(
    "dt が 0 以下・NaN（%s）なら変えない",
    (dt) => {
      expect(advanceKeyTurn(1.25, 1, dt)).toBe(1.25);
      expect(advanceKeyTurn(-0.5, -1, dt)).toBe(-0.5);
    },
  );

  it("π を超えたら -π 側へ巻き戻す（(-π, π] に収める）", () => {
    // 0.9π から左へ 0.6π 進むと 1.5π → -0.5π
    const next = advanceKeyTurn(Math.PI * 0.9, 1, 1);
    expect(next).toBeCloseTo(-Math.PI * 0.5);
    inRange(next);
  });

  it("-π を下回ったら π 側へ巻き戻す", () => {
    const next = advanceKeyTurn(-Math.PI * 0.9, -1, 1);
    expect(next).toBeCloseTo(Math.PI * 0.5);
    inRange(next);
  });

  it("ちょうど -π になる時は π にする", () => {
    // -0.4π から右へ 0.6π 進むと -π
    expect(advanceKeyTurn(-Math.PI * 0.4, -1, 1)).toBeCloseTo(Math.PI);
  });

  it("長く回し続けても角度は (-π, π] に収まる", () => {
    let angle = 0;
    for (let i = 0; i < 1000; i++) {
      angle = advanceKeyTurn(angle, 1, 0.1);
      inRange(angle);
    }
    for (let i = 0; i < 1000; i++) {
      angle = advanceKeyTurn(angle, -1, 0.37);
      inRange(angle);
    }
  });

  it("大きな dt（タブを戻した直後など）でも (-π, π] に収まる", () => {
    inRange(advanceKeyTurn(0, 1, 100));
    inRange(advanceKeyTurn(0, -1, 12345.6));
  });

  it("dt が Infinity でも角度が NaN にならない（(-π, π] に収まる）", () => {
    const next = advanceKeyTurn(0.5, 1, Number.POSITIVE_INFINITY);
    expect(Number.isNaN(next)).toBe(false);
    inRange(next);
  });
});

describe("walkLook", () => {
  it("前へ進む・止まっている時は yaw をそのまま渡す", () => {
    expect(walkLook({ yaw: 0.7, pitch: 0.3 }, 1).yaw).toBeCloseTo(0.7);
    expect(walkLook({ yaw: -2, pitch: 0.3 }, 0).yaw).toBeCloseTo(-2);
  });

  it("後ろへ下がる時は yaw を半回転させる", () => {
    expect(walkLook({ yaw: 0, pitch: 0 }, -1).yaw).toBeCloseTo(Math.PI);
    expect(walkLook({ yaw: 0.5, pitch: 0 }, -1).yaw).toBeCloseTo(0.5 - Math.PI);
    expect(walkLook({ yaw: -0.5, pitch: 0 }, -1).yaw).toBeCloseTo(Math.PI - 0.5);
  });

  it("半回転した yaw も (-π, π] に収める", () => {
    for (let yaw = -Math.PI + 0.01; yaw <= Math.PI; yaw += 0.13) {
      inRange(walkLook({ yaw, pitch: 0 }, -1).yaw);
    }
    // π の半回転は 0
    expect(walkLook({ yaw: Math.PI, pitch: 0 }, -1).yaw).toBeCloseTo(0);
  });

  it.each([-1, 0, 1] as const)("pitch は常に 0（forward=%d）", (forward) => {
    expect(walkLook({ yaw: 0.2, pitch: 1.2 }, forward).pitch).toBe(0);
    expect(walkLook({ yaw: 0.2, pitch: -1.2 }, forward).pitch).toBe(0);
  });

  it("渡した向きを書き換えない", () => {
    const look = { yaw: 0.4, pitch: 0.9 };
    walkLook(look, -1);
    expect(look).toEqual({ yaw: 0.4, pitch: 0.9 });
  });
});
