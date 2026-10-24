# 3D 空間の構成 (Scene Structure)

体験の舞台となる 3D 空間（部屋・電車・エレベーター）のコードの構成と，空間を追加する手順をまとめる．
部屋（リビング）・電車（通勤電車の車内）・エレベーター（乗用エレベーターのかご内）の 3 つを実装済み（Issue #22）．校舎は，パーツ（教室・廊下・壁・ドア・出口・防火シャッター）と，それを並べて見る確認用の空間 `school-parts` まで実装済み（Issue #73）．マス目データ（`SchoolPlan`）からの組み立ては後の Issue で作る．
画面の種類（`src/core/scene.ts` の `SceneId`: start / lobby / scenario / debrief）と区別するため，空間の型・関数は「Space」の名前で呼ぶ．

## ファイル構成 (Files)

| パス | 内容 |
| --- | --- |
| `src/main.ts` | URL パラメータで空間を選び，開始位置から一人称で描画する．確認用の仮の入力（ドラッグで視点・画面のボタンで歩く／しゃがむ／ドア）を `SpaceWalker` につなぎ，エリアの出入りをイベントバスに流す（`app/` ができるまでの暫定）．`?input=mock\|device` を付けた時は，ボタン・ドラッグの代わりに担当D の入力（`createInputSource()` の `PlayerInput`）を同じ `SpaceWalker` に渡す（どちらも当たり判定あり．rig・walker・確認用のドアの組み立ては `setupWalk()` で共通） |
| `src/inputPreview.ts` | `?input=` を付けた時の入力の確認用の殻．`InputSource`（`src/input/inputSource.ts`）から `PlayerInput` を読み（`read()`），画面の左上に `PlayerInput` の中身と歩行の状態（位置・目の高さ・エリア・直前の出入り・近くのドア）を出す（`show()`）．`device` ではタップでセンサーの許可を取り，E キーで近くのドアを開閉する（確認用）．カメラ・移動には触れない |
| `src/scenes/types.ts` | 空間の共通インターフェース（`Space`・`SpaceFactory`・`SpaceBuildOptions`） |
| `src/scenes/index.ts` | 実装済みの空間の一覧（`SPACE_FACTORIES`・`AVAILABLE_SPACE_IDS`）と `createSpace()` |
| `src/scenes/spaceParam.ts` | `?scene=` の解釈（`SpaceId`・`parseSpaceId()`・`resolveSpaceId()`） |
| `src/scenes/common/` | 空間をまたいで使う部品（乱数・手続きテクスチャ・壁の分割と壁の板・家具の Group・メッシュの生成と解放・`InstancedMesh` とジオメトリの結合・引き戸の扉の配置 `slidingDoor.ts`） |
| `src/scenes/room/` | 部屋（リビング・シナリオ H1）．`roomLayout.ts` に寸法・配置・エリアと userData の型（three 非依存），`room.ts` に組み立て（部屋の殻・窓ガラス・ドア・廊下），`roomFurniture.ts` に家具の Group（テーブルの脚・コンロのつまみと火・ブレーカーのスイッチを含む），`roomMaterials.ts` に見た目 |
| `src/scenes/train/` | 電車（通勤電車 1 両のうちドア 2 か所分）．`trainLayout.ts` に寸法・配置と userData の型（three 非依存），`train.ts` に組み立て，`trainFixtures.ts` に座席・手すり・つり革・ドア等の Group，`trainMaterials.ts`・`trainTextures.ts` に見た目 |
| `src/scenes/elevator/` | エレベーター（かご内と扉の外の乗り場）．`elevatorLayout.ts` に寸法・配置と userData の型（three 非依存），`elevator.ts` に組み立て，`elevatorFixtures.ts` に操作盤・ボタン・手すり・扉・階の表示・照明の Group，`elevatorMaterials.ts`・`elevatorTextures.ts` に見た目 |
| `src/scenes/school/` | 校舎のパーツと確認用の空間（`?scene=school-parts`）．`routeArrowsLayout.ts`・`routeArrows.ts` に床の正解経路の矢印，`dev/` に確認用のページ．`schoolLayout.ts` に床の面・辺の物・柱の寸法と当たり判定の範囲，`classroomLayout.ts` に教室の中身の並び，`schoolPartsPreviewLayout.ts` に確認用の空間に並べる一覧（いずれも three 非依存），`schoolParts.ts`・`classroom.ts` に組み立て，`schoolMerge.ts` に動かない Mesh の結合，`schoolPartsCollision.ts` に当たり判定の取り出し，`schoolMaterials.ts`・`schoolTextures.ts` に見た目．詳細は「校舎のパーツの構成」 |
| `src/scenes/walk/` | 歩行と当たり判定（three 非依存の純粋関数）．`collision.ts` に当たり判定，`areas.ts` にエリアの判定，`obstacles.ts`・`furnitureObstacles.ts` に障害物の生成，`locomotion.ts` に 1 フレーム分の移動（`stepWalk`），`walker.ts` に `ScenarioWorld` の実装（`SpaceWalker`） |
| `src/scenes/<id>/<id>Walk.ts` | 各空間の `WalkWorld`（床の範囲・障害物・ドア・エリア・座席）．`createWalkWorld(space)`（`index.ts`）で作る |
| `src/scenes/devDoors.ts` | 確認用: 近くのドアを開閉する（本物のドア開閉が入るまでのデバッグ用） |
| `src/controls/` | 確認用の仮の入力．ドラッグで視点を回す操作（`lookAngles.ts` は純粋関数，`dragLook.ts` は Pointer Events），画面のボタン（`walkButtons.ts`）と，その状態から `PlayerInput` を作る純粋関数（`devInput.ts`）．本物の検知（`src/input/`）が入ったら差し替える |

