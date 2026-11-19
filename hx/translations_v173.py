"""HXBot v1.7.3 电脑操控（五）：停放、续做和“停放后自动续做”的界面文字在其他 13 种语言里的译文。

英文和中文写在 hx/computer_v173.py。translations.py 的最后把这里的内容并进 KEYS 和 PHRASES。
每种语言按 ORDER 的顺序一句一句写。回复的两个词（马上做、不做了）每种语言用自己的词，
src/backend/hx-computer/work.ts 的 NOW_WORDS、DROP_WORDS 认得它们（也认得中文和英文的）。
"""

from __future__ import annotations

ORDER = [
    "status.agent.hxComputer.parked",
    "status.agent.hxComputer.parkedLocked",
    "status.agent.hxComputer.parkedLong",
    "status.agent.hxComputer.resume",
    "settings.hxComputer.autoResume.title",
    "settings.hxComputer.autoResume.description",
]

# 每种语言里“马上做”“不做了”的回复词：和 work.ts 的 NOW_WORDS、DROP_WORDS 一致（测试会核对）
REPLY_WORDS: dict[str, tuple[str, str]] = {
    "ar": ("الآن", "إلغاء"),
    "de": ("jetzt", "verwerfen"),
    "es": ("ahora", "descartar"),
    "fr": ("maintenant", "abandonner"),
    "he": ("עכשיו", "ביטול"),
    "it": ("ora", "scarta"),
    "ja": ("今すぐ", "やめる"),
    "ko": ("지금", "취소"),
    "nl": ("nu", "overslaan"),
    "pl": ("teraz", "porzuć"),
    "pt": ("agora", "descartar"),
    "ru": ("сейчас", "отмена"),
    "tr": ("şimdi", "bırak"),
}

