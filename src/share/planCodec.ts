// SchoolPlan と URL の埋め込みデータ（`?app#p=<埋め込みデータ>`）の変換（SPEC_02「URL と QR への埋め込み」）．
// JSON（cells は 1 マス 1 文字，roomOf はランレングス）→ deflate-raw で圧縮 → base64url．ブラウザ API は CompressionStream だけを使う．
// JSON の段階（planToJson・planFromJson）は，ファイルと localStorage への保存（planFile.ts）でも使う
import type {
  CellRef,
  DrillMode,
  DrillSetup,
  Floor,
  PlanLoadError,
  PlanLoadFailureKind,
  Room,
  SchoolPlan,
  SpreadSettings,
} from "../core/schoolPlan";
import { base64UrlToBytes, bytesToBase64Url } from "./base64url";
import { cellsToChars, charsToCells } from "./cellChars";
import { validatePlan } from "./validatePlan";

/** このアプリが読める SchoolPlan の版 */
const SUPPORTED_VERSION = 1;

/**
 * 展開した JSON の大きさの上限（バイト）．QR に載る長さ（URL 全体で 1,500 文字が目安）から戻る大きさはずっと小さいため，
 * これを超えるものは壊れたデータか細工したデータとみなし，端末のメモリを使い切る前に打ち切る
 */
const MAX_DECODED_BYTES = 1024 * 1024;

/** decodePlan が失敗した理由の種類（core の PlanLoadFailureKind と同じもの） */
export type DecodePlanFailureKind = PlanLoadFailureKind;

/** decodePlan の結果．失敗しても例外は投げず，画面に出せる理由（PlanLoadError）を返す */
export type DecodePlanResult =
  | { readonly ok: true; readonly plan: SchoolPlan }
  | ({ readonly ok: false } & PlanLoadError);

/** URL・ファイルに載せる時の 1 フロア（cells は 1 マス 1 文字，roomOf は [値, 続く数, 値, 続く数, …]） */
export interface EncodedFloor {
  readonly level: number;
  readonly width: number;
  readonly depth: number;
  readonly cells: string;
  readonly roomOf: readonly number[];
}

/**
 * URL・ファイル・localStorage に書く時の SchoolPlan の JSON の形（cells は 1 マス 1 文字，roomOf はランレングス）．
 * 読み戻しは planFromJson で行う
 */
export interface PlanJson {
  readonly version: SchoolPlan["version"];
  readonly name: string;
  readonly cellSize: number;
  readonly floors: readonly EncodedFloor[];
  readonly rooms: readonly Room[];
  readonly drill: DrillSetup;
}

/** SchoolPlan を JSON に書ける形（PlanJson）にする．中身は確かめない */
export function planToJson(plan: SchoolPlan): PlanJson {
  return {
    version: plan.version,
    name: plan.name,
    cellSize: plan.cellSize,
    floors: plan.floors.map(
      (floor): EncodedFloor => ({
        level: floor.level,
        width: floor.width,
        depth: floor.depth,
        cells: cellsToChars(floor.cells),
        roomOf: toRunLength(floor.roomOf),
      }),
    ),
    rooms: plan.rooms.map((room) => ({ name: room.name })),
    drill: plan.drill,
  };
}

/**
 * planFromJson の結果．invalidPlan の時は形は読めているので，校舎（plan）と誤りの一覧（errors）も持つ
 * （エディタは誤りのある校舎も開き，誤りを画面に出すため）
 */
export type PlanJsonResult =
  | { readonly ok: true; readonly plan: SchoolPlan }
  | {
      readonly ok: false;
      readonly kind: "invalidPlan";
      readonly reason: string;
      readonly plan: SchoolPlan;
      readonly errors: readonly string[];
    }
  | {
      readonly ok: false;
      readonly kind: Exclude<PlanLoadFailureKind, "invalidPlan">;
      readonly reason: string;
    };

/**
 * JSON.parse した値（PlanJson の形のはず）を SchoolPlan に戻し，版・形・中身（validatePlan）を確かめる．
 * 例外は投げない．URL の埋め込みデータ（decodePlan）・ファイル・localStorage の読み込みで同じ検査を使う
 */