## 空間の共通インターフェース (Space)

各空間は `SpaceFactory`（`(options) => Space`）として作る．`root` を Scene に追加すれば照明も含めて表示できる．

| プロパティ | 内容 |
| --- | --- |
| `id` | `"room"` / `"train"` / `"elevator"` / `"school-parts"` |
| `root` | 空間全体の `Group`（照明を含む） |
| `startPosition` | 開始時の目の位置（ワールド座標，m） |
| `startYaw` | 開始時の向き（rad．0 で -Z を向き，正で左へ回る） |
| `background` | Scene の背景色 |
| `dispose()` | ジオメトリ・マテリアル・テクスチャを解放する |

## 空間の切り替え (Space Selection)

- `?scene=room` のように URL パラメータで選ぶ．大文字小文字は区別しない
- 未実装の空間・不正な値・指定なしは `room` にフォールバックする
- 作るのは選んだ 1 つの空間だけ（`createSpace()` が選ばれた空間の `SpaceFactory` だけを呼ぶ）．他の空間は作らず描画もしない

## 入力の切り替え (Input Selection)

- `?input=mock` は PC のキーボードとマウス（W: 歩く・S: ゆっくり歩く・C: しゃがみの切り替え・ドラッグ: 頭の向き），`?input=device` はスマホのセンサー（画面のタップで許可）で動かす．使い方は [ENV_04](../02_ENV/ENV_04_開発コマンド.md)「開発」
- 指定なし・不正な値は，ドラッグで視点・画面のボタンで歩く確認用の仮の入力で `SpaceWalker` を動かす（`parseInputKind()` が `null` を返す）
- `?input=` を付けた時も同じ `SpaceWalker` に `PlayerInput` を渡すため，壁・家具・閉じたドアに当たって止まり，しゃがむと机の下に入れる．画面のボタンとドラッグの視点操作（`DragLook`）は出さない（`mock` のドラッグは `src/input/` のモックが受ける）．確認用のドアの開閉は E キー（PC のみ．スマホでは開閉できない）
- 頭の向き（`PlayerInput.head`）は正面リセット済み（`device` は最初に受け取った向き，`mock` はドラッグの開始の向きが正面）のため，体の向きから見た値として扱う．rig の向きを空間の `startYaw` にし，その子のカメラに `head` をそのまま入れる．`SpaceWalker` は `startYaw` ＋ 頭のヨーの向きへ進むので，空間の開始の向きを向いて始まり，頭を向けた方向へ歩く（ボタン歩行の `DragLook` と同じ扱い）
- `src/main.ts` は `src/input/` のうち `inputParam.ts`（`?input=` の解釈）と `inputSource.ts`（入力の入口）だけを import する．フライトレコーダーと dev ページ（`src/input/recorder/`・`src/input/dev/`）は本番のビルドに入れない

