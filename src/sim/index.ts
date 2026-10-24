// sim/ の公開窓口．延焼・正解経路の提案・評価・体験中のエラー行動の判定・壁の規則（すべて three.js・ブラウザ API に依存しない純粋な関数）

export {
  detectErrorBehaviors,
  type ErrorBehaviors,
  errorBehaviorsAt,
  isInSmoke,
  positionCell,
} from "./errorBehavior";
export {
  type EvaluateOptions,
  evaluateDrill,
  type ReferenceRoute,
  type ReferenceRouteSource,
  resolveReferenceRoute,
} from "./evaluate";
export {
  type CellXZ,
  cellCenter,
  cellIndex,
  isAdjacent,
  isInside,
  kindAt,
  NEIGHBOR_OFFSETS,
  worldToCell,
} from "./grid";
export * from "./params";
export { proposeRoute, type RouteOptions } from "./route";
export { computeSpread, isNearFire, type SpreadMap } from "./spread";
export {
  canPersonStep,
  canSpreadStep,
  isSpreadableKind,
  isWalkableKind,
  wallBetween,
} from "./walls";
