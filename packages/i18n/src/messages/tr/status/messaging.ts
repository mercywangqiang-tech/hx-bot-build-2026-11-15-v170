import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/messaging";

export const messages = {
  // Text that HXBot posts in a Slack conversation. Slack users read it. It names no agent: in
  // Slack, every answer comes from HXBot.
  "status.messaging.working": "Üzerinde çalışılıyor…",
  "status.messaging.queued": "Bekleniyor: HXBot başka bir istek üzerinde çalışıyor. Yanıt buraya gelecek.",
  "status.messaging.busy": "Çok fazla istek bekliyor. Daha sonra tekrar deneyin.",
  "status.messaging.failed": "HXBot bu isteği tamamlayamadı. Ayrıntılar HXBot ana makinesinde mevcuttur.",
  "status.messaging.noAnswer": "HXBot yazılı bir yanıt olmadan tamamlandı.",
  "status.messaging.noAgent": "Henüz burada yanıt verebilecek bir ajan yok. HXBot'ta Slack Düzenleyicisini ekleyin.",
  "status.messaging.delegated": "Bir ekip arkadaşı üzerinde çalışıyor. Yanıt buraya gelecek.",
  "status.messaging.stopped": "Durduruldu.",
  "status.messaging.stop": "Durdur",
  "status.messaging.approvalTitle": "HXBot devam etmek için onay istiyor.",
  "status.messaging.approvalCommand": "Bir komut çalıştır",
  "status.messaging.approvalFileChange": "Dosyaları değiştir",
  "status.messaging.approvalPermissions": "Daha fazla izin al",
  "status.messaging.approve": "Onayla",
  "status.messaging.deny": "Reddet",
  "status.messaging.approvedBy": "{user} tarafından onaylandı.",
  "status.messaging.deniedBy": "{user} tarafından reddedildi.",
  "status.messaging.answeredOnHost": "HXBot ana makinesinde yanıtlandı.",
  "status.messaging.requestInactive": "Bu istek artık etkin değil.",
  "status.messaging.onlyRequester": "Bunu yalnızca {user} yapabilir. HXBot ana makinesi de yanıt verebilir.",
  "status.messaging.hostOnly": "Bu isteği yalnızca HXBot ana makinesi yanıtlayabilir.",
  "status.messaging.filesSkipped": "Bazı dosyalar gönderilmedi: {names}.",
  // The name and title of the agent that HXBot adds to answer in Slack. The user can rename it.
  "status.messaging.orchestratorName": "Slack Düzenleyicisi",
  "status.messaging.orchestratorTitle": "Slack'te yanıt verir ve ekibe sorar",
  // The same texts for Discord. Discord users read the first one.
  "status.messaging.discordNoAgent":
    "Henüz burada yanıt verebilecek bir ajan yok. HXBot'ta Discord Düzenleyicisini ekleyin.",
  "status.messaging.discordOrchestratorName": "Discord Düzenleyicisi",
  "status.messaging.discordOrchestratorTitle": "Discord'da yanıt verir ve ekibe sorar",
  // The sidebar section that HXBot puts the Slack Orchestrator in. The user can rename it.
  "status.messaging.integrationsSection": "Entegrasyonlar",
  // The page a development Slack install ends on.
  "status.messaging.signInReceived": "HXBot Slack kurulumunu aldı. Bu sekmeyi kapatabilirsiniz.",
  "status.messaging.signInUnknown": "HXBot bu Slack kurulumunu başlatmadı. HXBot içinde tekrar başlatın.",
  "status.messaging.telegramNoAgent":
    "Henüz burada yanıt verebilecek bir ajan yok. HXBot'ta Telegram Düzenleyicisini ekleyin.",
  "status.messaging.telegramLinked":
    "HXBot bu sohbete bağlandı. Ajanlara sormak için {bot} adını anın veya HXBot'un bir mesajını yanıtlayın.",
  "status.messaging.telegramOrchestratorName": "Telegram Düzenleyicisi",
  "status.messaging.telegramOrchestratorTitle": "Telegram'da yanıt verir ve ekibe sorar",
  "status.messaging.whatsappNoAgent":
    "Henüz burada yanıt verebilecek bir ajan yok. HXBot'ta WhatsApp Düzenleyicisini ekleyin.",
  "status.messaging.whatsappApprovalMenu": "Onaylamak için 1, reddetmek için 2 yazın.",
  "status.messaging.whatsappStopMenu": "Durdurmak için “stop” yazın.",
  "status.messaging.whatsappPairingCode":
    "Bu numara yalnızca sahibinin izin verdiği kişileri yanıtlar. Sahibine şu kodu verin: {code}",
  "status.messaging.whatsappPairingApproved": "Artık bu numaraya istek gönderebilirsiniz.",
  "status.messaging.whatsappOwnChat": "Kendine mesaj gönder",
  "status.messaging.whatsappWelcomeOwn":
    "👋 *HXBot bağlandı*\n\nAjanlarına sormak için buraya yaz. WhatsApp Orchestrator yanıtlar ya da işi doğru ajana verir.\n\nBir isteği durdurmak için *stop* gönder.",
  "status.messaging.whatsappWelcomeDedicated":
    "👋 *HXBot bağlandı*\n\nHXBot'ta izin verdiğin kişiler artık bu numaraya yazabilir. Yeni bir kişi bir kod alır: HXBot'ta İstekler altında onayla.\n\nBir isteği durdurmak için *stop* gönder.",
  "status.messaging.whatsappOrchestratorName": "WhatsApp Düzenleyicisi",
  "status.messaging.whatsappOrchestratorTitle": "WhatsApp'ta yanıt verir ve ekibe sorar",
} as const satisfies PartialTranslation<typeof source>;
