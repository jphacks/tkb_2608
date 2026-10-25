// portal/ のモジュールとしての決まりのテスト．
// 基準は docs/04_SPEC/SPEC_01「依存の向き」（画面を持つモジュール同士は直接 import しない．つなぐのは app/ だけ）と
// Issue #176（教員用のホーム画面は HTML と CSS だけで組み，three.js は使わない．portal/ は core/ と自分のフォルダ以外を import しない）
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const PORTAL_DIR = dirname(fileURLToPath(import.meta.url));

const files = readdirSync(PORTAL_DIR).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));

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

describe("portal/ の依存の向き", () => {
  it("対象のファイルがある（portal.ts・portalLinks.ts を含む）", () => {
    expect(files).toContain("portal.ts");
    expect(files).toContain("portalLinks.ts");
  });

  it.each(files)("%s は three.js を import しない", (file) => {
    for (const spec of importsOf(join(PORTAL_DIR, file))) {
      expect(spec, `${file} が ${spec} を import している`).not.toMatch(/^three(\/|$)/);
    }
  });

  it.each(files)(
    "%s の import の行き先は portal/・core/ だけ（外部のパッケージも使わない）",
    (file) => {
      for (const spec of importsOf(join(PORTAL_DIR, file))) {
        expect(spec, `${file} が ${spec} を import している`).toMatch(
          /^(\.\/[^/]|\.\.\/core(\/|$))/,
        );
      }
    },
  );

  it("portalLinks.ts は何も import しない（DOM・location に依存しない純粋な関数）", () => {
    expect(importsOf(join(PORTAL_DIR, "portalLinks.ts"))).toEqual([]);
  });
});
