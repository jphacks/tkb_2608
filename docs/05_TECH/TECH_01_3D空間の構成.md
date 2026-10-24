# 3D 空間の構成 (Scene Structure)

体験の舞台となる 3D 空間（部屋・電車・エレベーター）のコードの構成と，空間を追加する手順をまとめる．
現在は部屋（リビング）のみ実装済み（Issue #22）．

## ファイル構成 (Files)

| パス | 内容 |
| --- | --- |
| `src/main.ts` | URL パラメータで空間を選び，開始位置から一人称で描画する．PC 確認用にドラッグで視点を回す |
| `src/scenes/types.ts` | 空間の共通インターフェース（`SceneSpace`・`SceneFactory`） |
| `src/scenes/index.ts` | 実装済みの空間の一覧（`SCENE_FACTORIES`）と `createSceneSpace()` |
| `src/scenes/sceneParam.ts` | `?scene=` の解釈（`parseSceneId()`・`resolveSceneId()`） |
| `src/scenes/common/` | 空間をまたいで使う部品（乱数・手続きテクスチャ・壁の分割・家具の Group・メッシュの生成と解放） |
| `src/scenes/room/` | 部屋（リビング）．`roomLayout.ts` に寸法と家具の定義（three 非依存），`room.ts` に組み立て |
| `src/controls/` | ドラッグで視点を回す操作（`lookAngles.ts` は純粋関数，`dragLook.ts` は Pointer Events） |

## 空間の共通インターフェース (SceneSpace)

各空間は `SceneFactory`（`(options) => SceneSpace`）として作る．`root` を Scene に追加すれば照明も含めて表示できる．

| プロパティ | 内容 |
| --- | --- |
| `id` | `"room"` / `"train"` / `"elevator"` |
| `root` | 空間全体の `Group`（照明を含む） |
| `startPosition` | 開始時の目の位置（ワールド座標，m） |
| `startYaw` | 開始時の向き（rad．0 で -Z を向き，正で左へ回る） |
| `background` | Scene の背景色 |
| `dispose()` | ジオメトリ・マテリアル・テクスチャを解放する |

## 空間の切り替え (Scene Selection)

- `?scene=room` のように URL パラメータで選ぶ．大文字小文字は区別しない
- 未実装の空間・不正な値・指定なしは `room` にフォールバックする

## 空間を追加する手順 (Adding a Scene)

1. `src/scenes/<id>/` を作り，寸法・配置の定数（three 非依存）と組み立て（`create<Id>Scene: SceneFactory`）を分けて書く
2. `src/scenes/index.ts` の `SCENE_FACTORIES` に 1 行足す
3. 寸法・配置の定数は `roomLayout.test.ts` と同様に Vitest でテストする

## 後の機能のための構造 (Hooks for Later Features)

当たり判定・ドアの開閉・地震の物理演算を後から足せるよう，部屋は以下の形で作ってある．

- 家具は 1 つずつ独立した `Group`．`userData` に `{ id, kind, size, mass, anchored, mount, origin, tipRisk, restsOn }` を持つ（物理エンジンの剛体 1 つに対応させる想定）
- 床での占有範囲は `furnitureFootprint(group)`（回転後の外接 AABB）で求める
- テーブルは天板と脚を別の Mesh にしている（机の下に潜る当たり判定のため）
- 本は 1 冊ずつ Mesh（`bookshelf-book-N`）
- ドアはヒンジ位置を原点とする独立した `Group`（name `door`）．開閉に要る値は `userData`（`DoorUserData`）にある．壁はドアの開口部を空けて作っている

## 性能上の方針 (Performance)

- マテリアルは `MeshLambertMaterial` を基本にする（iPhone の 2 画面描画で PBR より軽い）
- 箱形の部品は単位の `BoxGeometry` を共有し，`scale` で大きさを変える
- 影は使わない．`setPixelRatio` は 2 倍まで，異方性フィルタは 8 まで
- テクスチャは画像ファイルを使わず canvas で手続き生成する（シード固定で毎回同じ見た目）
- 部屋の Mesh 数はおよそ 150．重い場合は本を `InstancedMesh` にするのが次の候補
