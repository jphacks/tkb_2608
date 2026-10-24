import { describe, expect, it } from "vitest";
import {
  AUTO_LOCK_HELP,
  BRIGHTNESS_GUIDE,
  createHomeMemory,
  describeWakeLockStatus,
  type HomeMemory,
  shouldConfirmStart,
  type WakeLockStatus,
} from "./homeSettings";

/** WakeLockStatus のすべての値 */
const ALL_STATUSES: readonly WakeLockStatus[] = [
  "unsupported",
  "idle",
  "pending",
  "active",
  "released",
  "failed",
];

/** 設定を開いた記録（homeScene が設定を開いた時に行う更新と同じ） */
function visitSettings(memory: HomeMemory): void {
  memory.settingsVisited = true;
}

describe("createHomeMemory", () => {
  it("作った直後は設定を一度も開いていない", () => {
    expect(createHomeMemory().settingsVisited).toBe(false);
  });

  it("呼ぶたびに別の memory を作る（片方を更新しても他方は変わらない）", () => {
    const a = createHomeMemory();
    const b = createHomeMemory();
    expect(a).not.toBe(b);
    visitSettings(a);
    expect(b.settingsVisited).toBe(false);
  });
});

describe("shouldConfirmStart", () => {
  it("設定を一度も開いていなければ「スタート」で確認を聞く", () => {
    expect(shouldConfirmStart(createHomeMemory())).toBe(true);
  });

  it("設定を一度開いた後は聞かない", () => {
    const memory = createHomeMemory();
    visitSettings(memory);
    expect(shouldConfirmStart(memory)).toBe(false);
  });

  it("確認を聞いた後でも，設定を開くまでは何度押しても聞く（聞くこと自体では記録しない）", () => {
    const memory = createHomeMemory();
    for (let i = 0; i < 3; i++) expect(shouldConfirmStart(memory)).toBe(true);
    expect(memory.settingsVisited).toBe(false);
  });

  it("同じ memory を使い回せば，結果画面からホームに戻って作り直しても聞かない", () => {
    // app/ が 1 つだけ作って各ホームに渡す想定: 1 回目のホームで設定を開く → 体験 → ホームへ戻る
    const memory = createHomeMemory();
    expect(shouldConfirmStart(memory)).toBe(true);
    visitSettings(memory);
    for (let round = 0; round < 3; round++) {
      expect(shouldConfirmStart(memory)).toBe(false);
    }
  });

  it("新しい回の利用（新しい memory）ではまた聞く", () => {
    const first = createHomeMemory();
    visitSettings(first);
    expect(shouldConfirmStart(first)).toBe(false);
    expect(shouldConfirmStart(createHomeMemory())).toBe(true);
  });
});

describe("describeWakeLockStatus", () => {
  it.each(ALL_STATUSES)("%s の状態の文面は空でない", (status) => {
    const d = describeWakeLockStatus(status);
    expect(typeof d.label).toBe("string");
    expect(d.label.trim().length).toBeGreaterThan(0);
  });

  it.each([
    ["unsupported", true],
    ["failed", true],
    ["active", false],
    ["released", false],
    ["idle", false],
    ["pending", false],
  ] as const)("%s では自動ロックの案内を出すか: %s", (status, hasHelp) => {
    const { help } = describeWakeLockStatus(status);
    if (hasHelp) {
      expect(help).toBe(AUTO_LOCK_HELP);
    } else {
      expect(help).toBeNull();
    }
  });

  it("使えない時と失敗した時は文面が区別できる", () => {
    expect(describeWakeLockStatus("unsupported").label).not.toBe(
      describeWakeLockStatus("failed").label,
    );
  });

  it("有効な時と，使えない・失敗した時は文面が違う", () => {
    const active = describeWakeLockStatus("active").label;
    expect(describeWakeLockStatus("unsupported").label).not.toBe(active);
    expect(describeWakeLockStatus("failed").label).not.toBe(active);
  });
});

describe("AUTO_LOCK_HELP", () => {
  it("自動ロックを「なし」にする案内である", () => {
    expect(AUTO_LOCK_HELP).toContain("自動ロック");
    expect(AUTO_LOCK_HELP).toContain("なし");
  });
});

describe("BRIGHTNESS_GUIDE", () => {
  it("案内が 1 つ以上あり，どれも空でない", () => {
    expect(BRIGHTNESS_GUIDE.length).toBeGreaterThan(0);
    for (const p of BRIGHTNESS_GUIDE) expect(p.trim().length).toBeGreaterThan(0);
  });

  it("明るさの自動調節をオフにする案内を含む", () => {
    expect(BRIGHTNESS_GUIDE.some((p) => p.includes("自動調節") && p.includes("オフ"))).toBe(true);
  });

  it("中くらいが目安であることを含む", () => {
    expect(BRIGHTNESS_GUIDE.some((p) => p.includes("中くらい"))).toBe(true);
  });
});