## 空間を追加する手順 (Adding a Space)

1. `src/scenes/<id>/` を作り，寸法・配置の定数（three 非依存）と組み立て（`create<Id>Scene: SpaceFactory`）を分けて書く
2. `src/scenes/index.ts` の `SPACE_FACTORIES` に 1 行足す
3. 寸法・配置の定数は `roomLayout.test.ts` と同様に Vitest でテストする

## 部屋の構成 (Room)

`?scene=room`（既定）で表示する．シナリオ H1 で使う物が揃う配置にしてある．寸法・配置はすべて `roomLayout.ts` の定数（`root` から見た座標．部屋の殻と家具の Group は原点に置くため，揺らしていない時はワールド座標と同じ）．

- 範囲: 6m（X）× 5m（Z）× 高さ 2.4m．床の中心が原点．窓は -Z（北）の壁，廊下へ出るドアは +Z（南）の壁，キッチンは +X（東）の壁，テレビは -X（西）の壁
- 目の高さ: `EYE_HEIGHT`（立ち 1.6m・しゃがみ 0.55m）．しゃがみはテーブルの下に頭が収まるよう，天板の下面（0.68m）より低くしている（電車・エレベーターの 0.9m とは別）
- 開始位置: 居間の中央付近 (-0.6, 1.6, 0.2) で +X（奥のコンロ）を向く（`startYaw` = -π/2）．正面 0.85m 先にテーブル，その奥（3m 先）にカウンターとコンロ．左に窓（約 78°）と本棚（約 46°），右前にドア（約 57°）とブレーカー（約 44°），真後ろにソファとテレビ
- テーブル（`dining-table`）: 中心 (0.8, 0, 0.2)，1.1m × 0.7m × 高さ 0.72m（天板の下面 0.68m）．長辺が X に沿い，開始位置側（-X）の端は椅子を置かずに空けて潜り込めるようにしている．潜り込んで +X を向くと，奥の脚 2 本（`dining-table-leg-2`・`-4`）が正面の左右およそ 20〜30° に入る．脚の位置は `tableLegLocalPositions()` で求める
- 本棚（`bookshelf`）: 窓と同じ北の壁の東寄り（中心 x=1.85，窓の端から 0.4m）．高さ 1.8m．本は 1 冊ずつ Mesh
- キッチン: 東の壁にカウンター（`kitchen-counter`．長さ 1.8m・高さ 0.85m・奥行 0.6m．扉 3 枚・シンク・水栓）とガスコンロ（`gas-stove`．カウンターの上，開始位置の正面 z=0.25）．口 2 つに火（`stove-flame-1`・`-2`．既定は点火），正面につまみ（`stove-knob-1`・`-2`．高さ 0.91m）．上の壁にレンジフード
- ブレーカー: ドアの左（+X 側）の南の壁に分電盤（`breaker-panel`．中心 (1.75, 1.3)，0.3m × 0.36m）．切る対象のメインスイッチ（`breaker-main-switch`）は高さ 1.33m（実際より低いが，正面を向いた時に背面カメラの画角に入る高さにしている）
- ドア（`door`）: 南の壁の中心 x=0.9，開口 0.85m × 2.0m．内開きで，内側から見て右（-X）にヒンジ，ブレーカー側にレバー．壁の厚み 0.1m（`WALL_THICKNESS`）の小口はドア枠で覆う
- 窓（`window-glass`）: 北の壁の中心 x=0，幅 2.0m・高さ 1.2m（下端 0.8m）．窓の外に景色の板．割れた後の破片（`glass-shards`．小さな三角・四角の板 12 枚を 1 Mesh にまとめたもの）を窓の前の床（窓から 0.15〜0.85m）に置き，既定は非表示
- 廊下（`hallway`）: ドアの外に X に沿って伸びる（x -2〜3，幅 1.2m，高さ 2.4m）．床・天井・壁 4 面（部屋側の壁にドアと同じ開口部）・照明・西の端の玄関ドア（開かない飾り）．内側だけを描く閉じた空間で，ドアを開けると部屋から見える
- その他の家具: 椅子 4 脚（テーブルの長辺に 2 脚ずつ），ソファ（開始位置の後ろでテレビを向く），テレビ台とテレビ（西の壁），ペンダントライト（テーブルの真上），観葉植物（北西の隅），掛け時計（北の壁）．開始位置→テーブル→コンロ→ブレーカー→ドアの通り道はふさがない

