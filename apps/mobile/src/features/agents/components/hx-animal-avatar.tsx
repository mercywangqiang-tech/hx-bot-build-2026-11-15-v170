// HXBot：手机端智能体头像——小动物（与桌面端、网页版同一套图形：@hxbot/brand/hx-animals）。
import { hxAgentAnimal, hxAnimalSvg } from "@hxbot/brand/hx-animals";
import type { AvatarColor, AvatarHue } from "@hxbot/contracts/ipc";
import { memo, useMemo } from "react";
import { View } from "react-native";
import { SvgXml } from "react-native-svg";

/** The agent's animal, in its colour. A disconnected agent shows faded, as the plush did. */
export const HxAnimalAvatar = memo(function HxAnimalAvatar({
  seed,
  hue,
  color,
  size,
  disconnected,
}: {
  seed: string;
  hue: AvatarHue | null;
  color: AvatarColor | null;
  size: number;
  disconnected?: boolean | undefined;
}) {
  const xml = useMemo(() => {
    const { animal, colors } = hxAgentAnimal(seed, hue, color);
    return hxAnimalSvg(animal, colors, { size });
  }, [seed, hue, color, size]);
  return (
    <View style={{ width: size, height: size, opacity: disconnected ? 0.45 : 1 }}>
      <SvgXml xml={xml} width={size} height={size} />
    </View>
  );
});
