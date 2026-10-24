// ロビーの部屋（防災学習室）と指示の板の組み立て（Issue #110）．canvas でテクスチャを描くため，node 環境では
// document を何もしない canvas に差し替えて構造（名前・数・置き場所）だけを確かめる（描画結果は見ない）．
// 指示の板の文字は，代表的な文面が PANEL_TEXT_LAYOUT の枠に下限の大きさまでに収まる（「…」にならない）ことを確かめる

import * as THREE from "three";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { CellKind, SchoolPlan } from "../core/schoolPlan";
import {
  type CalibrationState,
  currentStepId,
  skipCalibrationStep,
  startCalibration,
} from "./calibration";
import { describeBriefing, skipBriefingPage, startBriefing } from "./drillBriefing";
import { createLobbyProps } from "./lobbyProps";
import { createLobbyPanel, createLobbyRoom, PANEL_TEXT_LAYOUT } from "./lobbyRoom";
import { describeCalibration, describeStartGate, type LobbyInstruction } from "./lobbyScript";
import { fitText, type MeasureText } from "./textFit";

/** 何もしない 2D コンテキスト（メソッドは空の関数，グラデーション等は空のオブジェクト） */
function fakeContext(): CanvasRenderingContext2D {
  const store: Record<string | symbol, unknown> = {};
  const noopResult = { addColorStop: () => {}, width: 0 };
  return new Proxy(store, {
    get: (target, prop) => (prop in target ? target[prop] : () => noopResult),
    set: (target, prop, value) => {
      target[prop] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

beforeAll(() => {
  vi.stubGlobal("document", {
    createElement: (tag: string) => {
      if (tag !== "canvas") throw new Error(`unexpected element: ${tag}`);
      const ctx = fakeContext();
      return { width: 0, height: 0, getContext: () => ctx };
    },
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
});

const PROP_NAMES = [
  "blackboard",
  "clock",
  "door",
  "exit-sign",
  "extinguisher-label",
  "extinguisher",
  "extinguisher-top",
  "route-map",
  "bulletin-board",
  "furniture-wood",
  "furniture-metal",
];

describe("createLobbyProps", () => {
  it("防災学習室の置き物（黒板・誘導灯・消火器・避難経路図・掲示板・机と椅子）を置く", () => {
    const props = createLobbyProps({ size: 8 });
    const names = props.root.children.map((c) => c.name);
    expect(props.root.name).toBe("lobby-props");
    for (const name of PROP_NAMES) expect(names).toContain(name);
    // 名前は重ならない
    expect(new Set(names).size).toBe(names.length);
    props.dispose();
  });

  it("机と椅子は InstancedMesh 2 つ（木・金属）にまとめる", () => {
    const props = createLobbyProps({ size: 8 });
    const instanced = props.root.children.filter(
      (c): c is THREE.InstancedMesh => c instanceof THREE.InstancedMesh,
    );
    expect(instanced.map((m) => m.name).sort()).toEqual(["furniture-metal", "furniture-wood"]);
    for (const m of instanced) expect(m.count).toBeGreaterThan(0);
    props.dispose();
  });

  it("ライトを足さない・影を使わない", () => {
    const props = createLobbyProps({ size: 8 });
    props.root.traverse((o) => {
      expect(o).not.toBeInstanceOf(THREE.Light);
      expect(o.castShadow).toBe(false);
    });
    props.dispose();
  });

  it("非常口の誘導灯は光の計算をしないマテリアル（光って見える）", () => {
    const props = createLobbyProps({ size: 8 });
    const sign = props.root.getObjectByName("exit-sign");
    expect(sign).toBeInstanceOf(THREE.Mesh);
    if (sign instanceof THREE.Mesh) expect(sign.material).toBeInstanceOf(THREE.MeshBasicMaterial);
    props.dispose();
  });

  it("置き物はすべて部屋（8 m 四方・高さ 3 m）の中にある", () => {
    const props = createLobbyProps({ size: 8 });
    for (const c of props.root.children) {
      expect(Math.abs(c.position.x)).toBeLessThanOrEqual(4);
      expect(Math.abs(c.position.z)).toBeLessThanOrEqual(4);
      expect(c.position.y).toBeGreaterThanOrEqual(0);
      expect(c.position.y).toBeLessThanOrEqual(3);
    }
    props.dispose();
  });
});

describe("createLobbyRoom", () => {
  it("置き物を部屋に含める", () => {
    const room = createLobbyRoom();
    expect(room.root.name).toBe("lobby-room");
    const props = room.root.getObjectByName("lobby-props");
    expect(props).toBeDefined();
    for (const name of PROP_NAMES) expect(room.root.getObjectByName(name)).toBeDefined();
    room.dispose();
  });

  it("ライトは 2 つまで・影を使わない", () => {
    const room = createLobbyRoom();
    let lights = 0;
    room.root.traverse((o) => {
      if (o instanceof THREE.Light) lights++;
      expect(o.castShadow).toBe(false);
    });
    expect(lights).toBeLessThanOrEqual(2);
    room.dispose();
  });
});

describe("createLobbyPanel", () => {
  it("内容を描いても例外を出さない（node の代わりの canvas）", () => {
    const panel = createLobbyPanel();
    expect(panel.object.name).toBe("lobby-panel");
    panel.show({ title: "見出し", body: "本文\n2 行目", caption: "手順 1 / 5　残り 8 秒" });
    panel.setHighlight(Number.NaN);
    panel.dispose();
  });
});

// ---- 指示の板の文字の収まり ----

/**
 * 文字の幅の見積もり（全角は 1 文字 = 文字の大きさ，半角は 0.6 倍）．日本語の字体の実際の幅に近い，やや大きめの見積もり
 */
const approxMeasure: MeasureText = (text, fontPx) => {
  let w = 0;
  for (const ch of text) w += (ch.codePointAt(0) ?? 0) < 0x80 ? fontPx * 0.6 : fontPx;
  return w;
};

function captionOf(i: LobbyInstruction): string {
  return [i.progressLabel, i.remainingSeconds === null ? null : `残り ${i.remainingSeconds} 秒`]
    .filter((s) => s !== null)
    .join("　");
}

/** 1 フロア 2 × 1 マスの教室だけの校舎（名前を長くして収まりを厳しめに確かめる） */
function plan(mode: "learn" | "test"): SchoolPlan {
  const cells: CellKind[] = ["classroom", "corridor"];
  return {
    version: 1,
    name: "デモ小学校 北校舎",
    cellSize: 1,
    floors: [{ level: 1, width: 2, depth: 1, cells, roomOf: [0, -1] }],
    rooms: [{ name: "1年1組" }],
    drill: {
      mode,
      fireOrigins: [{ floor: 0, x: 1, z: 0 }],
      start: { floor: 0, x: 0, z: 0 },
      startYaw: 0,
      assembly: [{ floor: 0, x: 1, z: 0 }],
      route: [],
      spread: { fireSecondsPerCell: 6, smokeSecondsPerCell: 2, extraFires: [] },
      timeLimitSeconds: 150,
    },
  };
}

function calibrationStates(reused: boolean): CalibrationState[] {
  const previous = reused
    ? {
        createdAt: 1,
        yawOffset: 0,
        standingBaseline: 9.7,
        crouchThreshold: 2,
        stepPeakThreshold: 2,
      }
    : null;
  const states: CalibrationState[] = [];
  let s = startCalibration(previous);
  for (let i = 0; i < 20 && s.phase !== "finished"; i++) {
    states.push(s);
    s = skipCalibrationStep(s);
  }
  return states;
}

function representativeInstructions(): [string, LobbyInstruction][] {
  const list: [string, LobbyInstruction][] = [];
  for (const reused of [false, true]) {
    for (const gaze of [false, true]) {
      for (const auto of [null, 15]) {
        list.push([
          `開始（reused=${reused}・gaze=${gaze}・auto=${auto}）`,
          describeStartGate(reused, auto, gaze),
        ]);
      }
      list.push([
        `手が見つからない（reused=${reused}・gaze=${gaze}）`,
        describeStartGate(reused, null, gaze, 3),
      ]);
    }
    for (const s of calibrationStates(reused)) {
      list.push([
        `キャリブレーション ${s.phase}:${currentStepId(s) ?? ""}（reused=${reused}）`,
        describeCalibration(s),
      ]);
    }
  }
  for (const p of [plan("learn"), plan("test"), null]) {
    const first = startBriefing(false);
    list.push([`説明 overview（${p?.drill.mode ?? "null"}）`, describeBriefing(first, p)]);
    list.push([
      `説明 caution（${p?.drill.mode ?? "null"}）`,
      describeBriefing(skipBriefingPage(first), p),
    ]);
  }
  return list;
}

describe("PANEL_TEXT_LAYOUT", () => {
  it("下限の大きさは上限以下", () => {
    for (const part of [
      PANEL_TEXT_LAYOUT.caption,
      PANEL_TEXT_LAYOUT.title,
      PANEL_TEXT_LAYOUT.body,
    ]) {
      expect(part.minFontPx).toBeLessThanOrEqual(part.maxFontPx);
      expect(part.box.x + part.box.width).toBeLessThanOrEqual(PANEL_TEXT_LAYOUT.canvasWidth);
      expect(part.box.y + part.box.height).toBeLessThanOrEqual(PANEL_TEXT_LAYOUT.canvasHeight);
    }
  });

  it("枠どうしが上下に重ならない（補足 → 見出し → 本文）", () => {
    const { caption, title, body } = PANEL_TEXT_LAYOUT;
    expect(caption.box.y + caption.box.height).toBeLessThanOrEqual(title.box.y);
    expect(title.box.y + title.box.height).toBeLessThanOrEqual(body.box.y);
  });

  it.each(representativeInstructions())("%s の文面は枠に収まる（「…」にならない）", (_label, i) => {
    const { caption, title, body } = PANEL_TEXT_LAYOUT;
    const fitPart = (text: string, part: typeof caption | typeof title | typeof body) =>
      fitText(
        text,
        {
          maxWidth: part.box.width,
          maxHeight: part.box.height,
          maxFontPx: part.maxFontPx,
          minFontPx: part.minFontPx,
          lineHeight: "lineHeight" in part ? part.lineHeight : undefined,
          maxLines: "maxLines" in part ? part.maxLines : undefined,
        },
        approxMeasure,
      );
    expect(fitPart(captionOf(i), caption).truncated).toBe(false);
    expect(fitPart(i.title, title).truncated).toBe(false);
    expect(fitPart(i.body, body).truncated).toBe(false);
  });
});
