// 見守り画面が中継につなぐ URL（resolveRelayBaseUrl・createMonitorRelayUrl）のテスト．
// 基準は docs/04_SPEC/SPEC_01_画面遷移とモジュール構成.md「見守り」の段階 1「中継」
// （`wss://<中継>/rooms/<部屋の ID>?role=monitor`．住所が設定されていないビルドでは「中継の住所が設定されていません」）
import { describe, expect, it } from "vitest";
import { createMonitorRelayUrl, resolveRelayBaseUrl } from "./relayUrl";

describe("resolveRelayBaseUrl", () => {
  it.each<[string, string]>([
    ["wss://relay.example.com", "wss://relay.example.com"],
    ["ws://localhost:8787", "ws://localhost:8787"],
    ["wss://relay.example.com/", "wss://relay.example.com"],
    ["wss://relay.example.com///", "wss://relay.example.com"],
    ["  wss://relay.example.com/  ", "wss://relay.example.com"],
    ["wss://relay.example.com/base/", "wss://relay.example.com/base"],
  ])("%s → %s", (value, expected) => {
    expect(resolveRelayBaseUrl(value)).toBe(expected);
  });

  it.each<[string, unknown]>([
    ["undefined（未設定）", undefined],
    ["null", null],
    ["空文字", ""],
    ["空白だけ", "   "],
    ["http://", "http://relay.example.com"],
    ["https://", "https://relay.example.com"],
    ["スキームだけ", "wss://"],
    ["スラッシュだけの後", "wss:///"],
    ["スキームの無い住所", "relay.example.com"],
    ["数", 8787],
    ["オブジェクト", { url: "wss://relay.example.com" }],
  ])("%s は設定されていないとみなして null", (_, value) => {
    expect(resolveRelayBaseUrl(value)).toBeNull();
  });
});

describe("createMonitorRelayUrl", () => {
  it("見守り画面は /rooms/<部屋の ID>?role=monitor につなぐ", () => {
    expect(createMonitorRelayUrl("wss://relay.example.com", "AbCdEf0123_-xyZQ")).toBe(
      "wss://relay.example.com/rooms/AbCdEf0123_-xyZQ?role=monitor",
    );
  });

  it("resolveRelayBaseUrl で末尾の / を落とした住所とつなぐと / が重ならない", () => {
    const base = resolveRelayBaseUrl("ws://localhost:8787/");
    expect(base).not.toBeNull();
    expect(createMonitorRelayUrl(base ?? "", "room1234")).toBe(
      "ws://localhost:8787/rooms/room1234?role=monitor",
    );
  });
});
