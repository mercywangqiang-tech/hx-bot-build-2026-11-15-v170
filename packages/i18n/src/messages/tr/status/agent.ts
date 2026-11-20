import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/agent";

export const messages = {
  "status.agent.claudeWriteOutside":
    "Ajanın çalışma alanı, paylaşılan klasör ve geçici klasörler dışındaki {path} konumuna yaz.",
  "status.agent.contextCleared": "Bağlam temizlendi. Yeni bir sohbet burada başlıyor.",
  "status.agent.instructionsChanged": "Talimatlarını güncelledi",
  "status.agent.modelSwitchedForLimit": "Kullanım sınırına ulaşıldı. {model} modeline geçildi.",
  "status.agent.modelReturnedAfterLimit": "Kullanım sınırı bitti. {model} modeline geri dönüldü.",
  "status.agent.modelSwitchedForError": "Sağlayıcı hatası. {model} modeline geçildi.",
  "status.agent.modelReturnedAfterError": "Sağlayıcı hatasından sonra {model} modeline geri dönüldü.",
  "status.agent.marketplaceSuggested": "Bir Pazaryeri uygulaması önerildi: {app}.",
  "status.agent.channelMemberAdded": "{agent}, {member} ajanını kanala ekledi. İsteyen: {person}.",
  "status.agent.channelMemberRemoved": "{agent}, {member} ajanını kanaldan çıkardı. İsteyen: {person}.",
  "status.agent.channelInstructionsChanged": "{agent}, kanal talimatlarını değiştirdi. İsteyen: {person}.",
  "status.agent.channelRoutineCreated": "{agent}, {routine} rutinini oluşturdu. İsteyen: {person}.",
  "status.agent.channelRoutineUpdated": "{agent}, {routine} rutinini değiştirdi. İsteyen: {person}.",
  "status.agent.channelRoutineDeleted": "{agent}, {routine} rutinini sildi. İsteyen: {person}.",
  "status.agent.channelTaskCancelled": "{agent}, “{task}” görevini ve alt görevlerini iptal etti. İsteyen: {person}.",
  "status.agent.screenCaptureScreen": "Ana ekranı yakala ve görüntüyü ajanın modeline gönder.",
  "status.agent.screenCaptureChannel":
    "Görüntü {channel} kanalında görünür ve bu sunucuda kanalı okuyan her üye onu görebilir.",
  "status.agent.screenCaptureDisplay": "{name} ekranını yakala ve görüntüyü ajanın modeline gönder.",
  "status.agent.screenCaptureWindow": "{name} penceresini yakala ve görüntüyü ajanın modeline gönder.",
  "status.agent.screenCaptureRegion":
    "{x}, {y} konumundaki {width} × {height} noktalık ekran alanını yakala ve görüntüyü ajanın modeline gönder.",
  "status.agent.workflowDelete":
    "{title} iş akışını çalıştırmaları ve sürümleriyle birlikte silin. Açık adımları durur.",
  "status.agent.screenCaptureProgress": "Ekranı yakalamak için izin isteniyor…",
  "status.agent.screenCaptureReviewing": "Ekran görüntüsü inceleniyor…",
  "status.agent.browserOpening": "Web sayfası açılıyor…",
  "status.agent.browserReading": "Web sayfası okunuyor…",
  "status.agent.browserClicking": "Web sayfasında tıklanıyor…",
  "status.agent.browserTyping": "Web sayfasına yazılıyor…",
  "status.agent.browserActing": "Web sayfası kullanılıyor…",
  "status.agent.browserReviewing": "Web sayfası inceleniyor…",
  "status.agent.memoriesSearching": "Belleklerinde arıyor…",
  "status.agent.memoriesSearched": {
    one: "Belleklerinde aradı: {count} bulundu",
    other: "Belleklerinde aradı: {count} bulundu",
  },
  "status.agent.memoriesUpdating": "Belleklerini güncelliyor…",
  "status.agent.skillUsing": "{name} becerisini kullanıyor…",
  "status.agent.skillReading": "Bir beceri okuyor…",
  "status.agent.toolStepFailed":
    "Bir araç adımı başarısız oldu; sonucu inceliyor ve sırada neyi deneyeceğine karar veriyor…",
  "status.agent.toolResultReviewing": "En son araç sonucu inceleniyor…",
  "status.agent.sourcesSearching": "Güncel bilgiler aranıyor…",
  "status.agent.sourcesReviewing": "Bulunan kaynaklar ve bilgiler inceleniyor…",
  "status.agent.informationGathering": "İlgili bilgiler toplanıyor…",
  "status.agent.informationReviewing": "Toplanan bilgiler inceleniyor…",
  "status.agent.workChecking": "İş kontrol ediliyor…",
  "status.agent.workReviewing": "Doğrulama sonuçları inceleniyor…",
  "status.agent.changesMaking": "İstenen değişiklikler yapılıyor…",
  "status.agent.changesReviewing": "Yapılan değişiklikler inceleniyor…",
  "status.agent.agentCoordinating": "Başka bir ajanla koordinasyon sağlanıyor…",
  "status.agent.agentResponseReviewing": "Diğer ajanın yanıtı inceleniyor…",
  "status.agent.commandRunningUnnamed": "Bir komut çalıştırılıyor…",
  "status.agent.toolStepWorking": "Bir sonraki araç destekli adım işleniyor…",
  "status.agent.webSearching": "Web’de “{query}” aranıyor…",
  "status.agent.urlFetching": "{host} açılıyor…",
  "status.agent.fileReading": "{name} okunuyor…",
  "status.agent.filesReading": "Dosyalar okunuyor…",
  "status.agent.filesListing": "{path} inceleniyor…",
  "status.agent.filesLooking": "Dosyalar inceleniyor…",
  "status.agent.textSearching": "“{query}” aranıyor…",
  "status.agent.filesSearchingText": "Dosyalarda aranıyor…",
  "status.agent.folderSizesMeasuring": "Klasör boyutları ölçülüyor…",
  "status.agent.diskSpaceChecking": "Boş disk alanı kontrol ediliyor…",
  "status.agent.processesChecking": "Çalışan işlemler kontrol ediliyor…",
  "status.agent.gitChecking": "Git deposu kontrol ediliyor…",
  "status.agent.commandRunning": "{program} çalıştırılıyor…",
  "status.agent.memoryChanges": "Bellek: {saved} kaydedildi, {updated} güncellendi, {forgotten} unutuldu.",
  "status.agent.memoryChangesWithConflicts":
    "Bellek: {saved} kaydedildi, {updated} güncellendi, {forgotten} unutuldu, {notChanged} değiştirilmedi çünkü önce başka bir mesaj dizisi değiştirdi.",
  "status.agent.nextStepContinues": "Ajan bir sonraki adımdan önce durdu. Devam ediyor ({current}/{limit}).",
  "status.agent.planContinues": "Planda açık adımlar var. Ajan devam ediyor ({current}/{limit}).",
  "status.agent.branchTitle": "Dallandırılmış sohbet",
  "status.agent.hxAuto.switched.chat": "Otomatik model · Sohbet: {model} modeline geçildi.",
  "status.agent.hxAuto.switched.writing": "Otomatik model · Yazma: {model} modeline geçildi.",
  "status.agent.hxAuto.switched.codeSmall": "Otomatik model · Küçük kod değişikliği: {model} modeline geçildi.",
  "status.agent.hxAuto.switched.codeLarge":
    "Otomatik model · Birden çok dosyada programlama: {model} modeline geçildi.",
  "status.agent.hxAuto.switched.data": "Otomatik model · Veri: {model} modeline geçildi.",
  "status.agent.hxAuto.switched.vision": "Otomatik model · Görseller: {model} modeline geçildi.",
  "status.agent.hxAuto.switched.longContext": "Otomatik model · Uzun belgeler: {model} modeline geçildi.",
  "status.agent.hxAuto.switched.reasoning": "Otomatik model · Planlama ve akıl yürütme: {model} modeline geçildi.",
  "status.agent.hxAuto.switched.computer": "Otomatik model · Bu bilgisayarı kullanma: {model} modeline geçildi.",
  "status.agent.hxAuto.kept.chat": "Otomatik model · Sohbet: {model} üstleniyor.",
  "status.agent.hxAuto.kept.writing": "Otomatik model · Yazma: {model} üstleniyor.",
  "status.agent.hxAuto.kept.codeSmall": "Otomatik model · Küçük kod değişikliği: {model} üstleniyor.",
  "status.agent.hxAuto.kept.codeLarge": "Otomatik model · Birden çok dosyada programlama: {model} üstleniyor.",
  "status.agent.hxAuto.kept.data": "Otomatik model · Veri: {model} üstleniyor.",
  "status.agent.hxAuto.kept.vision": "Otomatik model · Görseller: {model} üstleniyor.",
  "status.agent.hxAuto.kept.longContext": "Otomatik model · Uzun belgeler: {model} üstleniyor.",
  "status.agent.hxAuto.kept.reasoning": "Otomatik model · Planlama ve akıl yürütme: {model} üstleniyor.",
  "status.agent.hxAuto.kept.computer": "Otomatik model · Bu bilgisayarı kullanma: {model} üstleniyor.",
  "status.agent.hxAuto.switched": "Otomatik model: {model} modeline geçildi.",
  "status.agent.hxAuto.suggest": "Bu iş iyi gitmedi. {model} ile yeniden yapmak için “redo” yanıtını verin.",
  "status.agent.hxTeam.started": "Ekip başladı: {members}; {lead} yönetiyor. İlerleme buraya döner.",
  "status.agent.hxTeam.assigned": "Ekip · {from}, “{task}” işini {to} üyesine verdi ({count}/{limit}. devir).",
  "status.agent.hxTeam.returned": "Ekip · {name} bir sonuç gönderdi ({steps} adımdan {done} tanesi bitti).",
  "status.agent.hxTeam.failedOnce":
    "Ekip · {name} işin bir kısmını bitiremedi; yine başarısız olursa ekip durur ve sana sorar.",
  "status.agent.hxTeam.stuck":
    "Ekip · İş bekliyor: bir görev durduruldu ya da başarısız oldu. Odada devam ettir ya da ne yapacağımı söyle.",
  "status.agent.hxTeam.done": "Ekip {minutes} dk içinde bitti. Sonuç bir sonraki mesajda.",
  "status.agent.hxTeam.stopped.user": "Ekip senin isteğinle durduruldu.",
  "status.agent.hxTeam.stopped.minutes": "Ekip durdu: {minutes} dakikalık sınırına ulaştı.",
  "status.agent.hxTeam.stopped.retry": "Ekip durdu: aynı iş iki kez başarısız oldu.",
  "status.agent.hxTeam.stopped.room": "Ekip durdu: odası arşivlendi ya da silindi.",
  "status.agent.hxTeam.stopped.cancelled": "Ekip durdu: işi odada iptal edildi.",
  "status.agent.hxTeam.rounds": "Ekip · {limit} devir sınırına ulaştı; yöneten üye eldekiyle bitiriyor.",
  "status.agent.hxTeam.message": "Ekip · Sözlerin {name} üyesine iletildi.",
  "status.agent.hxTeam.swapped": "Ekip · {old} yerine {new} devam ediyor.",
  "status.agent.hxTeam.kept": "Ekip · Onun için oluşturulan üyeler kalıyor: {names}.",
  "status.agent.hxTeam.collapsed": "Ekip · Onun için oluşturulan üyeler gizlendi: {names}.",
  "status.agent.hxComputer.plan": "Bu bilgisayardaki iş · {app} · {keys} durdurur",
  "status.agent.hxComputer.stopped": "Bu bilgisayardaki iş durduruldu: durdurma tuşlarına bastın.",
  "status.agent.hxComputer.needBoth":
    "Bilgisayar Kullanımı iki izin istiyor: Ekran Kaydı ve Erişilebilirlik. Sistem Ayarları ilkinde açık: orada HXBot'u açın, sonra ikincisini. İkisi de açık olunca yeniden isteyin. Ayarlar → Bilgisayar Kullanımı ikisini de gösterir.",
  "status.agent.hxComputer.needScreen":
    "Bilgisayar Kullanımı Ekran Kaydı iznini istiyor. Sistem Ayarları o sayfada açık: orada HXBot'u açın ve yeniden isteyin. Ayarlar → Bilgisayar Kullanımı da gösterir.",
  "status.agent.hxComputer.needAccessibility":
    "Bilgisayar Kullanımı Erişilebilirlik iznini istiyor. Sistem Ayarları o sayfada açık: orada HXBot'u açın ve yeniden isteyin. Ayarlar → Bilgisayar Kullanımı da gösterir.",
  "status.agent.hxComputer.notRunning":
    "Bilgisayar Kullanımı çalışmıyor: {reason}. Ayarlar → Bilgisayar Kullanımı nedenini gösterir.",
  "status.agent.hxTeam.handedOver": "Ekip · {from}, görevin tamamını {to} adlı üyeye verdi ({count}. devir).",
  "status.agent.hxTeam.progressOpen": "Ekip · {count} devir · {minutes} dk",
  "status.agent.hxTeam.progressPaused": "Ekip · duraklatıldı, kararını bekliyor · {count} devir · {minutes} dk",
  "status.agent.hxTeam.paused":
    "Ekip duraklatıldı: {reason} Yeni iş başlatmaz; süren iş biter. Devam mı, toparlama mı, durdurma mı?",
  "status.agent.hxTeam.continued": "Ekip · Devam ediyor.",
  "status.agent.hxTeam.wrapUp": "Ekip · Lider, ekibin elindekiyle toparlıyor.",
  "status.agent.hxTeam.priority.urgent": "Ekip · Daha acil: bitene kadar diğer ekiplerden önce gelir.",
  "status.agent.hxTeam.priority.normal": "Ekip · Yeniden normal sıra.",
  "status.agent.hxTeam.priority.relaxed": "Ekip · Acil değil: bitene kadar diğer ekipler önce gelir.",
  "status.agent.hxTeam.spend.api":
    "Ekip · Şimdiye kadar yaklaşık ¥{yuan} harcandı. Devam ediyor; orada durdurmak için bir sınır söyleyin.",
  "status.agent.hxTeam.spend.plan":
    "Ekip · Plan döneminin %{percent} kadarı kullanıldı. Devam ediyor; orada durdurmak için bir sınır söyleyin.",
  "status.agent.hxTeam.spend.tokens":
    "Ekip · Şimdiye kadar yaklaşık {millions} milyon token kullanıldı (fiyat bilinmiyor). Devam ediyor.",
  "status.agent.hxComputer.parked":
    "Sizi bekliyor: {seconds} saniye boyunca klavye ve fare kullanmadığınızda ve penceresi öndeyken {app} içindeki adım devam eder. Hemen yapılması için «şimdi», bırakmak için «bırak» yanıtını verin.",
  "status.agent.hxComputer.parkedLocked":
    "Sizi bekliyor: ekran kilitli. Kilidi açtığınızda ve penceresi öndeyken {app} içindeki adım devam eder. Hemen yapılması için «şimdi», bırakmak için «bırak» yanıtını verin.",
  "status.agent.hxComputer.parkedLong":
    "{app} içindeki adım 30 dakikadır bekliyor. Hemen yapılması için «şimdi», bırakmak için «bırak» yanıtını verin.",
  "status.agent.hxComputer.resume":
    "(HXBot tarafından gönderildi) Kullanıcı durdu ve {app} önde: bekletilen adıma devam et. Önce pencereye bak, sonra kalan {count} adımı yap. Göndermeden, ödemeden veya silmeden önce her zamanki gibi kullanıcıya sor.",
  "status.agent.hxUpdate.resume":
    "(HXBot tarafından gönderildi) HXBot bir güncellemeyi yüklemek için yeniden başladı ve şimdi {version} sürümünde. Yeniden başlatma son turunu yarıda kesti: önce işin nereye kadar geldiğine bak, bir şeyi zaten değiştirmiş bir adımı tekrarlama, sonra kalanını bitir.",
  "status.agent.hxTeam.card.paused": "Duraklatıldı: {reason}",
  "status.agent.hxTeam.card.urgent": "Daha acil: diğer ekiplerden önce gelir. Değiştirmek için «acil değil» deyin.",
  "status.agent.hxTeam.card.relaxed": "Acil değil: önce diğer ekipler gelir. Değiştirmek için «acil» deyin.",
  "status.agent.hxTeam.member.doing": "{name}: «{what}» üzerinde çalışıyor",
  "status.agent.hxTeam.member.queued": "{name}: sırada ({position}. sıra, yaklaşık {minutes} dk)",
  "status.agent.hxTeam.member.after": "{name}: ihtiyaç duyduğu iş bitince başlar",
  "status.agent.hxTeam.member.reply": "{name}: yanıt bekliyor",
  "status.agent.hxTeam.member.screen": "{name}: ekranı bekliyor",
  "status.agent.hxTeam.member.yourTurn": "{name}: bilgisayarı kullanmayı bırakmanızı bekliyor",
  "status.agent.hxTeam.member.free": "{name}: boşta",
  "status.agent.hxAutoModel.overloadPaused":
    "{from} sağlayıcısı bir hız sınırından sonra duraklıyor: bu yeni iş {to} kullanıyor.",
  "status.agent.hxAutoModel.overloadQueue": "{from} için uzun süre bekleniyor: bu yeni iş {to} kullanıyor.",
  "status.agent.hxTeam.overloadMove":
    "Ekip · {name}: {from} sağlayıcısı dakikalardır duraklıyor, bu yüzden yeni işi {to} kullanıyor.",
  "status.agent.hxTeam.card.judge": "Hakemin görüşü (yalnızca öneri): {verdict}. {reason}",
  "status.agent.hxTeam.member.starting": "{name}: şimdi başlıyor",
  "status.agent.hxTeam.member.provider":
    "{name}: modelinin sağlayıcısını bekliyor ({position}. sıra, yaklaşık {minutes} dk)",
  "status.agent.hxTeam.member.held": "{name}: ekip duraklatılmışken veya işi bitirirken bekliyor",
  "status.agent.hxSkill.space.header": "Sürüm alanı",
  "status.agent.hxSkill.space.cap":
    "Dosyaların önceki sürümleri için ayrılan alan doldu ({cap} alanın {used} kadarı kullanılıyor). {file} dosyasının bu değişiklikten önceki sürümünü saklamak için HXBot'un {needed} daha alana ihtiyacı var. HXBot ne yapsın?",
  "status.agent.hxSkill.space.disk":
    "{file} dosyasının bu değişiklikten önceki sürümünü saklamak için diskte yer yok ({needed} gerekiyor). HXBot ne yapsın?",
  "status.agent.hxSkill.space.detail":
    "Siz seçene kadar hiçbir şey değişmez. Alanı Ayarlar → Bilgisayar Kullanımı bölümünden değiştirebilirsiniz.",
  "status.agent.hxSkill.space.cleanOld": "En eski sürümleri kaldır",
  "status.agent.hxSkill.space.cleanOldDetail":
    "Yer açılana kadar en eski görevler için saklanan sürümleri kaldırır (bu görevinkini asla), sonra değişikliği yapar.",
  "status.agent.hxSkill.space.noVersion": "Sürüm saklamadan değiştir",
  "status.agent.hxSkill.space.noVersionDetail":
    "Değişikliği şimdi yapar. Bu dosyayı önceki hâline geri getiremezsiniz.",
  "status.agent.hxSkill.space.cancel": "Değişikliği iptal et",
  "status.agent.hxSkill.space.cancelDetail": "Dosya olduğu gibi kalır ve tüm sürümler korunur.",
  "status.agent.hxSkill.change.made": "{file} oluşturuldu",
  "status.agent.hxSkill.change.same": "{file} kaydedildi; içeriği değişmedi",
  "status.agent.hxSkill.change.fileOnly": "{file} değiştirildi (bu tür dosya ayrıntı göstermez)",
  "status.agent.hxSkill.change.counts": "{file} değiştirildi: {changed} değişti, {added} eklendi, {removed} kaldırıldı",
  "status.agent.hxSkill.change.restored": "{file} değişiklikten önceki hâline geri getirildi",
  "status.agent.hxSkill.change.checked": "HXBot dosyayı yeniden okudu ve dosya beklendiği gibi.",
  "status.agent.hxSkill.change.unchecked": "HXBot dosyayı kontrol etmek için yeniden okuyamadı.",
  "status.agent.hxSkill.change.checkedNoVersion":
    "HXBot dosyayı yeniden okudu ve dosya beklendiği gibi. Sürüm saklanmadı, bu yüzden bu değişiklik geri alınamaz.",
  "status.agent.hxSkill.change.uncheckedNoVersion":
    "HXBot dosyayı kontrol etmek için yeniden okuyamadı. Sürüm saklanmadı, bu yüzden bu değişiklik geri alınamaz.",
  "status.agent.hxSkill.change.restoredNote":
    "Dosya değişiklikten önceki hâlinde. Geri getirmeden önceki hâli de sürüm olarak saklandı.",
  "status.agent.hxSkill.change.more": "… {count} değişiklik daha",
  "status.agent.hxSkill.change.cut": "… liste burada bitiyor; başlıktaki sayılar eksiksiz",
  "status.agent.hxSkill.restore.starting": "HXBot hâlâ başlıyor. Birazdan yeniden deneyin.",
  "status.agent.hxSkill.restore.notInChat": "Bu kart artık bu sohbette değil.",
  "status.agent.hxSkill.restore.noVersion": "Bu değişiklikten önce sürüm saklanmadı, bu yüzden geri getirilemez.",
  "status.agent.hxSkill.restore.notKept": "Bu değişiklikten önceki sürüm artık saklanmıyor.",
  "status.agent.hxSkill.restore.spaceFull":
    "Geri getirmeden önce dosyanın şu anki hâlini saklayacak yer yok. Diskte yer açın veya Ayarlar → Bilgisayar Kullanımı bölümünden alanı büyütün.",
  "status.agent.hxRoutineConfirm.title": "“{name}” rutini çalışmadan önce onayınızı bekliyor",
  "status.agent.hxRoutineConfirm.titleMany": "{count} rutin çalışmadan önce onayınızı bekliyor",
  "status.agent.hxRoutineConfirm.noteCatchUp":
    "HXBot kapalıyken veya bilgisayar uykudayken {count} kez kaçırıldı ({from} – {until}). Hepsi için bir kez çalışır.",
  "status.agent.hxRoutineConfirm.noteLate": "Bu çalıştırma kaçırılan bir zamanın yerini tutar.",
  "status.agent.hxRoutineConfirm.noteEach":
    "v1.7.5 güncellemesinden beri gönderdiği, yayımladığı, ödeme yaptığı veya sildiği için her çalıştırmadan önce sorar.",
  "status.agent.hxRoutineConfirm.actions.send":
    "Bu çalıştırma mesaj veya e-posta gönderir. Siz evet demeden hiçbir şey gönderilmez.",
  "status.agent.hxRoutineConfirm.actions.publish":
    "Bu çalıştırma paylaşır veya yayımlar. Siz evet demeden hiçbir şey paylaşılmaz.",
  "status.agent.hxRoutineConfirm.actions.pay":
    "Bu çalıştırma ödeme yapar veya satın alır. Siz evet demeden hiçbir şey ödenmez.",
  "status.agent.hxRoutineConfirm.actions.delete": "Bu çalıştırma siler. Siz evet demeden hiçbir şey silinmez.",
  "status.agent.hxRoutineConfirm.actions.several":
    "Bu çalıştırma gönderir, yayımlar, ödeme yapar veya siler. Siz evet demeden hiçbir şey olmaz.",
  "status.agent.hxRoutineConfirm.actions.each": "Bu rutin her çalıştırmadan önce sorar.",
  "status.agent.hxRoutineConfirm.outcome.yes": "Evet dediniz: şimdi çalışıyor.",
  "status.agent.hxRoutineConfirm.outcome.no": "Hayır dediniz: bu sefer atlandı.",
  "status.agent.hxRoutineConfirm.outcome.expired": "Sonraki zamanından önce yanıt gelmedi: bu sefer atlandı.",
  "status.agent.hxRoutineResult.unverifiedTitle": "Rutin sonucu doğrulanmadı",
  "status.agent.hxRoutineResult.missingFile":
    "“{name}” çalıştırması {files} kaydettiğini söylüyor, ama HXBot orada bulamadı. Güvenmeden önce sonucu kontrol edin.",
  "status.agent.hxRoutineResult.notReadBack":
    "“{name}” çalıştırması HXBot'un geri okuyamadığı bir dosyayı değiştirdi. Güvenmeden önce sonucu kontrol edin.",
  "status.agent.hxRoutineResult.actionUnknown":
    "“{name}” çalıştırması bir şey gönderdi, yayımladı, ödedi veya sildi ve HXBot sonucu bilmiyor. Güvenmeden önce kontrol edin.",
  "status.agent.hxRoutineResult.noToolStep":
    "“{name}” çalıştırması göndermeli, yayımlamalı, ödemeli veya silmeliydi, ama böyle bir adım olmadan bitti. Güvenmeden önce sonucu kontrol edin.",
  "status.agent.hxRoutineConfirm.outcome.paused": "Rutin duraklatıldı: bu zaman çalışmaz.",
  "status.agent.hxLearned.teamProgress":
    "Ekip · Geçen sefer seçtiğiniz gibi, sonraki hatırlatma ilerleme olmadan {minutes} dakika geçince gelir.",
  "status.agent.hxLearned.workProgress":
    "Ekip · Seçtiğiniz gibi, bu tür işler için hatırlatma artık ilerleme olmadan {minutes} dakika geçince gelir.",
  "status.agent.hxLearned.yield":
    "Bilgisayar Kullanımı · HXBot devam ettikten hemen sonra bilgisayarı yeniden kullandınız, bu yüzden artık siz bıraktıktan sonra {seconds} saniye bekler.",
  "status.agent.hxTeam.judgeAuto.went":
    "Ekip · Hakem devam edebileceğini söylüyor: {reason} Ayarladığınız gibi, size sormak için durmadı.",
  "status.agent.hxTeam.judgeAuto.third":
    "Ekip · Bu nedenle hakemin dediği gibi zaten iki kez devam etti, bu yüzden bu sefer size soruyor.",
  "status.agent.hxTeam.judgeAuto.back":
    "Ekip · Hakem devam ettirdikten sonra bir ekibi iki kez durdurdunuz, bu yüzden bunun gibi durumlarda yine her seferinde size sorulur.",
  "status.agent.hxTeam.judgeAuto.on":
    "Ekip · Bundan sonra bunun gibi durumlar ({cause}) yalnızca bu bilgisayarda hakemin dediği gibi ilerler.",
  "status.agent.hxTeam.judgeAuto.off": "Ekip · Bunun gibi durumlarda ({cause}) yine her seferinde size sorulur.",
  "status.agent.hxTeam.card.judgeOffer": "Hakemin görüşü seçiminizle art arda {count} kez aynı çıktı.",
  "status.agent.hxTeam.card.judgeWent": "Hakem devam ettirdi: {reason}",
  "status.agent.hxTeam.cause.G1": "bir süredir ilerleme yok",
  "status.agent.hxTeam.cause.G2": "kendi etrafında dönen iş",
  "status.agent.hxTeam.cause.G3": "fazla dağılan iş",
} as const satisfies PartialTranslation<typeof source>;
