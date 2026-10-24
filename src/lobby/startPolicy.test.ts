import { describe, expect, it } from "vitest";
import { decideStart, type PermissionOutcome, type PermissionResults } from "./startPolicy";

const ALL_GRANTED: PermissionResults = { motion: "granted", camera: "granted", audio: "granted" };

function results(patch: Partial<PermissionResults>): PermissionResults {
  return { ...ALL_GRANTED, ...patch };
}

describe("decideStart", () => {
  it("すべて許可されたら案内なしで進み，手が使える", () => {
    expect(decideStart(ALL_GRANTED)).toEqual({
      kind: "proceed",
      handsAvailable: true,
      notices: [],
    });
  });

  it("requestPermission の無いブラウザ（notRequired）は許可済みと同じく進む", () => {
    const d = decideStart({ motion: "notRequired", camera: "granted", audio: "notRequired" });
    expect(d).toEqual({ kind: "proceed", handsAvailable: true, notices: [] });
  });

  describe("センサー", () => {
    it.each<PermissionOutcome>(["denied", "error"])(
      "%s の時は進まず，再試行を促す（needsMotion）",
      (motion) => {
        const d = decideStart(results({ motion }));
        expect(d.kind).toBe("needsMotion");
        if (d.kind === "needsMotion") expect(d.message.length).toBeGreaterThan(0);
      },
    );

    it("既定のオプションでもセンサー拒否では進まない", () => {
      expect(decideStart(results({ motion: "denied" }), { allowWithoutMotion: false }).kind).toBe(
        "needsMotion",
      );
    });

    it("「センサーなしで進む」を選んだら案内付きで進む", () => {
      const d = decideStart(results({ motion: "denied" }), { allowWithoutMotion: true });
      expect(d.kind).toBe("proceed");
      if (d.kind === "proceed") {
        expect(d.handsAvailable).toBe(true);
        expect(d.notices.length).toBe(1);
      }
    });

    it("センサーが無い端末（unavailable）は許可が要らないため進む", () => {
      expect(decideStart(results({ motion: "unavailable" })).kind).toBe("proceed");
    });
  });

  describe("カメラ", () => {
    it.each<PermissionOutcome>(["denied", "unavailable", "error"])(
      "%s の時は手を使わずに進み，案内を出す",
      (camera) => {
        const d = decideStart(results({ camera }));
        expect(d.kind).toBe("proceed");
        if (d.kind === "proceed") {
          expect(d.handsAvailable).toBe(false);
          expect(d.notices.length).toBe(1);
        }
      },
    );

    it("拒否の時は再読み込みで使えることを案内する", () => {
      const d = decideStart(results({ camera: "denied" }));
      if (d.kind !== "proceed") throw new Error("proceed のはず");
      expect(d.notices[0]).toContain("再読み込み");
    });

    it("notRequired は使えるものとして扱う", () => {
      const d = decideStart(results({ camera: "notRequired" }));
      if (d.kind !== "proceed") throw new Error("proceed のはず");
      expect(d.handsAvailable).toBe(true);
    });
  });

  describe("音", () => {
    it.each<PermissionOutcome>(["denied", "unavailable", "error"])(
      "%s の時も進み，消音モードの解除を案内する",
      (audio) => {
        const d = decideStart(results({ audio }));
        if (d.kind !== "proceed") throw new Error("proceed のはず");
        expect(d.handsAvailable).toBe(true);
        expect(d.notices.length).toBe(1);
        expect(d.notices[0]).toContain("消音");
      },
    );
  });

  it("センサーなしで進む・カメラ拒否・音なしが重なると案内がすべて出る", () => {
    const d = decideStart(
      { motion: "denied", camera: "denied", audio: "error" },
      { allowWithoutMotion: true },
    );
    if (d.kind !== "proceed") throw new Error("proceed のはず");
    expect(d.handsAvailable).toBe(false);
    expect(d.notices.length).toBe(3);
  });

  it("センサー拒否はカメラ・音の状態より優先して止める", () => {
    expect(decideStart({ motion: "denied", camera: "denied", audio: "denied" }).kind).toBe(
      "needsMotion",
    );
  });
});