### 部屋の殻と個別の Group (Shell & Parts)

`createRoomScene()` は `Space` に `parts`（`RoomParts`）を加えた `RoomSpace` を返す（`isRoomSpace(space)` で判定できる）．部屋の殻は `parts.shell`（床・壁・天井・窓の枠・窓ガラス・ドア枠・ドア・レンジフード・ガラスの破片），家具は `parts.furniture`（1 つずつ独立した `Group`）にまとまっている．揺れの演出では `shell` を動かし，家具は剛体として個別に動かす想定．窓の外の景色・廊下（`parts.hallway`）・照明は `root` 直下なので動かない（揺れの間はドアが閉じているため，廊下とのずれは見えない）．

| 一覧 | id の例 | kind | userData の主な欄 |
| --- | --- | --- | --- |
| `furniture` の子 | `dining-table`・`bookshelf`・`sofa` | `table`・`bookshelf`・`chair` 等 | 家具の欄 `{ id, kind, size, mass, anchored, mount, origin, tipRisk, restsOn }`（物理エンジンの剛体 1 つに対応させる想定）．床での占有範囲は `furnitureFootprint(group)`（回転後の外接 AABB） |
| `tableLegs` | `dining-table-leg-1`〜`4` | `tableLeg` | `tableId`・`index`・`size`・`grabbed`．原点は脚の底面中央（テーブルの子）．テーブル本体の userData に `legIds` |
| `books` | `bookshelf-book-1` | `book` | `size`・`mass`．1 冊 1 Mesh（`byId` には含めない） |
| `stove.body` | `gas-stove` | `stove` | 家具の欄＋`knobIds`・`flameIds`．`restsOn` はカウンター |
| `stove.knobs` | `stove-knob-1` | `stoveKnob` | `stoveId`・`flameId`・`diameter`・`on`．原点はつまみの付け根，正面がローカル +Z |
| `stove.flames` | `stove-flame-1` | `stoveFlame` | `stoveId`・`knobId`・`lit`．原点は口の上面の中心．表示は `visible` で切り替える |
| `breaker.panel` | `breaker-panel` | `breakerPanel` | 家具の欄（壁掛け）＋`switchIds` |
| `breaker.mainSwitch` | `breaker-main-switch` | `breakerSwitch` | `panelId`・`leverName`（レバーの Mesh）・`on` |
| `windowGlass` | `window-glass` | `windowGlass` | `width`・`height`・`broken`．原点は開口部の中心の壁面上 |
| `glassShards` | `glass-shards` | `glassShards` | `count`．既定は `visible` が false |
| `door` | `door` | `door` | `hingeSide`・`width`・`height`・`closedRotationY`・`openInwardSign`・`maxOpenAngle`（100°）・`open`・`openAngle`．原点はヒンジ．`rotation.y` は `roomDoorRotationY(userData, openAngle)` で求める |
| `tv` | `tv` | `tv` | 家具の欄＋`screenName`・`on`．① でテレビの音を流す発生源．画面は点いている見た目（明るい Basic のマテリアル．消すときは色を暗くする） |
| `pendant` | `pendant-light` | `pendant` | 家具の欄．原点が天井取付点（`rotation` で振り子状に揺らせる）．電球の子に `PointLight` |

- 種類ごとの一覧に加え，`parts.byId` で id から引ける（家具・脚・つまみ・火・スイッチ・窓ガラス・破片・ドア．`shell`・`furniture`・`hallway`・本は除く）
- 状態の欄（`grabbed`・`on`・`lit`・`broken`・`open`・`openAngle`）は今は初期値だけで，変える処理（握る・火を消す・ブレーカーを切る・割れる・開ける）は後の Issue で作る

### エリア (Areas)

シナリオの判定に使う床の範囲を `ROOM_AREAS`（`parts.areas`）に XZ の矩形（`id`・`minX`・`maxX`・`minZ`・`maxZ`）で定義している．家具・窓・ドアの定義から導くため，家具を動かすとエリアも動く．今いるエリアの判定と出入りのイベントは「歩行と当たり判定」を参照．

