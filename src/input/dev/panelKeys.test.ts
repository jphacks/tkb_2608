// 操作盤のキーと印の種類（ENV_04「操作盤（PC）」・experiment_山﨑/10「印の付け方」）
import { describe, expect, it } from "vitest";
import { MARK_KIND_PATTERN } from "../recorder/logProtocol";
import { MARK_KINDS, markKindForCode } from "./panelKeys";

describe("markKindForCode", () => {
  it.each([
    ["Digit1", "false-walk", "歩いていないのに進んだ"],
    ["Digit2", "missed-walk", "歩いたのに進まない"],
    ["Digit3", "false-stand", "立っていないのに立った"],
    ["Digit4", "hand-glitch", "手が震えた・消えた"],
    ["Space", "other", "その他"],
  ])("%s → %s（%s）", (code, kind, title) => {
    expect(markKindForCode(code)).toMatchObject({ kind, title });
  });

  it.each([
    ["Numpad1", "false-walk"],
    ["Numpad2", "missed-walk"],
    ["Numpad3", "false-stand"],
    ["Numpad4", "hand-glitch"],
  ])("テンキーの %s も同じ印（%s）", (code, kind) => {
    expect(markKindForCode(code)?.kind).toBe(kind);
  });

  it.each([
    "Digit0",
    "Digit5",
    "Numpad0",
    "Numpad5",
    "Numpad10",
    "KeyA",
    "Enter",
    "",
    "digit1",
    "1",
  ])("印のキーでない（%j）なら null", (code) => {
    expect(markKindForCode(code)).toBeNull();
  });
});

describe("MARK_KINDS", () => {
  it("種類は記録に書ける書式で，キーと種類は重ならない", () => {
    for (const k of MARK_KINDS) expect(k.kind).toMatch(MARK_KIND_PATTERN);
    expect(new Set(MARK_KINDS.map((k) => k.code)).size).toBe(MARK_KINDS.length);
    expect(new Set(MARK_KINDS.map((k) => k.kind)).size).toBe(MARK_KINDS.length);
  });
});
