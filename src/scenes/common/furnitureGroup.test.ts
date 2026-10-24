import { describe, expect, it } from "vitest";
import type { FurnitureDef } from "./furniture";
import { createFurnitureGroup, furnitureFootprint } from "./furnitureGroup";

const DEF: FurnitureDef<"shelf"> = {
  id: "shelf-1",
  kind: "shelf",
  position: [1, 0.5, -2],
  rotationY: Math.PI / 2,
  size: { x: 0.9, y: 1.8, z: 0.3 },
  mass: 40,
  mount: "floor",
  anchored: false,
  origin: "bottom",
  tipRisk: "high",
  restsOn: null,
};

describe("createFurnitureGroup", () => {
  it("名前・位置・向きを定義どおりに設定する", () => {
    const g = createFurnitureGroup(DEF);
    expect(g.name).toBe("shelf-1");
    expect(g.position.toArray()).toEqual([1, 0.5, -2]);
    expect(g.rotation.y).toBeCloseTo(Math.PI / 2);
    expect(g.rotation.x).toBe(0);
    expect(g.rotation.z).toBe(0);
    expect(g.children).toHaveLength(0);
  });

  it("userData に id・kind・size・mass・anchored・mount・origin・tipRisk・restsOn を入れる", () => {
    const g = createFurnitureGroup({ ...DEF, restsOn: "base", mount: "top", anchored: true });
    expect(g.userData).toEqual({
      id: "shelf-1",
      kind: "shelf",
      size: { x: 0.9, y: 1.8, z: 0.3 },
      mass: 40,
      anchored: true,
      mount: "top",
      origin: "bottom",
      tipRisk: "high",
      restsOn: "base",
    });
  });

  it("userData に position・rotationY は含めない", () => {
    const g = createFurnitureGroup(DEF);
    expect(g.userData).not.toHaveProperty("position");
    expect(g.userData).not.toHaveProperty("rotationY");
  });
});

describe("furnitureFootprint", () => {
  it("Group の位置・向きから回転後の外接 AABB を求める", () => {
    const fp = furnitureFootprint(createFurnitureGroup(DEF));
    expect(fp.centerX).toBeCloseTo(1);
    expect(fp.centerZ).toBeCloseTo(-2);
    expect(fp.halfX).toBeCloseTo(0.15);
    expect(fp.halfZ).toBeCloseTo(0.45);
  });

  it("Group を動かすと現在の位置・向きが反映される", () => {
    const g = createFurnitureGroup(DEF);
    g.position.set(-1, 0, 0.5);
    g.rotation.y = 0;
    const fp = furnitureFootprint(g);
    expect(fp.centerX).toBeCloseTo(-1);
    expect(fp.centerZ).toBeCloseTo(0.5);
    expect(fp.halfX).toBeCloseTo(0.45);
    expect(fp.halfZ).toBeCloseTo(0.15);
  });
});
