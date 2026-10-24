// sim/ の計算で使う目安の値．仕様（SPEC_01「VR 避難の規則」「結果の評価」）にある値と，仕様に無く仮に決めた値を
// ここに集める．仮の値はデモの校舎で歩いて決め直す

// ---- 評価（SPEC_01「結果の評価」の値） ----

/** 燃えているマスからこのマス数以内（斜めも 1 マスと数える）に入ったら「火に近づいた」とする */
export const NEAR_FIRE_CELLS = 1;

/** 正解経路のマスからこのマス数より離れたら（斜めも 1 マスと数える）「外れた」とする */
export const OFF_ROUTE_CELLS = 1;

/** 煙の中でしゃがんでいた割合がこれ以上なら「できた」とする（0〜1） */
export const SMOKE_CROUCH_GOOD_RATIO = 0.7;

// ---- 評価（仕様に無く仮に決めた値） ----

/**
 * 記録の間隔がこれより空いた時（s），その間の時間はこの秒数までしか数えない．
 * 端末が一時的に止まった時に，その前の姿勢が長く続いたことにしないため
 */
export const TRACK_MAX_SAMPLE_GAP_SECONDS = 1;

// ---- 経路の提案（仕様に無く仮に決めた値） ----

/** 経路の提案で，避難を始める時刻（非常ベルからの秒数．s）．② の非常ベルと校内放送の最長の 8 秒 */
export const ROUTE_DEPART_SECONDS = 8;

/** 経路の提案で見込む歩く速さ（m/s）．足踏みの 1.0 m/s に校舎用の倍率 1.5 を掛けたもの */
export const ROUTE_WALK_SPEED = 1.5;

/** 経路の提案で，煙の着いたマスを 1 つ通ることを，何マス余計に歩くことと同じに見るか */
export const ROUTE_SMOKE_PENALTY_CELLS = 5;

/** 経路の提案で，燃えているマスの 1 マス以内を 1 つ通ることを，何マス余計に歩くことと同じに見るか */
export const ROUTE_NEAR_FIRE_PENALTY_CELLS = 10;

/**
 * 経路の提案で，着いた時刻からこの秒数（s）以内に燃えるマスには入らない（安全の余裕）．
 * この余裕では集合場所に着けない時は，余裕なし（着いた時刻に燃えていなければ入る）で探し直す
 */
export const ROUTE_FIRE_MARGIN_SECONDS = 10;

/**
 * 経路の提案で，「火の側」とみなす先読みの秒数（s）．着いた時刻からこの秒数のうちに燃えるマスを，
 * 火の側を避ける重み（ROUTE_FIRE_SIDE_*）の基準にする．延焼は 1 マス 6 秒が既定なので，30 秒でおよそ 5 マス先まで
 */
export const ROUTE_FIRE_SIDE_LOOKAHEAD_SECONDS = 30;

/** 経路の提案で，先読みで燃えるマスからこのマス数以内（斜めも 1 マスと数える）を「火の側」とする */
export const ROUTE_FIRE_SIDE_RANGE_CELLS = 3;

/**
 * 経路の提案で，「火の側」のマスを 1 つ通ることを，何マス余計に歩くことと同じに見るか．
 * 先読みで燃えるマスに近いほど重く，距離 d（0〜RANGE）のマスに (RANGE + 1 - d) 倍を足す
 */
export const ROUTE_FIRE_SIDE_PENALTY_CELLS = 3;
