// 見守り画面の見せ方（resolveMonitorDisplay）と赤い表示（isMonitorAlert）のテスト．
// 基準は docs/04_SPEC/SPEC_01_画面遷移とモジュール構成.md「見守り」の「見守り画面」の表・違う校舎・「赤い表示」・「切れた時」
import { describe, expect, it } from "vitest";
import type { DrillTrack } from "../core/drill";
import type { MonitorLobbyNotice } from "../share/monitorNotice";
import { DEMO_SCHOOL } from "../share/samples/demoSchool";
import { computeSpread } from "../sim/spread";
import {
  isMonitorAlert,
  MONITOR_MESSAGES,
  type MonitorDisplay,
  type MonitorDrawKind,
  type RelayStatus,
  resolveMonitorDisplay,
} from "./monitorDisplay";
import type { MonitorFrame, MonitorScreen } from "./monitorSession";
import { createMonitorPose, type MonitorPose } from "./stateBuffer";

const DEMO_SPREAD = computeSpread(DEMO_SCHOOL);

function pose(overrides: Partial<MonitorPose> = {}): MonitorPose {
  return { ...createMonitorPose(), x: 2.5, z: 2.5, t: 0, ...overrides };
}

function frame(overrides: Partial<MonitorFrame> = {}): MonitorFrame {
  return { screen: "waiting", mismatch: false, stalled: false, pose: null, ...overrides };
}

const POSE_DISPLAY: MonitorDisplay = { draw: "pose", message: null };

describe("MONITOR_MESSAGES", () => {
  it("仕様の案内の文と同じ", () => {
    expect(MONITOR_MESSAGES).toMatchObject({
      waiting: "体験者の接続を待っています",
      preparing: "体験者は準備中です",
      ended: "避難が終わりました",
      stalled: "電波が途切れています",
      relayDown: "中継につながりません．つなぎ直しています",
      mismatch: "見守り画面と違う校舎で始めています．同じ p= の URL で開いてください",
      noRoom: "URL に room= を付けて開いてください",
      noRelay: "中継の住所が設定されていません",
    });
  });
});

describe("resolveMonitorDisplay", () => {
  it.each<[string, Partial<MonitorFrame>, MonitorDisplay]>([
    [
      "接続待ちは描かずに案内",
      { screen: "waiting" },
      { draw: "blank", message: MONITOR_MESSAGES.waiting },
    ],
    [
      "準備中は開始地点から描いて案内",
      { screen: "preparing" },
      { draw: "start", message: MONITOR_MESSAGES.preparing },
    ],
    [
      "準備中は姿勢があっても開始地点から描く",
      { screen: "preparing", pose: pose() },
      { draw: "start", message: MONITOR_MESSAGES.preparing },
    ],
    ["体験中は目線を描き，文字を出さない", { screen: "live", pose: pose() }, POSE_DISPLAY],
    [
      "体験中でまだ状態が無ければ開始地点から描き，文字を出さない",
      { screen: "live" },
      { draw: "start", message: null },
    ],
    [
      "体験中に途切れたら最後の目線のまま案内",
      { screen: "live", pose: pose(), stalled: true },
      { draw: "pose", message: MONITOR_MESSAGES.stalled },
    ],
    [
      "終わりは止めた目線を描いて案内",
      { screen: "ended", pose: pose() },
      { draw: "pose", message: MONITOR_MESSAGES.ended },
    ],
  ])("%s", (_, overrides, expected) => {
    expect(resolveMonitorDisplay(frame(overrides), "open")).toEqual(expected);
  });

  it.each<MonitorScreen>(["waiting", "preparing", "live", "ended"])(
    "違う校舎（%s）は描かずに案内",
    (screen) => {
      expect(
        resolveMonitorDisplay(frame({ screen, mismatch: true, pose: pose() }), "open"),
      ).toEqual({
        draw: "blank",
        message: MONITOR_MESSAGES.mismatch,
      });
    },
  );

  it.each<[string, Partial<MonitorFrame>]>([
    ["接続待ち", { screen: "waiting" }],
    ["体験中", { screen: "live", pose: pose() }],
    ["途切れ", { screen: "live", pose: pose(), stalled: true }],
    ["終わり", { screen: "ended", pose: pose() }],
    ["違う校舎", { screen: "live", mismatch: true }],
  ])("中継につながらない間（%s）は「中継につながりません」を最優先で出す", (_, overrides) => {
    expect(resolveMonitorDisplay(frame(overrides), "retrying").message).toBe(
      MONITOR_MESSAGES.relayDown,
    );
  });

  it.each<RelayStatus>(["connecting", "open"])("中継が %s の間は画面の状態の案内", (relay) => {
    expect(resolveMonitorDisplay(frame({ screen: "waiting" }), relay).message).toBe(
      MONITOR_MESSAGES.waiting,
    );
  });
});

