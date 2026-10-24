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

  describe("カメラ（Issue #110: 手で開始ボタンに触れて始める）", () => {
    it.each<PermissionOutcome>(["denied", "unavailable", "error"])(
      "%s の時は既定（requireCamera 省略）では進まず，再読み込みを案内する（needsCamera）",
      (camera) => {
        const d = decideStart(results({ camera }));
        expect(d.kind).toBe("needsCamera");
        if (d.kind === "needsCamera") {
          expect(d.message.length).toBeGreaterThan(0);
          expect(d.message).toContain("再読み込み");
        }
      },
    );

    it.each<PermissionOutcome>(["denied", "unavailable", "error"])(
      "%s の時，requireCamera: true を明示しても進まない",
      (camera) => {
        expect(
          decideStart(results({ camera }), { allowWithoutMotion: false, requireCamera: true }).kind,
        ).toBe("needsCamera");
      },
    );

    it("拒否の時はカメラを許可するよう案内する", () => {
      const d = decideStart(results({ camera: "denied" }));
      if (d.kind !== "needsCamera") throw new Error("needsCamera のはず");
      expect(d.message).toContain("許可");
    });

    it("「センサーなしで進む」を選んでもカメラが使えなければ進まない", () => {
      const d = decideStart(results({ motion: "denied", camera: "denied" }), {
        allowWithoutMotion: true,
      });
      expect(d.kind).toBe("needsCamera");
    });

    it.each<PermissionOutcome>(["denied", "unavailable", "error"])(
      "requireCamera: false（mock・replay）なら %s でも手を使わずに進む",
      (camera) => {
        const d = decideStart(results({ camera }), {
          allowWithoutMotion: false,
          requireCamera: false,
        });
        expect(d.kind).toBe("proceed");
        if (d.kind === "proceed") expect(d.handsAvailable).toBe(false);
      },
    );

    it.each<PermissionOutcome>(["granted", "notRequired"])(
      "%s は使えるものとして扱い，requireCamera によらず進む",
      (camera) => {
        for (const requireCamera of [true, false]) {
          const d = decideStart(results({ camera }), { allowWithoutMotion: false, requireCamera });
          if (d.kind !== "proceed") throw new Error("proceed のはず");
          expect(d.handsAvailable).toBe(true);
          expect(d.notices).toEqual([]);
        }
      },
    );
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

  it("センサーなしで進む・音なしが重なると案内が両方出る", () => {
    const d = decideStart(
      { motion: "denied", camera: "granted", audio: "error" },
      { allowWithoutMotion: true },
    );
    if (d.kind !== "proceed") throw new Error("proceed のはず");
    expect(d.handsAvailable).toBe(true);
    expect(d.notices.length).toBe(2);
  });

  it("requireCamera: false でセンサーなし・カメラなし・音なしが重なっても進む", () => {
    const d = decideStart(
      { motion: "denied", camera: "denied", audio: "error" },
      { allowWithoutMotion: true, requireCamera: false },
    );
    if (d.kind !== "proceed") throw new Error("proceed のはず");
    expect(d.handsAvailable).toBe(false);
    // センサー・音の案内は出る（カメラの扱いは今までどおり出さなくてよい）
    expect(d.notices.some((n) => n.includes("センサー"))).toBe(true);
    expect(d.notices.some((n) => n.includes("消音"))).toBe(true);
  });

  it("センサー拒否はカメラ・音の状態より優先して止める（needsCamera より needsMotion）", () => {
    expect(decideStart({ motion: "denied", camera: "denied", audio: "denied" }).kind).toBe(
      "needsMotion",
    );
  });
});
