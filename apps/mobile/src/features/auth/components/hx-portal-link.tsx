import { Typography } from "heroui-native";
import { Linking, Pressable } from "react-native";

import { hxPortalUrl } from "@/features/auth/model/hx-portal";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

/**
 * HXBot：手机端登录页下方的“忘记了密码？”“创建账号”，在浏览器里打开门户的对应页面。
 * The look is the one of the other text actions of the sign-in panes.
 */
export function HxPortalLink({ page, label }: { page: "register" | "reset"; label: string }) {
  const { locale } = useText();
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={label}
      hitSlop={8}
      pressRetentionOffset={12}
      onPress={() => {
        void haptics.impact("light");
        void Linking.openURL(hxPortalUrl(locale, page));
      }}
      className="min-h-11 justify-center"
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
    >
      <Typography.Paragraph type="body-sm" color="muted">
        {label}
      </Typography.Paragraph>
    </Pressable>
  );
}
