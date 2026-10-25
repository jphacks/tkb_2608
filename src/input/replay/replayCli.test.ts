// 記録の再生と集計のコマンド（replayCli.ts・loadLogs.ts）を一時フォルダの小さな記録で確かめる
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { InputRecord } from "../recorder/records";
import { listLogFiles, loadLabeledRecordings, loadRecordings } from "./loadLogs";
import { parseCliArgs, REPLAY_USAGE, runReplayCli } from "./replayCli";
import { labelPair, restRecords, steppingRecords } from "./testRecords";

const jsonl = (records: readonly InputRecord[]) =>
  `${records.map((r) => JSON.stringify(r)).join("\n")}\n`;

describe("parseCliArgs", () => {
  it("引数が無ければ既定（default の組あり・記録は省略）", () => {
    expect(parseCliArgs([])).toMatchObject({
      paths: [],
      setSpecs: [],
      includeDefault: true,
      segments: false,
      unlabeled: false,
      slice: null,
      help: false,
      errors: [],
    });
  });

  it("オプションと記録のパスを読む（--set は何度でも）", () => {
    const o = parseCliArgs([
      "a.jsonl",
      "--set",
      "x:zuptMs=1",
      "--set",
      "y:zuptMs=2",
      "--sets",
      "s.json",
      "--no-default",
      "--segments",
      "--unlabeled",
      "dir",
    ]);
    expect(o).toMatchObject({
      paths: ["a.jsonl", "dir"],
      setSpecs: ["x:zuptMs=1", "y:zuptMs=2"],
      setsFiles: ["s.json"],
      includeDefault: false,
      segments: true,
      unlabeled: true,
      errors: [],
    });
  });

  it.each([["-h"], ["--help"]])("%s で使い方", (a) => {
    expect(parseCliArgs([a]).help).toBe(true);
  });

  it("--slice は ファイル・始まり秒・終わり秒", () => {
    expect(parseCliArgs(["--slice", "f.jsonl", "1.5", "3"]).slice).toEqual({
      file: "f.jsonl",
      fromSec: 1.5,
      toSec: 3,
    });
  });

  it.each([
    [["--slice", "f", "3", "1"]],
    [["--slice", "f", "a", "1"]],
    [["--slice", "f", "1", "1"]],
  ])("--slice の秒が不正（%j）なら errors", (argv) => {
    const o = parseCliArgs(argv);
    expect(o.slice).toBeNull();
    expect(o.errors).toHaveLength(1);
  });

  it("--calib 等の既定は無効・空", () => {
    expect(parseCliArgs([])).toMatchObject({ calib: false, calibScales: [], calibMsSpecs: [] });
  });

  it("--calib・--calib-scale（カンマ区切り）・--calib-ms（何度でも）を読む", () => {
    const o = parseCliArgs([
      "a.jsonl",
      "--calib",
      "--calib-scale",
      "0.5, 2",
      "--calib-scale",
      "3",
      "--calib-ms",
      "long:crouchWalk=8000",
      "--calib-ms",
      "stand=1000",
    ]);
    expect(o).toMatchObject({
      paths: ["a.jsonl"],
      calib: true,
      calibScales: [0.5, 2, 3],
      calibMsSpecs: ["long:crouchWalk=8000", "stand=1000"],
      errors: [],
    });
  });

  it.each([["0"], ["-1"], ["abc"], ["NaN"], ["Infinity"], [""]])(
    "--calib-scale の不正な倍率（%j）は errors に入れ，正しいものだけ使う",
    (bad) => {
      const o = parseCliArgs(["--calib-scale", `2,${bad}`]);
      expect(o.calibScales).toEqual([2]);
      expect(o.errors).toHaveLength(1);
    },
  );

  it("値の無い --calib-scale・--calib-ms は errors", () => {
    expect(parseCliArgs(["--calib-scale"]).errors).toContain("--calib-scale の値がありません");
    expect(parseCliArgs(["--calib-scale"]).calibScales).toEqual([]);
    expect(parseCliArgs(["--calib-ms"]).errors).toEqual(["--calib-ms の値がありません"]);
  });

  it("値の無い --set・知らないオプションは errors", () => {
    expect(parseCliArgs(["--set"]).errors).toEqual(["--set の値がありません"]);
    expect(parseCliArgs(["--foo"]).errors).toEqual(["知らないオプション: --foo"]);
  });
});

