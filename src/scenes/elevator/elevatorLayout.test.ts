// エレベーターのかごの配置（three 非依存の定数と純粋な関数）．要件（シナリオ PLAN_04 の E1・E2）を基準に確かめる

import { describe, expect, it } from "vitest";
import { computeFootprint, type Footprint, type Vec3Tuple } from "../common/furniture";
import { wallPointToWorld } from "../common/wallLayout";
import {
  BUTTON_LABEL_KEYS,
  CABIN,
  CABIN_DOOR,
  CABIN_DOOR_ID,
  CABIN_DOOR_LEAVES,
  CABIN_DOOR_OPENING,
  CABIN_WALLS,
  CEILING_LIGHT,
  CONTROL_PANELS,
  type ControlPanelDef,
  directionSign,
  ELEVATOR_BUTTONS,
  ELEVATOR_FLOORS,
  ELEVATOR_HANDRAILS,
  ELEVATOR_START,
  EMERGENCY_LIGHT,
  EYE_HEIGHT,
  FLOOR_INDICATOR,
  FLOOR_INDICATOR_ID,
  FLOOR_NUMBERS,
  floorButtonKey,
  formatFloorLabel,
  HALL_CENTER,
  HALL_DOOR_OPENING,
  HALL_WALL_Z,
  HALL_WALLS,
  HANDRAIL,
  HORIZONTAL_PANEL_LAYOUT,
  localToCabin,
  MAIN_PANEL_Z,
  PANEL,
  panelButtonId,
  panelCenterY,
  SUB_PANEL_X,
  VERTICAL_PANEL_LAYOUT,
} from "./elevatorLayout";
import { buttonLabelURange } from "./elevatorTextures";

const HALF_W = 1.0;
const HALF_D = 0.9;
const EPS = 1e-9;

type Range = readonly [number, number];

function overlaps(a: Range, b: Range): boolean {
  return Math.min(a[1], b[1]) - Math.max(a[0], b[0]) > EPS;
}

function panel(role: "main" | "sub"): ControlPanelDef {
  const p = CONTROL_PANELS.find((c) => c.role === role);
  if (!p) throw new Error(role);
  return p;
}

/** 操作盤の板の壁に沿う範囲（主は z，副は x）と高さの範囲（かごの座標） */
function panelSpan(p: ControlPanelDef): { along: Range; y: Range } {
  const center = p.wall === CABIN_WALLS.right ? p.position[2] : p.position[0];
  return {
    along: [center - p.layout.width / 2, center + p.layout.width / 2],
    y: [p.layout.bottom, p.layout.top],
  };
}

/** 操作盤の床占有範囲（AABB．壁から板の厚み＋ボタンまで） */
function panelFootprint(p: ControlPanelDef): Footprint {
  return computeFootprint({ x: p.position[0], z: p.position[2] }, p.rotationY, {
    x: p.layout.width,
    z: (PANEL.depth + PANEL.buttonDepth) * 2,
  });
}

function distanceToFootprint(x: number, z: number, f: Footprint): number {
  const dx = Math.max(0, Math.abs(x - f.centerX) - f.halfX);
  const dz = Math.max(0, Math.abs(z - f.centerZ) - f.halfZ);
  return Math.hypot(dx, dz);
}

