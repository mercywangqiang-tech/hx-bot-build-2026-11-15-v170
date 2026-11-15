import { HX_GIRAFFE } from "@hxbot/brand/app-logo-shape";
import { Pressable, View } from "react-native";
import Svg, { Ellipse, G, Path, Rect } from "react-native-svg";
import { type AppLogoAnimation, useAppLogoMotion } from "@/features/auth/components/use-app-logo-motion";
import { useText } from "@/shared/lib/text";

export interface AppLogoProps {
  animation?: AppLogoAnimation;
  interactive?: boolean;
  size?: number;
}

const VIEWBOX_SIZE = 240;

// HXBot：白底上的长颈鹿标志（代替上游的眼睛标识；数据见 hx/assets/hxbot-giraffe.json）。
export function AppLogo({ animation = "none", interactive = false, size = VIEWBOX_SIZE }: AppLogoProps) {
  const { t } = useText();
  const { handlePressIn } = useAppLogoMotion({ animation, size });

  const logo = (
    <View
      style={{ height: size, width: size }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Svg width={size} height={size} viewBox={`0 0 ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}`}>
        <Rect width={VIEWBOX_SIZE} height={VIEWBOX_SIZE} rx={50} ry={50} fill="#FFFFFF" />
        <G transform="translate(71.41 25.00) scale(0.3286)">
          <Path d={HX_GIRAFFE.body} fill={HX_GIRAFFE.colors.body} />
          <Path d={HX_GIRAFFE.spots.join("")} fill={HX_GIRAFFE.colors.spots} />
          <Ellipse
            cx={HX_GIRAFFE.eye.cx}
            cy={HX_GIRAFFE.eye.cy}
            rx={HX_GIRAFFE.eye.rx}
            ry={HX_GIRAFFE.eye.ry}
            fill={HX_GIRAFFE.colors.eye}
          />
        </G>
      </Svg>
    </View>
  );

  if (!interactive) return logo;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("mobile.auth.logo.animate")}
      accessibilityHint={t("mobile.auth.logo.animateHint")}
      onPressIn={handlePressIn}
      pressRetentionOffset={12}
    >
      {logo}
    </Pressable>
  );
}
