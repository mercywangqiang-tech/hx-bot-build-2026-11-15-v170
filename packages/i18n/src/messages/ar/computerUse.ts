import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/computerUse";

export const messages = {
  "computerUse.permission.screenRecording.title": "تسجيل الشاشة",
  "computerUse.permission.screenRecording.description":
    "يتيح لـ HXBot التقاط لقطات الشاشة. النقر والكتابة يعملان بدونه.",
  "computerUse.permission.screenRecording.pane": "تسجيل الشاشة وصوت النظام",
  "computerUse.permission.accessibility.title": "إمكانية الوصول",
  "computerUse.permission.accessibility.description":
    "يتيح لـ HXBot النقر والكتابة. بعد ذلك يشغّل HXBot تسجيل الشاشة بنفسه.",
  "computerUse.permission.accessibility.pane": "إمكانية الوصول",
  "computerUse.error.check": "تعذّر على HXBot التحقق من التحكم في الحاسوب.",
  "computerUse.error.openSettings": "تعذّر على HXBot فتح إعدادات النظام.",
  "computerUse.error.startDriver": "تعذّر على HXBot بدء برنامج تشغيل التحكم في الحاسوب.",
  "computerUse.checkAgain": "التحقق مرة أخرى",
  "computerUse.checking": "جارٍ التحقق من التحكم في الحاسوب",
  "computerUse.unavailable.title": "التحكم في الحاسوب غير متاح بعد",
  "computerUse.permissions.title": "أذونات النظام",
  "computerUse.permissions.description":
    "يدير macOS الأذونات. بعد «منح» يشغّل HXBot ما يستطيع، وأنت تكتفي بكلمة المرور أو Touch ID.",
  "computerUse.ready.title": "التحكم في الحاسوب جاهز",
  "computerUse.ready.description":
    "يمكن لـ HXBot رؤية التطبيقات على هذا الحاسوب والتفاعل معها. لا يطلب هذا النظام أي إذن إضافي.",
  "computerUse.openSettingsFailed.title": "تعذّر فتح إعدادات النظام",
  "computerUse.compact.title": "تفعيل التحكم في الحاسوب",
  "computerUse.compact.description": "اسمح لـ HXBot برؤية التطبيقات على هذا الحاسوب والتفاعل معها.",
  "computerUse.granted": "ممنوح",
  "computerUse.opening": "جارٍ الفتح…",
  "computerUse.manage": "إدارة",
  "computerUse.grant": "منح",
  "computerUse.manageLabel": "إدارة {permission}",
  "computerUse.grantLabel": "منح {permission}",
  "computerUse.help.title": "تشغيل {permission}",
  "computerUse.help.paneOpen": "إعدادات النظام مفتوحة على {pane}.",
  "computerUse.help.dragLabel": "اسحب {name} إلى إعدادات النظام، أو اضغط لإظهاره في Finder",
  "computerUse.help.dragToAdd": "اسحب للإضافة",
  "computerUse.help.findInList": "ابحث عن {name} في القائمة.",
  "computerUse.help.dragIntoList": "اسحب {name}.app إلى القائمة.",
  "computerUse.help.turnOn": "شغّل المفتاح.",
  "computerUse.help.showInFinder": "إظهار في Finder",
  "computerUse.help.revealFailed": "تعذّر إظهار التطبيق في Finder.",
  "computerUse.help.dragFailed": "تعذّر سحب التطبيق.",
  "computerUse.highlight.working": "يعمل HXBot في {title}",
  "computerUse.help.hxPressesScreen":
    "عندما يملك HXBot إذن إمكانية الوصول، يشغّل هذا المفتاح بنفسه. عندما يطلب macOS ذلك، أدخل كلمة المرور أو استخدم Touch ID.",
  "computerUse.help.hxThenScreen":
    "يسمح macOS لك وحدك بتشغيل هذا المفتاح لـ HXBot. بعد ذلك يشغّل HXBot تسجيل الشاشة بنفسه.",
  "computerUse.hxAskTitle": "يحتاج HXBot إلى إذن",
  "computerUse.hxAskBody": "انقر لفتح الصفحة في إعدادات النظام. لا يفتحها HXBot بنفسه أثناء عملك في تطبيق آخر.",
} as const satisfies PartialTranslation<typeof source>;
