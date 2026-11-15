import { type Ref, useImperativeHandle, useRef, useState } from "react";
import { StyleSheet, TextInput, type TextInputInstance, View } from "react-native";
import Animated from "react-native-reanimated";

import type { EmailCodeInputHandle } from "@/features/auth/components/email-code-input";
import { SIGN_IN_CONTROL_HEIGHT, useSignInColors } from "@/features/auth/components/sign-in-colors";
import { useShake } from "@/features/auth/components/use-shake";
import { selectionColorProps } from "@/shared/lib/selection-color";

/** The longest sign-in password the account service accepts. */
const HX_LOGIN_PASSWORD_MAX_LENGTH = 32;

interface HxPasswordFieldProps {
  ref?: Ref<EmailCodeInputHandle>;
  value: string;
  onChangeText: (value: string) => void;
  onSubmit: () => void;
  placeholder: string;
  label: string;
  invalid: boolean;
  /** Grows on each rejected password, so the field shakes again for the same message. */
  rejection: number;
  editable: boolean;
  reduced: boolean;
}

/**
 * HXBot：手机端登录第二步的“密码”输入框，代替邮件验证码的 8 格输入。
 * 样式与邮箱输入框一致：聚焦时显示品牌色描边，密码错误时显示红色描边并轻轻晃动。
 */
export function HxPasswordField({
  ref,
  value,
  onChangeText,
  onSubmit,
  placeholder,
  label,
  invalid,
  rejection,
  editable,
  reduced,
}: HxPasswordFieldProps) {
  const colors = useSignInColors();
  const [focused, setFocused] = useState(false);
  const shake = useShake(rejection, reduced);
  const input = useRef<TextInputInstance>(null);
  useImperativeHandle(ref, () => ({ focus: () => input.current?.focus() }), []);
  return (
    <Animated.View
      style={[
        shake,
        {
          height: SIGN_IN_CONTROL_HEIGHT,
          borderRadius: colors.radius,
          borderCurve: "continuous",
          backgroundColor: colors.surface,
        },
      ]}
    >
      <TextInput
        ref={input}
        value={value}
        onChangeText={onChangeText}
        onSubmitEditing={onSubmit}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        editable={editable}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        accessibilityLabel={label}
        secureTextEntry
        autoCapitalize="none"
        autoComplete="current-password"
        textContentType="password"
        autoCorrect={false}
        spellCheck={false}
        returnKeyType="go"
        submitBehavior="submit"
        maxLength={HX_LOGIN_PASSWORD_MAX_LENGTH}
        {...selectionColorProps(colors.brand)}
        className="flex-1 px-4 font-sans text-[17px]"
        style={{ color: colors.text }}
      />
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <Animated.View
          style={{
            flex: 1,
            borderRadius: colors.radius,
            borderCurve: "continuous",
            borderWidth: 1.5,
            borderColor: invalid ? colors.danger : colors.brand,
            opacity: invalid || focused ? 1 : 0,
            transitionProperty: ["opacity", "borderColor"],
            transitionDuration: reduced ? 0 : 160,
            transitionTimingFunction: "ease-out",
          }}
        />
      </View>
    </Animated.View>
  );
}
