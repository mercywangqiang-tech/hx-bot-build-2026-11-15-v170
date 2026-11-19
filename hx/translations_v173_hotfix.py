"""HXBot v1.7.3 紧急修正：新增界面文字在其他 13 种语言里的译文。

英文和中文写在 hx/hotfix_173.py。translations.py 的最后把这里的内容并进 KEYS 和 PHRASES。
“自动更新”的说明（settings.updates.hxForced.description）改了意思，13 种语言的新译文直接改在 hx/translations_v162.py。
"""

from __future__ import annotations

ORDER = [
    "status.agent.hxUpdate.resume",
    "error.update.checkSignedOut",
]

_LANG: dict[str, list[str]] = {
    "ar": [
        "(أرسله HXBot) أُعيد تشغيل HXBot لتثبيت تحديث، وهو الآن الإصدار {version}. قطعت إعادة التشغيل دورك الأخير: تحقّق أولًا من المدى الذي وصل إليه العمل، ولا تكرّر خطوة غيّرت شيئًا بالفعل، ثم أكمل الباقي.",
        "لم يقبل خادم التحديثات تسجيل دخولك. سجّل الدخول إلى HXBot مرة أخرى، ثم تحقّق من وجود تحديثات.",
    ],
    "de": [
        "(Von HXBot gesendet) HXBot wurde neu gestartet, um ein Update zu installieren, und ist jetzt Version {version}. Der Neustart hat deinen letzten Durchlauf unterbrochen: Prüfe zuerst, wie weit die Arbeit gekommen ist, wiederhole keinen Schritt, der schon etwas geändert hat, und erledige dann den Rest.",
        "Der Update-Server hat deine Anmeldung nicht akzeptiert. Melde dich erneut bei HXBot an und suche dann nach Updates.",
    ],
    "es": [
        "(Enviado por HXBot) HXBot se reinició para instalar una actualización y ahora es la versión {version}. El reinicio interrumpió tu último turno: comprueba primero hasta dónde llegó el trabajo, no repitas un paso que ya cambió algo y luego termina el resto.",
        "El servidor de actualizaciones no aceptó tu inicio de sesión. Vuelve a iniciar sesión en HXBot y busca actualizaciones de nuevo.",
    ],
    "fr": [
        "(Envoyé par HXBot) HXBot a redémarré pour installer une mise à jour et est maintenant en version {version}. Le redémarrage a interrompu votre dernier tour : vérifiez d’abord où en était le travail, ne refaites pas une étape qui a déjà modifié quelque chose, puis terminez le reste.",
        "Le serveur de mises à jour n’a pas accepté votre connexion. Reconnectez-vous à HXBot, puis recherchez les mises à jour.",
    ],
    "he": [
        "(נשלח על ידי HXBot) HXBot הופעל מחדש כדי להתקין עדכון, ועכשיו זו גרסה {version}. ההפעלה מחדש קטעה את הסבב האחרון שלך: בדוק קודם עד היכן הגיעה העבודה, אל תחזור על שלב שכבר שינה משהו, ואז סיים את השאר.",
        "שרת העדכונים לא קיבל את ההתחברות שלך. התחבר שוב ל-HXBot ואז בדוק אם יש עדכונים.",
    ],
    "it": [
        "(Inviato da HXBot) HXBot si è riavviato per installare un aggiornamento e ora è alla versione {version}. Il riavvio ha interrotto il tuo ultimo turno: controlla prima fin dove è arrivato il lavoro, non ripetere un passaggio che ha già cambiato qualcosa, poi completa il resto.",
        "Il server degli aggiornamenti non ha accettato il tuo accesso. Accedi di nuovo a HXBot, poi cerca gli aggiornamenti.",
    ],
    "ja": [
        "（HXBot が自動送信）HXBot は更新をインストールするために再起動し、現在はバージョン {version} です。再起動で前回のターンが中断されました。まず作業がどこまで進んだかを確認し、すでに何かを変更した手順は繰り返さずに、残りを終わらせてください。",
        "更新サーバーがサインインを受け付けませんでした。HXBot にもう一度サインインしてから、更新を確認してください。",
    ],
    "ko": [
        "(HXBot이 자동으로 보냄) HXBot이 업데이트를 설치하려고 다시 시작했고, 지금은 {version} 버전입니다. 다시 시작하면서 지난 턴이 중단되었습니다. 먼저 작업이 어디까지 진행됐는지 확인하고, 이미 무언가를 바꾼 단계는 반복하지 말고 나머지를 끝내세요.",
        "업데이트 서버가 로그인을 받아들이지 않았어요. HXBot에 다시 로그인한 다음 업데이트를 확인하세요.",
    ],
    "nl": [
        "(Verzonden door HXBot) HXBot is opnieuw gestart om een update te installeren en is nu versie {version}. De herstart heeft je laatste beurt onderbroken: kijk eerst hoe ver het werk was, herhaal geen stap die al iets heeft veranderd en maak daarna de rest af.",
        "De updateserver heeft je aanmelding niet geaccepteerd. Meld je opnieuw aan bij HXBot en zoek daarna naar updates.",
    ],
    "pl": [
        "(Wysłane przez HXBot) HXBot uruchomił się ponownie, aby zainstalować aktualizację, i ma teraz wersję {version}. Ponowne uruchomienie przerwało twoją ostatnią turę: najpierw sprawdź, jak daleko doszła praca, nie powtarzaj kroku, który już coś zmienił, a potem dokończ resztę.",
        "Serwer aktualizacji nie przyjął twojego logowania. Zaloguj się ponownie do HXBot, a potem sprawdź aktualizacje.",
    ],
    "pt": [
        "(Enviado pelo HXBot) O HXBot reiniciou para instalar uma atualização e agora está na versão {version}. A reinicialização interrompeu seu último turno: verifique primeiro até onde o trabalho chegou, não repita um passo que já mudou algo e depois termine o resto.",
        "O servidor de atualizações não aceitou seu login. Entre no HXBot novamente e depois procure atualizações.",
    ],
    "ru": [
        "(Отправлено HXBot) HXBot перезапустился, чтобы установить обновление, и теперь работает версия {version}. Перезапуск прервал твой последний ход: сначала проверь, докуда дошла работа, не повторяй шаг, который уже что-то изменил, а затем доделай остальное.",
        "Сервер обновлений не принял твой вход. Войди в HXBot снова, а затем проверь обновления.",
    ],
    "tr": [
        "(HXBot tarafından gönderildi) HXBot bir güncellemeyi yüklemek için yeniden başladı ve şimdi {version} sürümünde. Yeniden başlatma son turunu yarıda kesti: önce işin nereye kadar geldiğine bak, bir şeyi zaten değiştirmiş bir adımı tekrarlama, sonra kalanını bitir.",
        "Güncelleme sunucusu oturum açmanı kabul etmedi. HXBot'a yeniden giriş yap, sonra güncellemeleri denetle.",
    ],
}

