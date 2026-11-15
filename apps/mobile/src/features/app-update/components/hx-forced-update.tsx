/**
 * HXBot：手机端强制更新。下载中心发布了比这个应用新的版本时（/updates/mobile.json），整屏挡住，不能再用，
 * 并自动打开新版本：安卓用系统浏览器下载安装包，iPhone 打开无线安装。系统规定最后一步“安装”要用户自己点。
 * 打开应用、回到前台、每 30 分钟检查一次。
 */
import { Button, Typography } from "heroui-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Linking, Modal, View } from "react-native";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { currentAppVersion } from "@/shared/lib/mobile-features";
import { isIOS } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";
import { type HxMobileRelease, hxNewerRelease } from "../model/hx-app-update";

const CHECK_EVERY_MS = 30 * 60 * 1000;

export function HxForcedUpdate() {
  const { session } = useMobileSession();
  const { t } = useText();
  const [release, setRelease] = useState<HxMobileRelease | null>(null);
  const opened = useRef<string | null>(null);

  const check = useCallback(async () => {
    if (!session) return;
    setRelease(await hxNewerRelease(isIOS ? "ios" : "android", currentAppVersion()));
  }, [session]);

  useEffect(() => {
    void check();
    const timer = setInterval(() => void check(), CHECK_EVERY_MS);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void check();
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [check]);

  const open = useCallback(() => {
    if (release) void Linking.openURL(release.url).catch(() => undefined);
  }, [release]);

  // The new version opens by itself once per version: the person only has to install it.
  useEffect(() => {
    if (!release || opened.current === release.version) return;
    opened.current = release.version;
    open();
  }, [release, open]);

  if (!release) return null;
  return (
    <Modal visible animationType="fade" presentationStyle="fullScreen" onRequestClose={() => undefined}>
      <View className="flex-1 items-center justify-center gap-4 bg-background px-8">
        <Typography.Heading className="text-center">{t("mobile.app.hxForced.title")}</Typography.Heading>
        <Typography.Paragraph className="text-center">
          {t("mobile.app.hxForced.body", { version: release.version })}
        </Typography.Paragraph>
        <Typography.Paragraph className="text-center text-muted">
          {t(isIOS ? "mobile.app.hxForced.iosHint" : "mobile.app.hxForced.androidHint")}
        </Typography.Paragraph>
        <Button onPress={open}>
          <Button.Label>{t("mobile.app.hxForced.update")}</Button.Label>
        </Button>
        <Typography.Paragraph className="text-center text-muted">
          {t("mobile.app.hxForced.manual")}
        </Typography.Paragraph>
      </View>
    </Modal>
  );
}
