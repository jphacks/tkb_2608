// 生徒側で使う正解経路を校舎に入れる純粋な関数．教員が経路を決めていない（plan.drill.route が空の）校舎は，
// sim/ の提案で埋めてから Session.plan に書く．床の矢印・結果画面・評価が同じ経路を読むように，埋めるのは app/ のここだけにする
import type { SchoolPlan } from "../core/schoolPlan";
import { computeSpread, resolveReferenceRoute } from "../sim";

/**
 * plan.drill.route が空なら resolveReferenceRoute()（proposeRoute() の提案）の経路を入れた校舎を返す（SPEC_01「結果の評価」）．
 * 空でなければ同じ参照を返す．提案でもたどり着けない時は空のまま（同じ参照）返す
 */
export function withResolvedRoute(plan: SchoolPlan): SchoolPlan {
  if (plan.drill.route.length > 0) return plan;
  const { route } = resolveReferenceRoute(plan, computeSpread(plan));
  if (route.length === 0) return plan;
  return { ...plan, drill: { ...plan.drill, route } };
}
