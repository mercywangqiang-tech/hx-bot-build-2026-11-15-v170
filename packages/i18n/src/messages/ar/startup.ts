import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/startup";

export const messages = {
  "startup.failedTitle": "تعذّر بدء تشغيل HXBot",
  "startup.failedBody":
    "{message}\n\nلم تُعَد تعيين بياناتك المحلية ولم يُكتب فوقها. راجع دليل استكشاف الأخطاء وإصلاحها لمعرفة خطوات الاسترداد.",
  "startup.archiveChangedTitle": "تم تغيير ملفات HXBot",
  "startup.archiveChangedBody":
    "غيّر برنامج آخر ملف HXBot المسمى app.asar. يعمل HXBot الآن، لكنه لن يفتح بعد إنهائه.\n\nلإصلاح HXBot، ثبّته من جديد. تبقى بياناتك المحلية.",
  "startup.archiveChangedDownload": "تنزيل HXBot",
  "startup.newerDataUpdatingTitle": "جارٍ تحديث HXBot",
  "startup.newerDataUpdatingBody":
    "حفظ إصدار أحدث من HXBot بياناتك. يثبّت HXBot أحدث إصدار ثم يفتح مرة أخرى.\n\nلم تتم إعادة تعيين بياناتك المحلية أو الكتابة فوقها.",
  "startup.newerDataTitle": "ثبّت أحدث إصدار من HXBot",
  "startup.newerDataBody":
    "حفظ إصدار أحدث من HXBot بياناتك، ولا يستطيع هذا الإصدار ({version}) فتحها. ثبّت أحدث إصدار لفتح بياناتك.\n\nلم تتم إعادة تعيين بياناتك المحلية أو الكتابة فوقها.",
  "startup.newerDataDownload": "تنزيل HXBot",
  "startup.newerDataGuide": "فتح الدليل",
  "startup.newerDataQuit": "إنهاء",
  "startup.hxMoveTitle": "هل تنقل HXBot إلى مجلد التطبيقات؟",
  "startup.hxMoveBody":
    "يعمل HXBot خارج مجلد التطبيقات، مثلًا من التنزيلات أو من صورة قرص. عندها يشغّله macOS من مكان مؤقت، فلا تعمل الأذونات والتحديثات. ينقل HXBot نفسه ثم يفتح من جديد.",
  "startup.hxMoveNow": "نقل",
  "startup.hxMoveLater": "ليس الآن",
  "startup.hxMoveFailed": "تعذّر على HXBot نقل نفسه. أغلق HXBot، ثم اسحبه إلى مجلد التطبيقات في Finder.",
} as const satisfies PartialTranslation<typeof source>;
