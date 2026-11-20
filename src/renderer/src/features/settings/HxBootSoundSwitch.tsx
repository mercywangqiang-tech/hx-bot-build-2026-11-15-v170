// HXBot v1.7.5（UI-27）：设置 · 外观里“开机视频的声音”（默认关）。存在这个窗口的本机存储里，不上报。
import { SwitchField } from "@hxbot/ui";
import { createSignal } from "solid-js";
import { hxBootSound, setHxBootSound } from "../../hx-boot";
import { useI18n } from "../../i18n-context";

export function HxBootSoundSwitch() {
  const i18n = useI18n();
  const [on, setOn] = createSignal(hxBootSound());
  return (
    <SwitchField
      data-settings-row="settings.hxBoot.sound.title"
      checked={on()}
      onChange={(checked) => {
        setHxBootSound(checked);
        setOn(checked);
      }}
      label={i18n.t("settings.hxBoot.sound.title")}
      description={i18n.t("settings.hxBoot.sound.description")}
    />
  );
}
