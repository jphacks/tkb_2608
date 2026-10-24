# 3D 空間の構成 (Scene Structure)

体験の舞台となる 3D 空間（部屋・電車・エレベーター）のコードの構成と，空間を追加する手順をまとめる．
部屋（リビング）・電車（通勤電車の車内）・エレベーター（乗用エレベーターのかご内）の 3 つを実装済み（Issue #22）．
画面の種類（`src/core/scene.ts` の `SceneId`: start / lobby / scenario / debrief）と区別するため，空間の型・関数は「Space」の名前で呼ぶ．

## ファイル構成 (Files)

| パス | 内容 |
| --- | --- |
| `src/main.ts` | URL パラメータで空間を選び，開始位置から一人称で描画する．PC 確認用にドラッグで視点を回す |
| `src/scenes/types.ts` | 空間の共通インターフェース（`Space`・`SpaceFactory`・`SpaceBuildOptions`） |
| `src/scenes/index.ts` | 実装済みの空間の一覧（`SPACE_FACTORIES`・`AVAILABLE_SPACE_IDS`）と `createSpace()` |
| `src/scenes/spaceParam.ts` | `?scene=` の解釈（`SpaceId`・`parseSpaceId()`・`resolveSpaceId()`） |
| `src/scenes/common/` | 空間をまたいで使う部品（乱数・手続きテクスチャ・壁の分割と壁の板・家具の Group・メッシュの生成と解放・`InstancedMesh` とジオメトリの結合・引き戸の扉の配置 `slidingDoor.ts`） |
| `src/scenes/room/` | 部屋（リビング）．`roomLayout.ts` に寸法と家具の定義（three 非依存），`room.ts` に組み立て |
| `src/scenes/train/` | 電車（通勤電車 1 両のうちドア 2 か所分）．`trainLayout.ts` に寸法・配置と userData の型（three 非依存），`train.ts` に組み立て，`trainFixtures.ts` に座席・手すり・つり革・ドア等の Group，`trainMaterials.ts`・`trainTextures.ts` に見た目 |
| `src/scenes/elevator/` | エレベーター（かご内と扉の外の乗り場）．`elevatorLayout.ts` に寸法・配置と userData の型（three 非依存），`elevator.ts` に組み立て，`elevatorFixtures.ts` に操作盤・ボタン・手すり・扉・階の表示・照明の Group，`elevatorMaterials.ts`・`elevatorTextures.ts` に見た目 |
| `src/controls/` | ドラッグで視点を回す操作（`lookAngles.ts` は純粋関数，`dragLook.ts` は Pointer Events） |

## 空間の共通インターフェース (Space)

各空間は `SpaceFactory`（`(options) => Space`）として作る．`root` を Scene に追加すれば照明も含めて表示できる．

| プロパティ | 内容 |
| --- | --- |
| `id` | `"room"` / `"train"` / `"elevator"` |
| `root` | 空間全体の `Group`（照明を含む） |
| `startPosition` | 開始時の目の位置（ワールド座標，m） |
| `startYaw` | 開始時の向き（rad．0 で -Z を向き，正で左へ回る） |
| `background` | Scene の背景色 |
| `dispose()` | ジオメトリ・マテリアル・テクスチャを解放する |

## 空間の切り替え (Space Selection)

- `?scene=room` のように URL パラメータで選ぶ．大文字小文字は区別しない
- 未実装の空間・不正な値・指定なしは `room` にフォールバックする
- 作るのは選んだ 1 つの空間だけ（`createSpace()` が選ばれた空間の `SpaceFactory` だけを呼ぶ）．他の空間は作らず描画もしない

## 空間を追加する手順 (Adding a Space)

1. `src/scenes/<id>/` を作り，寸法・配置の定数（three 非依存）と組み立て（`create<Id>Scene: SpaceFactory`）を分けて書く
2. `src/scenes/index.ts` の `SPACE_FACTORIES` に 1 行足す
3. 寸法・配置の定数は `roomLayout.test.ts` と同様に Vitest でテストする