| id | 範囲 | 用途 |
| --- | --- | --- |
| `under-table` | テーブルの天板の範囲 | ③ テーブルの下に入った |
| `near-window` | 窓の左右 0.3m 広げた幅，窓の壁から 1.0m | ② 窓に近づく（危険） |
| `near-bookshelf` | 本棚の左右 0.3m 広げた幅，本棚の前面から 1.0m | ② 本棚に近づく（危険） |
| `glass-shards` | 破片を置いた範囲 | ④ ガラスの破片の上を歩く（危険） |
| `stove-front` | コンロの左右 0.25m 広げた幅，カウンターの前面から 0.8m | ④ コンロの前 |
| `breaker-front` | 分電盤の左右 0.35m，南の壁から 0.8m | ④ ブレーカーの前 |
| `door-front` | ドアの開口部の幅，南の壁から 0.8m | ④ ドアの前 |
| `hallway` | ドアの開口部（壁の厚み）から廊下の奥まで | 終了（廊下へ出た） |

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

## 校舎のパーツの構成 (School Parts)

校舎は「床の面」「辺に置く物」「柱」の 3 種のパーツを並べて作る（Issue #73）．どのパーツも大きさ（面は幅と奥行き，辺の物は辺の長さ，どちらも天井の高さ）を引数で受け取り，定数に直接依存しない．マス目データから並べる処理は後の Issue で作るため，今は確認用の空間 `?scene=school-parts` でだけ使う．

### 大きさの約束 (Dimensions)

- 既定値は `DEFAULT_CELL_SIZE`（マスの一辺 4 m）・`DEFAULT_CEILING_HEIGHT`（天井 3 m）．どちらも仮の値で，#67 で決める（8 × 8 m の教室が 2 × 2 マス）
- 壁の厚さ `WALL_THICKNESS` は 0.12 m．柱（`POST_SIZE`）は壁の厚さの角柱で，壁が交わる点・つながる点に 1 本置いて角・T 字の隙間を防ぐ
- ドア・窓・出口等の開口部は実寸のまま固定し，残りの壁が伸び縮みする．下限を下回ると `RangeError` にする（比較は浮動小数の誤差 `LENGTH_EPSILON` を許す）

| 対象 | 下限 |
| --- | --- |
| 天井の高さ | 2.5 m |
| 床の面の幅・奥行き | 0.5 m |
| 壁・窓付きの壁の辺 | 0.22 m（窓が 1 つ以上入るのは 2.12 m から） |
| ドアの辺 | 2.32 m（開口部 1.0 m と，開いた扉が収まる壁） |
| 出口の辺 | 2.72 m（開口部 2.4 m） |
| 防火シャッターの辺 | 1.28 m（くぐり戸 0.8 m とガイドレール） |
| 教室に中身を置ける大きさ | 幅 2.52 m・奥行き 3.42 m |

### 原点と向き (Origin & Orientation)

- 床の面: 原点は面の中心の床の上．幅がローカル X，奥行きがローカル Z．教室の黒板は -Z の側
- 辺の物: 原点は辺の中心の床の上．辺はローカル X に沿う．引き戸は +Z の側に付き，出口の外は -Z の側
- 2 点の間に辺の物を置く位置と向きは `edgePlacementBetween(a, b)` で求める（a から b へ進む向きの右手が +Z）

### パーツの一覧 (Parts)

| パーツ | 作る関数 | userData の kind | 内容 |
| --- | --- | --- | --- |
| 教室 | `createClassroom(ctx, { interior })` | `schoolFloor` | 床・天井・照明＋中身．`interior: "furnished"` は黒板・教卓・机と椅子を置く（開始地点の教室用）．`"shell"` は中身と照明を作らない |
| 廊下 | `createFloorSurface()` | `schoolFloor` | 床（タイル）・天井（吸音板）・照明 |
| 壁・窓付きの壁 | `createSchoolEdge()` | `schoolEdge` | 窓は幅 1.6 m．辺の長さから数を決める．`glass: "frosted"` ですりガラス |
| ドア | 同上 | `schoolEdge`（`edgeKind: "door"`） | 引き戸 1 枚（開口部 1.0 × 2.0 m）．`open`・`openAmount`・`locked`．開閉は `setSchoolDoorOpen()` |
| 出口 | 同上 | `schoolEdge`（`edgeKind: "exit"`） | 開け放しの開口部（2.4 × 2.2 m）・外のポーチ・庇・誘導灯 |
| 防火シャッター | 同上 | `schoolEdge`（`edgeKind: "fireShutter"`） | 天井の収納箱・幕・ガイドレール・くぐり戸．`closed`．開閉は `setFireShutterClosed()` |
| 柱 | `createSchoolPost()` | `schoolPost` | 壁の交わる点に置く角柱 |

