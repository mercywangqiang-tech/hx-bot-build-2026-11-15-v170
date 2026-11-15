// HXBot：智能体头像的 30 种小动物（packages/brand/src/hx-animals.ts）。
import { AVATAR_EXPRESSIONS, SUPPORTED_AVATAR_SILHOUETTES } from "@hxbot/brand/bloub-avatar";
import {
  HX_ANIMAL_HUES,
  HX_ANIMALS,
  hxAgentAnimal,
  hxAnimalColors,
  hxAnimalColorsFromHex,
  hxAnimalForFace,
  hxAnimalSvg,
} from "@hxbot/brand/hx-animals";
import { describe, expect, it } from "vitest";

describe("the HXBot animals", () => {
  it("has 30 different animals, the giraffe and the rhino among them", () => {
    expect(HX_ANIMALS).toHaveLength(30);
    expect(new Set(HX_ANIMALS.map((animal) => animal.id)).size).toBe(30);
    expect(new Set(HX_ANIMALS.map((animal) => animal.zh)).size).toBe(30);
    expect(HX_ANIMALS.map((animal) => animal.id)).toEqual(
      expect.arrayContaining(["giraffe", "rhino", "pig", "pony", "elephant", "fish"]),
    );
  });

  it("lets the avatar editor reach every animal: ten silhouettes, sixteen eyes", () => {
    const reached = new Set<string>();
    for (const shape of SUPPORTED_AVATAR_SILHOUETTES)
      for (const expression of AVATAR_EXPRESSIONS) reached.add(hxAnimalForFace(shape, expression).id);
    expect(reached.size).toBe(30);
    // The silhouette options of one face show ten different animals.
    const expression = AVATAR_EXPRESSIONS[0] ?? "";
    expect(new Set(SUPPORTED_AVATAR_SILHOUETTES.map((shape) => hxAnimalForFace(shape, expression).id)).size).toBe(10);
  });

  it("keeps an agent's animal and colour for its seed", () => {
    const first = hxAgentAnimal("agent-1234", 215);
    expect(hxAgentAnimal("agent-1234", 215)).toEqual(first);
    expect(first.colors.body).toMatch(/^#[0-9a-f]{6}$/u);
    // A chosen colour is the body colour as it is.
    expect(hxAgentAnimal("agent-1234", null, "#1e6fd9").colors.body).toBe("#1e6fd9");
  });

  it("gives every role a hex colour that every platform can read", () => {
    for (const hue of HX_ANIMAL_HUES) {
      for (const value of Object.values(hxAnimalColors(hue))) expect(value).toMatch(/^#[0-9a-f]{6}$/u);
    }
    for (const value of Object.values(hxAnimalColorsFromHex("#888888"))) expect(value).toMatch(/^#[0-9a-f]{6}$/u);
  });

  it("draws each animal as one SVG that fills its box", () => {
    for (const animal of HX_ANIMALS) {
      const svg = hxAnimalSvg(animal, animal.hue);
      expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%"')).toBe(true);
      expect(svg.endsWith("</svg>")).toBe(true);
      expect(svg).not.toMatch(/undefined|NaN/u);
    }
    expect(
      hxAnimalSvg(
        HX_ANIMALS[0] ??
          (() => {
            throw new Error("no animal");
          })(),
        30,
        { size: 24 },
      ),
    ).toContain('width="24"');
  });
});
