import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/host";

export const messages = {
  "status.host.registered": "تم تسجيل HXBot هذا للوصول عبر WebRTC.",
  "status.host.keyRotated": "تغيّر مفتاح الخادم. تبقى الأجهزة المقترنة مقترنة.",
  "status.host.identityUpdated": "تم تحديث هوية الخادم.",
  "status.host.starting": "جارٍ تشغيل مضيف WebRTC…",
  "status.host.ready": "HXBot هذا جاهز لاتصالات WebRTC.",
  "status.host.signalLost": "لا يمكن للأجهزة الأخرى الوصول إلى HXBot هذا الآن. سيتصل مرة أخرى.",
  "status.host.stopping": "جارٍ جعل HXBot هذا خاصًا…",
  "status.host.private": "HXBot هذا خاص.",
  "status.host.removed": "أُزيل HXBot هذا من حسابك. انشره مرة أخرى لمشاركته.",
} as const satisfies PartialTranslation<typeof source>;
