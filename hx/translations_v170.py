"""HXBot v1.7.0 不打扰其他应用：不抢焦点的通知文字在其他 13 种语言里的译文。

英文和中文写在 hx/quiet.py。translations.py 的最后把这里的内容并进 KEYS 和 PHRASES。
每种语言按 ORDER 的顺序一句一句写。
"""

from __future__ import annotations

ORDER = [
    "computerUse.hxAskTitle",
    "computerUse.hxAskBody",
    "remoteDesktop.host.hxAskBody",
]

_LANG: dict[str, list[str]] = {
    "ar": [
        "يحتاج HXBot إلى إذن",
        "انقر لفتح الصفحة في إعدادات النظام. لا يفتحها HXBot بنفسه أثناء عملك في تطبيق آخر.",
        "انقر خلال 30 ثانية للرد في HXBot.",
    ],
    "de": [
        "HXBot braucht eine Berechtigung",
        "Klicke, um die Seite in den Systemeinstellungen zu öffnen. HXBot öffnet sie nicht, während du in einer anderen App arbeitest.",
        "Klicke innerhalb von 30 Sekunden, um in HXBot zu antworten.",
    ],
    "es": [
        "HXBot necesita un permiso",
        "Haz clic para abrir la página en Ajustes del Sistema. HXBot no la abre mientras trabajas en otra app.",
        "Haz clic en menos de 30 segundos para responder en HXBot.",
    ],
    "fr": [
        "HXBot a besoin d’une autorisation",
        "Cliquez pour ouvrir la page dans Réglages Système. HXBot ne l’ouvre pas pendant que vous travaillez dans une autre app.",
        "Cliquez dans les 30 secondes pour répondre dans HXBot.",
    ],
    "he": [
        "HXBot צריך הרשאה",
        "לחץ כדי לפתוח את הדף בהגדרות המערכת. HXBot לא פותח אותו בזמן שאתה עובד ביישום אחר.",
        "לחץ תוך 30 שניות כדי לענות ב-HXBot.",
    ],
    "it": [
        "HXBot ha bisogno di un permesso",
        "Fai clic per aprire la pagina in Impostazioni di Sistema. HXBot non la apre mentre lavori in un’altra app.",
        "Fai clic entro 30 secondi per rispondere in HXBot.",
    ],
    "ja": [
        "HXBot に許可が必要です",
        "クリックするとシステム設定のそのページが開きます。ほかのアプリで作業している間、HXBot は自分では開きません。",
        "30 秒以内にクリックして、HXBot で答えてください。",
    ],
    "ko": [
        "HXBot에 권한이 필요해요",
        "클릭하면 시스템 설정의 해당 페이지가 열려요. 다른 앱을 쓰는 동안에는 HXBot이 직접 열지 않아요.",
        "30초 안에 클릭해서 HXBot에서 답해 주세요.",
    ],
    "nl": [
        "HXBot heeft een toestemming nodig",
        "Klik om de pagina in Systeeminstellingen te openen. HXBot opent die niet terwijl je in een andere app werkt.",
        "Klik binnen 30 seconden om in HXBot te antwoorden.",
    ],
    "pl": [
        "HXBot potrzebuje uprawnienia",
        "Kliknij, aby otworzyć stronę w Ustawieniach systemowych. HXBot nie otwiera jej, gdy pracujesz w innej aplikacji.",
        "Kliknij w ciągu 30 sekund, aby odpowiedzieć w HXBot.",
    ],
    "pt": [
        "O HXBot precisa de uma permissão",
        "Clique para abrir a página nos Ajustes do Sistema. O HXBot não a abre enquanto você trabalha em outro app.",
        "Clique em até 30 segundos para responder no HXBot.",
    ],
    "ru": [
        "HXBot нужно разрешение",
        "Нажмите, чтобы открыть страницу в Системных настройках. Пока вы работаете в другом приложении, HXBot не открывает её сам.",
        "Нажмите в течение 30 секунд, чтобы ответить в HXBot.",
    ],
    "tr": [
        "HXBot bir izne ihtiyaç duyuyor",
        "Sistem Ayarları'nda sayfayı açmak için tıklayın. Başka bir uygulamada çalışırken HXBot onu kendisi açmaz.",
        "HXBot'ta yanıtlamak için 30 saniye içinde tıklayın.",
    ],
}

NEW: dict[str, dict[str, str]] = {locale: dict(zip(ORDER, phrases, strict=True)) for locale, phrases in _LANG.items()}
NEW_KEYS = {key: key for key in ORDER}

PLACEHOLDERS: dict[str, set[str]] = {}
