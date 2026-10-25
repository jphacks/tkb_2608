// editor/ のモジュールとしての決まりのテスト．
// 基準は docs/04_SPEC/SPEC_01「依存の向き」（画面を持つモジュール同士は直接 import しない．editor/ は core/・sim/・share/ を import し，
// つなぐのは app/ だけ）と Issue #169 の設計メモ（view モードの 3D は editor/ から scenes/school/ を import せず，
// app/ が起動時に表示部品を渡す．FloorDraftProvider と同じ考え方）
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const EDITOR_DIR = dirname(fileURLToPath(import.meta.url));

const files = readdirSync(EDITOR_DIR).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));

/** ファイルの import・export ... from・import("...") の行き先 */
function importsOf(path: string): string[] {
  const text = readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  return [
    ...[...text.matchAll(/(?:import|export)[^"';]*?from\s+["']([^"']+)["']/g)].map((m) => m[1]),
    ...[...text.matchAll(/import\s*\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]),
    ...[...text.matchAll(/^\s*import\s+["']([^"']+)["']/gm)].map((m) => m[1]),
  ];
}

/** 画面を持つほかのモジュールと app/・controls/ */
const FORBIDDEN_DIRS = [
  "app",
  "scenes",
  "controls",
  "debrief",
  "scenario",
  "input",
  "lobby",
  "audio",
  "monitor",
];

describe("editor/ の依存の向き", () => {
  it("対象のファイルがある（planPreview.ts・editor.ts を含む）", () => {
    expect(files).toContain("planPreview.ts");
    expect(files).toContain("editor.ts");
  });

  it.each(files)("%s は three.js を import しない", (file) => {
    for (const spec of importsOf(join(EDITOR_DIR, file))) {
      expect(spec, `${file} が ${spec} を import している`).not.toMatch(/^three(\/|$)/);
    }
  });

  it.each(files)("%s は画面を持つほかのモジュール・app/・controls/ を import しない", (file) => {
    for (const spec of importsOf(join(EDITOR_DIR, file))) {
      for (const dir of FORBIDDEN_DIRS) {
        expect(spec, `${file} が ${spec} を import している`).not.toMatch(
          new RegExp(`(^|/)${dir}(/|$)`),
        );
      }
    }
  });

  it.each(files)("%s の相対 import の行き先は editor/・core/・sim/・share/ だけ", (file) => {
    for (const spec of importsOf(join(EDITOR_DIR, file))) {
      if (!spec.startsWith(".")) continue;
      expect(spec, `${file} が ${spec} を import している`).toMatch(
        /^(\.\/[^/]|\.\.\/(core|sim|share)(\/|$))/,
      );
    }
  });

  it("planPreview.ts は core/ だけを import する（型の窓口．three.js・校舎の 3D を知らない）", () => {
    const specs = importsOf(join(EDITOR_DIR, "planPreview.ts"));
    expect(specs.length).toBeGreaterThan(0);
    for (const spec of specs) {
      expect(spec, `planPreview.ts が ${spec} を import している`).toMatch(/^\.\.\/core\//);
    }
  });
});
