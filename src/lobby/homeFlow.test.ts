import { describe, expect, it } from "vitest";
import type { SceneId } from "../core/scene";
import { AFTER_PERMISSIONS_SCENE, resolveSceneRequest } from "./homeFlow";

/** SceneId のすべての値（core/scene.ts） */
const ALL_SCENES: readonly SceneId[] = ["start", "home", "lobby", "scenario", "debrief"];

describe("AFTER_PERMISSIONS_SCENE", () => {
  it("許可を取り終えた後に許可の画面の代わりに出すのはホーム", () => {
    expect(AFTER_PERMISSIONS_SCENE).toBe("home");
  });
});

describe("resolveSceneRequest", () => {
  it.each(ALL_SCENES)("許可を取る前は %s を頼まれたらそのまま出す", (requested) => {
    expect(resolveSceneRequest(requested, false)).toBe(requested);
  });

  it.each(ALL_SCENES.map((s) => [s, s === "start" ? "home" : s] as const))(
    "許可を取り終えた後に %s を頼まれたら %s を出す",
    (requested, expected) => {
      expect(resolveSceneRequest(requested, true)).toBe(expected);
    },
  );

  it("起動直後（許可の前）は許可の画面を出す", () => {
    expect(resolveSceneRequest("start", false)).toBe("start");
  });

  it("許可を取り終えた後は，何度 start を頼まれても許可の画面を出さない", () => {
    for (let i = 0; i < 3; i++) {
      expect(resolveSceneRequest("start", true)).not.toBe("start");
    }
  });

  it("体験の流れ（許可 → ホーム → ロビー → シナリオ → ホームへ → ロビー）で許可の画面は最初の 1 回だけ", () => {
    // 許可の画面で許可がそろうまでは permissionsDone = false，その後は true
    const requests: readonly [SceneId, boolean][] = [
      ["start", false],
      ["home", true],
      ["lobby", true],
      ["scenario", true],
      ["home", true],
      ["start", true], // 誤って start を頼まれてもホームへ
      ["lobby", true],
      ["scenario", true],
      ["debrief", true],
      ["lobby", true], // もう一度（ロビーから）
    ];
    const shown = requests.map(([r, done]) => resolveSceneRequest(r, done));
    expect(shown.filter((s) => s === "start").length).toBe(1);
    expect(shown[0]).toBe("start");
    expect(shown).toEqual([
      "start",
      "home",
      "lobby",
      "scenario",
      "home",
      "home",
      "lobby",
      "scenario",
      "debrief",
      "lobby",
    ]);
  });
});