export function planFromJson(json: unknown): PlanJsonResult {
  if (isRecord(json) && typeof json.version === "number" && json.version > SUPPORTED_VERSION) {
    return {
      ok: false,
      kind: "unsupportedVersion",
      reason: "このデータは新しい版のアプリで作られています．新しい版のアプリで開いてください",
    };
  }

  let plan: SchoolPlan;
  try {
    plan = parsePlan(json);
  } catch (error) {
    if (error instanceof ShapeError) {
      return {
        ok: false,
        kind: "corrupted",
        reason: `校舎のデータの形が正しくありません（${error.path}）`,
      };
    }
    throw error;
  }

  const errors = validatePlan(plan);
  if (errors.length > 0) {
    const rest = errors.length > 1 ? `（ほか ${errors.length - 1} 件）` : "";
    return { ok: false, kind: "invalidPlan", reason: `${errors[0]}${rest}`, plan, errors };
  }
  return { ok: true, plan };
}

/** SchoolPlan を埋め込みデータ（base64url の文字列．`#p=` の後ろに置く）にする */
export async function encodePlan(plan: SchoolPlan): Promise<string> {
  const json = JSON.stringify(planToJson(plan));
  const compressed = await readAll(
    streamOf(new TextEncoder().encode(json)).pipeThrough(new CompressionStream("deflate-raw")),
    Number.POSITIVE_INFINITY,
  );
  return bytesToBase64Url(compressed ?? new Uint8Array());
}

/**
 * 埋め込みデータを SchoolPlan に戻し，validatePlan で中身を確かめる．
 * 壊れている・未知の版・中身が誤っている時は，例外を投げず理由つきの失敗を返す
 */
export async function decodePlan(text: string): Promise<DecodePlanResult> {
  const compressed = base64UrlToBytes(text);
  if (compressed === null || compressed.length === 0) {
    return corrupted("データの文字が途中で欠けているか，読み取れない文字が入っています");
  }

  let decompressed: Uint8Array | null;
  try {
    decompressed = await readAll(
      streamOf(compressed).pipeThrough(new DecompressionStream("deflate-raw")),
      MAX_DECODED_BYTES,
    );
  } catch {
    return corrupted("データが途中で欠けているか，壊れています");
  }
  if (decompressed === null) return corrupted("データが大きすぎます");

  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decompressed));
  } catch {
    return corrupted("データの中身を読み取れません");
  }

  const result = planFromJson(json);
  // URL の読み込みでは誤りのある校舎を使わないので，校舎と誤りの一覧は渡さない
  if (!result.ok) return { ok: false, kind: result.kind, reason: result.reason };
  return result;
}

const corrupted = (reason: string): DecodePlanResult => ({ ok: false, kind: "corrupted", reason });

/** [値, 続く数, 値, 続く数, …] にする（教室の割り当ては同じ値が横に長く続くため） */
function toRunLength(values: readonly number[]): number[] {
  const runs: number[] = [];
  for (const value of values) {
    if (runs.length > 0 && runs[runs.length - 2] === value) {
      runs[runs.length - 1]++;
    } else {
      runs.push(value, 1);
    }
  }
  return runs;
}