## 後の機能のための構造 (Hooks for Later Features)

当たり判定・ドアの開閉・地震の物理演算を後から足せるよう，部屋は以下の形で作ってある．

- 家具は 1 つずつ独立した `Group`．`userData` に `{ id, kind, size, mass, anchored, mount, origin, tipRisk, restsOn }` を持つ（物理エンジンの剛体 1 つに対応させる想定）
- 床での占有範囲は `furnitureFootprint(group)`（回転後の外接 AABB）で求める
- テーブルは天板と脚を別の Mesh にしている（机の下に潜る当たり判定のため）
- 本は 1 冊ずつ Mesh（`bookshelf-book-N`）
- ドアはヒンジ位置を原点とする独立した `Group`（name `door`）．開閉に要る値は `userData`（`DoorUserData`）にある．壁はドアの開口部を空けて作っている

## 電車の構成 (Train)

`?scene=train` で表示する．寸法・配置はすべて `trainLayout.ts` の定数（車体の Group から見た座標）．

- 範囲: 長さ 10m（Z）× 幅 2.8m × 高さ 2.3m．床の中心が原点．-Z の端を「前」とし，前を向いて左が -X．両側面にドア 2 か所ずつ（中心 z=±2.4，開口 1.3m × 1.85m），ドア間に 7 人掛け，両端に 3 人掛けの優先席．両端は妻面で閉じ，前は非常扉，後ろは貫通扉（向こうは内側だけ描く箱でふさぐ）
- 目の高さ: `EYE_HEIGHT`（立ち 1.6m・しゃがみ 0.9m・着座 1.2m）
- 開始位置: 左の 2 番目のドア（`door-left-2`）の車端側の脇．すぐ左に縦の握り棒 `pole-door-left-2-rear`，足元の壁に非常用ドアコック `door-cock-2`
- 車外: 両側に街並みの板，左側にホームの床（`root` の直下．車体を動かしても動かない）

### 車体と個別の Group (Car Body & Parts)

`createTrainScene()` は `Space` に `parts`（`TrainParts`）を加えた `TrainSpace` を返す（`isTrainSpace(space)` で判定できる）．車体全体は `parts.carBody`（`root` の子）にまとまっており，揺れの演出ではこれを動かす．

| 一覧 | id の例 | kind | userData の主な欄 |
| --- | --- | --- | --- |
| `seats` | `seat-left-2` | `longSeat` / `prioritySeat` | `size`・`persons`・`slots`（着座位置と目の位置．座席のローカル座標）・`facingYaw` |
| `handrails` | `pole-door-left-2-rear`・`pole-seat-left-2`・`rail-left`・`emergency-door-handrail` | `handrail` | `orientation`（`vertical` / `horizontal`）・`grabbed` |
| `straps` | `strap-01` | `strap` | `railId`・`length`・`grabbed`．Group 原点が上端の支点（`rotation` で振り子状に揺らせる） |
| `doors` | `door-left-1`・`emergency-door`・`gangway-door-rear` | `sideDoor` / `emergencyDoor` / `gangwayDoor` | `width`・`height`・`leafIds`・`openStyle`・`open`．原点は開口部の下端中央，ローカル X が壁に沿う向き |
| `doorLeaves` | `door-left-1-a` | `doorLeaf` | `doorId`・`closedX`・`slideDirection`・`slideDistance`・`slideAxis`・`openAmount`．位置は `slidingLeafX()` で求める．扉は壁の外側（戸袋）を滑り，全開で開口部が全幅あく |
| `doorCocks` | `door-cock-2` | `doorCock` | `doorId`・`lidName`（蓋の子 Group）・`opened` |
| `intercoms` | `intercom-left-2` | `emergencyIntercom` | 家具と同じ欄 |
| `racks` / `luggage` | `rack-left-2` / `luggage-1` | `luggageRack` / `luggage` | 荷物は `restsOn` に網棚の id，`mass`・`shape` |