describe("loadLogs・runReplayCli（一時フォルダ）", () => {
  let dir = "";
  const labeled = jsonl([
    ...labelPair("still", 0, 0, 2000),
    ...labelPair("step_in_place", 1, 2000, 5000),
    ...restRecords(0, 2000),
    ...steppingRecords(2000, 3000),
    ...restRecords(5000, 2000),
  ]);
  const unlabeled = jsonl([...restRecords(0, 1000), ...steppingRecords(1000, 2000)]);

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "replay-cli-test-"));
    await writeFile(path.join(dir, "b_labeled.jsonl"), labeled);
    await writeFile(path.join(dir, "a_unlabeled.jsonl"), unlabeled);
    await writeFile(path.join(dir, "note.txt"), "x");
  });
  afterAll(async () => {
    if (dir !== "") await rm(dir, { recursive: true, force: true });
  });

  it("listLogFiles は .jsonl だけを名前の順に返し，無いフォルダは空", async () => {
    expect((await listLogFiles(dir)).map((f) => path.basename(f))).toEqual([
      "a_unlabeled.jsonl",
      "b_labeled.jsonl",
    ]);
    expect(await listLogFiles(path.join(dir, "missing"))).toEqual([]);
  });

  it("loadRecordings は読めないファイルを飛ばし，名前は拡張子を除いたもの", async () => {
    const recs = await loadRecordings([
      path.join(dir, "a_unlabeled.jsonl"),
      path.join(dir, "missing.jsonl"),
    ]);
    expect(recs.map((r) => r.name)).toEqual(["a_unlabeled"]);
  });

  it("loadLabeledRecordings は正解付きで完了した区間のある記録だけ", async () => {
    expect((await loadLabeledRecordings(dir)).map((r) => r.name)).toEqual(["b_labeled"]);
    expect(await loadLabeledRecordings(path.join(dir, "missing"))).toEqual([]);
  });

  it("フォルダを渡すと中の記録を集計し，正解付きの記録の表を出す", async () => {
    const out = await runReplayCli([
      dir,
      "--set",
      "high:stepHighStanding=100",
      "--segments",
      "--unlabeled",
    ]);
    expect(out).toContain("記録 2 件（正解付き 1 件）× しきい値 2 組: default, high");
    expect(out).toContain("== b_labeled（正解付き）");
    expect(out).toContain("-- b_labeled × default");
    expect(out).toContain("a_unlabeled");
  });

  it("正解付きの記録が無ければそう伝える", async () => {
    const out = await runReplayCli([path.join(dir, "a_unlabeled.jsonl")]);
    expect(out).toContain("正解付きの記録（protocol.html で取ったもの）がありません");
  });

  it("--set の誤りは結果の前に出す", async () => {
    const out = await runReplayCli([dir, "--set", "x:foo=1"]);
    expect(out.split("\n")[0]).toBe("--set x:foo=1: 知らない項目: foo");
  });

  it("--no-default で組が無ければそう伝える", async () => {
    expect(await runReplayCli([dir, "--no-default"])).toBe("比べるしきい値の組がありません");
  });

  it("--calib で calib の列とキャリブレーションの表を足す（--no-default でも組になる）", async () => {
    const out = await runReplayCli([
      path.join(dir, "b_labeled.jsonl"),
      "--no-default",
      "--calib",
      "--calib-scale",
      "2",
      "--calib-ms",
      "long:stand=1000",
    ]);
    expect(out).toContain("× しきい値 3 組: calib, calib×2, long");
    expect(out).toContain("-- b_labeled のキャリブレーション");
    expect(out).not.toContain("比べるしきい値の組がありません");
  });

  it("--calib-ms の誤りは結果の前に出す", async () => {
    const out = await runReplayCli([dir, "--calib-ms", "x:walk=1"]);
    expect(out.split("\n")[0]).toContain("--calib-ms x:walk=1: 知らない区間: walk");
  });

  it("--help・引数の誤りは使い方を返す（例外にしない）", async () => {
    expect(await runReplayCli(["--help"])).toBe(REPLAY_USAGE);
    expect(await runReplayCli(["--foo"])).toContain(REPLAY_USAGE);
  });

  it("--slice は記録の始まりからの秒で切り出す", async () => {
    const out = await runReplayCli(["--slice", path.join(dir, "b_labeled.jsonl"), "1", "2"]);
    const rows = out
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as { type: string; t: number });
    expect(rows.every((r) => r.t >= 1000 && r.t <= 2000)).toBe(true);
    expect(rows.some((r) => r.type === "label")).toBe(true);
  });
});
