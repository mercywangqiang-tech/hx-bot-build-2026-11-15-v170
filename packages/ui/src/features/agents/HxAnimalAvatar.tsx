// HXBot：智能体头像——小动物（图形在 @hxbot/brand/hx-animals，30 种，颜色跟随智能体的颜色设置）。
//
// It takes the place of the generated plush in AgentAvatar. The animal comes from the face that the
// seed (or the avatar editor's silhouette and eyes) chooses, and the colour is the agent's colour, so an
// agent keeps its look on every screen and on every device. An uploaded photo still wins over it.
import type { AvatarMood } from "@hxbot/brand/bloub-avatar-motion";
import { hxAgentAnimal, hxAnimalSvg } from "@hxbot/brand/hx-animals";
import type { AvatarColor, AvatarHue } from "@hxbot/contracts/ipc";
import { createMemo } from "solid-js";

import "./hx-animal-avatar.css";

export function HxAnimalAvatar(props: {
  seed: string;
  hue: AvatarHue | null;
  color: AvatarColor | null;
  /** A silhouette or eyes of the avatar editor, in place of the seed's. */
  shape?: string | undefined;
  expression?: string | undefined;
  mood: AvatarMood;
  class: string;
  style?: Record<string, string> | undefined;
}) {
  const picture = createMemo(() => {
    const { animal, colors } = hxAgentAnimal(props.seed, props.hue, props.color, {
      shape: props.shape,
      expression: props.expression,
    });
    return { name: animal.en, svg: hxAnimalSvg(animal, colors) };
  });
  return (
    <span
      class={`${props.class} hx-animal-avatar`}
      style={{ display: "inline-block", ...props.style }}
      data-avatar="animal"
      data-animal={picture().name}
      data-mood={props.mood}
      aria-hidden="true"
      innerHTML={picture().svg}
    />
  );
}
