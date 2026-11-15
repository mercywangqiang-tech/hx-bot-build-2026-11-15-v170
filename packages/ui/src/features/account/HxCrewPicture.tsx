// HXBot：开屏动画里落下、堆满屏幕的角色图片。
//
// 动画代码（crew-pile.ts 的物理模拟、CrewPileStage.tsx 的播放）与原版一样，这里只换图片：原来的六个毛绒角色，
// 换成 HXBot 已设计的角色——长颈鹿，六种颜色（图形和配色在 @hxbot/brand/hx-animals，与智能体头像是同一套）。
//
// This module takes the place of the plush library for the loading crew, with the same names, so the
// stage keeps its code: `PlushBot` draws one crew member in its square box, and
// `PLUSH_CHARACTER_BY_ID` gives each character its face at rest. The picture is the giraffe alone, in
// the character's colour, with no disc behind it. It stands on the bottom of the round body that the
// simulation stacks (crew-pile.ts has the body's size), and its neck and head reach above the body.

import { HX_ANIMALS, type HxAnimal, type HxAnimalEye, hxAnimalColors, hxAnimalSvg } from "@hxbot/brand/hx-animals";
import type { BotExpression, ExpressionId } from "@norbert_bodziony/bloub";
import type { PlushCharacterId, PlushState } from "@norbert_bodziony/bloub/plush";
import { createMemo } from "solid-js";

/**
 * The colour of the giraffe that stands for each plush character: the avatar hue nearest to the
 * colour that the character had (orange, green, pink, purple, red and yellow).
 */
const HUES: Readonly<Record<PlushCharacterId, number>> = {
  nexo: 30,
  vita: 150,
  cloe: 320,
  malu: 280,
  yoshi: 0,
  fred: 55,
};
const CHARACTER_IDS = ["nexo", "vita", "cloe", "malu", "yoshi", "fred"] as const satisfies readonly PlushCharacterId[];

/**
 * Where the giraffe is in the square box of a crew member, as shares of the box. crew-pile.ts gives
 * the round body a width and a height of `BODY` around the centre of the box, so the body's bottom is
 * at `FEET`. The giraffe stands there and is `HEIGHT` tall.
 */
const BODY = 0.62;
const FEET = 0.5 + BODY / 2;
const HEIGHT = 0.72;
/** Where the giraffe is in its own picture (hxAnimalSvg): its height and its feet, as shares of the picture. */
const DRAWN_HEIGHT = 0.82 * 0.9;
const DRAWN_FEET = 0.07 + 0.82 * 0.92;
/** The picture in the box: its side, its left edge and its top edge, as percentages of the box. */
const SIDE = (HEIGHT / DRAWN_HEIGHT) * 100;
const LEFT = 50 - SIDE / 2;
const TOP = FEET * 100 - DRAWN_FEET * SIDE;
const PLACE = {
  position: "absolute",
  left: `${LEFT}%`,
  top: `${TOP}%`,
  width: `${SIDE}%`,
  height: `${SIDE}%`,
} as const;

/** The face at rest. The stage reads it and hands it back as `expression`; a picture has one resting face. */
export const PLUSH_CHARACTER_BY_ID: ReadonlyMap<PlushCharacterId, { face: BotExpression | undefined }> = new Map(
  CHARACTER_IDS.map((id) => [id, { face: undefined }]),
);

function dataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** The giraffe is the first of the HXBot animals. */
function firstAnimal(): HxAnimal {
  const animal = HX_ANIMALS[0];
  if (!animal) throw new Error("The HXBot animal list is empty.");
  return animal;
}
const giraffe = firstAnimal();

/** Each token is drawn once and every crew member of that colour shows the same image. */
const TOKENS = new Map<PlushCharacterId, string>();
function token(character: PlushCharacterId): string {
  let url = TOKENS.get(character);
  if (!url) {
    url = dataUrl(hxAnimalSvg(giraffe, hxAnimalColors(HUES[character]), { layer: "body", background: false }));
    TOKENS.set(character, url);
  }
  return url;
}

export interface HxCrewPictureProps {
  character?: PlushCharacterId;
  /** `wide` is a fall or a startle: the eye opens wide. */
  state?: PlushState;
  /** `heureux` is the happy face of the hop out: the eye closes in a smile. */
  expression?: ExpressionId | BotExpression;
  /** The size of the square box, in pixels. */
  size?: number;
  // The plush took these to run its own clock. A picture has none.
  initialPhase?: number;
  autoPause?: boolean;
  paused?: boolean;
  ariaLabel?: string;
}

/** One crew member: the picture of its character in a square box, with the eye of its face. */
export function PlushBot(props: HxCrewPictureProps) {
  const character = () => props.character ?? "nexo";
  const eye = createMemo((): HxAnimalEye => {
    if (props.state === "wide") return "wide";
    return props.expression === "heureux" ? "happy" : "open";
  });
  const eyeLayer = createMemo(() =>
    hxAnimalSvg(giraffe, hxAnimalColors(HUES[character()]), { layer: "eye", eye: eye() }),
  );
  return (
    <span
      class="hx-crew-picture"
      style={{
        display: "block",
        position: "relative",
        width: `${props.size ?? 100}px`,
        height: `${props.size ?? 100}px`,
      }}
      aria-hidden="true"
    >
      <img src={token(character())} alt="" draggable={false} style={PLACE} />
      {/* Only the eye changes with the face, so only this small layer is drawn again. */}
      <span style={PLACE} innerHTML={eyeLayer()} />
    </span>
  );
}