- 種類ごとの一覧に加え，`parts.byId` で id から引ける
- 状態の欄（`grabbed`・`open`・`openAmount`・`opened`）は今は初期値だけで，変える処理は後の Issue で作る
- つり革は頭上にあり手でつかむ判定はしない方針．数は描画負荷を見て控えめ（間隔 0.6m，32 本）

## エレベーターの構成 (Elevator)

`?scene=elevator` で表示する．寸法・配置はすべて `elevatorLayout.ts` の定数（かごの Group から見た座標．乗り場だけは `root` の座標）．

- 範囲: かご内 幅 2.0m（X）× 奥行 1.8m（Z）× 天井高 2.3m（15 人乗り程度）．床の中心が原点．正面（-Z）に中央開きの扉（開口 1.0m × 2.1m）．正面を向いて右が +X
- 目の高さ: `EYE_HEIGHT`（立ち 1.6m・しゃがみ 0.9m）
- 開始位置: かごの中央付近 (0, 1.6, 0.25) で扉（-Z）を向く．正面に扉と階の表示，左前に副の操作盤（中心が約 32°），右前に主の操作盤（扉側の端が約 42°，中心が約 51°）
- 操作盤: どちらも 1〜5 階・開・閉・非常連絡のボタン（直径 5.5cm（非常連絡は 6.5cm），中心の間隔 10cm 以上）．板にインターホンのスピーカーの格子と定員・積載量（15 名・1000kg）を描く．板の大きさとボタンの並びは操作盤ごとの `PanelLayout`（`HORIZONTAL_PANEL_LAYOUT`・`VERTICAL_PANEL_LAYOUT`）で決める
  - 主（`panel-main`）: 右の壁の扉寄り（正面の壁から 5cm）の横型．板 0.56m × 0.42m（高さ 0.94〜1.36m，中心 1.15m）．上の段（1.2m）に 1〜5 階を扉側から横一列，下の段（1.06m）に開・閉と，離して非常連絡
  - 副（`panel-sub`）: 正面の壁の扉の左（三方枠から 6cm）の縦型．板 0.24m × 0.78m（高さ 0.84〜1.62m）．左の列に 1〜5 階（0.97〜1.37m．縁まで 1.4m 以下），右の列に閉・開・非常連絡
- 手すり: 奥の壁と左右の壁（高さ 0.85m，壁から 5cm）．奥は x ±0.85，左は z ±0.7，右は主の操作盤より奥（z -0.14〜0.7）
- 天井: 照明パネル（点灯）と扉寄りの非常灯（消灯）．奥の壁に鏡（反射は描かず明るい板），天井の奥の隅に防犯カメラ（小さな半球）
- 扉の外: 乗り場（幅 3.6m（かごより両側 0.8m 広い）× 奥行 3.0m × 高さ 2.6m の閉じた部屋．床・壁・天井・三方枠・照明）を `root` 直下に置く．かごと乗り場のすき間は敷居と幕板でふさぎ，開いた扉の脇から外が覗けないようにしている

### かごと個別の Group (Cabin & Parts)

`createElevatorScene()` は `Space` に `parts`（`ElevatorParts`）を加えた `ElevatorSpace` を返す（`isElevatorSpace(space)` で判定できる）．かご全体は `parts.cabin`（`root` の子）にまとまっており，揺れ（`position`・`rotation`）と上昇・下降（`position.y`）の演出ではこれを動かす．乗り場（`parts.hall`）と環境光（`parts.ambient`）は `root` 直下なので動かない．

