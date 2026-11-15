// HXBot：手机上可以多选的提问，例如按需授权卡片上的“读取、写入、删除”。点选项切换勾选，按“确定”提交；
// 什么都不勾就按“确定”，等于拒绝。
import type { ConversationQuestionPrompt } from "@hxbot/contracts/ipc";
import { Button, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import Check from "lucide-react-native/icons/check";
import { useState } from "react";
import { View } from "react-native";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

type Question = ConversationQuestionPrompt["questions"][number];

interface HxMultiSelectOptionsProps {
  question: Question;
  disabled: boolean;
  answer: (values: string[]) => void;
}

export function HxMultiSelectOptions({ question, disabled, answer }: HxMultiSelectOptionsProps) {
  const { t } = useText();
  const [accentForeground] = useThemeColor(["accent-foreground"]);
  // The ticks belong to one question: a new question starts with none.
  const [ticked, setTicked] = useState<{ id: string; labels: string[] }>({ id: question.id, labels: [] });
  const labels = ticked.id === question.id ? ticked.labels : [];
  const options = question.options ?? [];

  function toggle(label: string): void {
    void haptics.selection();
    const next = labels.includes(label) ? labels.filter((value) => value !== label) : [...labels, label];
    setTicked({ id: question.id, labels: next });
  }

  return (
    <View className="gap-1">
      {options.map((option) => {
        const on = labels.includes(option.label);
        return (
          <Button
            key={option.label}
            variant="ghost"
            isDisabled={disabled}
            accessibilityLabel={option.label}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on, disabled }}
            className={`h-auto min-h-12 justify-start rounded-[18px] px-2 py-2 ${on ? "bg-control/60" : ""}`}
            onPress={() => toggle(option.label)}
          >
            <View
              className={`w-10 self-stretch items-center justify-center rounded-xl ${on ? "bg-accent" : "bg-control"}`}
              style={{ borderCurve: "continuous" }}
            >
              {on ? <Check color={String(accentForeground)} size={18} /> : null}
            </View>
            <View className="min-w-0 flex-1 gap-0.5">
              <Typography type="body-sm" weight="medium">
                {option.label}
              </Typography>
              {option.description ? (
                <Typography type="body-xs" className="text-text-secondary">
                  {option.description}
                </Typography>
              ) : null}
            </View>
          </Button>
        );
      })}
      <View className="flex-row justify-end">
        <Button
          size="sm"
          isDisabled={disabled}
          accessibilityLabel={t("mobile.chat.question.hxConfirmChoice")}
          onPress={() => {
            void haptics.selection();
            // Keep the order of the options, whatever the order of the taps.
            answer(options.map((option) => option.label).filter((label) => labels.includes(label)));
          }}
        >
          <Button.Label>{t("mobile.chat.question.hxConfirmChoice")}</Button.Label>
        </Button>
      </View>
    </View>
  );
}