describe("isMonitorAlert", () => {
  it("煙の中で立っている姿勢を描いている時は赤くする", () => {
    expect(
      isMonitorAlert(DEMO_SCHOOL, DEMO_SPREAD, POSE_DISPLAY, pose({ x: 14.5, z: 5.5, t: 15 })),
    ).toBe(true);
  });

  it("煙の中でもしゃがんでいれば赤くしない", () => {
    expect(
      isMonitorAlert(
        DEMO_SCHOOL,
        DEMO_SPREAD,
        POSE_DISPLAY,
        pose({ x: 14.5, z: 5.5, t: 15, posture: "crouching" }),
      ),
    ).toBe(false);
  });

  it("火の 1 マス以内なら赤くする", () => {
    expect(
      isMonitorAlert(
        DEMO_SCHOOL,
        DEMO_SPREAD,
        POSE_DISPLAY,
        pose({ x: 16.5, z: 5.5, t: 20, posture: "crouching" }),
      ),
    ).toBe(true);
  });

  it("開始地点の近くでは赤くしない", () => {
    expect(isMonitorAlert(DEMO_SCHOOL, DEMO_SPREAD, POSE_DISPLAY, pose({ t: 30 }))).toBe(false);
  });

  it.each([-1, -0.001, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "t が %s（非常ベルの前・有限でない）なら火のそばでも赤くしない",
    (t) => {
      expect(
        isMonitorAlert(DEMO_SCHOOL, DEMO_SPREAD, POSE_DISPLAY, pose({ x: 16.5, z: 3.5, t })),
      ).toBe(false);
    },
  );

  it("姿勢が無ければ赤くしない", () => {
    expect(isMonitorAlert(DEMO_SCHOOL, DEMO_SPREAD, POSE_DISPLAY, null)).toBe(false);
  });

  it.each<MonitorDisplay>([
    { draw: "start", message: MONITOR_MESSAGES.preparing },
    { draw: "blank", message: MONITOR_MESSAGES.mismatch },
    { draw: "blank", message: MONITOR_MESSAGES.waiting },
  ])("目線を描いていない時（%o）は赤くしない（準備中は出さない）", (display) => {
    expect(
      isMonitorAlert(DEMO_SCHOOL, DEMO_SPREAD, display, pose({ x: 14.5, z: 5.5, t: 15 })),
    ).toBe(false);
  });

  it("途切れ・終わりで止めた姿勢でも，その姿勢で判定する（最後の表示のまま）", () => {
    const smoke = pose({ x: 14.5, z: 5.5, t: 15 });
    const stalled = resolveMonitorDisplay(
      frame({ screen: "live", pose: smoke, stalled: true }),
      "open",
    );
    const ended = resolveMonitorDisplay(frame({ screen: "ended", pose: smoke }), "open");
    expect(isMonitorAlert(DEMO_SCHOOL, DEMO_SPREAD, stalled, smoke)).toBe(true);
    expect(isMonitorAlert(DEMO_SCHOOL, DEMO_SPREAD, ended, smoke)).toBe(true);
  });
});

// ---- ロビーと結果画面の出し分け（SPEC_01「見守り画面」の表の準備中・終わり） ----

const LOBBY: MonitorLobbyNotice = {
  type: "lobby",
  studentId: 1,
  title: "しゃがんでください",
  body: "その場でしゃがみ，しゃがんだまま止まってください",
  caption: "",
  startButton: false,
  alignMarker: false,
};

const TRACK: DrillTrack = {
  samples: [{ t: 0, floor: 0, x: 2.5, z: 2.5, posture: "standing" }],
};

describe("resolveMonitorDisplay（ロビー・結果画面）", () => {
  it.each<[string, Partial<MonitorFrame>, MonitorDisplay]>([
    [
      "準備中で板が届いていれば，ロビーを描いて文字を出さない",
      { screen: "preparing", lobby: LOBBY },
      { draw: "lobby", message: null },
    ],
    [
      "準備中で板と姿勢があっても，ロビーを描いて文字を出さない",
      { screen: "preparing", lobby: LOBBY, pose: pose() },
      { draw: "lobby", message: null },
    ],
    [
      "準備中で板が null なら開始地点と案内",
      { screen: "preparing", lobby: null },
      { draw: "start", message: MONITOR_MESSAGES.preparing },
    ],
    [
      "終わりで記録がそろっていれば結果画面を出し，文字を出さない",
      { screen: "ended", pose: pose(), track: TRACK },
      { draw: "result", message: null },
    ],
    [
      "終わりで記録が null なら止めた目線と案内",
      { screen: "ended", pose: pose(), track: null },
      { draw: "pose", message: MONITOR_MESSAGES.ended },
    ],
    [
      "終わりで記録も姿勢も無ければ開始地点と案内",
      { screen: "ended" },
      { draw: "start", message: MONITOR_MESSAGES.ended },
    ],
    [
      "終わりで記録があれば姿勢が無くても結果画面",
      { screen: "ended", track: TRACK },
      { draw: "result", message: null },
    ],
    [
      "体験中は板や記録があっても目線を描く",
      { screen: "live", pose: pose(), lobby: LOBBY, track: TRACK },
      POSE_DISPLAY,
    ],
    [
      "接続待ちは板や記録があっても描かない",
      { screen: "waiting", lobby: LOBBY, track: TRACK },
      { draw: "blank", message: MONITOR_MESSAGES.waiting },
    ],
  ])("%s", (_, overrides, expected) => {
    expect(resolveMonitorDisplay(frame(overrides), "open")).toEqual(expected);
  });

  it.each<[string, Partial<MonitorFrame>]>([
    ["準備中（ロビー）", { screen: "preparing", lobby: LOBBY }],
    ["終わり（結果画面）", { screen: "ended", track: TRACK }],
  ])("違う校舎の %s は描かずに案内", (_, overrides) => {
    expect(resolveMonitorDisplay(frame({ ...overrides, mismatch: true }), "open")).toEqual({
      draw: "blank",
      message: MONITOR_MESSAGES.mismatch,
    });
  });

  it.each<[string, Partial<MonitorFrame>, MonitorDrawKind]>([
    ["ロビー", { screen: "preparing", lobby: LOBBY }, "lobby"],
    ["結果画面", { screen: "ended", track: TRACK }, "result"],
  ])(
    "中継につながらない間は %s を描いたまま「中継につながりません」を出す",
    (_, overrides, draw) => {
      expect(resolveMonitorDisplay(frame(overrides), "retrying")).toEqual({
        draw,
        message: MONITOR_MESSAGES.relayDown,
      });
    },
  );
});

describe("isMonitorAlert（ロビー・結果画面）", () => {
  it.each<MonitorDisplay>([
    { draw: "lobby", message: null },
    { draw: "result", message: null },
  ])("%o の時は煙の中の姿勢でも赤くしない", (display) => {
    expect(
      isMonitorAlert(DEMO_SCHOOL, DEMO_SPREAD, display, pose({ x: 14.5, z: 5.5, t: 15 })),
    ).toBe(false);
  });
});
