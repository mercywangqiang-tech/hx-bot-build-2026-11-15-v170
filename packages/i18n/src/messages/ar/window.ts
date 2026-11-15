import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/window";

export const messages = {
  "window.localHostTitle": "HXBot – المضيف المحلي",
  "window.localClientTitle": "HXBot – العميل المحلي",
  "window.computerUsePermissionTitle": "تشغيل التحكم في الحاسوب",
} as const satisfies PartialTranslation<typeof source>;
