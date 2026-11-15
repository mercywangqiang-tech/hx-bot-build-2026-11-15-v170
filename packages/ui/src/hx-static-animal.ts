// HXBot：静态的智能体头像（输入框里的 @提及、助手模板卡片）画成小动物，与 AgentAvatar 显示的是同一只。
import { hxAgentAnimal, hxAnimalSvg } from "@hxbot/brand/hx-animals";
import type { AvatarColor, AvatarHue } from "@hxbot/contracts/ipc";

/** The agent's animal as an SVG element, or null where the page cannot build one. */
export function hxStaticAnimalSvg(
  seed: string,
  hue: AvatarHue | null,
  color: AvatarColor | null,
): SVGSVGElement | null {
  const { animal, colors } = hxAgentAnimal(seed, hue, color);
  const host = document.createElement("span");
  host.innerHTML = hxAnimalSvg(animal, colors);
  const svg = host.firstElementChild;
  if (!(svg instanceof SVGSVGElement)) return null;
  svg.setAttribute("focusable", "false");
  return svg;
}
