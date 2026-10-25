// 道具箱の「正解経路」の薄い殻（E5）．経路の道具・「経路を提案」・「経路を消す」のボタンと，経路の確かめの結果を出す．
// 操作は呼び出し側が editorState.ts の純粋な関数に渡し，確かめは routeCheck.ts の checkRoute で行う
import type { RouteCheck } from "./routeCheck";

/** 経路が空の時の表示（SPEC_01「結果の評価」．空なら生徒側では proposeRoute() の提案を使う） */
export const ROUTE_EMPTY_TEXT = "経路が未設定（生徒側では自動の提案を使う）";

/** 経路が空で，自動の提案でもたどり着けない時の注意 */
export const ROUTE_UNREACHABLE_WARNING =
  "今の校舎では自動の提案でも集合場所にたどり着けないため，QR コードは出せますが生徒側に正解経路（床の矢印・結果画面の線）が出ません";

/** 操作の受け渡し先 */
export interface RoutePanelOptions {
  /** 経路の道具を選んだ */
  readonly onSelectTool: () => void;
  /** 「経路を提案」を押した */
  readonly onSuggest: () => void;
  /** 「経路を消す」を押した */
  readonly onClear: () => void;
}

/** 正解経路の道具箱 */
export interface RoutePanel {
  /** 道具箱に置く要素 */
  readonly element: HTMLElement;
  /**
   * 道具の選択・経路の確かめの結果に合わせて表示を直す．routeLength は経路のマスの数．
   * unreachable は経路が空で自動の提案でもたどり着けないか（isEmptyRouteUnreachable の結果）
   */
  sync(selected: boolean, routeLength: number, check: RouteCheck, unreachable: boolean): void;
}

/** 道具箱を作る．toolButton は経路の道具のボタン（道具箱のほかの道具と同じ見た目にするため editor.ts が作って渡す） */
export function createRoutePanel(
  options: RoutePanelOptions,
  toolButton: HTMLButtonElement,
): RoutePanel {
  const element = document.createElement("div");
  const title = document.createElement("h2");
  title.textContent = "正解経路";
  const tools = document.createElement("div");
  tools.className = "editor__tools";
  tools.appendChild(toolButton);
  toolButton.addEventListener("click", () => options.onSelectTool());

  const actions = document.createElement("div");
  actions.className = "editor__row";
  const suggestButton = button("経路を提案");
  suggestButton.title = "延焼を見て，火と煙を避けた開始地点から集合場所までの経路を入れる";
  suggestButton.addEventListener("click", () => options.onSuggest());
  const clearButton = button("経路を消す");
  clearButton.addEventListener("click", () => options.onClear());
  actions.append(suggestButton, clearButton);

  const status = document.createElement("p");
  status.className = "editor__hint";
  const problems = document.createElement("p");
  problems.className = "editor__hint editor__warning";
  const hint = document.createElement("p");
  hint.className = "editor__hint";
  hint.textContent =
    "経路の道具で，経路の最後のマスの隣をクリック・ドラッグすると伸ばし，途中のマスをクリックするとそこまでに切り詰める．空の時は開始地点から始まる．壁をまたぐ一歩は置けない";
  element.append(title, tools, actions, status, problems, hint);

  function sync(
    selected: boolean,
    routeLength: number,
    check: RouteCheck,
    unreachable: boolean,
  ): void {
    toolButton.setAttribute("aria-pressed", String(selected));
    clearButton.disabled = check.empty;
    if (check.empty) {
      status.textContent = ROUTE_EMPTY_TEXT;
    } else {
      // 開始地点・集合場所から外れている時の文は check.problems に入っているので，ここでは整っている時だけ書く
      status.textContent =
        check.problems.length === 0
          ? `${routeLength} マス．開始地点から集合場所までつながっている`
          : `${routeLength} マス．次の問題がある`;
    }
    const warnings = check.empty && unreachable ? [ROUTE_UNREACHABLE_WARNING] : check.problems;
    problems.hidden = warnings.length === 0;
    problems.textContent = warnings.join("\n");
  }

  return { element, sync };
}

function button(text: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "editor__button";
  b.textContent = text;
  return b;
}