- 外側だけの教室（`shell`）の廊下側は，すりガラスの窓と開かないドア（`locked: true`）にする．開かないドアは当たり判定でも通れない
- 机の並びは，幅から列数，奥行きから行数を自動で決める．机と椅子は材質ごとに `InstancedMesh` 1 つにまとめる
- マテリアルと単位立方体は `SchoolPartContext`（`createSchoolPartContext()`）で全パーツが共有し，`disposeSchoolPartContext()` でまとめて解放する

### 結合と動く物 (Merging)

- パーツを並べ終えた後に `mergeStaticMeshes()` を 1 回呼び，動かない Mesh をマテリアルごとに 1 つのジオメトリへ結合する．パーツの Group と userData は残すため，当たり判定はそのまま取り出せる
- 開閉で動く物（扉の板 `schoolDoorLeaf`・シャッターの幕 `fireShutterCurtain`・座板 `fireShutterOpenBar`）は結合しない．開閉以外で動かす物を足す時は `schoolParts.ts` の `DYNAMIC_KINDS` に足す

### 当たり判定 (School Collision)

`collectSchoolCollision(root)` がパーツの Group の userData から `WalkWorld` の材料（障害物・ドア・床の範囲・エリア）を取り出す．範囲の計算は `schoolLayout.ts`・`classroomLayout.ts` の純粋な関数で行う．

- 壁・窓付きの壁（窓の下の腰壁を含む）・柱・教室の中身は通れない
- ドアは閉じている間だけふさぐ．`locked` のドアは開けられない（`setSchoolDoorOpen()` が何もせず false を返す）ので，常にふさぐ
- 閉じた防火シャッターは全面をふさぐ（しゃがんでもくぐれない）．くぐり戸の範囲を空ける関数（`fireShutterCurtainObstacles(…, true)`）はあるが，まだ使っていない
- 出口は，外のポーチと敷居（`exitSillRect()`）を床の範囲に足すため，内から外へ出られる．外のポーチはエリア `<出口の id>-outside` にする

### 確認用の空間 (School Parts Preview)

`?scene=school-parts` で表示する．大きさの違う 2 棟を並べ，同じパーツを 2 種類以上の大きさで見比べられるようにしてある（`schoolPartsPreviewLayout.ts` の `PREVIEW_BLOCKS`）．

| 棟 | 天井 | 廊下の幅 | 正方形の教室 | 長方形の教室 | 防火シャッター |
| --- | --- | --- | --- | --- | --- |
| A | 3 m | 3 m | 8 × 8 m・中身あり | 7 × 9 m・外側だけ | 閉 |
| B | 2.6 m | 2.4 m | 6 × 6 m・外側だけ | 5 × 7 m・中身あり | 開 |

- 開始位置は 2 棟の間の外（北（-Z）を向く）．出口から廊下へ入り，ドア・シャッター・教室を見て回れる．外の地面（`PREVIEW_GROUND`）も歩ける
- E キー（`?input=mock`）で近くのドアとシャッターを開閉できる（`devDoors.ts`）

### 床の正解経路の矢印 (Route Arrows)

学習モードで，正解経路（`SchoolPlan.drill.route`）のマスの床に緑の矢印を並べる（F6．Issue #95）．校舎の組み立てとは別の部品にしてあり，校舎の `root` に足すだけで使える．

```ts
const arrows = createRouteArrows(plan); // テストモード（drill.mode が "test"）では null
if (arrows) root.add(arrows.object);
// 校舎を解放する時に arrows?.dispose()
```

