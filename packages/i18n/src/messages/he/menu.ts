import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/menu";

export const messages = {
  "menu.stopAllAgents": "עצירת כל הסוכנים",
  "menu.checkForUpdates": "בדיקת עדכונים…",
  "menu.preferences": "הגדרות…",
  "menu.actualSize": "גודל בפועל",
  "menu.zoomIn": "הגדלה",
  "menu.zoomOut": "הקטנה",
  "menu.copyLink": "העתקת קישור",
  "menu.quit": "יציאה מ-HXBot",
  "menu.quitConfirmTitle": "לצאת מ-HXBot?",
  "menu.quitConfirmBody": "סוכנים ושגרות נעצרים עד שתפתח את HXBot שוב.",
  "menu.quitConfirm": "יציאה",
  "menu.quitHint": "יש להחזיק את ⌘Q או ללחוץ עליו פעמיים כדי לצאת",
  "menu.trayOpen": "פתיחת HXBot",
  "menu.trayQuit": "יציאה מ-HXBot",
  "menu.trayTooltip": "HXBot",
  "menu.undo": "ביטול",
  "menu.redo": "ביצוע חוזר",
  "menu.cut": "גזירה",
  "menu.copy": "העתקה",
  "menu.paste": "הדבקה",
  "menu.pasteAndMatchStyle": "הדבקה והתאמת סגנון",
  "menu.delete": "מחיקה",
  "menu.selectAll": "בחירת הכול",
} as const satisfies PartialTranslation<typeof source>;