function dist2(a: readonly [number, number], b: readonly [number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

describe("かごの寸法", () => {
  it("幅 2.0m（X）× 奥行 1.8m（Z）× 天井 2.3m", () => {
    expect(CABIN.width).toBeCloseTo(2.0);
    expect(CABIN.depth).toBeCloseTo(1.8);
    expect(CABIN.height).toBeCloseTo(2.3);
  });

  it("目の高さは 1.6m", () => {
    expect(EYE_HEIGHT.standing).toBeCloseTo(1.6);
  });

  it("壁 4 面は床の中心を原点にかごを囲み，法線は内側を向く", () => {
    for (const wall of Object.values(CABIN_WALLS)) {
      const mid = wallPointToWorld(wall, wall.length / 2, 0);
      // 壁の中点から法線方向へ進むと原点に近づく
      const inward = [mid[0] + wall.normal[0] * 0.1, mid[2] + wall.normal[2] * 0.1] as const;
      expect(dist2(inward, [0, 0])).toBeLessThan(dist2([mid[0], mid[2]], [0, 0]));
    }
    expect(wallPointToWorld(CABIN_WALLS.front, 0, 0)[2]).toBeCloseTo(-HALF_D);
    expect(wallPointToWorld(CABIN_WALLS.rear, 0, 0)[2]).toBeCloseTo(HALF_D);
    expect(wallPointToWorld(CABIN_WALLS.right, 0, 0)[0]).toBeCloseTo(HALF_W);
    expect(wallPointToWorld(CABIN_WALLS.left, 0, 0)[0]).toBeCloseTo(-HALF_W);
    expect(CABIN_WALLS.front.length).toBeCloseTo(CABIN.width);
    expect(CABIN_WALLS.right.length).toBeCloseTo(CABIN.depth);
  });
});

describe("扉（正面・中央開き）", () => {
  it("開口部は正面の壁の中央で 1.0m × 2.1m", () => {
    const { u0, u1, v0, v1 } = CABIN_DOOR_OPENING;
    expect(u1 - u0).toBeCloseTo(1.0);
    expect(v0).toBeCloseTo(0);
    expect(v1 - v0).toBeCloseTo(2.1);
    const center = wallPointToWorld(CABIN_WALLS.front, (u0 + u1) / 2, 0);
    expect(center[0]).toBeCloseTo(0);
    expect(center[2]).toBeCloseTo(-HALF_D);
  });

  it("扉は 2 枚で中央で合わさり，閉じると開口部をすき間なくふさぐ", () => {
    expect(CABIN_DOOR_LEAVES).toHaveLength(2);
    const spans = CABIN_DOOR_LEAVES.map(
      (l) => [l.closedX - l.width / 2, l.closedX + l.width / 2] as const,
    ).sort((a, b) => a[0] - b[0]);
    expect(spans[0][0]).toBeCloseTo(-0.5);
    expect(spans[0][1]).toBeCloseTo(0);
    expect(spans[1][0]).toBeCloseTo(0);
    expect(spans[1][1]).toBeCloseTo(0.5);
  });

  it("全開で開口部が全幅あく（左右逆向きに開く）", () => {
    expect(new Set(CABIN_DOOR_LEAVES.map((l) => l.slideDirection))).toEqual(new Set([-1, 1]));
    for (const l of CABIN_DOOR_LEAVES) {
      const x = l.closedX + l.slideDirection * l.slideDistance;
      expect(overlaps([x - l.width / 2, x + l.width / 2], [-0.5, 0.5])).toBe(false);
    }
  });

  it("id がある", () => {
    expect(CABIN_DOOR_ID.length).toBeGreaterThan(0);
  });
});

describe("階・ボタンの id の関数", () => {
  it("階は 1〜5", () => {
    expect(ELEVATOR_FLOORS).toEqual({ lowest: 1, highest: 5 });
    expect([...FLOOR_NUMBERS]).toEqual([1, 2, 3, 4, 5]);
  });

  it("floorButtonKey・panelButtonId", () => {
    expect(floorButtonKey(3)).toBe("floor-3");
    expect(panelButtonId("panel-main", "floor-1")).toBe("panel-main-floor-1");
    expect(panelButtonId("panel-sub", "emergency-call")).toBe("panel-sub-emergency-call");
  });

  it("panelCenterY は下端と上端の中央", () => {
    expect(panelCenterY({ bottom: 0.9, top: 1.3 })).toBeCloseTo(1.1);
  });

  it.each([
    [1, "1"],
    [5, "5"],
    [12, "12"],
    [0, "B1"],
    [-1, "B2"],
  ])("formatFloorLabel(%d) は %s", (floor, label) => {
    expect(formatFloorLabel(floor)).toBe(label);
  });

  it("directionSign: up 1・down -1・none 0", () => {
    expect(directionSign("up")).toBe(1);
    expect(directionSign("down")).toBe(-1);
    expect(directionSign("none")).toBe(0);
  });
});

describe("localToCabin", () => {
  it("回転 0 なら平行移動だけ", () => {
    const r = localToCabin({ position: [1, 2, 3], rotationY: 0 }, [0.1, 0.2, 0.3]);
    expect(r[0]).toBeCloseTo(1.1);
    expect(r[1]).toBeCloseTo(2.2);
    expect(r[2]).toBeCloseTo(3.3);
  });

  it("右の壁（rotationY -π/2）ではローカル +Z（内側）が -X，ローカル +X が +Z", () => {
    const o = { position: [HALF_W, 1, 0] as Vec3Tuple, rotationY: CABIN_WALLS.right.rotationY };
    const inward = localToCabin(o, [0, 0, 0.1]);
    expect(inward[0]).toBeCloseTo(HALF_W - 0.1);
    expect(inward[2]).toBeCloseTo(0);
    const along = localToCabin(o, [0.1, 0, 0]);
    expect(along[0]).toBeCloseTo(HALF_W);
    expect(along[2]).toBeCloseTo(0.1);
  });

  it("奥の壁（rotationY π）ではローカル +Z が -Z", () => {
    const r = localToCabin({ position: [0, 0, HALF_D], rotationY: Math.PI }, [0, 0, 0.2]);
    expect(r[0]).toBeCloseTo(0);
    expect(r[2]).toBeCloseTo(HALF_D - 0.2);
  });
});

describe("操作盤", () => {
  it("主（右の壁・横型）と副（正面の壁・縦型）の 2 か所で，id は一意", () => {
    expect(CONTROL_PANELS).toHaveLength(2);
    expect(new Set(CONTROL_PANELS.map((p) => p.id)).size).toBe(2);
    const main = panel("main");
    const sub = panel("sub");
    expect(main.wall).toBe(CABIN_WALLS.right);
    expect(main.layout).toBe(HORIZONTAL_PANEL_LAYOUT);
    expect(main.position[0]).toBeCloseTo(HALF_W);
    expect(main.position[2]).toBeCloseTo(MAIN_PANEL_Z);
    expect(main.rotationY).toBeCloseTo(CABIN_WALLS.right.rotationY);
    expect(sub.wall).toBe(CABIN_WALLS.front);
    expect(sub.layout).toBe(VERTICAL_PANEL_LAYOUT);
    expect(sub.position[2]).toBeCloseTo(-HALF_D);
    expect(sub.position[0]).toBeCloseTo(SUB_PANEL_X);
    expect(sub.rotationY).toBeCloseTo(CABIN_WALLS.front.rotationY);
  });

  it("主は右の壁の扉寄り（かごの前半分），壁の範囲に収まる", () => {
    const { along } = panelSpan(panel("main"));
    expect(along[0]).toBeGreaterThanOrEqual(-HALF_D);
    expect(along[1]).toBeLessThanOrEqual(0);
  });

  it("副は正面の壁の扉の左（-X）で，三方枠と重ならず壁に収まる", () => {
    const { along, y } = panelSpan(panel("sub"));
    const frameOuter = CABIN_DOOR.width / 2 + CABIN_DOOR.frameWidth;
    expect(along[1]).toBeLessThan(-frameOuter);
    expect(along[0]).toBeGreaterThanOrEqual(-HALF_W);
    expect(y[0]).toBeGreaterThanOrEqual(0);
    expect(y[1]).toBeLessThanOrEqual(CABIN.height);
  });

  it("主の操作盤は三方枠（正面の壁）と重ならない", () => {
    // 右の壁の板の手前の端は正面の壁（三方枠の付く面）から離れている
    const { along } = panelSpan(panel("main"));
    expect(along[0]).toBeGreaterThan(-HALF_D + CABIN_DOOR.frameDepth);
  });
});

describe("ボタン", () => {
  const expectedOps = [
    ...FLOOR_NUMBERS.map((f) => `floor:${f}`),
    "open:null",
    "close:null",
    "emergencyCall:null",
  ].sort();

  it("両方の操作盤で計 16 個．id は一意", () => {
    expect(ELEVATOR_BUTTONS).toHaveLength(16);
    expect(new Set(ELEVATOR_BUTTONS.map((b) => b.id)).size).toBe(16);
  });

  it.each(["main", "sub"] as const)(
    "%s の操作盤は 1〜5 階・開・閉・非常連絡を 1 つずつ持つ（action・floor で同じ操作）",
    (role) => {
      const p = panel(role);
      const ops = ELEVATOR_BUTTONS.filter((b) => b.panelId === p.id)
        .map((b) => `${b.action}:${b.floor}`)
        .sort();
      expect(ops).toEqual(expectedOps);
    },
  );

  it("階のボタンは floor を持ち，他は floor が null", () => {
    for (const b of ELEVATOR_BUTTONS) {
      if (b.action === "floor") {
        expect(b.floor).not.toBeNull();
        expect(b.key).toBe(floorButtonKey(b.floor as number));
      } else {
        expect(b.floor).toBeNull();
      }
      expect(b.id).toBe(panelButtonId(b.panelId, b.key));
    }
  });

  it("ボタンの中心はすべて床から 0.9〜1.4m の高さにある", () => {
    for (const b of ELEVATOR_BUTTONS) {
      expect(b.position[1]).toBeGreaterThanOrEqual(0.9);
      expect(b.position[1]).toBeLessThanOrEqual(1.4);
    }
  });

  it("ボタンはすべて（縁まで）床から 0.9〜1.4m の高さに収まる", () => {
    for (const b of ELEVATOR_BUTTONS) {
      expect(b.position[1] - b.diameter / 2).toBeGreaterThanOrEqual(0.9);
      expect(b.position[1] + b.diameter / 2).toBeLessThanOrEqual(1.4);
    }
  });

  it.each(["main", "sub"] as const)(
    "%s の操作盤のボタンは隣どうし重ならず 3cm 以上あいている",
    (role) => {
      const p = panel(role);
      const buttons = p.layout.buttons;
      for (let i = 0; i < buttons.length; i++) {
        for (let j = i + 1; j < buttons.length; j++) {
          const a = buttons[i];
          const b = buttons[j];
          const gap = Math.hypot(a.x - b.x, a.y - b.y) - (a.diameter + b.diameter) / 2;
          expect(gap, `${a.key} - ${b.key}`).toBeGreaterThanOrEqual(0.03);
        }
      }
    },
  );

  it.each(["main", "sub"] as const)("%s の操作盤のボタンは板の上に収まる", (role) => {
    const { layout } = panel(role);
    for (const b of layout.buttons) {
      expect(Math.abs(b.x) + b.diameter / 2).toBeLessThanOrEqual(layout.width / 2 + EPS);
      expect(b.y - b.diameter / 2).toBeGreaterThanOrEqual(layout.bottom - EPS);
      expect(b.y + b.diameter / 2).toBeLessThanOrEqual(layout.top + EPS);
    }
  });

  it("主（横並び）: 上段に 1〜5 階，下段に開・閉・非常連絡", () => {
    const { buttons } = HORIZONTAL_PANEL_LAYOUT;
    const floors = buttons.filter((b) => b.action === "floor");
    const controls = buttons.filter((b) => b.action !== "floor");
    expect(new Set(floors.map((b) => b.y)).size).toBe(1);
    expect(new Set(controls.map((b) => b.y)).size).toBe(1);
    expect(floors[0].y).toBeGreaterThan(controls[0].y);
    // 横に並ぶ（x が互いに異なる）
    expect(new Set(floors.map((b) => b.x)).size).toBe(5);
  });

  it("副（縦並び）: 階のボタンは 1 列に縦に並ぶ", () => {
    const floors = VERTICAL_PANEL_LAYOUT.buttons.filter((b) => b.action === "floor");
    expect(new Set(floors.map((b) => b.x)).size).toBe(1);
    expect(new Set(floors.map((b) => b.y)).size).toBe(5);
  });

  it("position（かごの座標）は操作盤の壁面より内側で，localPosition と対応する", () => {
    for (const b of ELEVATOR_BUTTONS) {
      const p = CONTROL_PANELS.find((c) => c.id === b.panelId);
      if (!p) throw new Error(b.panelId);
      const base = localToCabin(p, b.localPosition);
      expect(Math.hypot(base[0] - b.position[0], base[2] - b.position[2])).toBeLessThan(0.05);
      expect(base[1]).toBeCloseTo(b.position[1]);
      if (p.role === "main") {
        expect(b.position[0]).toBeLessThan(HALF_W);
        expect(b.position[0]).toBeGreaterThan(HALF_W - 0.06);
      } else {
        expect(b.position[2]).toBeGreaterThan(-HALF_D);
        expect(b.position[2]).toBeLessThan(-HALF_D + 0.06);
      }
    }
  });

  it("ラベルのテクスチャはすべてのボタンの key を含み，マスは重ならない", () => {
    for (const b of ELEVATOR_BUTTONS) expect(BUTTON_LABEL_KEYS).toContain(b.key);
    expect(new Set(BUTTON_LABEL_KEYS).size).toBe(BUTTON_LABEL_KEYS.length);
    const ranges = BUTTON_LABEL_KEYS.map((k) => buttonLabelURange(k)).sort((a, b) => a.u0 - b.u0);
    for (const r of ranges) {
      expect(r.u0).toBeGreaterThanOrEqual(0);
      expect(r.u1).toBeLessThanOrEqual(1);
      expect(r.u1).toBeGreaterThan(r.u0);
    }
    for (let i = 1; i < ranges.length; i++) {
      expect(ranges[i].u0).toBeGreaterThanOrEqual(ranges[i - 1].u1 - EPS);
    }
  });

  it("どちらの操作盤でも同じ key のボタンは同じラベルのマスを使う", () => {
    const main = ELEVATOR_BUTTONS.filter((b) => b.panelId === panel("main").id);
    for (const b of main) {
      const sub = ELEVATOR_BUTTONS.find((s) => s.panelId === panel("sub").id && s.key === b.key);
      expect(sub).toBeDefined();
      if (sub) expect(buttonLabelURange(sub.key)).toEqual(buttonLabelURange(b.key));
    }
  });
});

describe("手すり", () => {
  it("奥（必須）と左右の 3 本で，id は一意", () => {
    expect(ELEVATOR_HANDRAILS.map((h) => h.wall).sort()).toEqual(["left", "rear", "right"]);
    expect(new Set(ELEVATOR_HANDRAILS.map((h) => h.id)).size).toBe(3);
    for (const h of ELEVATOR_HANDRAILS) expect(h.kind).toBe("handrail");
  });

  it("高さは 0.85m 程度", () => {
    expect(HANDRAIL.y).toBeCloseTo(0.85, 2);
    for (const h of ELEVATOR_HANDRAILS) expect(h.position[1]).toBeCloseTo(0.85, 2);
  });

  it("壁に沿って付き，かごの中に収まる", () => {
    for (const h of ELEVATOR_HANDRAILS) {
      const wall = CABIN_WALLS[h.wall];
      expect(h.rotationY).toBeCloseTo(wall.rotationY);
      expect(h.size.x).toBeGreaterThan(0.5);
      expect(h.size.x).toBeLessThanOrEqual(wall.length);
      const f = computeFootprint({ x: h.position[0], z: h.position[2] }, h.rotationY, h.size);
      expect(f.centerX - f.halfX).toBeGreaterThanOrEqual(-HALF_W - EPS);
      expect(f.centerX + f.halfX).toBeLessThanOrEqual(HALF_W + EPS);
      expect(f.centerZ - f.halfZ).toBeGreaterThanOrEqual(-HALF_D - EPS);
      expect(f.centerZ + f.halfZ).toBeLessThanOrEqual(HALF_D + EPS);
    }
    const rear = ELEVATOR_HANDRAILS.find((h) => h.wall === "rear");
    expect(rear?.position[2]).toBeGreaterThan(HALF_D - 0.1);
  });

  it("右の手すりは主の操作盤と（壁に沿う向きで）重ならない", () => {
    const right = ELEVATOR_HANDRAILS.find((h) => h.wall === "right");
    if (!right) throw new Error("right");
    const railZ: Range = [
      right.position[2] - right.size.x / 2,
      right.position[2] + right.size.x / 2,
    ];
    expect(overlaps(railZ, panelSpan(panel("main")).along)).toBe(false);
  });

  it("どの手すりも操作盤と重ならない", () => {
    for (const h of ELEVATOR_HANDRAILS) {
      const f = computeFootprint({ x: h.position[0], z: h.position[2] }, h.rotationY, h.size);
      for (const p of CONTROL_PANELS) {
        const pf = panelFootprint(p);
        const xOverlap = overlaps(
          [f.centerX - f.halfX, f.centerX + f.halfX],
          [pf.centerX - pf.halfX, pf.centerX + pf.halfX],
        );
        const zOverlap = overlaps(
          [f.centerZ - f.halfZ, f.centerZ + f.halfZ],
          [pf.centerZ - pf.halfZ, pf.centerZ + pf.halfZ],
        );
        expect(xOverlap && zOverlap, `${h.id} - ${p.id}`).toBe(false);
      }
    }
  });
});

describe("階の表示・照明", () => {
  it("階の表示は扉の上（開口部より上で天井より下）の中央", () => {
    expect(FLOOR_INDICATOR_ID.length).toBeGreaterThan(0);
    expect(FLOOR_INDICATOR.centerY - FLOOR_INDICATOR.height / 2).toBeGreaterThanOrEqual(
      CABIN_DOOR_OPENING.v1,
    );
    expect(FLOOR_INDICATOR.centerY + FLOOR_INDICATOR.height / 2).toBeLessThanOrEqual(CABIN.height);
  });

  it("天井の照明と非常灯は天井の範囲に収まる", () => {
    expect(CEILING_LIGHT.width / 2).toBeLessThanOrEqual(HALF_W);
    expect(Math.abs(CEILING_LIGHT.z) + CEILING_LIGHT.depth / 2).toBeLessThanOrEqual(HALF_D);
    expect(Math.abs(EMERGENCY_LIGHT.x) + EMERGENCY_LIGHT.width / 2).toBeLessThanOrEqual(HALF_W);
    expect(Math.abs(EMERGENCY_LIGHT.z) + EMERGENCY_LIGHT.depth / 2).toBeLessThanOrEqual(HALF_D);
    expect(CEILING_LIGHT.intensity).toBeGreaterThan(0);
    expect(EMERGENCY_LIGHT.intensity).toBeGreaterThan(0);
  });
});

describe("乗り場（ホール）", () => {
  it("かごの正面の壁より外（-Z）にある", () => {
    expect(HALL_WALL_Z).toBeLessThan(-HALF_D);
    expect(HALL_CENTER[2]).toBeLessThan(HALL_WALL_Z);
  });

  it("乗り場の開口部はかごの扉と同じ位置・大きさ", () => {
    const a = wallPointToWorld(HALL_WALLS.car, HALL_DOOR_OPENING.u0, 0)[0];
    const b = wallPointToWorld(HALL_WALLS.car, HALL_DOOR_OPENING.u1, 0)[0];
    expect(Math.min(a, b)).toBeCloseTo(-0.5);
    expect(Math.max(a, b)).toBeCloseTo(0.5);
    expect(HALL_DOOR_OPENING.v1 - HALL_DOOR_OPENING.v0).toBeCloseTo(CABIN_DOOR_OPENING.v1);
  });
});

describe("開始位置", () => {
  const [sx, sy, sz] = ELEVATOR_START.position;

  it("かごの中央付近 (0, 1.6, 0.25) で扉（-Z）を向く", () => {
    expect(sx).toBeCloseTo(0);
    expect(sy).toBeCloseTo(EYE_HEIGHT.standing);
    expect(sz).toBeCloseTo(0.25);
    expect(ELEVATOR_START.yaw).toBeCloseTo(0);
  });

  it("壁・手すり・操作盤と重ならない（体の半径 0.25m を見込む）", () => {
    const r = 0.25;
    expect(HALF_W - Math.abs(sx)).toBeGreaterThan(r);
    expect(HALF_D - Math.abs(sz)).toBeGreaterThan(r);
    for (const h of ELEVATOR_HANDRAILS) {
      const f = computeFootprint({ x: h.position[0], z: h.position[2] }, h.rotationY, h.size);
      expect(distanceToFootprint(sx, sz, f), h.id).toBeGreaterThan(r);
    }
    for (const p of CONTROL_PANELS) {
      expect(distanceToFootprint(sx, sz, panelFootprint(p)), p.id).toBeGreaterThan(r);
    }
  });
});
