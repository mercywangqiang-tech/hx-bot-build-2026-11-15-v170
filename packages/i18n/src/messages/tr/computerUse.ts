import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/computerUse";

export const messages = {
  "computerUse.permission.screenRecording.title": "Ekran Kaydı",
  "computerUse.permission.screenRecording.description":
    "HXBot'un ekran görüntüsü almasını sağlar. Tıklama ve yazma onsuz da çalışır.",
  "computerUse.permission.screenRecording.pane": "Ekran ve Sistem Sesi Kaydı",
  "computerUse.permission.accessibility.title": "Erişilebilirlik",
  "computerUse.permission.accessibility.description":
    "HXBot'un tıklamasını ve yazmasını sağlar. Ardından HXBot ekran kaydını kendisi açar.",
  "computerUse.permission.accessibility.pane": "Erişilebilirlik",
  "computerUse.error.check": "HXBot, Bilgisayar Kullanımını denetleyemedi.",
  "computerUse.error.openSettings": "HXBot, Sistem Ayarlarını açamadı.",
  "computerUse.error.startDriver": "HXBot, Bilgisayar Kullanımı sürücüsünü başlatamadı.",
  "computerUse.checkAgain": "Tekrar kontrol et",
  "computerUse.checking": "Bilgisayar Kullanımı denetleniyor",
  "computerUse.unavailable.title": "Bilgisayar Kullanımı henüz mevcut değil",
  "computerUse.permissions.title": "Sistem izinleri",
  "computerUse.permissions.description":
    "İzinler macOS tarafından yönetilir. “İzin ver”den sonra HXBot açabildiklerini kendisi açar; siz yalnızca parolanızı veya Touch ID'nizi kullanırsınız.",
  "computerUse.ready.title": "Bilgisayar Kullanımı hazır",
  "computerUse.ready.description":
    "HXBot bu bilgisayardaki uygulamaları görebilir ve onlarla etkileşime girebilir. Bu sistem fazladan izin istemez.",
  "computerUse.openSettingsFailed.title": "Sistem Ayarları açılamadı",
  "computerUse.compact.title": "Bilgisayar Kullanımını etkinleştir",
  "computerUse.compact.description":
    "HXBot'un bu bilgisayardaki uygulamaları görmesine ve etkileşime girmesine izin verin.",
  "computerUse.granted": "Verildi",
  "computerUse.opening": "Açılıyor…",
  "computerUse.manage": "Yönet",
  "computerUse.grant": "İzin ver",
  "computerUse.manageLabel": "{permission} iznini yönet",
  "computerUse.grantLabel": "{permission} iznini ver",
  "computerUse.help.title": "{permission} iznini aç",
  "computerUse.help.paneOpen": "Sistem Ayarları {pane} bölümünde açık.",
  "computerUse.help.dragLabel": "{name} uygulamasını Sistem Ayarlarına sürükleyin veya Finder'da göstermek için basın",
  "computerUse.help.dragToAdd": "Eklemek için sürükleyin",
  "computerUse.help.findInList": "Listede {name} uygulamasını bulun.",
  "computerUse.help.dragIntoList": "{name}.app dosyasını listeye sürükleyin.",
  "computerUse.help.turnOn": "Anahtarı açın.",
  "computerUse.help.showInFinder": "Finder'da göster",
  "computerUse.help.revealFailed": "Uygulama Finder'da gösterilemedi.",
  "computerUse.help.dragFailed": "Uygulama sürüklenemedi.",
  "computerUse.highlight.working": "HXBot {title} içinde çalışıyor",
  "computerUse.help.hxPressesScreen":
    "HXBot'ta Erişilebilirlik izni varsa bu anahtarı kendisi açar. macOS sorduğunda parolanızı girin veya Touch ID kullanın.",
  "computerUse.help.hxThenScreen":
    "macOS bu anahtarı HXBot için yalnızca sizin açmanıza izin verir. Ardından HXBot ekran kaydını kendisi açar.",
  "computerUse.hxAskTitle": "HXBot bir izne ihtiyaç duyuyor",
  "computerUse.hxAskBody":
    "Sistem Ayarları'nda sayfayı açmak için tıklayın. Başka bir uygulamada çalışırken HXBot onu kendisi açmaz.",
} as const satisfies PartialTranslation<typeof source>;