- 計算は `routeArrowsLayout.ts` の `layoutRouteArrows(plan, route)`（three 非依存）．マスの中心は `sim/grid.ts` の `cellCenter()` で求め，矢印はワールド座標で置く（`root` は原点のままでよい）
- 各マスの中心に 1 つ置き，次のマスへ進む向きを指す．`kind` は最初のマスが `start`，曲がった後の向きを指すマスが `turn`，最後のマス（集合場所）が `goal`（入ってきた向き）で，残りは `straight`
- 高さは `(level - 1) * 3.5 + 0.02` m（SPEC_02「座標」の床の高さから 2 cm 浮かせ，`polygonOffset` と合わせて床とのちらつきを防ぐ）．大きさは長さがマスの一辺の 0.6 倍（0.3〜1.2 m），幅が長さの 0.75 倍
- 全部の矢印を `InstancedMesh` 1 つ（描画 1 回）にまとめ，光源が無くても見える `MeshBasicMaterial`（`ROUTE_ARROW_COLOR`）にする．位置は作る時に 1 回だけ決め，毎フレームの更新は無い
- `options.route` で `drill.route` 以外の経路（`proposeRoute()` の結果等）を描ける
- 経路の異常は例外にせず，描けるところだけ描く

| 経路の状態 | 扱い |
| --- | --- |
| 空 | 矢印は 0 個（子の無い Group） |
| 階が無い・マス目の外・整数でないマス | そのマスを飛ばし，前後の続きはそこで切れる |
| 同じマスの連続 | 1 つにまとめる |
| 隣り合わないマス・別の階への飛び | そこで区切り，区切った部分ごとに描く（区切りの直前のマスは入ってきた向き，直後のマスは `straight`） |
| 前後どちらにも続くマスが無いマス（1 マスだけの経路等） | 向きが決まらないので描かない |

## 歩行と当たり判定 (Walking & Collision)

`SpaceWalker`（`src/scenes/walk/walker.ts`）が `ScenarioWorld` を実装する．毎フレーム `update(frame)` で `FrameInfo.input`（`PlayerInput`）からプレイヤーを動かし，`applyTo(rig)` でカメラの親（rig）の位置・目の高さ・体の向きを合わせる．頭の向きは rig の子のカメラに入れる（Issue #31）．

### 移動 (Locomotion)

- `walking` の間だけ，体の向き（`startYaw`）＋頭の向きの yaw の方へ `walkSpeed` で進む（上限 `MAX_WALK_SPEED` 2 m/s）
- 1 フレームの時間は `MAX_STEP_SECONDS`（0.1 秒）までに抑え，移動は 5 cm ごとに分けてすり抜けを防ぐ．各刻みは「そのまま → X だけ → Z だけ」の順に試し，押し出した後も物と重なる候補は採らない（壁に沿って滑り，狭いすき間でめり込まない）
- 目の高さは各空間の `EYE_HEIGHT` を基準に，`EYE_HEIGHT_SPEED`（2.5 m/s）で少しずつ変える

### 当たり判定 (Collision)

- 体は XZ 平面の円（半径 0.18 m）＋高さの範囲（足元〜目の高さ＋0.1 m）．障害物は軸に沿った直方体で，高さの範囲が体と重なる物だけが行く手をふさぐ．高さ 0.05 m 以下の物はまたげる
- 壁は，見た目と同じ `splitWallAroundOpening(s)` で開口部を除いた板を，外側へ 0.1 m の厚みにする（窓の下の腰壁は残る）．家具は `furnitureFootprint()` と `size`・`origin` から作る（作るのは `createWalkWorld` の時の 1 回だけ．揺れで動いた後の更新は地震の揺れの Issue #32 で扱う）
- 体の中心が出られない「床の範囲」を別に持ち，線路や空間の外へ出ないようにする
- 部屋のテーブルは天板（0.68〜0.72 m）と脚 4 本に分ける．しゃがむ（目 0.55 m）と天板の下に入れる．机の下で立っても目は「天板の下面 − 0.1 m」で止まり，出ると立つ
- ドア（`DoorBlocker`）は `userData.open` が false の間だけ開口部をふさぐ．部屋は廊下へ，エレベーターは乗り場へ，電車は左のホームと前後の貫通扉の向こうの通路へ出られる．電車の右（線路側）のドアは開いても開口部まで
- 当たり判定に入れていない物: 電車のつり革（頭上の物），開いて内側に振れた部屋のドアの板（ドア開閉の Issue で扱う）

### 着座 (Seating)