| 一覧 | id の例 | kind | userData の主な欄 |
| --- | --- | --- | --- |
| `panels` | `panel-main`・`panel-sub` | `controlPanel` | `role`（`main` / `sub`）・`layout`（`horizontal` / `vertical`）・`buttonIds`．原点は板の中心の壁面上，正面がローカル +Z |
| `buttons` | `panel-main-floor-1`・`panel-sub-open`・`panel-main-emergency-call` | `elevatorButton` | `panelId`・`action`（`floor` / `open` / `close` / `emergencyCall`）・`floor`・`faceName`・`pressed`・`lit`．同じ `action`（と `floor`）ならどちらの操作盤でも同じ操作として扱う |
| `handrails` | `handrail-rear`・`handrail-left`・`handrail-right` | `handrail` | `wall`・`grabbed`．原点は棒の中心，ローカル X が棒の向き |
| `doors` | `cabin-door` | `elevatorDoor` | `width`・`height`・`leafIds`・`open`・`openAmount`・`locked`（閉じ込め E2 用の開かない状態） |
| `doorLeaves` | `cabin-door-a`・`cabin-door-b` | `doorLeaf` | 電車と同じ形（`closedX`・`slideDirection`・`slideDistance`・`openAmount`）．位置は `slidingLeafX()`．扉は正面の壁の外側を滑り，三方枠（`door-frame`）とは別の構造 |
| `indicator` | `floor-indicator` | `floorIndicator` | `currentFloor`・`direction`（`up` / `down` / `none`）・`screenName`．表示は `setFloorIndicator(group, floor, direction)` で描き直す |
| `lights` | `ceiling-light`・`emergency-light` | `ceilingLight` / `emergencyLight` | `on`・`emergency`・`intensity`（点灯時の強さ）・`lightName`（`PointLight`）・`panelName`（発光の板） |

- 種類ごとの一覧に加え，`parts.byId` で id から引ける（`cabin`・`hall`・`surfaces` は除く）
- 床・壁・天井は `parts.surfaces`（`floor`・`ceiling`・`walls.front` / `right` / `rear` / `left`）で 1 面ずつ別の Mesh として引ける
- ボタンの点灯は `setElevatorButtonLit(button, lit, parts.buttonMaterials)` で面のマテリアル（消灯は Lambert，点灯は橙の Basic）を差し替える．ボタンの文字（数字・開閉の記号・非常連絡のベル）は 1 枚の canvas テクスチャに並べ，面の UV で切り分ける
- 照明の消灯は光源の `intensity` を 0 にする（`visible` の切り替えはシェーダーの作り直しで重い）．非常灯は既定で `intensity` 0
- 状態の欄（`pressed`・`lit`・`grabbed`・`open`・`openAmount`・`locked`・`on`）は今は初期値だけで，変える処理（押す・開閉・明滅・階の移動）は後の Issue で作る

## 性能上の方針 (Performance)

- マテリアルは `MeshLambertMaterial` を基本にする（iPhone の 2 画面描画で PBR より軽い）
- 箱形の部品は単位の `BoxGeometry` を共有し，`scale` で大きさを変える
- 影は使わない．`setPixelRatio` は 2 倍まで，異方性フィルタは 8 まで
- テクスチャは画像ファイルを使わず canvas で手続き生成する（シード固定で毎回同じ見た目）
- 部屋の Mesh 数はおよそ 150．重い場合は本を `InstancedMesh` にするのが次の候補
- 電車の Mesh 数（描画数）はおよそ 150．動かない部品（枠・支え・照明・広告・案内表示・窓ガラス）は材質ごとに `InstancedMesh`，壁は開口部を空けた片を 1 つのジオメトリに結合，形が同じ部品（扉の枠・座席・網棚）は結合したジオメトリを共有する．つり革（1 本 2 Mesh）が最も多いため，重い場合はまず本数を減らす
- エレベーターの Mesh 数（描画数）はおよそ 60（かご 55・乗り場 5）．ボタン（1 つ 2 Mesh × 16）が最も多い．ボタンのジオメトリ（ラベルごとの面・台座の円柱）とマテリアルは両方の操作盤で共有する．光源は環境光 1 つとかごの `PointLight` 2 つ（照明・非常灯）
