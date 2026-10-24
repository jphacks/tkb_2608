// HandLandmarker のモデルと wasm の URL（public/mediapipe/ に同梱して自前で配信する．ENV_04「ハンドトラッキングのモデルと wasm」）
import { describe, expect, it } from "vitest";
import { resolveHandAssetUrls } from "./handAssets";

describe("resolveHandAssetUrls", () => {
  it.each([
    ["/", "http://localhost:5173/?app", "http://localhost:5173/"],
    ["/", "http://localhost:5173/src/input/dev/hands.html", "http://localhost:5173/"],
    [
      "/tkb_2608/",
      "https://example.github.io/tkb_2608/index.html",
      "https://example.github.io/tkb_2608/",
    ],
    ["/tkb_2608", "https://example.github.io/tkb_2608/", "https://example.github.io/tkb_2608/"],
    ["./", "https://tkb2608.pages.dev/", "https://tkb2608.pages.dev/"],
  ])("base %s・ページ %s → %s の下の絶対 URL", (base, page, root) => {
    expect(resolveHandAssetUrls(base, page)).toEqual({
      wasmLoaderUrl: `${root}mediapipe/wasm/vision_wasm_module_internal.js`,
      wasmBinaryUrl: `${root}mediapipe/wasm/vision_wasm_module_internal.wasm`,
      modelUrl: `${root}mediapipe/hand_landmarker.task`,
    });
  });

  it("外部の CDN を指さない（ページと同じ配信元）", () => {
    const urls = resolveHandAssetUrls("/", "https://tkb2608.pages.dev/?app");
    for (const u of Object.values(urls))
      expect(new URL(u).origin).toBe("https://tkb2608.pages.dev");
  });
});
