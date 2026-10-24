// sim/ の公開窓口と，モジュールとしての決まりのテスト．
// 基準は docs/04_SPEC/SPEC_01_画面遷移とモジュール構成.md「依存の向き」（sim/ は core/ だけを import し，
// three.js にもブラウザ API にも依存しない）・「処理速度」（computeSpread() はマス目 2,000 程度で数 ms．1 フレームの外で 1 回）
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { CellRef, SchoolPlan } from "../core/schoolPlan";
import { createFloorFromRows } from "../share/samples/floorFromRows";
import * as sim from "./index";

const SIM_DIR = dirname(fileURLToPath(import.meta.url));
const CORE_DIR = resolve(SIM_DIR, "../core");

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));

/** ファイルの import・export ... from の行き先 */
function importsOf(path: string): string[] {
  const text = readFileSync(path, "utf8");
  return [...text.matchAll(/(?:import|export)[^"';]*?from\s+["']([^"']+)["']/g)].map((m) => m[1]);
}

describe("sim/index.ts", () => {
  it.each([
    "wallBetween",
    "canPersonStep",
    "canSpreadStep",
    "isWalkableKind",
    "isSpreadableKind",
    "computeSpread",
    "isNearFire",
    "proposeRoute",
    "evaluateDrill",
    "resolveReferenceRoute",
    "worldToCell",
    "cellCenter",
  ])("%s を公開する", (name) => {
    expect(typeof (sim as Record<string, unknown>)[name]).toBe("function");
  });
});

describe("依存の向き（SPEC_01）", () => {
  const files = sourceFiles(SIM_DIR);

  it("sim/ のコードがある", () => {
    expect(files).toEqual(
      expect.arrayContaining(["walls.ts", "spread.ts", "route.ts", "evaluate.ts"]),
    );
  });

  it.each(files)("%s は sim/ の中と core/ だけを import する", (file) => {
    for (const spec of importsOf(join(SIM_DIR, file))) {
      const ok = spec.startsWith("./") || spec.startsWith("../core/");
      expect(ok, `${file} が ${spec} を import している`).toBe(true);
    }
  });

  it("sim/ が import する core/ のファイルも three.js・core/scene.ts を import しない", () => {
    const seen = new Set<string>();
    const queue = files.flatMap((f) =>
      importsOf(join(SIM_DIR, f))
        .filter((s) => s.startsWith("../core/"))
        .map((s) => resolve(SIM_DIR, `${s}.ts`)),
    );
    while (queue.length > 0) {
      const path = queue.pop() as string;
      if (seen.has(path)) continue;
      seen.add(path);
      for (const spec of importsOf(path)) {
        expect(spec, `${path} が ${spec} を import している`).not.toMatch(/^three/);
        expect(spec).not.toMatch(/scene$/);
        expect(spec.startsWith("./"), `${path} が core/ の外の ${spec} を import している`).toBe(
          true,
        );
        queue.push(resolve(CORE_DIR, `${spec}.ts`));
      }
    }
    expect(seen.size).toBeGreaterThan(0);
  });

  it.each(files)("%s はブラウザ API・時刻・乱数を使わない", (file) => {
    const text = readFileSync(join(SIM_DIR, file), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    for (const banned of [
      /\bwindow\b/,
      /\bdocument\b/,
      /\bnavigator\b/,
      /\blocalStorage\b/,
      /\bperformance\./,
      /\bDate\b/,
      /Math\.random/,
      /\bconsole\./,
    ]) {
      expect(text, `${file} が ${banned} を使っている`).not.toMatch(banned);
    }
  });
});

describe("処理速度（SPEC_01「処理速度」）", () => {
  // SPEC_02「長さの上限」の想定する校舎（1 フロア 60 × 30 マス．教室 6 つと廊下）に近い形
  const at = (x: number, z: number): CellRef => ({ floor: 0, x, z });
  const rows: string[] = [];
  const roomRow = Array.from({ length: 60 }, (_, x) => String(Math.floor(x / 10))).join("");
  for (let z = 0; z < 7; z++) rows.push(roomRow);
  rows.push(
    Array.from({ length: 60 }, (_, x) => (x % 10 === 5 ? "d" : String(Math.floor(x / 10)))).join(
      "",
    ),
  );
  for (let z = 0; z < 3; z++) rows.push("h".repeat(60));
  rows.push(`e${"#".repeat(28)}ss${"#".repeat(28)}e`.slice(0, 60));
  for (let z = rows.length; z < 30; z++) rows.push("o".repeat(60));
  const plan: SchoolPlan = {
    version: 1,
    name: "60×30 の校舎",
    cellSize: 1,
    floors: [createFloorFromRows(1, rows)],
    rooms: Array.from({ length: 6 }, (_, i) => ({ name: `教室${i}` })),
    drill: {
      mode: "learn",
      fireOrigins: [at(55, 2)],
      start: at(5, 2),
      startYaw: 0,
      assembly: [at(30, 20)],
      route: [],
      spread: { fireSecondsPerCell: 6, smokeSecondsPerCell: 2, extraFires: [] },
      timeLimitSeconds: 150,
    },
  };

  /** 何回か実行した中央値（ms）．テストの環境の揺れで落ちないよう，予算より十分ゆるい上限で比べる */
  const medianMs = (run: () => void, times = 7): number => {
    const ms: number[] = [];
    for (let i = 0; i < times; i++) {
      const t0 = performance.now();
      run();
      ms.push(performance.now() - t0);
    }
    return ms.sort((a, b) => a - b)[Math.floor(times / 2)];
  };

  it("60 × 30 マスの computeSpread() は数 ms（ゆるい上限 50 ms）", () => {
    expect(plan.floors[0].cells).toHaveLength(1800);
    expect(medianMs(() => sim.computeSpread(plan))).toBeLessThan(50);
  });

  it("60 × 30 マスの proposeRoute() は経路を返し，エディタで待たせない（ゆるい上限 500 ms）", () => {
    const spread = sim.computeSpread(plan);
    expect(sim.proposeRoute(plan, spread)).not.toBeNull();
    expect(medianMs(() => sim.proposeRoute(plan, spread), 3)).toBeLessThan(500);
  });

  it("60 × 30 マスで 150 秒分（0.2 秒ごと 750 件）の evaluateDrill()（ゆるい上限 500 ms）", () => {
    const spread = sim.computeSpread(plan);
    const samples = Array.from({ length: 750 }, (_, i) => ({
      t: i * 0.2,
      floor: 0,
      x: 5.5 + (i % 50),
      z: 9.5,
      posture: "standing" as const,
    }));
    expect(medianMs(() => sim.evaluateDrill(plan, spread, { samples }), 3)).toBeLessThan(500);
  });
});
