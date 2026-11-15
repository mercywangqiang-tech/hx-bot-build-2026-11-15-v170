import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/startup";

export const messages = {
  "startup.failedTitle": "HXBot başlatılamadı",
  "startup.failedBody":
    "{message}\n\nYerel verileriniz sıfırlanmadı veya üzerine yazılmadı. Kurtarma adımları için sorun giderme kılavuzuna bakın.",
  "startup.archiveChangedTitle": "HXBot dosyaları değiştirildi",
  "startup.archiveChangedBody":
    "Başka bir program HXBot’un app.asar dosyasını değiştirdi. HXBot şu an çalışıyor, ancak kapattıktan sonra açılmayacak.\n\nOnarmak için HXBot’u yeniden yükleyin. Yerel verileriniz korunur.",
  "startup.archiveChangedDownload": "HXBot’u indir",
  "startup.newerDataUpdatingTitle": "HXBot güncelleniyor",
  "startup.newerDataUpdatingBody":
    "HXBot’un daha yeni bir sürümü verilerinizi kaydetti. HXBot en son sürümü yüklüyor ve ardından yeniden açılacak.\n\nYerel verileriniz sıfırlanmadı veya üzerine yazılmadı.",
  "startup.newerDataTitle": "En son HXBot’u yükleyin",
  "startup.newerDataBody":
    "HXBot’un daha yeni bir sürümü verilerinizi kaydetti ve bu sürüm ({version}) onları açamıyor. Verilerinizi açmak için en son sürümü yükleyin.\n\nYerel verileriniz sıfırlanmadı veya üzerine yazılmadı.",
  "startup.newerDataDownload": "HXBot’u indir",
  "startup.newerDataGuide": "Kılavuzu aç",
  "startup.newerDataQuit": "Çık",
  "startup.hxMoveTitle": "HXBot, Uygulamalar klasörüne taşınsın mı?",
  "startup.hxMoveBody":
    "HXBot, Uygulamalar klasörünün dışından, örneğin İndirilenler'den veya bir disk görüntüsünden çalışıyor. macOS onu bu durumda geçici bir yerden çalıştırır; izinler ve güncellemeler çalışmaz. HXBot kendini taşır ve yeniden açılır.",
  "startup.hxMoveNow": "Taşı",
  "startup.hxMoveLater": "Şimdi değil",
  "startup.hxMoveFailed": "HXBot kendini taşıyamadı. HXBot'tan çıkın ve Finder'da Uygulamalar klasörüne sürükleyin.",
} as const satisfies PartialTranslation<typeof source>;
