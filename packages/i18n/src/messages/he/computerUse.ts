import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/computerUse";

export const messages = {
  "computerUse.permission.screenRecording.title": "הקלטת מסך",
  "computerUse.permission.screenRecording.description": "מאפשר ל-HXBot לצלם מסך. לחיצה והקלדה עובדות גם בלעדיו.",
  "computerUse.permission.screenRecording.pane": "Screen & System Audio Recording",
  "computerUse.permission.accessibility.title": "נגישות",
  "computerUse.permission.accessibility.description":
    "מאפשר ל-HXBot ללחוץ ולהקליד. אחר כך HXBot מפעיל בעצמו את הקלטת המסך.",
  "computerUse.permission.accessibility.pane": "Accessibility",
  "computerUse.error.check": "HXBot לא הצליח לבדוק את שליטה במחשב.",
  "computerUse.error.openSettings": "HXBot לא הצליח לפתוח את System Settings.",
  "computerUse.error.startDriver": "HXBot לא הצליח להפעיל את מנהל ההתקן של שליטה במחשב.",
  "computerUse.checkAgain": "בדיקה חוזרת",
  "computerUse.checking": "בודק את שליטה במחשב",
  "computerUse.unavailable.title": "שליטה במחשב עדיין אינה זמינה",
  "computerUse.permissions.title": "הרשאות מערכת",
  "computerUse.permissions.description":
    "ההרשאות מנוהלות על ידי macOS. אחרי „מתן הרשאה” HXBot מפעיל את מה שהוא יכול, ואתה רק מזין סיסמה או Touch ID.",
  "computerUse.ready.title": "שליטה במחשב מוכנה",
  "computerUse.ready.description":
    "HXBot יכול לראות אפליקציות במחשב הזה ולפעול בהן. המערכת הזו אינה דורשת הרשאה נוספת.",
  "computerUse.openSettingsFailed.title": "לא ניתן היה לפתוח את System Settings",
  "computerUse.compact.title": "הפעלת שליטה במחשב",
  "computerUse.compact.description": "מאפשר ל-HXBot לראות אפליקציות במחשב הזה ולפעול בהן.",
  "computerUse.granted": "ניתנה",
  "computerUse.opening": "פותח…",
  "computerUse.manage": "ניהול",
  "computerUse.grant": "מתן הרשאה",
  "computerUse.manageLabel": "ניהול {permission}",
  "computerUse.grantLabel": "מתן הרשאה ל-{permission}",
  "computerUse.help.title": "הפעלת {permission}",
  "computerUse.help.paneOpen": "System Settings פתוחה ב-{pane}.",
  "computerUse.help.dragLabel": "יש לגרור את {name} אל System Settings, או ללחוץ כדי להציג ב-Finder",
  "computerUse.help.dragToAdd": "יש לגרור כדי להוסיף",
  "computerUse.help.findInList": "יש לחפש את {name} ברשימה.",
  "computerUse.help.dragIntoList": "יש לגרור את {name}.app אל הרשימה.",
  "computerUse.help.turnOn": "יש להפעיל את המתג.",
  "computerUse.help.showInFinder": "הצגה ב-Finder",
  "computerUse.help.revealFailed": "לא ניתן היה להציג את האפליקציה ב-Finder.",
  "computerUse.help.dragFailed": "לא ניתן היה לגרור את האפליקציה.",
  "computerUse.highlight.working": "HXBot עובד ב-{title}",
  "computerUse.help.hxPressesScreen":
    "כש-HXBot מקבל הרשאת נגישות, הוא מפעיל את המתג הזה בעצמו. כש-macOS מבקש, הזן סיסמה או השתמש ב-Touch ID.",
  "computerUse.help.hxThenScreen":
    "macOS מאפשר רק לך להפעיל את המתג הזה עבור HXBot. אחר כך HXBot מפעיל בעצמו את הקלטת המסך.",
  "computerUse.hxAskTitle": "HXBot צריך הרשאה",
  "computerUse.hxAskBody": "לחץ כדי לפתוח את הדף בהגדרות המערכת. HXBot לא פותח אותו בזמן שאתה עובד ביישום אחר.",
} as const satisfies PartialTranslation<typeof source>;