/** バイト列を 1 回だけ流すストリーム */
function streamOf(bytes: Uint8Array<ArrayBuffer>): ReadableStream<BufferSource> {
  return new ReadableStream<BufferSource>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

/** ストリームを最後まで読んで 1 つのバイト列にする．maxBytes（バイト）を超えたら読むのをやめて null を返す */
async function readAll(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<Uint8Array | null> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

/** JSON の形が SchoolPlan に合わない時に parsePlan の中だけで使う．path はどこが合わないか（開発者が調べるための手がかり） */
class ShapeError extends Error {
  constructor(readonly path: string) {
    super(`unexpected shape at ${path}`);
  }
}

type JsonRecord = Readonly<Record<string, unknown>>;

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function recordAt(value: unknown, path: string): JsonRecord {
  if (!isRecord(value)) throw new ShapeError(path);
  return value;
}

function arrayAt(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new ShapeError(path);
  return value;
}

/** 数（NaN・Infinity は JSON に書けないため，ここでは有限の数だけが来る．範囲は validatePlan が確かめる） */
function numberAt(value: unknown, path: string): number {
  if (typeof value !== "number") throw new ShapeError(path);
  return value;
}

function stringAt(value: unknown, path: string): string {
  if (typeof value !== "string") throw new ShapeError(path);
  return value;
}

/**
 * JSON を SchoolPlan に組み立てる．型が違う項目は ShapeError を投げる．
 * 知らない項目は捨て，SchoolPlan の項目だけで新しく組み立てる（呼ぶ側に余計なものを渡さない）
 */
function parsePlan(json: unknown): SchoolPlan {
  const root = recordAt(json, "全体");
  if (root.version !== SUPPORTED_VERSION) throw new ShapeError("version");
  const rooms = arrayAt(root.rooms, "rooms").map(
    (room, i): Room => ({ name: stringAt(recordAt(room, `rooms[${i}]`).name, `rooms[${i}].name`) }),
  );
  return {
    version: SUPPORTED_VERSION,
    name: stringAt(root.name, "name"),
    cellSize: numberAt(root.cellSize, "cellSize"),
    floors: arrayAt(root.floors, "floors").map((floor, i) => parseFloor(floor, `floors[${i}]`)),
    rooms,
    drill: parseDrill(root.drill),
  };
}

function parseFloor(value: unknown, path: string): Floor {
  const floor = recordAt(value, path);
  const level = numberAt(floor.level, `${path}.level`);
  const width = numberAt(floor.width, `${path}.width`);
  const depth = numberAt(floor.depth, `${path}.depth`);
  const cells = charsToCells(stringAt(floor.cells, `${path}.cells`));
  if (cells === null) throw new ShapeError(`${path}.cells`);
  // ランレングスを広げる前にマスの数と比べ，細工した大きな続く数で配列を作りすぎないようにする
  if (!(Number.isInteger(width) && Number.isInteger(depth) && cells.length === width * depth)) {
    throw new ShapeError(`${path}.cells`);
  }
  const roomOf = fromRunLength(
    arrayAt(floor.roomOf, `${path}.roomOf`),
    cells.length,
    `${path}.roomOf`,
  );
  return { level, width, depth, cells, roomOf };
}

/** [値, 続く数, …] を広げる．続く数の合計が count と違う時は ShapeError */
function fromRunLength(runs: readonly unknown[], count: number, path: string): number[] {
  if (runs.length % 2 !== 0) throw new ShapeError(path);
  const values: number[] = [];
  for (let i = 0; i < runs.length; i += 2) {
    const value = numberAt(runs[i], `${path}[${i}]`);
    const length = numberAt(runs[i + 1], `${path}[${i + 1}]`);
    if (!(Number.isInteger(length) && length > 0 && values.length + length <= count)) {
      throw new ShapeError(`${path}[${i + 1}]`);
    }
    for (let k = 0; k < length; k++) values.push(value);
  }
  if (values.length !== count) throw new ShapeError(path);
  return values;
}

function parseCellRef(value: unknown, path: string): CellRef {
  const ref = recordAt(value, path);
  return {
    floor: numberAt(ref.floor, `${path}.floor`),
    x: numberAt(ref.x, `${path}.x`),
    z: numberAt(ref.z, `${path}.z`),
  };
}

function parseDrill(value: unknown): DrillSetup {
  const drill = recordAt(value, "drill");
  const mode = drill.mode;
  if (mode !== "learn" && mode !== "test") throw new ShapeError("drill.mode");
  const refs = (key: string): CellRef[] =>
    arrayAt(drill[key], `drill.${key}`).map((ref, i) => parseCellRef(ref, `drill.${key}[${i}]`));
  return {
    mode: mode satisfies DrillMode,
    fireOrigins: refs("fireOrigins"),
    start: parseCellRef(drill.start, "drill.start"),
    startYaw: numberAt(drill.startYaw, "drill.startYaw"),
    assembly: refs("assembly"),
    route: refs("route"),
    spread: parseSpread(drill.spread),
    timeLimitSeconds: numberAt(drill.timeLimitSeconds, "drill.timeLimitSeconds"),
  };
}

function parseSpread(value: unknown): SpreadSettings {
  const spread = recordAt(value, "drill.spread");
  return {
    fireSecondsPerCell: numberAt(spread.fireSecondsPerCell, "drill.spread.fireSecondsPerCell"),
    smokeSecondsPerCell: numberAt(spread.smokeSecondsPerCell, "drill.spread.smokeSecondsPerCell"),
    extraFires: arrayAt(spread.extraFires, "drill.spread.extraFires").map((fire, i) => {
      const path = `drill.spread.extraFires[${i}]`;
      const record = recordAt(fire, path);
      return {
        cell: parseCellRef(record.cell, `${path}.cell`),
        atSeconds: numberAt(record.atSeconds, `${path}.atSeconds`),
      };
    }),
  };
}