電車の座席の前（座面の前端から 0.35 m）で，座席に背を向けて（±60° 以内．`SIT_FACING_LIMIT`）しゃがみ始めると座る．目の位置は座席の着座位置（高さ 1.2 m）．座っている間は歩かず，立つと座る前の位置に戻る．

### エリアのイベント (Area Events)

エリアは体の中心で判定し，前のフレームとの差を `areaExited` → `areaEntered` の順に `GameEvent` として流す．`observe()` は今いるエリアを返す．開始位置のエリアはイベントにしない．

| 空間 | エリアの id |
| --- | --- |
| 部屋 | `ROOM_AREAS`（上記「エリア」） |
| 電車 | 各ドアの前（`door-left-1-front`・`emergency-door-front` 等）・`platform`（ホーム）・`emergency-door-gangway`・`gangway-door-rear-gangway`（貫通扉の向こうの通路） |
| エレベーター | `cabin`・`door-front`・`hall`（乗り場） |
| 校舎のパーツ | 床の面の id（教室・廊下）・`<出口の id>-outside`（出口の外のポーチ） |

- 電車・エレベーターのエリアの id は Issue #31 で仮に決めたもの．シナリオ定義を書くときに合わせる
- エレベーターの `locked` は見ていない（扉が閉じているかどうかだけで通れるかを決める）

### 確認用の仮の入力 (Dev Controls)

本物の検知（担当D の `src/input/`）とドアの開閉（手で触れて開く）が入るまでの確認用．スマホで `npm run tunnel -- <空間の id>` から開いて操作する（[ENV_04](../02_ENV/ENV_04_開発コマンド.md)）．

- 「歩く」: 押している間 `walking: true`（`DEV_WALK_SPEED` 1 m/s）．「しゃがむ」: 押すたびに `posture` を切り替える．向きはドラッグ．ボタンは canvas と別の要素なので，別の指でドラッグしながら歩ける
- 「ドア」: 体の中心から `DEV_DOOR_REACH`（1.5 m）以内で最も近いドア 1 つだけを開閉する（電車の両開き・エレベーターの扉は板をまとめて 1 つのドア）．範囲内に無ければ何もしない．1.5 m はこのデバッグ用の仕組みの中だけの値で，本物の開閉は手が触れたかで決める
- 左上に状態（位置・目の高さ・座席・今いるエリア・最後のイベント・近くのドア）を出す

## 性能上の方針 (Performance)

- マテリアルは `MeshLambertMaterial` を基本にする（iPhone の 2 画面描画で PBR より軽い）
- 箱形の部品は単位の `BoxGeometry` を共有し，`scale` で大きさを変える
- 影は使わない．`setPixelRatio` は 2 倍まで，異方性フィルタは 8 まで
- テクスチャは画像ファイルを使わず canvas で手続き生成する（シード固定で毎回同じ見た目）
- 部屋の Mesh 数（描画数）はおよそ 155（部屋の殻 36・家具 112・廊下 5・窓の外 1．本 17 冊が最も多い）．重い場合は本を `InstancedMesh` にするのが次の候補．ガラスの破片は 1 Mesh にまとめ，火は口ごとに 1 Mesh（光源は付けない）．光源は環境光・日光とペンダントの `PointLight` の 3 つ
- 電車の Mesh 数（描画数）はおよそ 150．動かない部品（枠・支え・照明・広告・案内表示・窓ガラス）は材質ごとに `InstancedMesh`，壁は開口部を空けた片を 1 つのジオメトリに結合，形が同じ部品（扉の枠・座席・網棚）は結合したジオメトリを共有する．つり革（1 本 2 Mesh）が最も多いため，重い場合はまず本数を減らす
- 校舎のパーツの確認用の空間の Mesh 数（描画数）は，結合の後でおよそ 44（三角形はおよそ 11,700）．動かない Mesh はマテリアルごとに結合し，机と椅子は `InstancedMesh`．iPhone で 30 fps を保てるかは未確認
- エレベーターの Mesh 数（描画数）はおよそ 60（かご 55・乗り場 5）．ボタン（1 つ 2 Mesh × 16）が最も多い．ボタンのジオメトリ（ラベルごとの面・台座の円柱）とマテリアルは両方の操作盤で共有する．光源は環境光 1 つとかごの `PointLight` 2 つ（照明・非常灯）
