# 3D 空間の構成 (Scene Structure)

体験の舞台となる 3D 空間（部屋・電車・エレベーター）のコードの構成と，空間を追加する手順をまとめる．
部屋（リビング）と電車（通勤電車の車内）を実装済み（Issue #22）．エレベーターは未実装．
画面の種類（`src/core/scene.ts` の `SceneId`: start / lobby / scenario / debrief）と区別するため，空間の型・関数は「Space」の名前で呼ぶ．

## ファイル構成 (Files)

| パス | 内容 |
| --- | --- |
| `src/main.ts` | URL パラメータで空間を選び，開始位置から一人称で描画する．PC 確認用にドラッグで視点を回す |
| `src/scenes/types.ts` | 空間の共通インターフェース（`Space`・`SpaceFactory`・`SpaceBuildOptions`） |
| `src/scenes/index.ts` | 実装済みの空間の一覧（`SPACE_FACTORIES`・`AVAILABLE_SPACE_IDS`）と `createSpace()` |
| `src/scenes/spaceParam.ts` | `?scene=` の解釈（`SpaceId`・`parseSpaceId()`・`resolveSpaceId()`） |
| `src/scenes/common/` | 空間をまたいで使う部品（乱数・手続きテクスチャ・壁の分割と壁の板・家具の Group・メッシュの生成と解放・`InstancedMesh` とジオメトリの結合） |
| `src/scenes/room/` | 部屋（リビング）．`roomLayout.ts` に寸法と家具の定義（three 非依存），`room.ts` に組み立て |
| `src/scenes/train/` | 電車（通勤電車 1 両のうちドア 2 か所分）．`trainLayout.ts` に寸法・配置と userData の型（three 非依存），`train.ts` に組み立て，`trainFixtures.ts` に座席・手すり・つり革・ドア等の Group，`trainMaterials.ts`・`trainTextures.ts` に見た目 |
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

## 性能上の方針 (Performance)

- マテリアルは `MeshLambertMaterial` を基本にする（iPhone の 2 画面描画で PBR より軽い）
- 箱形の部品は単位の `BoxGeometry` を共有し，`scale` で大きさを変える
- 影は使わない．`setPixelRatio` は 2 倍まで，異方性フィルタは 8 まで
- テクスチャは画像ファイルを使わず canvas で手続き生成する（シード固定で毎回同じ見た目）
- 部屋の Mesh 数はおよそ 150．重い場合は本を `InstancedMesh` にするのが次の候補
- 電車の Mesh 数（描画数）はおよそ 150．動かない部品（枠・支え・照明・広告・案内表示・窓ガラス）は材質ごとに `InstancedMesh`，壁は開口部を空けた片を 1 つのジオメトリに結合，形が同じ部品（扉の枠・座席・網棚）は結合したジオメトリを共有する．つり革（1 本 2 Mesh）が最も多いため，重い場合はまず本数を減らす
