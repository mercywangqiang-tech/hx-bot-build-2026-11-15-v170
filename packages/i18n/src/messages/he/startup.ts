import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/startup";

export const messages = {
  "startup.failedTitle": "HXBot לא הצליח להיפתח",
  "startup.failedBody":
    "{message}\n\nהנתונים המקומיים שלך לא אופסו ולא נדרסו. בצעדי השחזור שבמדריך לפתרון בעיות אפשר לקרוא איך להמשיך.",
  "startup.archiveChangedTitle": "קובצי HXBot שונו",
  "startup.archiveChangedBody":
    "תוכנה אחרת שינתה את קובץ HXBot app.asar. HXBot פועל כעת, אך לא ייפתח לאחר היציאה ממנו.\n\nכדי לתקן את HXBot, יש להתקין אותו מחדש. הנתונים המקומיים נשמרים.",
  "startup.archiveChangedDownload": "הורדת HXBot",
  "startup.newerDataUpdatingTitle": "HXBot מתעדכן",
  "startup.newerDataUpdatingBody":
    "גרסה חדשה יותר של HXBot שמרה את הנתונים שלך. HXBot מתקין את הגרסה האחרונה ואז נפתח מחדש.\n\nהנתונים המקומיים שלך לא אופסו ולא נדרסו.",
  "startup.newerDataTitle": "התקנת HXBot העדכני ביותר",
  "startup.newerDataBody":
    "גרסה חדשה יותר של HXBot שמרה את הנתונים שלך, והגרסה הזו ({version}) אינה יכולה לפתוח אותם. יש להתקין את הגרסה האחרונה כדי לפתוח את הנתונים.\n\nהנתונים המקומיים שלך לא אופסו ולא נדרסו.",
  "startup.newerDataDownload": "הורדת HXBot",
  "startup.newerDataGuide": "פתיחת המדריך",
  "startup.newerDataQuit": "יציאה",
  "startup.hxMoveTitle": "להעביר את HXBot לתיקיית היישומים?",
  "startup.hxMoveBody":
    "HXBot פועל מחוץ לתיקיית היישומים, למשל מתיקיית ההורדות או מתמונת דיסק. אז macOS מפעיל אותו ממקום זמני, וההרשאות והעדכונים לא עובדים. HXBot יעביר את עצמו וייפתח מחדש.",
  "startup.hxMoveNow": "העבר",
  "startup.hxMoveLater": "לא עכשיו",
  "startup.hxMoveFailed": "HXBot לא הצליח להעביר את עצמו. צא מ-HXBot וגרור אותו לתיקיית היישומים ב-Finder.",
} as const satisfies PartialTranslation<typeof source>;