NEW: dict[str, dict[str, str]] = {locale: dict(zip(ORDER, phrases, strict=True)) for locale, phrases in _LANG.items()}
NEW_KEYS = {key: key for key in ORDER}

PLACEHOLDERS: dict[str, set[str]] = {
    "status.agent.hxUpdate.resume": {"version"},
    "error.update.checkSignedOut": set(),
}

# “自动更新”的说明：用着用着找到的新版本也在后台装好，等助手空闲（最多 10 分钟）就保存并重启，被打断的助手接着做
AUTO_UPDATE_DESCRIPTION: dict[str, str] = {
    "ar": "يبحث HXBot عن إصدار جديد كل بضع دقائق، حتى أثناء عمل الوكلاء. ينزّله ويثبّته في الخلفية، ثم يحفظ ويعيد التشغيل بالإصدار الجديد عندما يكون الوكلاء في حالة خمول، أو بعد 10 دقائق على الأكثر. يتابع الوكلاء الذين قطعتهم إعادة التشغيل عملهم بأنفسهم. لا حاجة إلى النقر على أي شيء.",
    "de": "HXBot sucht alle paar Minuten nach einer neuen Version, auch während die Agenten arbeiten. Es lädt und installiert sie im Hintergrund, speichert dann und startet in der neuen Version neu, sobald die Agenten nichts zu tun haben, spätestens nach 10 Minuten. Agenten, die der Neustart unterbrochen hat, machen von selbst weiter. Du musst nichts anklicken.",
    "es": "HXBot busca una versión nueva cada pocos minutos, también mientras los agentes trabajan. La descarga e instala en segundo plano, y luego guarda y se reinicia en ella cuando los agentes están inactivos, o como máximo a los 10 minutos. Los agentes que el reinicio interrumpió continúan solos. No tienes que hacer clic en nada.",
    "fr": "HXBot cherche une nouvelle version toutes les quelques minutes, même pendant que les agents travaillent. Il la télécharge et l’installe en arrière-plan, puis enregistre et redémarre dans la nouvelle version quand les agents sont inactifs, ou au plus tard après 10 minutes. Les agents que le redémarrage a interrompus reprennent d’eux-mêmes. Il n’y a rien à cliquer.",
    "he": "HXBot מחפש גרסה חדשה כל כמה דקות, גם בזמן שהסוכנים עובדים. הוא מוריד ומתקין אותה ברקע, ואז שומר ומופעל מחדש בגרסה החדשה כשהסוכנים אינם עסוקים, או אחרי 10 דקות לכל היותר. סוכנים שההפעלה מחדש קטעה ממשיכים מעצמם. אין צורך ללחוץ על דבר.",
    "it": "HXBot cerca una nuova versione ogni pochi minuti, anche mentre gli agenti lavorano. La scarica e la installa in background, poi salva e si riavvia nella nuova versione quando gli agenti sono inattivi, o al massimo dopo 10 minuti. Gli agenti interrotti dal riavvio continuano da soli. Non c’è nulla da cliccare.",
    "ja": "HXBot は数分ごとに新しいバージョンを確認します。エージェントが作業している間も確認します。見つかったらバックグラウンドでダウンロードしてインストールし、エージェントが待機中になったら（最長 10 分待って）保存して新しいバージョンで再起動します。再起動で中断されたエージェントは自動で続きを行います。クリックは不要です。",
    "ko": "HXBot은 에이전트가 일하는 동안에도 몇 분마다 새 버전을 확인합니다. 새 버전을 찾으면 백그라운드에서 다운로드하고 설치한 뒤, 에이전트가 쉬고 있을 때(최대 10분 기다림) 저장하고 새 버전으로 다시 시작합니다. 다시 시작 때문에 중단된 에이전트는 스스로 이어서 작업합니다. 아무것도 누를 필요가 없습니다.",
    "nl": "HXBot zoekt om de paar minuten naar een nieuwe versie, ook terwijl de agents werken. Hij downloadt en installeert die op de achtergrond, slaat daarna op en start opnieuw op in de nieuwe versie zodra de agents niets te doen hebben, of uiterlijk na 10 minuten. Agents die door de herstart zijn onderbroken, gaan vanzelf verder. Je hoeft nergens op te klikken.",
    "pl": "HXBot co kilka minut sprawdza, czy jest nowa wersja, także gdy agenci pracują. Pobiera ją i instaluje w tle, a potem zapisuje i uruchamia się ponownie w nowej wersji, gdy agenci są bezczynni, najpóźniej po 10 minutach. Agenci, których przerwało ponowne uruchomienie, sami kontynuują pracę. Nie trzeba niczego klikać.",
    "pt": "O HXBot procura uma nova versão a cada poucos minutos, também enquanto os agentes trabalham. Ele a baixa e instala em segundo plano, depois salva e reinicia na nova versão quando os agentes estão ociosos, ou no máximo após 10 minutos. Os agentes que a reinicialização interrompeu continuam sozinhos. Não é preciso clicar em nada.",
    "ru": "HXBot проверяет наличие новой версии каждые несколько минут, в том числе пока агенты работают. Он скачивает и устанавливает её в фоне, затем сохраняет всё и перезапускается в новой версии, когда агенты свободны, но не позже чем через 10 минут. Агенты, которых прервал перезапуск, продолжают сами. Нажимать ничего не нужно.",
    "tr": "HXBot, ajanlar çalışırken de birkaç dakikada bir yeni sürüm olup olmadığına bakar. Yeni sürümü arka planda indirip kurar, ardından ajanlar boştayken, en geç 10 dakika sonra kaydedip yeni sürümle yeniden başlar. Yeniden başlatmanın yarıda kestiği ajanlar kendiliğinden devam eder. Hiçbir şeye tıklamanız gerekmez.",
}