_LANG: dict[str, list[str]] = {
    "ar": [
        "بانتظارك: تكتمل الخطوة في {app} عندما لا تستخدم لوحة المفاتيح أو الفأرة لمدة {seconds} ثوانٍ وتكون نافذتها في المقدمة. للتنفيذ الآن ردّ بـ «الآن»، أو بـ «إلغاء» لتركها.",
        "بانتظارك: الشاشة مقفلة. تكتمل الخطوة في {app} بعد فتح القفل وعندما تكون نافذتها في المقدمة. للتنفيذ الآن ردّ بـ «الآن»، أو بـ «إلغاء» لتركها.",
        "الخطوة في {app} تنتظر منذ 30 دقيقة. للتنفيذ الآن ردّ بـ «الآن»، أو بـ «إلغاء» لتركها.",
        "(أرسله HXBot) توقف المستخدم، و{app} في المقدمة: تابع الخطوة المؤجلة. انظر إلى النافذة أولًا، ثم نفّذ الخطوات المتبقية وعددها {count}. اسأل المستخدم قبل أي إرسال أو دفع أو حذف، كالعادة.",
        "متابعة الخطوات المؤجلة تلقائيًا",
        "عندما تستخدم الحاسوب، يؤجل الوكيل الخطوة التي تحتاج إلى لوحة المفاتيح أو الفأرة. عند التشغيل، تتابع الخطوة تلقائيًا بعد توقفك 5 ثوانٍ (60 للمهام المجدولة). عند الإيقاف، لا تتابع إلا إذا رددت بـ «الآن».",
    ],
    "de": [
        "Wartet auf dich: Der Schritt in {app} geht weiter, wenn du {seconds} Sekunden lang weder Tastatur noch Maus benutzt hast und sein Fenster vorne ist. Antworte „jetzt“, damit er sofort erledigt wird, oder „verwerfen“, um ihn zu lassen.",
        "Wartet auf dich: Der Bildschirm ist gesperrt. Der Schritt in {app} geht weiter, wenn du entsperrst und sein Fenster vorne ist. Antworte „jetzt“, damit er sofort erledigt wird, oder „verwerfen“, um ihn zu lassen.",
        "Der Schritt in {app} wartet seit 30 Minuten. Antworte „jetzt“, damit er sofort erledigt wird, oder „verwerfen“, um ihn zu lassen.",
        "(Von HXBot gesendet) Der Benutzer hat aufgehört, und {app} ist vorne: Setze den geparkten Schritt fort. Sieh dir zuerst das Fenster an, dann erledige die {count} restlichen Schritte. Frage den Benutzer wie immer vor einem Senden, einer Zahlung oder einem Löschen.",
        "Geparkte Schritte von selbst fortsetzen",
        "Während du den Computer benutzt, parkt ein Agent einen Schritt, der Tastatur oder Maus braucht. Ist dies an, geht der Schritt von selbst weiter, wenn du 5 Sekunden aufhörst (60 bei Routinen). Ist es aus, nur wenn du „jetzt“ antwortest.",
    ],
    "es": [
        "Te espera: el paso en {app} sigue cuando no hayas usado el teclado ni el ratón durante {seconds} segundos y su ventana esté al frente. Responde «ahora» para hacerlo ya, o «descartar» para dejarlo.",
        "Te espera: la pantalla está bloqueada. El paso en {app} sigue cuando la desbloquees y su ventana esté al frente. Responde «ahora» para hacerlo ya, o «descartar» para dejarlo.",
        "El paso en {app} lleva 30 minutos esperando. Responde «ahora» para hacerlo ya, o «descartar» para dejarlo.",
        "(Enviado por HXBot) El usuario se ha detenido y {app} está al frente: continúa el paso aparcado. Mira primero la ventana y luego haz los {count} pasos que quedan. Pregunta al usuario antes de enviar, pagar o borrar, como siempre.",
        "Continuar solos los pasos aparcados",
        "Mientras usas el ordenador, un agente aparca el paso que necesita el teclado o el ratón. Si está activado, el paso sigue solo cuando paras 5 segundos (60 en las rutinas). Si está desactivado, solo cuando respondes «ahora».",
    ],
    "fr": [
        "En attente : l’étape dans {app} reprend quand vous n’avez pas utilisé le clavier ni la souris pendant {seconds} secondes et que sa fenêtre est au premier plan. Répondez « maintenant » pour la faire tout de suite, ou « abandonner » pour la laisser.",
        "En attente : l’écran est verrouillé. L’étape dans {app} reprend quand vous le déverrouillez et que sa fenêtre est au premier plan. Répondez « maintenant » pour la faire tout de suite, ou « abandonner » pour la laisser.",
        "L’étape dans {app} attend depuis 30 minutes. Répondez « maintenant » pour la faire tout de suite, ou « abandonner » pour la laisser.",
        "(Envoyé par HXBot) L’utilisateur s’est arrêté et {app} est au premier plan : reprenez l’étape mise en attente. Regardez d’abord la fenêtre, puis faites les {count} étapes restantes. Demandez à l’utilisateur avant un envoi, un paiement ou une suppression, comme toujours.",
        "Reprendre seules les étapes en attente",
        "Quand vous utilisez l’ordinateur, un agent met en attente l’étape qui a besoin du clavier ou de la souris. Activé, l’étape reprend seule après 5 secondes d’arrêt (60 pour les routines). Désactivé, seulement quand vous répondez « maintenant ».",
    ],
    "he": [
        "ממתין לך: השלב ב-{app} ימשיך כשלא תשתמש במקלדת או בעכבר במשך {seconds} שניות והחלון שלו יהיה בחזית. השב „עכשיו” כדי לבצע אותו מיד, או „ביטול” כדי לוותר עליו.",
        "ממתין לך: המסך נעול. השלב ב-{app} ימשיך אחרי שתבטל את הנעילה והחלון שלו יהיה בחזית. השב „עכשיו” כדי לבצע אותו מיד, או „ביטול” כדי לוותר עליו.",
        "השלב ב-{app} ממתין כבר 30 דקות. השב „עכשיו” כדי לבצע אותו מיד, או „ביטול” כדי לוותר עליו.",
        "(נשלח על ידי HXBot) המשתמש הפסיק, ו-{app} בחזית: המשך את השלב שהושהה. הסתכל קודם על החלון, ואז בצע את {count} השלבים שנותרו. שאל את המשתמש לפני שליחה, תשלום או מחיקה, כרגיל.",
        "המשך שלבים מושהים מעצמם",
        "בזמן שאתה משתמש במחשב, הסוכן משהה שלב שצריך את המקלדת או העכבר. כשזה פועל, השלב ממשיך מעצמו אחרי שאתה מפסיק ל-5 שניות (60 בשגרות). כשזה כבוי, רק כשאתה משיב „עכשיו”.",
    ],
    "it": [
        "In attesa: il passaggio in {app} continua quando non usi la tastiera né il mouse per {seconds} secondi e la sua finestra è in primo piano. Rispondi «ora» per farlo subito, o «scarta» per lasciarlo.",
        "In attesa: lo schermo è bloccato. Il passaggio in {app} continua quando lo sblocchi e la sua finestra è in primo piano. Rispondi «ora» per farlo subito, o «scarta» per lasciarlo.",
        "Il passaggio in {app} aspetta da 30 minuti. Rispondi «ora» per farlo subito, o «scarta» per lasciarlo.",
        "(Inviato da HXBot) L’utente si è fermato e {app} è in primo piano: continua il passaggio in sospeso. Guarda prima la finestra, poi fai i {count} passaggi rimasti. Chiedi all’utente prima di un invio, un pagamento o un’eliminazione, come sempre.",
        "Continua da soli i passaggi in sospeso",
        "Mentre usi il computer, un agente mette in sospeso il passaggio che richiede tastiera o mouse. Se è attivo, il passaggio continua da solo dopo che ti fermi per 5 secondi (60 per le routine). Se è disattivato, solo quando rispondi «ora».",
    ],
    "ja": [
        "あなたを待っています：{seconds} 秒間キーボードとマウスを使わず、{app} のウィンドウが最前面にあれば、この手順を続けます。今すぐ行うには「今すぐ」、やめるには「やめる」と返信してください。",
        "あなたを待っています：画面がロックされています。ロックを解除し、{app} のウィンドウが最前面にあれば、この手順を続けます。今すぐ行うには「今すぐ」、やめるには「やめる」と返信してください。",
        "{app} の手順は 30 分間待っています。今すぐ行うには「今すぐ」、やめるには「やめる」と返信してください。",
        "（HXBot が自動送信）ユーザーが操作をやめ、{app} が最前面にあります。保留中の手順を続けてください。まずウィンドウを確認し、残りの {count} 個の手順を行ってください。送信、支払い、削除の前には、いつもどおりユーザーに確認してください。",
        "保留した手順を自動で続ける",
        "あなたがコンピュータを使っている間、エージェントはキーボードやマウスが必要な手順を保留します。オンのときは、あなたが 5 秒（定期実行は 60 秒）手を止めると自動で続けます。オフのときは「今すぐ」と返信したときだけ続けます。",
    ],
    "ko": [
        "기다리는 중: {seconds}초 동안 키보드와 마우스를 쓰지 않고 {app} 창이 맨 앞에 있으면 이 단계를 이어서 합니다. 바로 하려면 “지금”, 그만두려면 “취소”라고 답하세요.",
        "기다리는 중: 화면이 잠겨 있습니다. 잠금을 풀고 {app} 창이 맨 앞에 있으면 이 단계를 이어서 합니다. 바로 하려면 “지금”, 그만두려면 “취소”라고 답하세요.",
        "{app}의 단계가 30분째 기다리고 있습니다. 바로 하려면 “지금”, 그만두려면 “취소”라고 답하세요.",
        "(HXBot이 자동으로 보냄) 사용자가 손을 멈췄고 {app}이(가) 맨 앞에 있습니다. 보류한 단계를 이어서 하세요. 먼저 창을 확인한 다음 남은 {count}개 단계를 하세요. 보내기, 결제, 삭제 전에는 언제나처럼 사용자에게 먼저 물어보세요.",
        "보류한 단계를 자동으로 이어서 하기",
        "컴퓨터를 사용하는 동안 에이전트는 키보드나 마우스가 필요한 단계를 보류합니다. 켜 두면 5초(루틴은 60초) 동안 손을 멈춘 뒤 자동으로 이어서 합니다. 끄면 “지금”이라고 답할 때만 합니다.",
    ],
    "nl": [
        "Wacht op je: de stap in {app} gaat verder als je {seconds} seconden geen toetsenbord of muis hebt gebruikt en het venster vooraan staat. Antwoord „nu” om het meteen te doen, of „overslaan” om het te laten.",
        "Wacht op je: het scherm is vergrendeld. De stap in {app} gaat verder als je ontgrendelt en het venster vooraan staat. Antwoord „nu” om het meteen te doen, of „overslaan” om het te laten.",
        "De stap in {app} wacht al 30 minuten. Antwoord „nu” om het meteen te doen, of „overslaan” om het te laten.",
        "(Verzonden door HXBot) De gebruiker is gestopt en {app} staat vooraan: ga verder met de geparkeerde stap. Kijk eerst naar het venster en doe dan de {count} resterende stappen. Vraag het de gebruiker zoals altijd vóór verzenden, betalen of verwijderen.",
        "Geparkeerde stappen vanzelf voortzetten",
        "Terwijl je de computer gebruikt, parkeert een agent een stap die het toetsenbord of de muis nodig heeft. Staat dit aan, dan gaat de stap vanzelf verder als je 5 seconden stopt (60 bij routines). Staat het uit, alleen als je „nu” antwoordt.",
    ],
    "pl": [
        "Czeka na Ciebie: krok w {app} będzie kontynuowany, gdy przez {seconds} s nie użyjesz klawiatury ani myszy, a jego okno będzie na wierzchu. Odpowiedz „teraz”, aby zrobić to od razu, lub „porzuć”, aby go zostawić.",
        "Czeka na Ciebie: ekran jest zablokowany. Krok w {app} będzie kontynuowany, gdy go odblokujesz, a jego okno będzie na wierzchu. Odpowiedz „teraz”, aby zrobić to od razu, lub „porzuć”, aby go zostawić.",
        "Krok w {app} czeka od 30 minut. Odpowiedz „teraz”, aby zrobić to od razu, lub „porzuć”, aby go zostawić.",
        "(Wysłane przez HXBot) Użytkownik przestał, a {app} jest na wierzchu: kontynuuj wstrzymany krok. Najpierw spójrz na okno, potem wykonaj pozostałe kroki ({count}). Jak zawsze zapytaj użytkownika przed wysłaniem, płatnością lub usunięciem.",
        "Kontynuuj wstrzymane kroki samoczynnie",
        "Gdy używasz komputera, agent wstrzymuje krok, który potrzebuje klawiatury lub myszy. Gdy to jest włączone, krok jest kontynuowany sam po 5 s przerwy (60 s dla rutyn). Gdy wyłączone, tylko gdy odpowiesz „teraz”.",
    ],
    "pt": [
        "À sua espera: o passo em {app} continua quando você não usar o teclado nem o mouse por {seconds} segundos e a janela estiver na frente. Responda «agora» para fazer já, ou «descartar» para deixá-lo.",
        "À sua espera: a tela está bloqueada. O passo em {app} continua quando você desbloquear e a janela estiver na frente. Responda «agora» para fazer já, ou «descartar» para deixá-lo.",
        "O passo em {app} espera há 30 minutos. Responda «agora» para fazer já, ou «descartar» para deixá-lo.",
        "(Enviado pelo HXBot) O usuário parou e {app} está na frente: continue o passo em espera. Veja a janela primeiro e depois faça os {count} passos restantes. Pergunte ao usuário antes de enviar, pagar ou apagar, como sempre.",
        "Continuar sozinhos os passos em espera",
        "Enquanto você usa o computador, um agente deixa em espera o passo que precisa do teclado ou do mouse. Ligado, o passo continua sozinho depois que você para por 5 segundos (60 nas rotinas). Desligado, só quando você responde «agora».",
    ],
    "ru": [
        "Ждёт вас: шаг в {app} продолжится, когда вы {seconds} с не будете пользоваться клавиатурой и мышью, а его окно будет впереди. Ответьте «сейчас», чтобы сделать его сразу, или «отмена», чтобы не делать.",
        "Ждёт вас: экран заблокирован. Шаг в {app} продолжится, когда вы разблокируете экран, а его окно будет впереди. Ответьте «сейчас», чтобы сделать его сразу, или «отмена», чтобы не делать.",
        "Шаг в {app} ждёт уже 30 минут. Ответьте «сейчас», чтобы сделать его сразу, или «отмена», чтобы не делать.",
        "(Отправлено HXBot) Пользователь остановился, и {app} впереди: продолжи отложенный шаг. Сначала посмотри на окно, затем выполни оставшиеся шаги ({count}). Как всегда, спроси пользователя перед отправкой, оплатой или удалением.",
        "Продолжать отложенные шаги самостоятельно",
        "Пока вы пользуетесь компьютером, агент откладывает шаг, которому нужны клавиатура или мышь. Если включено, шаг продолжится сам, когда вы остановитесь на 5 с (60 с для регулярных задач). Если выключено, только когда вы ответите «сейчас».",
    ],
    "tr": [
        "Sizi bekliyor: {seconds} saniye boyunca klavye ve fare kullanmadığınızda ve penceresi öndeyken {app} içindeki adım devam eder. Hemen yapılması için «şimdi», bırakmak için «bırak» yanıtını verin.",
        "Sizi bekliyor: ekran kilitli. Kilidi açtığınızda ve penceresi öndeyken {app} içindeki adım devam eder. Hemen yapılması için «şimdi», bırakmak için «bırak» yanıtını verin.",
        "{app} içindeki adım 30 dakikadır bekliyor. Hemen yapılması için «şimdi», bırakmak için «bırak» yanıtını verin.",
        "(HXBot tarafından gönderildi) Kullanıcı durdu ve {app} önde: bekletilen adıma devam et. Önce pencereye bak, sonra kalan {count} adımı yap. Göndermeden, ödemeden veya silmeden önce her zamanki gibi kullanıcıya sor.",
        "Bekletilen adımlara kendiliğinden devam et",
        "Bilgisayarı kullanırken bir ajan, klavye veya fare gereken adımı bekletir. Açıksa, 5 saniye durduğunuzda (rutinlerde 60) adım kendiliğinden devam eder. Kapalıysa, yalnızca «şimdi» yanıtını verdiğinizde.",
    ],
}

NEW: dict[str, dict[str, str]] = {locale: dict(zip(ORDER, phrases, strict=True)) for locale, phrases in _LANG.items()}
NEW_KEYS = {key: key for key in ORDER}

PLACEHOLDERS: dict[str, set[str]] = {
    "status.agent.hxComputer.parked": {"app", "seconds"},
    "status.agent.hxComputer.parkedLocked": {"app"},
    "status.agent.hxComputer.parkedLong": {"app"},
    "status.agent.hxComputer.resume": {"app", "count"},
}
