import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/menu";

export const messages = {
  "menu.stopAllAgents": "إيقاف كل الوكلاء",
  "menu.checkForUpdates": "التحقق من التحديثات…",
  "menu.preferences": "الإعدادات…",
  "menu.actualSize": "الحجم الفعلي",
  "menu.zoomIn": "تكبير",
  "menu.zoomOut": "تصغير",
  "menu.copyLink": "نسخ الرابط",
  "menu.quit": "إنهاء HXBot",
  "menu.quitConfirmTitle": "هل تريد إنهاء HXBot؟",
  "menu.quitConfirmBody": "يتوقف الوكلاء والمهام الدورية حتى تفتح HXBot مرة أخرى.",
  "menu.quitConfirm": "إنهاء",
  "menu.quitHint": "اضغط ⌘Q مطولًا أو مرتين للإنهاء",
  "menu.trayOpen": "فتح HXBot",
  "menu.trayQuit": "إنهاء HXBot",
  "menu.trayTooltip": "HXBot",
  "menu.undo": "تراجع",
  "menu.redo": "إعادة",
  "menu.cut": "قص",
  "menu.copy": "نسخ",
  "menu.paste": "لصق",
  "menu.pasteAndMatchStyle": "لصق ومطابقة النمط",
  "menu.delete": "حذف",
  "menu.selectAll": "تحديد الكل",
} as const satisfies PartialTranslation<typeof source>;
