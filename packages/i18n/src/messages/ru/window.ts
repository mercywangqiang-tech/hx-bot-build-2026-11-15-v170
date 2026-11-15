import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/window";

export const messages = {
  "window.localHostTitle": "HXBot: локальный хост",
  "window.localClientTitle": "HXBot: локальный клиент",
  "window.computerUsePermissionTitle": "Включите управление компьютером",
} as const satisfies PartialTranslation<typeof source>;
