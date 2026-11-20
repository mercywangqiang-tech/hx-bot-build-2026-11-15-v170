"""HXBot：研究版自己的界面文字在其他 13 种语言里的译文。

研究版加的文字（登录、注册、按需授权、保密箱、帮助菜单……）和改了意思的上游文字，英文和中文写在各自的步骤里
（rebrand.py、access_control.py、close_upstream.py）；这里是阿拉伯语、德语、西班牙语、法语、希伯来语、意大利语、
日语、韩语、荷兰语、波兰语、葡萄牙语（巴西）、俄语、土耳其语的译文。

`translate(r)` 由 upstream_checks 在改名之前调用：每种语言的文件里有这条文字就改成译文，没有就按英文的顺序加进去；
packages/i18n/untranslated.json 里不再登记这些文字（rebrand.untranslated 也不再登记有译文的语言）。

写译文的约定（与上游各语言已有的文字一致）：
- 名称照原样：HXBot、Claude、Codex、Computer Use、GitHub、macOS、bot.hxallai.com。
- 界面上的名称用这种语言界面里的写法，例如“按需授权”“完全访问”用 agentSettings.access.* 的译文。
- 门户页面（注册、找回密码）只有中文和英文，所以译文只说“在 bot.hxallai.com 重设密码”，不引用页面上按钮的名字；
  授权卡片也只有中文和英文，所以译文只说“读取、写入、删除”，不加引号当按钮名。
- 占位符 {email} {time} {provider} {tool} {reason} 原样保留。
"""

from __future__ import annotations

import json
import re

LOCALES = ["ar", "de", "es", "fr", "he", "it", "ja", "ko", "nl", "pl", "pt", "ru", "tr"]
MESSAGES = "packages/i18n/src/messages"

# 每个键用哪一句译文（几个键的英文相同时共用一句）
KEYS = {
    "account.login.hxSignInDescription": "signInDescription",
    "account.login.hxContinue": "continue",
    "account.login.hxContinuing": "moment",
    "account.login.hxContinueFailed": "failed",
    "account.login.hxPasswordTitle": "pwTitle",
    "account.login.hxPasswordFor": "pwFor",
    "account.login.hxPasswordLabel": "pwLabel",
    "account.login.hxPasswordHint": "pwHint",
    "account.login.hxPasswordRequired": "pwRequired",
    "account.login.hxPasswordIncorrect": "pwIncorrect",
    "account.login.hxPasswordTooMany": "pwTooMany",
    "account.login.hxPasswordExpired": "pwExpired",
    "account.login.hxPasswordAccepted": "pwAccepted",
    "account.login.hxForgotPassword": "forgot",
    "account.login.hxCreateAccount": "create",
    "account.login.hxSignIn": "signIn",
    "account.login.hxVerifyFailed": "verifyFailed",
    "account.login.hxStartAgain": "startAgain",
    "account.login.hxStartAgainIn": "startAgainIn",
    "account.login.hxStartingAgain": "moment",
    "mobile.auth.email.hxDescription": "mobileDescription",
    "mobile.auth.email.hxContinue": "continue",
    "mobile.auth.email.hxContinuing": "moment",
    "mobile.auth.email.hxContinueFailed": "failed",
    "mobile.auth.email.hxPasswordTitle": "pwTitle",
    "mobile.auth.email.hxPasswordFor": "pwFor",
    "mobile.auth.email.hxPasswordLabel": "pwLabel",
    "mobile.auth.email.hxPasswordIncorrect": "pwIncorrect",
    "mobile.auth.email.hxPasswordTooMany": "pwTooMany",
    "mobile.auth.email.hxPasswordExpired": "pwExpired",
    "mobile.auth.email.hxVerifyFailed": "verifyFailed",
    "mobile.auth.email.hxSignIn": "signIn",
    "mobile.auth.email.hxForgotPassword": "forgot",
    "mobile.auth.email.hxCreateAccount": "create",
    "mobile.auth.email.hxStartAgain": "startAgain",
    "mobile.auth.email.hxStartingAgain": "moment",
    "mobile.auth.email.hxReady": "mobileReady",
    "webClient.connect.stepSignIn": "stepSignIn",
    "agentSettings.hxFullAgain.title": "fullTitle",
    "agentSettings.hxFullAgain.description": "fullDescription",
    "agentSettings.hxFullAgain.confirm": "fullConfirm",
    "agentSettings.runtime.workspaceNote": "note",
    "agentSettings.runtime.workspaceEnforcedCommand": "noteCommand",
    "agentSettings.runtime.workspaceEnforcedClaude": "noteClaude",
    "agentSettings.runtime.workspaceUnlimited": "noteUnlimited",
    "agentSettings.runtime.workspaceEnforcedProcess": "noteProcess",
    "mobile.agent.access.hxFullAgainTitle": "fullTitle",
    "mobile.agent.access.hxFullAgainBody": "fullBodyMobile",
    "mobile.agent.access.hxFullAgainConfirm": "fullConfirm",
    "mobile.agent.access.workspaceNote": "noteMobile",
    "mobile.chat.question.hxConfirmChoice": "confirm",
    "error.agent.workspaceOnlyMacOnly": "macOnly",
    "error.agent.workspaceOnlyToolMissing": "toolMissing",
    "error.agent.claudeSandboxUnavailable": "sandbox",
    "error.provider.customAgentWorkspaceOnly": "customBlocks",
    "composer.hxSecret.title": "secretTitle",
    "composer.hxSecret.body": "secretBody",
    "composer.hxSecret.openVault": "openVault",
    "composer.hxSecret.sendAnyway": "sendAnyway",
    "mobile.chat.hxSecret.title": "secretTitleMobile",
    "mobile.chat.hxSecret.body": "secretBodyMobile",
    "mobile.chat.hxSecret.edit": "editMessage",
    "mobile.chat.hxSecret.openVault": "openVault",
    "mobile.chat.hxSecret.sendAnyway": "sendAnyway",
    "app.help.guides": "helpGuide",
    "app.help.discord": "helpServer",
    "app.help.changelog": "helpDownload",
    "settings.mobileConnect.qr.appStore": "qrOpens",
    "settings.mobileConnect.qr.playStore": "qrOpens",
    "settings.mobileConnect.iosApp.qrLabel": "qrLabel",
    "settings.mobileConnect.androidApp.qrLabel": "qrLabel",
    "workflow.github.event.mention": "ghMention",
    "workflow.github.event.assigned": "ghAssigned",
    "mobile.workflow.github.event.mention": "ghMention",
    "mobile.workflow.github.event.assigned": "ghAssigned",
    "server.join.description": "joinDescription",
}

PHRASES: dict[str, dict[str, str]] = {
    "ar": {
        "signInDescription": "سجّل الدخول ببريدك الإلكتروني وكلمة المرور. ليس لديك حساب بعد؟ أنشئ حسابًا على bot.hxallai.com.",
        "continue": "متابعة",
        "moment": "لحظة…",
        "failed": "حدث خطأ. حاول مرة أخرى.",
        "pwTitle": "أدخل كلمة المرور",
        "pwFor": "تسجيل الدخول باسم {email}.",
        "pwLabel": "كلمة المرور",
        "pwHint": "نسيت كلمة المرور؟ افتح bot.hxallai.com لإعادة تعيينها.",
        "pwRequired": "أدخل كلمة المرور.",
        "pwIncorrect": "البريد الإلكتروني أو كلمة المرور غير صحيحة.",
        "pwTooMany": "عدد كبير جدًا من كلمات المرور الخاطئة. اختر «البدء من جديد».",
        "pwExpired": "انتهت مهلة هذه الخطوة. اختر «البدء من جديد».",
        "pwAccepted": "تم قبول كلمة المرور.",
        "forgot": "هل نسيت كلمة المرور؟",
        "create": "إنشاء حساب",
        "signIn": "تسجيل الدخول",
        "verifyFailed": "تعذّر تسجيل الدخول. حاول مرة أخرى.",
        "startAgain": "البدء من جديد",
        "startAgainIn": "البدء من جديد بعد {time}",
        "mobileDescription": "أدخل بريدك الإلكتروني، ثم كلمة المرور. ليس لديك حساب بعد؟ أنشئ حسابًا على bot.hxallai.com من المتصفح.",
        "mobileReady": "أدخل كلمة المرور. هل نسيتها؟ أعد تعيينها على bot.hxallai.com.",
        "stepSignIn": "سجّل الدخول ببريدك الإلكتروني وكلمة المرور.",
        "fullTitle": "أكّد مرة أخرى: هل تريد تشغيل الوصول الكامل؟",
        "fullDescription": "مع الوصول الكامل لا يعود الوكيل يسأل قبل أن يقرأ ملفاتك أو يغيّرها أو يحذفها، أو يشغّل الأوامر، أو يستخدم المواقع. "
                           "شغّله فقط لوكيل ومهمة تثق بهما، وارجع إلى «إذن عند الحاجة» عند انتهاء المهمة.",
        "fullBodyMobile": "مع الوصول الكامل لا يعود الوكيل يسأل قبل أن يقرأ ملفاتك أو يغيّرها أو يحذفها، أو يشغّل الأوامر، أو يستخدم المواقع. "
                          "ارجع إلى «إذن عند الحاجة» عند انتهاء المهمة.",
        "fullConfirm": "تشغيل الوصول الكامل",
        "note": "إذن عند الحاجة: يقرأ الوكيل ويكتب في مساحة عمله والمجلد المشترك والمجلدات المؤقتة. ولأي شيء آخر يسألك أولًا ويوضح السبب والغرض: "
                "الملفات في أماكن أخرى، والحذف، والأوامر، والمواقع، والشاشة، والبحث على الويب. أنت تختار ما تسمح به من قراءة أو كتابة أو حذف، "
                "وينتهي الإذن بانتهاء المهمة.",
        "noteCommand": "يسأل Codex قبل كل أمر وكل تغيير في ملف، والأذونات هي التي تجيب. أما القراءات البسيطة مثل cat أو ls فتعمل دون سؤال، "
                       "حتى خارج مساحة العمل.",
        "noteClaude": "يُتحقَّق من كل استدعاء أداة يجريه Claude وفق الأذونات.",
        "noteUnlimited": "يكون Computer Use متوقفًا في وضع «إذن عند الحاجة».",
        "noteProcess": "على macOS تعمل عملية {provider} بالكامل داخل بيئة معزولة، لذا تفشل أي كتابة خارجها. يُتحقَّق مما تطلبه وفق الأذونات؛ "
                       "أما القراءة التي لا تطلبها فلا تُقيَّد.",
        "noteMobile": "يعمل الوكيل في مساحة عمله والمجلد المشترك، ويسألك قبل أن يصل إلى أي شيء آخر. ينتهي الإذن بانتهاء المهمة.",
        "confirm": "تأكيد",
        "macOnly": "«إذن عند الحاجة» متاح لهذا المزوّد على macOS فقط. اختر «وصول كامل» في إعدادات الوكيل.",
        "toolMissing": "يحتاج «إذن عند الحاجة» إلى {tool}، ولم يعثر عليه HXBot. ثبّته أو اختر «وصول كامل» في إعدادات الوكيل.",
        "sandbox": "يحتاج «إذن عند الحاجة» إلى بيئة Claude المعزولة، ولا يستطيع Claude تشغيلها على هذا الكمبيوتر: {reason}. "
                   "اختر «وصول كامل» أو مزوّدًا آخر في إعدادات الوكيل.",
        "customBlocks": "{reason}. «إذن عند الحاجة» يمنع هذا. جرّب «وصول كامل».",
        "secretTitle": "يبدو أن هذه الرسالة تحتوي على كلمة مرور أو مفتاح",
        "secretBody": "لا ترسل كلمات المرور أو مفاتيح API أو الرموز المميزة في الدردشة: سيقرؤها نموذج الذكاء الاصطناعي. "
                      "احفظها في الخزنة، ثم أخبر الوكيل باسمها فقط. والوكيل الذي يحتاج إلى أحدها يعرض نموذجًا آمنًا.",
        "secretBodyMobile": "لا ترسل كلمات المرور أو مفاتيح API أو الرموز المميزة في الدردشة: سيقرؤها نموذج الذكاء الاصطناعي. "
                            "احفظها في الخزنة، ثم أخبر الوكيل باسمها فقط.",
        "secretTitleMobile": "كلمة مرور أو مفتاح في الرسالة",
        "openVault": "فتح الخزنة",
        "sendAnyway": "الإرسال على أي حال",
        "editMessage": "تعديل الرسالة",
        "helpGuide": "الدليل",
        "helpServer": "الخادم",
        "helpDownload": "تنزيل أحدث إصدار",
        "qrOpens": "يفتح صفحة تنزيل HXBot",
        "qrLabel": "رمز QR لصفحة التنزيل",
        "ghMention": "إشارة إلى تطبيق GitHub",
        "ghAssigned": "مُسنَد إلى تطبيق GitHub",
        "joinDescription": "الصق رابط الدعوة من مالك الخادم. ينشئه المالك في تطبيق سطح المكتب: إعدادات الخادم ← الأعضاء، ثم ينشر الخادم، "
                           "ثم دعوة أشخاص ← رابط الدعوة.",
    },
    "de": {
        "signInDescription": "Melde dich mit deiner E-Mail-Adresse und deinem Passwort an. Noch kein Konto? Erstelle eins auf bot.hxallai.com.",
        "continue": "Weiter",
        "moment": "Einen Moment…",
        "failed": "Etwas ist schiefgelaufen. Versuche es erneut.",
        "pwTitle": "Passwort eingeben",
        "pwFor": "Anmeldung als {email}.",
        "pwLabel": "Passwort",
        "pwHint": "Passwort vergessen? Öffne bot.hxallai.com und setze es dort zurück.",
        "pwRequired": "Gib dein Passwort ein.",
        "pwIncorrect": "E-Mail-Adresse oder Passwort ist falsch.",
        "pwTooMany": "Zu viele falsche Passwörter. Wähle „Neu beginnen“.",
        "pwExpired": "Dieser Schritt ist abgelaufen. Wähle „Neu beginnen“.",
        "pwAccepted": "Passwort akzeptiert.",
        "forgot": "Passwort vergessen?",
        "create": "Konto erstellen",
        "signIn": "Anmelden",
        "verifyFailed": "Anmeldung fehlgeschlagen. Versuche es erneut.",
        "startAgain": "Neu beginnen",
        "startAgainIn": "Neu beginnen in {time}",
        "mobileDescription": "Gib deine E-Mail-Adresse ein, danach dein Passwort. Noch kein Konto? Erstelle eins im Browser auf bot.hxallai.com.",
        "mobileReady": "Gib dein Passwort ein. Vergessen? Setze es auf bot.hxallai.com zurück.",
        "stepSignIn": "Melde dich mit deiner E-Mail-Adresse und deinem Passwort an.",
        "fullTitle": "Noch einmal bestätigen: vollen Zugriff einschalten?",
        "fullDescription": "Mit vollem Zugriff fragt der Agent nicht mehr, bevor er deine Dateien liest, ändert oder löscht, Befehle ausführt "
                           "oder Websites nutzt. Schalte ihn nur für einen Agenten und eine Aufgabe ein, denen du vertraust, und wechsle nach "
                           "der Aufgabe zurück zu „Zugriff auf Anfrage“.",
        "fullBodyMobile": "Mit vollem Zugriff fragt der Agent nicht mehr, bevor er deine Dateien liest, ändert oder löscht, Befehle ausführt "
                          "oder Websites nutzt. Wechsle nach der Aufgabe zurück zu „Zugriff auf Anfrage“.",
        "fullConfirm": "Vollen Zugriff einschalten",
        "note": "Zugriff auf Anfrage: Der Agent liest und schreibt in seinem Arbeitsbereich, im gemeinsamen Ordner und in den temporären "
                "Ordnern. Für alles andere fragt er dich vorher und sagt, warum und wofür: Dateien an anderen Orten, Löschen, Befehle, "
                "Websites, den Bildschirm und die Websuche. Du wählst, ob Lesen, Schreiben oder Löschen erlaubt ist, und die Freigabe "
                "endet mit der Aufgabe.",
        "noteCommand": "Codex fragt vor jedem Befehl und jeder Dateiänderung, und die Freigaben entscheiden. Einfache Lesebefehle wie cat "
                       "oder ls laufen ohne Nachfrage, auch außerhalb des Arbeitsbereichs.",
        "noteClaude": "Jeder Werkzeugaufruf von Claude wird mit den Freigaben abgeglichen.",
        "noteUnlimited": "Bei „Zugriff auf Anfrage“ ist Computer Use aus.",
        "noteProcess": "Unter macOS läuft der ganze {provider}-Prozess in einer Sandbox, daher schlägt ein Schreibzugriff außerhalb fehl. "
                       "Was er anfragt, wird mit den Freigaben abgeglichen; ein Lesezugriff, den er nicht anfragt, ist nicht begrenzt.",
        "noteMobile": "Der Agent arbeitet in seinem Arbeitsbereich und im gemeinsamen Ordner und fragt dich, bevor er auf anderes zugreift. "
                      "Eine Freigabe endet mit der Aufgabe.",
        "confirm": "Bestätigen",
        "macOnly": "„Zugriff auf Anfrage“ ist für diesen Anbieter nur unter macOS verfügbar. Wähle „Voller Zugriff“ in den "
                   "Agenteneinstellungen.",
        "toolMissing": "„Zugriff auf Anfrage“ benötigt {tool}, das HXBot nicht gefunden hat. Installiere es oder wähle „Voller Zugriff“ "
                       "in den Agenteneinstellungen.",
        "sandbox": "„Zugriff auf Anfrage“ braucht die Claude-Sandbox, die Claude auf diesem Computer nicht starten kann: {reason}. "
                   "Wähle „Voller Zugriff“ oder einen anderen Anbieter in den Agenteneinstellungen.",
        "customBlocks": "{reason}. „Zugriff auf Anfrage“ blockiert das. Versuche „Voller Zugriff“.",
        "secretTitle": "Diese Nachricht scheint ein Passwort oder einen Schlüssel zu enthalten",
        "secretBody": "Sende keine Passwörter, API-Schlüssel oder Tokens im Chat: Das KI-Modell würde sie lesen. Speichere sie im Tresor "
                      "und nenne dem Agenten nur den Namen. Braucht ein Agent so etwas, zeigt er ein sicheres Formular.",
        "secretBodyMobile": "Sende keine Passwörter, API-Schlüssel oder Tokens im Chat: Das KI-Modell würde sie lesen. Speichere sie im "
                            "Tresor und nenne dem Agenten nur den Namen.",
        "secretTitleMobile": "Passwort oder Schlüssel in der Nachricht",
        "openVault": "Tresor öffnen",
        "sendAnyway": "Trotzdem senden",
        "editMessage": "Nachricht bearbeiten",
        "helpGuide": "Anleitung",
        "helpServer": "Server",
        "helpDownload": "Neueste Version herunterladen",
        "qrOpens": "Öffnet die Downloadseite von HXBot",
        "qrLabel": "QR-Code der Downloadseite",
        "ghMention": "Erwähnung der GitHub-App",
        "ghAssigned": "Der GitHub-App zugewiesen",
        "joinDescription": "Füge den Einladungslink des Servereigentümers ein. Der Eigentümer erstellt ihn in der Desktop-App: "
                           "Servereinstellungen → Mitglieder, Server veröffentlichen, dann Personen einladen → Einladungslink.",
    },
    "es": {
        "signInDescription": "Inicia sesión con tu correo y tu contraseña. ¿Aún no tienes cuenta? Créala en bot.hxallai.com.",
        "continue": "Continuar",
        "moment": "Un momento…",
        "failed": "Algo salió mal. Vuelve a intentarlo.",
        "pwTitle": "Introduce tu contraseña",
        "pwFor": "Iniciando sesión como {email}.",
        "pwLabel": "Contraseña",
        "pwHint": "¿Olvidaste tu contraseña? Abre bot.hxallai.com para restablecerla.",
        "pwRequired": "Introduce tu contraseña.",
        "pwIncorrect": "El correo o la contraseña no son correctos.",
        "pwTooMany": "Demasiadas contraseñas incorrectas. Elige «Empezar de nuevo».",
        "pwExpired": "Este paso ha caducado. Elige «Empezar de nuevo».",
        "pwAccepted": "Contraseña aceptada.",
        "forgot": "¿Olvidaste tu contraseña?",
        "create": "Crear una cuenta",
        "signIn": "Iniciar sesión",
        "verifyFailed": "No se pudo iniciar sesión. Vuelve a intentarlo.",
        "startAgain": "Empezar de nuevo",
        "startAgainIn": "Empezar de nuevo en {time}",
        "mobileDescription": "Introduce tu correo y después tu contraseña. ¿Aún no tienes cuenta? Créala en bot.hxallai.com desde un navegador.",
        "mobileReady": "Introduce tu contraseña. ¿La olvidaste? Restablécela en bot.hxallai.com.",
        "stepSignIn": "Inicia sesión con tu correo y tu contraseña.",
        "fullTitle": "Confirma de nuevo: ¿activar el acceso completo?",
        "fullDescription": "Con acceso completo, el agente ya no pregunta antes de leer, cambiar o eliminar tus archivos, ejecutar comandos "
                           "o usar sitios web. Actívalo solo para un agente y una tarea de confianza, y vuelve a «Acceso bajo demanda» "
                           "cuando termine la tarea.",
        "fullBodyMobile": "Con acceso completo, el agente ya no pregunta antes de leer, cambiar o eliminar tus archivos, ejecutar comandos "
                          "o usar sitios web. Vuelve a «Acceso bajo demanda» cuando termine la tarea.",
        "fullConfirm": "Activar acceso completo",
        "note": "Acceso bajo demanda: el agente lee y escribe en su espacio de trabajo, la carpeta compartida y las carpetas temporales. "
                "Para todo lo demás, primero te pregunta y explica por qué y para qué: archivos en otros lugares, eliminaciones, comandos, "
                "sitios web, la pantalla y la búsqueda web. Tú eliges si permites leer, escribir o eliminar, y el permiso termina con la tarea.",
        "noteCommand": "Codex pregunta antes de cada comando y cada cambio de archivo, y los permisos responden. Las lecturas simples como "
                       "cat o ls se ejecutan sin preguntar, también fuera del espacio de trabajo.",
        "noteClaude": "Cada llamada a una herramienta de Claude se comprueba con los permisos.",
        "noteUnlimited": "Con «Acceso bajo demanda», Computer Use está desactivado.",
        "noteProcess": "En macOS, todo el proceso de {provider} se ejecuta en un entorno aislado, así que una escritura fuera falla. Lo que "
                       "solicita se comprueba con los permisos; una lectura que no solicita no está limitada.",
        "noteMobile": "El agente trabaja en su espacio de trabajo y la carpeta compartida, y te pregunta antes de acceder a cualquier otra "
                      "cosa. Un permiso termina con la tarea.",
        "confirm": "Confirmar",
        "macOnly": "Con este proveedor, «Acceso bajo demanda» solo está disponible en macOS. Elige «Acceso completo» en los ajustes "
                   "del agente.",
        "toolMissing": "«Acceso bajo demanda» necesita {tool}, que HXBot no encontró. Instálalo o elige «Acceso completo» en los ajustes "
                       "del agente.",
        "sandbox": "«Acceso bajo demanda» necesita el entorno aislado de Claude, que Claude no puede iniciar en este ordenador: {reason}. "
                   "Elige «Acceso completo» u otro proveedor en los ajustes del agente.",
        "customBlocks": "{reason}. «Acceso bajo demanda» lo bloquea. Prueba «Acceso completo».",
        "secretTitle": "Parece que este mensaje contiene una contraseña o una clave",
        "secretBody": "No envíes contraseñas, claves de API ni tokens en el chat: el modelo de IA los leería. Guárdalos en la bóveda y "
                      "dile al agente solo su nombre. Si un agente necesita uno, muestra un formulario seguro.",
        "secretBodyMobile": "No envíes contraseñas, claves de API ni tokens en el chat: el modelo de IA los leería. Guárdalos en la bóveda "
                            "y dile al agente solo su nombre.",
        "secretTitleMobile": "Contraseña o clave en el mensaje",
        "openVault": "Abrir la bóveda",
        "sendAnyway": "Enviar de todos modos",
        "editMessage": "Editar mensaje",
        "helpGuide": "Guía",
        "helpServer": "Servidor",
        "helpDownload": "Descargar la última versión",
        "qrOpens": "Abre la página de descarga de HXBot",
        "qrLabel": "Código QR de la página de descarga",
        "ghMention": "Mención de la app de GitHub",
        "ghAssigned": "Asignado a la app de GitHub",
        "joinDescription": "Pega el enlace de invitación del propietario del servidor. El propietario lo crea en la app de escritorio: "
                           "Ajustes del servidor → Miembros, publica el servidor y luego Invitar personas → Enlace.",
    },
    "fr": {
        "signInDescription": "Connectez-vous avec votre e-mail et votre mot de passe. Pas encore de compte ? Créez-en un sur bot.hxallai.com.",
        "continue": "Continuer",
        "moment": "Un instant…",
        "failed": "Un problème est survenu. Réessayez.",
        "pwTitle": "Saisissez votre mot de passe",
        "pwFor": "Connexion en tant que {email}.",
        "pwLabel": "Mot de passe",
        "pwHint": "Mot de passe oublié ? Ouvrez bot.hxallai.com pour le réinitialiser.",
        "pwRequired": "Saisissez votre mot de passe.",
        "pwIncorrect": "L’e-mail ou le mot de passe est incorrect.",
        "pwTooMany": "Trop de mots de passe incorrects. Choisissez « Recommencer ».",
        "pwExpired": "Cette étape a expiré. Choisissez « Recommencer ».",
        "pwAccepted": "Mot de passe accepté.",
        "forgot": "Mot de passe oublié ?",
        "create": "Créer un compte",
        "signIn": "Se connecter",
        "verifyFailed": "La connexion a échoué. Réessayez.",
        "startAgain": "Recommencer",
        "startAgainIn": "Recommencer dans {time}",
        "mobileDescription": "Saisissez votre e-mail, puis votre mot de passe. Pas encore de compte ? Créez-en un sur bot.hxallai.com dans "
                             "un navigateur.",
        "mobileReady": "Saisissez votre mot de passe. Oublié ? Réinitialisez-le sur bot.hxallai.com.",
        "stepSignIn": "Connectez-vous avec votre e-mail et votre mot de passe.",
        "fullTitle": "Confirmer à nouveau : activer l’accès complet ?",
        "fullDescription": "Avec l’accès complet, l’agent ne demande plus avant de lire, modifier ou supprimer vos fichiers, d’exécuter des "
                           "commandes ou d’utiliser des sites web. Activez-le seulement pour un agent et une tâche de confiance, et revenez "
                           "à « Accès sur demande » une fois la tâche terminée.",
        "fullBodyMobile": "Avec l’accès complet, l’agent ne demande plus avant de lire, modifier ou supprimer vos fichiers, d’exécuter des "
                          "commandes ou d’utiliser des sites web. Revenez à « Accès sur demande » une fois la tâche terminée.",
        "fullConfirm": "Activer l’accès complet",
        "note": "Accès sur demande : l’agent lit et écrit dans son espace de travail, le dossier partagé et les dossiers temporaires. Pour "
                "tout le reste, il vous demande d’abord en expliquant pourquoi et pour quoi faire : fichiers ailleurs, suppressions, "
                "commandes, sites web, écran et recherche web. Vous choisissez d’autoriser la lecture, l’écriture ou la suppression, et "
                "l’autorisation prend fin avec la tâche.",
        "noteCommand": "Codex demande avant chaque commande et chaque modification de fichier, et les autorisations répondent. Les simples "
                       "lectures comme cat ou ls s’exécutent sans demander, y compris hors de l’espace de travail.",
        "noteClaude": "Chaque appel d’outil de Claude est vérifié par rapport aux autorisations.",
        "noteUnlimited": "Computer Use est désactivé en « Accès sur demande ».",
        "noteProcess": "Sur macOS, tout le processus {provider} s’exécute dans un bac à sable : une écriture à l’extérieur échoue. Ce qu’il "
                       "demande est vérifié par rapport aux autorisations ; une lecture qu’il ne demande pas n’est pas limitée.",
        "noteMobile": "L’agent travaille dans son espace de travail et le dossier partagé, et vous demande avant d’accéder à autre chose. "
                      "Une autorisation prend fin avec la tâche.",
        "confirm": "Confirmer",
        "macOnly": "« Accès sur demande » n’est disponible pour ce fournisseur que sur macOS. Choisissez « Accès complet » dans les "
                   "réglages de l’agent.",
        "toolMissing": "« Accès sur demande » nécessite {tool}, que HXBot n’a pas trouvé. Installez-le ou choisissez « Accès complet » "
                       "dans les réglages de l’agent.",
        "sandbox": "« Accès sur demande » nécessite le bac à sable de Claude, que Claude ne peut pas démarrer sur cet ordinateur : {reason}. "
                   "Choisissez « Accès complet » ou un autre fournisseur dans les réglages de l’agent.",
        "customBlocks": "{reason}. « Accès sur demande » bloque cette action. Essayez « Accès complet ».",
        "secretTitle": "Ce message semble contenir un mot de passe ou une clé",
        "secretBody": "N’envoyez pas de mots de passe, de clés d’API ni de jetons dans la discussion : le modèle d’IA les lirait. "
                      "Enregistrez-les dans le coffre, puis donnez seulement leur nom à l’agent. Un agent qui en a besoin affiche un "
                      "formulaire sécurisé.",
        "secretBodyMobile": "N’envoyez pas de mots de passe, de clés d’API ni de jetons dans la discussion : le modèle d’IA les lirait. "
                            "Enregistrez-les dans le coffre, puis donnez seulement leur nom à l’agent.",
        "secretTitleMobile": "Mot de passe ou clé dans le message",
        "openVault": "Ouvrir le coffre",
        "sendAnyway": "Envoyer quand même",
        "editMessage": "Modifier le message",
        "helpGuide": "Guide",
        "helpServer": "Serveur",
        "helpDownload": "Télécharger la dernière version",
        "qrOpens": "Ouvre la page de téléchargement d’HXBot",
        "qrLabel": "QR code de la page de téléchargement",
        "ghMention": "Mention de l’app GitHub",
        "ghAssigned": "Assigné à l’app GitHub",
        "joinDescription": "Collez le lien d’invitation du propriétaire du serveur. Le propriétaire le crée dans l’app de bureau : Réglages "
                           "du serveur → Membres, publier le serveur, puis Inviter des personnes → Lien d’invitation.",
    },
    "he": {
        "signInDescription": "התחברות באמצעות האימייל והסיסמה. עדיין אין חשבון? אפשר ליצור אחד ב-bot.hxallai.com.",
        "continue": "המשך",
        "moment": "רגע…",
        "failed": "משהו השתבש. יש לנסות שוב.",
        "pwTitle": "הזנת סיסמה",
        "pwFor": "התחברות בתור {email}.",
        "pwLabel": "סיסמה",
        "pwHint": "שכחת את הסיסמה? אפשר לאפס אותה ב-bot.hxallai.com.",
        "pwRequired": "יש להזין סיסמה.",
        "pwIncorrect": "האימייל או הסיסמה שגויים.",
        "pwTooMany": "יותר מדי סיסמאות שגויות. יש לבחור ב״להתחיל מחדש״.",
        "pwExpired": "הזמן לשלב הזה תם. יש לבחור ב״להתחיל מחדש״.",
        "pwAccepted": "הסיסמה התקבלה.",
        "forgot": "שכחת את הסיסמה?",
        "create": "יצירת חשבון",
        "signIn": "התחברות",
        "verifyFailed": "ההתחברות נכשלה. יש לנסות שוב.",
        "startAgain": "להתחיל מחדש",
        "startAgainIn": "להתחיל מחדש בעוד {time}",
        "mobileDescription": "יש להזין את האימייל ואחר כך את הסיסמה. עדיין אין חשבון? אפשר ליצור אחד ב-bot.hxallai.com בדפדפן.",
        "mobileReady": "יש להזין את הסיסמה. שכחת? אפשר לאפס אותה ב-bot.hxallai.com.",
        "stepSignIn": "יש להתחבר באמצעות האימייל והסיסמה.",
        "fullTitle": "אישור נוסף: להפעיל גישה מלאה?",
        "fullDescription": "עם גישה מלאה הסוכן כבר לא שואל לפני שהוא קורא, משנה או מוחק את הקבצים שלך, מריץ פקודות או משתמש באתרים. "
                           "כדאי להפעיל אותה רק לסוכן ולמשימה שסומכים עליהם, ולחזור ל״גישה לפי בקשה״ כשהמשימה מסתיימת.",
        "fullBodyMobile": "עם גישה מלאה הסוכן כבר לא שואל לפני שהוא קורא, משנה או מוחק את הקבצים שלך, מריץ פקודות או משתמש באתרים. "
                          "כשהמשימה מסתיימת, יש לחזור ל״גישה לפי בקשה״.",
        "fullConfirm": "הפעלת גישה מלאה",
        "note": "גישה לפי בקשה: הסוכן קורא וכותב בסביבת העבודה שלו, בתיקייה המשותפת ובתיקיות הזמניות. לכל דבר אחר הוא שואל קודם ומסביר "
                "למה ולאיזו מטרה: קבצים במקומות אחרים, מחיקה, פקודות, אתרים, המסך וחיפוש באינטרנט. הבחירה אם לאשר קריאה, כתיבה או מחיקה "
                "היא שלך, וההרשאה מסתיימת עם המשימה.",
        "noteCommand": "Codex שואל לפני כל פקודה ולפני כל שינוי בקובץ, וההרשאות קובעות את התשובה. קריאות פשוטות כמו cat או ls רצות בלי "
                       "לשאול, גם מחוץ לסביבת העבודה.",
        "noteClaude": "כל קריאה לכלי של Claude נבדקת מול ההרשאות.",
        "noteUnlimited": "ב״גישה לפי בקשה״ Computer Use כבוי.",
        "noteProcess": "ב-macOS כל התהליך של {provider} רץ בארגז חול, ולכן כתיבה מחוצה לו נכשלת. מה שהוא מבקש נבדק מול ההרשאות; קריאה "
                       "שהוא לא מבקש אינה מוגבלת.",
        "noteMobile": "הסוכן עובד בסביבת העבודה שלו ובתיקייה המשותפת, ושואל לפני שהוא ניגש לכל דבר אחר. הרשאה מסתיימת עם המשימה.",
        "confirm": "אישור",
        "macOnly": "״גישה לפי בקשה״ זמינה לספק הזה רק ב-macOS. יש לבחור ב״גישה מלאה״ בהגדרות הסוכן.",
        "toolMissing": "״גישה לפי בקשה״ צריכה את {tool}, ו-HXBot לא מצא אותו. יש להתקין אותו או לבחור ב״גישה מלאה״ בהגדרות הסוכן.",
        "sandbox": "״גישה לפי בקשה״ צריכה את ארגז החול של Claude, ו-Claude לא יכול להפעיל אותו במחשב הזה: {reason}. יש לבחור ב״גישה "
                   "מלאה״ או בספק אחר בהגדרות הסוכן.",
        "customBlocks": "{reason}. ״גישה לפי בקשה״ חוסמת זאת. אפשר לנסות ״גישה מלאה״.",
        "secretTitle": "נראה שההודעה הזו מכילה סיסמה או מפתח",
        "secretBody": "אין לשלוח בצ׳אט סיסמאות, מפתחות API או אסימונים: מודל ה-AI יקרא אותם. יש לשמור אותם בכספת ולמסור לסוכן רק את "
                      "השם. סוכן שצריך אחד מהם מציג טופס מאובטח.",
        "secretBodyMobile": "אין לשלוח בצ׳אט סיסמאות, מפתחות API או אסימונים: מודל ה-AI יקרא אותם. יש לשמור אותם בכספת ולמסור לסוכן "
                            "רק את השם.",
        "secretTitleMobile": "סיסמה או מפתח בהודעה",
        "openVault": "פתיחת הכספת",
        "sendAnyway": "לשלוח בכל זאת",
        "editMessage": "עריכת ההודעה",
        "helpGuide": "מדריך",
        "helpServer": "שרת",
        "helpDownload": "הורדת הגרסה האחרונה",
        "qrOpens": "פותח את דף ההורדה של HXBot",
        "qrLabel": "קוד QR של דף ההורדה",
        "ghMention": "אזכור של אפליקציית GitHub",
        "ghAssigned": "הוקצה לאפליקציית GitHub",
        "joinDescription": "יש להדביק את קישור ההזמנה מבעל השרת. בעל השרת יוצר אותו באפליקציה למחשב: הגדרות השרת ← חברים, מפרסמים את "
                           "השרת, ואז הזמנת אנשים ← קישור הזמנה.",
    },
    "it": {
        "signInDescription": "Accedi con la tua email e la tua password. Non hai ancora un account? Crealo su bot.hxallai.com.",
        "continue": "Continua",
        "moment": "Un attimo…",
        "failed": "Qualcosa è andato storto. Riprova.",
        "pwTitle": "Inserisci la password",
        "pwFor": "Accesso come {email}.",
        "pwLabel": "Password",
        "pwHint": "Password dimenticata? Apri bot.hxallai.com per reimpostarla.",
        "pwRequired": "Inserisci la password.",
        "pwIncorrect": "L'email o la password non sono corrette.",
        "pwTooMany": "Troppe password errate. Scegli «Ricomincia».",
        "pwExpired": "Questo passaggio è scaduto. Scegli «Ricomincia».",
        "pwAccepted": "Password accettata.",
        "forgot": "Password dimenticata?",
        "create": "Crea un account",
        "signIn": "Accedi",
        "verifyFailed": "Accesso non riuscito. Riprova.",
        "startAgain": "Ricomincia",
        "startAgainIn": "Ricomincia tra {time}",
        "mobileDescription": "Inserisci la tua email, poi la password. Non hai ancora un account? Crealo su bot.hxallai.com da un browser.",
        "mobileReady": "Inserisci la password. L'hai dimenticata? Reimpostala su bot.hxallai.com.",
        "stepSignIn": "Accedi con la tua email e la tua password.",
        "fullTitle": "Conferma di nuovo: attivare l'accesso completo?",
        "fullDescription": "Con l'accesso completo l'agente non chiede più prima di leggere, modificare o eliminare i tuoi file, eseguire "
                           "comandi o usare siti web. Attivalo solo per un agente e un'attività di cui ti fidi, e torna ad «Accesso su "
                           "richiesta» quando l'attività è finita.",
        "fullBodyMobile": "Con l'accesso completo l'agente non chiede più prima di leggere, modificare o eliminare i tuoi file, eseguire "
                          "comandi o usare siti web. Torna ad «Accesso su richiesta» quando l'attività è finita.",
        "fullConfirm": "Attiva l'accesso completo",
        "note": "Accesso su richiesta: l'agente legge e scrive nel suo workspace, nella cartella condivisa e nelle cartelle temporanee. Per "
                "tutto il resto prima ti chiede, spiegando perché e a quale scopo: file altrove, eliminazioni, comandi, siti web, lo "
                "schermo e la ricerca web. Scegli tu se consentire lettura, scrittura o eliminazione, e l'autorizzazione termina con "
                "l'attività.",
        "noteCommand": "Codex chiede prima di ogni comando e di ogni modifica ai file, e rispondono le autorizzazioni. Le semplici letture "
                       "come cat o ls vengono eseguite senza chiedere, anche fuori dal workspace.",
        "noteClaude": "Ogni chiamata a uno strumento di Claude viene verificata rispetto alle autorizzazioni.",
        "noteUnlimited": "Con «Accesso su richiesta» Computer Use è disattivato.",
        "noteProcess": "Su macOS l'intero processo di {provider} viene eseguito in una sandbox, quindi una scrittura all'esterno non riesce. "
                       "Ciò che richiede viene verificato rispetto alle autorizzazioni; una lettura che non richiede non è limitata.",
        "noteMobile": "L'agente lavora nel suo workspace e nella cartella condivisa, e ti chiede prima di accedere a qualsiasi altra cosa. "
                      "Un'autorizzazione termina con l'attività.",
        "confirm": "Conferma",
        "macOnly": "Per questo provider «Accesso su richiesta» è disponibile solo su macOS. Scegli «Accesso completo» nelle impostazioni "
                   "dell'agente.",
        "toolMissing": "«Accesso su richiesta» richiede {tool}, che HXBot non ha trovato. Installalo oppure scegli «Accesso completo» "
                       "nelle impostazioni dell'agente.",
        "sandbox": "«Accesso su richiesta» richiede la sandbox di Claude, che Claude non riesce ad avviare su questo computer: {reason}. "
                   "Scegli «Accesso completo» o un altro provider nelle impostazioni dell'agente.",
        "customBlocks": "{reason}. «Accesso su richiesta» lo blocca. Prova «Accesso completo».",
        "secretTitle": "Questo messaggio sembra contenere una password o una chiave",
        "secretBody": "Non inviare password, chiavi API o token nella chat: il modello di IA li leggerebbe. Salvali nella cassaforte, poi "
                      "comunica all'agente solo il nome. Un agente che ne ha bisogno mostra un modulo sicuro.",
        "secretBodyMobile": "Non inviare password, chiavi API o token nella chat: il modello di IA li leggerebbe. Salvali nella cassaforte, "
                            "poi comunica all'agente solo il nome.",
        "secretTitleMobile": "Password o chiave nel messaggio",
        "openVault": "Apri la cassaforte",
        "sendAnyway": "Invia comunque",
        "editMessage": "Modifica messaggio",
        "helpGuide": "Guida",
        "helpServer": "Server",
        "helpDownload": "Scarica l'ultima versione",
        "qrOpens": "Apre la pagina di download di HXBot",
        "qrLabel": "Codice QR della pagina di download",
        "ghMention": "Menzione dell'app GitHub",
        "ghAssigned": "Assegnato all'app GitHub",
        "joinDescription": "Incolla il link di invito del proprietario del server. Il proprietario lo crea nell'app desktop: Impostazioni "
                           "server → Membri, pubblica il server, poi Invita persone → Link di invito.",
    },
    "ja": {
        "signInDescription": "メールアドレスとパスワードでサインインします。アカウントがない場合は、bot.hxallai.com で作成してください。",
        "continue": "続行",
        "moment": "お待ちください…",
        "failed": "問題が発生しました。もう一度お試しください。",
        "pwTitle": "パスワードを入力",
        "pwFor": "{email} でサインインします。",
        "pwLabel": "パスワード",
        "pwHint": "パスワードを忘れた場合は、bot.hxallai.com を開いて再設定してください。",
        "pwRequired": "パスワードを入力してください。",
        "pwIncorrect": "メールアドレスまたはパスワードが正しくありません。",
        "pwTooMany": "パスワードの誤りが多すぎます。「最初からやり直す」を選んでください。",
        "pwExpired": "この手順の有効期限が切れました。「最初からやり直す」を選んでください。",
        "pwAccepted": "パスワードを確認しました。",
        "forgot": "パスワードをお忘れですか？",
        "create": "アカウントを作成",
        "signIn": "サインイン",
        "verifyFailed": "サインインできませんでした。もう一度お試しください。",
        "startAgain": "最初からやり直す",
        "startAgainIn": "{time} 後にやり直す",
        "mobileDescription": "メールアドレスを入力し、次にパスワードを入力します。アカウントがない場合は、ブラウザで bot.hxallai.com を"
                             "開いて作成してください。",
        "mobileReady": "パスワードを入力してください。忘れた場合は bot.hxallai.com で再設定できます。",
        "stepSignIn": "メールアドレスとパスワードでサインインします。",
        "fullTitle": "もう一度確認します：フルアクセスをオンにしますか？",
        "fullDescription": "フルアクセスでは、エージェントはファイルの読み取り・変更・削除、コマンドの実行、ウェブサイトの利用の前に確認"
                           "しなくなります。信頼できるエージェントとタスクにだけオンにし、タスクが終わったら「必要時に許可」に戻して"
                           "ください。",
        "fullBodyMobile": "フルアクセスでは、エージェントはファイルの読み取り・変更・削除、コマンドの実行、ウェブサイトの利用の前に確認"
                          "しなくなります。タスクが終わったら「必要時に許可」に戻してください。",
        "fullConfirm": "フルアクセスをオンにする",
        "note": "必要時に許可：エージェントは自分のワークスペース、共有フォルダー、一時フォルダーで読み書きします。それ以外のこと（別の"
                "場所のファイル、削除、コマンド、ウェブサイト、画面、ウェブ検索）は、理由と目的を伝えて先に確認します。読み取り・書き"
                "込み・削除のどれを許可するかはあなたが選び、許可はタスクの終了とともに終わります。",
        "noteCommand": "Codex はコマンドの実行やファイルの変更のたびに確認し、許可内容がそれに答えます。cat や ls などの単純な読み取り"
                       "は、ワークスペースの外でも確認なしで実行されます。",
        "noteClaude": "Claude のツール呼び出しは、すべて許可内容と照合されます。",
        "noteUnlimited": "「必要時に許可」では Computer Use はオフです。",
        "noteProcess": "macOS では {provider} のプロセス全体がサンドボックス内で動くため、外部への書き込みは失敗します。要求された操作"
                       "は許可内容と照合されますが、要求せずに行う読み取りは制限されません。",
        "noteMobile": "エージェントはワークスペースと共有フォルダーで作業し、それ以外にアクセスする前に確認します。許可はタスクの終了と"
                      "ともに終わります。",
        "confirm": "確定",
        "macOnly": "このプロバイダーの「必要時に許可」は macOS でのみ利用できます。エージェントの設定で「フルアクセス」を選んでください。",
        "toolMissing": "「必要時に許可」には {tool} が必要ですが、HXBot は見つけられませんでした。インストールするか、エージェントの"
                       "設定で「フルアクセス」を選んでください。",
        "sandbox": "「必要時に許可」には Claude のサンドボックスが必要ですが、このコンピューターでは Claude がそれを起動できません："
                   "{reason}。エージェントの設定で「フルアクセス」または別のプロバイダーを選んでください。",
        "customBlocks": "{reason}。「必要時に許可」がこれをブロックしています。「フルアクセス」をお試しください。",
        "secretTitle": "このメッセージにはパスワードかキーが含まれているようです",
        "secretBody": "パスワード、API キー、トークンはチャットで送らないでください。AI モデルに読まれます。保管庫に保存し、エージェント"
                      "には名前だけを伝えてください。必要なときは、エージェントが安全なフォームを表示します。",
        "secretBodyMobile": "パスワード、API キー、トークンはチャットで送らないでください。AI モデルに読まれます。保管庫に保存し、"
                            "エージェントには名前だけを伝えてください。",
        "secretTitleMobile": "メッセージにパスワードかキーがあります",
        "openVault": "保管庫を開く",
        "sendAnyway": "このまま送信",
        "editMessage": "メッセージを編集",
        "helpGuide": "使い方ガイド",
        "helpServer": "サーバー",
        "helpDownload": "最新版をダウンロード",
        "qrOpens": "HXBot のダウンロードページを開きます",
        "qrLabel": "ダウンロードページの QR コード",
        "ghMention": "GitHub アプリへのメンション",
        "ghAssigned": "GitHub アプリに割り当て",
        "joinDescription": "サーバーのオーナーから届いた招待リンクを貼り付けてください。オーナーはデスクトップアプリで作成します："
                           "サーバーの設定 → メンバー でサーバーを公開し、ユーザーを招待 → 招待リンク を選びます。",
    },
    "ko": {
        "signInDescription": "이메일과 비밀번호로 로그인하세요. 아직 계정이 없나요? bot.hxallai.com에서 만드세요.",
        "continue": "계속",
        "moment": "잠시만요…",
        "failed": "문제가 발생했어요. 다시 시도해 주세요.",
        "pwTitle": "비밀번호 입력",
        "pwFor": "{email}(으)로 로그인합니다.",
        "pwLabel": "비밀번호",
        "pwHint": "비밀번호를 잊으셨나요? bot.hxallai.com을 열어 재설정하세요.",
        "pwRequired": "비밀번호를 입력하세요.",
        "pwIncorrect": "이메일 또는 비밀번호가 올바르지 않아요.",
        "pwTooMany": "비밀번호가 여러 번 틀렸어요. '처음부터 다시'를 선택하세요.",
        "pwExpired": "이 단계의 시간이 초과됐어요. '처음부터 다시'를 선택하세요.",
        "pwAccepted": "비밀번호가 확인됐어요.",
        "forgot": "비밀번호를 잊으셨나요?",
        "create": "계정 만들기",
        "signIn": "로그인",
        "verifyFailed": "로그인하지 못했어요. 다시 시도해 주세요.",
        "startAgain": "처음부터 다시",
        "startAgainIn": "{time} 후 처음부터 다시",
        "mobileDescription": "이메일을 입력한 뒤 비밀번호를 입력하세요. 아직 계정이 없나요? 브라우저에서 bot.hxallai.com을 열어 만드세요.",
        "mobileReady": "비밀번호를 입력하세요. 잊으셨다면 bot.hxallai.com에서 재설정할 수 있어요.",
        "stepSignIn": "이메일과 비밀번호로 로그인하세요.",
        "fullTitle": "다시 확인: 전체 접근을 켤까요?",
        "fullDescription": "전체 접근을 켜면 에이전트가 파일을 읽거나 바꾸거나 삭제하고, 명령을 실행하고, 웹사이트를 사용하기 전에 더 "
                           "이상 묻지 않아요. 믿을 수 있는 에이전트와 작업에만 켜고, 작업이 끝나면 '필요할 때 허가'로 되돌리세요.",
        "fullBodyMobile": "전체 접근을 켜면 에이전트가 파일을 읽거나 바꾸거나 삭제하고, 명령을 실행하고, 웹사이트를 사용하기 전에 더 "
                          "이상 묻지 않아요. 작업이 끝나면 '필요할 때 허가'로 되돌리세요.",
        "fullConfirm": "전체 접근 켜기",
        "note": "필요할 때 허가: 에이전트는 자기 워크스페이스, 공유 폴더, 임시 폴더에서 읽고 써요. 그 밖의 모든 것은 이유와 목적을 "
                "알리고 먼저 물어봐요. 다른 위치의 파일, 삭제, 명령, 웹사이트, 화면, 웹 검색이 여기에 해당해요. 읽기, 쓰기, 삭제 중 "
                "무엇을 허락할지 직접 고르고, 허가는 작업이 끝나면 함께 끝나요.",
        "noteCommand": "Codex는 명령을 실행하거나 파일을 바꿀 때마다 먼저 묻고, 허가 내용이 답해요. cat이나 ls 같은 단순한 읽기는 "
                       "워크스페이스 밖에서도 묻지 않고 실행돼요.",
        "noteClaude": "Claude의 모든 도구 호출은 허가 내용에 따라 확인돼요.",
        "noteUnlimited": "'필요할 때 허가'에서는 Computer Use가 꺼져 있어요.",
        "noteProcess": "macOS에서는 {provider} 프로세스 전체가 샌드박스에서 실행되므로 밖에 쓰는 작업은 실패해요. 요청한 작업은 허가 "
                       "내용에 따라 확인되지만, 요청하지 않고 하는 읽기는 제한되지 않아요.",
        "noteMobile": "에이전트는 워크스페이스와 공유 폴더에서 일하고, 다른 것에 접근하기 전에 먼저 물어봐요. 허가는 작업이 끝나면 "
                      "함께 끝나요.",
        "confirm": "확인",
        "macOnly": "이 제공자의 '필요할 때 허가'는 macOS에서만 사용할 수 있어요. 에이전트 설정에서 '전체 접근'을 선택하세요.",
        "toolMissing": "'필요할 때 허가'에는 {tool}이(가) 필요하지만 HXBot이 찾지 못했어요. 설치하거나 에이전트 설정에서 '전체 "
                       "접근'을 선택하세요.",
        "sandbox": "'필요할 때 허가'에는 Claude 샌드박스가 필요하지만 이 컴퓨터에서는 Claude가 시작할 수 없어요: {reason}. 에이전트 "
                   "설정에서 '전체 접근'이나 다른 제공자를 선택하세요.",
        "customBlocks": "{reason}. '필요할 때 허가'가 이를 막고 있어요. '전체 접근'을 사용해 보세요.",
        "secretTitle": "이 메시지에 비밀번호나 키가 있는 것 같아요",
        "secretBody": "채팅으로 비밀번호, API 키, 토큰을 보내지 마세요. AI 모델이 읽게 돼요. 보관함에 저장한 뒤 에이전트에게는 이름만 "
                      "알려 주세요. 필요할 때는 에이전트가 보안 양식을 보여 줘요.",
        "secretBodyMobile": "채팅으로 비밀번호, API 키, 토큰을 보내지 마세요. AI 모델이 읽게 돼요. 보관함에 저장한 뒤 에이전트에게는 "
                            "이름만 알려 주세요.",
        "secretTitleMobile": "메시지에 비밀번호나 키가 있어요",
        "openVault": "보관함 열기",
        "sendAnyway": "그래도 보내기",
        "editMessage": "메시지 편집",
        "helpGuide": "사용 가이드",
        "helpServer": "서버",
        "helpDownload": "최신 버전 다운로드",
        "qrOpens": "HXBot 다운로드 페이지를 열어요",
        "qrLabel": "다운로드 페이지 QR 코드",
        "ghMention": "GitHub 앱 멘션",
        "ghAssigned": "GitHub 앱에 할당됨",
        "joinDescription": "서버 소유자에게 받은 초대 링크를 붙여 넣으세요. 소유자는 데스크톱 앱의 서버 설정 → 멤버에서 서버를 게시한 "
                           "뒤 사람 초대 → 초대 링크로 만들어요.",
    },
    "nl": {
        "signInDescription": "Log in met je e-mailadres en wachtwoord. Nog geen account? Maak er een aan op bot.hxallai.com.",
        "continue": "Doorgaan",
        "moment": "Een moment…",
        "failed": "Er ging iets mis. Probeer het opnieuw.",
        "pwTitle": "Voer je wachtwoord in",
        "pwFor": "Inloggen als {email}.",
        "pwLabel": "Wachtwoord",
        "pwHint": "Wachtwoord vergeten? Open bot.hxallai.com om het opnieuw in te stellen.",
        "pwRequired": "Voer je wachtwoord in.",
        "pwIncorrect": "Het e-mailadres of het wachtwoord klopt niet.",
        "pwTooMany": "Te veel onjuiste wachtwoorden. Kies ‘Opnieuw beginnen’.",
        "pwExpired": "Deze stap is verlopen. Kies ‘Opnieuw beginnen’.",
        "pwAccepted": "Wachtwoord geaccepteerd.",
        "forgot": "Wachtwoord vergeten?",
        "create": "Account aanmaken",
        "signIn": "Inloggen",
        "verifyFailed": "Inloggen mislukt. Probeer het opnieuw.",
        "startAgain": "Opnieuw beginnen",
        "startAgainIn": "Opnieuw beginnen over {time}",
        "mobileDescription": "Voer je e-mailadres in en daarna je wachtwoord. Nog geen account? Maak er een aan op bot.hxallai.com in een "
                             "browser.",
        "mobileReady": "Voer je wachtwoord in. Vergeten? Stel het opnieuw in op bot.hxallai.com.",
        "stepSignIn": "Log in met je e-mailadres en wachtwoord.",
        "fullTitle": "Nogmaals bevestigen: volledige toegang aanzetten?",
        "fullDescription": "Met volledige toegang vraagt de agent niet meer om toestemming voordat hij je bestanden leest, wijzigt of "
                           "verwijdert, opdrachten uitvoert of websites gebruikt. Zet het alleen aan voor een agent en een taak die je "
                           "vertrouwt, en ga terug naar ‘Toegang op verzoek’ als de taak klaar is.",
        "fullBodyMobile": "Met volledige toegang vraagt de agent niet meer om toestemming voordat hij je bestanden leest, wijzigt of "
                          "verwijdert, opdrachten uitvoert of websites gebruikt. Ga terug naar ‘Toegang op verzoek’ als de taak klaar is.",
        "fullConfirm": "Volledige toegang aanzetten",
        "note": "Toegang op verzoek: de agent leest en schrijft in zijn werkruimte, de gedeelde map en de tijdelijke mappen. Voor al het "
                "andere vraagt hij het je eerst en zegt hij waarom en waarvoor: bestanden elders, verwijderen, opdrachten, websites, het "
                "scherm en zoeken op het web. Jij kiest of lezen, schrijven of verwijderen mag, en de toestemming eindigt met de taak.",
        "noteCommand": "Codex vraagt het voor elke opdracht en elke bestandswijziging, en de toestemmingen beslissen. Eenvoudige "
                       "leesopdrachten zoals cat of ls draaien zonder te vragen, ook buiten de werkruimte.",
        "noteClaude": "Elke toolaanroep van Claude wordt getoetst aan de toestemmingen.",
        "noteUnlimited": "Bij ‘Toegang op verzoek’ staat Computer Use uit.",
        "noteProcess": "Op macOS draait het hele {provider}-proces in een sandbox, dus schrijven daarbuiten mislukt. Wat het proces vraagt, "
                       "wordt getoetst aan de toestemmingen; lezen waar het niet om vraagt, is niet beperkt.",
        "noteMobile": "De agent werkt in zijn werkruimte en de gedeelde map, en vraagt het je voordat hij iets anders gebruikt. Een "
                      "toestemming eindigt met de taak.",
        "confirm": "Bevestigen",
        "macOnly": "‘Toegang op verzoek’ is voor deze aanbieder alleen beschikbaar op macOS. Kies ‘Volledige toegang’ in de instellingen "
                   "van de agent.",
        "toolMissing": "‘Toegang op verzoek’ heeft {tool} nodig, maar HXBot heeft het niet gevonden. Installeer het of kies ‘Volledige "
                       "toegang’ in de instellingen van de agent.",
        "sandbox": "‘Toegang op verzoek’ heeft de Claude-sandbox nodig, maar Claude kan die op deze computer niet starten: {reason}. Kies "
                   "‘Volledige toegang’ of een andere aanbieder in de instellingen van de agent.",
        "customBlocks": "{reason}. ‘Toegang op verzoek’ blokkeert dit. Probeer ‘Volledige toegang’.",
        "secretTitle": "Dit bericht lijkt een wachtwoord of sleutel te bevatten",
        "secretBody": "Stuur geen wachtwoorden, API-sleutels of tokens in de chat: het AI-model zou ze lezen. Bewaar ze in de kluis en geef "
                      "de agent alleen de naam. Een agent die er een nodig heeft, toont een beveiligd formulier.",
        "secretBodyMobile": "Stuur geen wachtwoorden, API-sleutels of tokens in de chat: het AI-model zou ze lezen. Bewaar ze in de kluis "
                            "en geef de agent alleen de naam.",
        "secretTitleMobile": "Wachtwoord of sleutel in het bericht",
        "openVault": "Kluis openen",
        "sendAnyway": "Toch versturen",
        "editMessage": "Bericht bewerken",
        "helpGuide": "Handleiding",
        "helpServer": "Server",
        "helpDownload": "Nieuwste versie downloaden",
        "qrOpens": "Opent de downloadpagina van HXBot",
        "qrLabel": "QR-code van de downloadpagina",
        "ghMention": "Vermelding van de GitHub-app",
        "ghAssigned": "Toegewezen aan de GitHub-app",
        "joinDescription": "Plak de uitnodigingslink van de servereigenaar. De eigenaar maakt die in de desktop-app: Serverinstellingen → "
                           "Leden, publiceer de server, dan Mensen uitnodigen → Uitnodigingslink.",
    },
    "pl": {
        "signInDescription": "Zaloguj się adresem e-mail i hasłem. Nie masz jeszcze konta? Utwórz je na bot.hxallai.com.",
        "continue": "Kontynuuj",
        "moment": "Chwileczkę…",
        "failed": "Coś poszło nie tak. Spróbuj ponownie.",
        "pwTitle": "Wpisz hasło",
        "pwFor": "Logowanie jako {email}.",
        "pwLabel": "Hasło",
        "pwHint": "Nie pamiętasz hasła? Otwórz bot.hxallai.com, aby je zresetować.",
        "pwRequired": "Wpisz hasło.",
        "pwIncorrect": "Adres e-mail lub hasło jest nieprawidłowe.",
        "pwTooMany": "Zbyt wiele błędnych haseł. Wybierz „Zacznij od nowa”.",
        "pwExpired": "Czas na ten krok minął. Wybierz „Zacznij od nowa”.",
        "pwAccepted": "Hasło przyjęte.",
        "forgot": "Nie pamiętasz hasła?",
        "create": "Utwórz konto",
        "signIn": "Zaloguj się",
        "verifyFailed": "Nie udało się zalogować. Spróbuj ponownie.",
        "startAgain": "Zacznij od nowa",
        "startAgainIn": "Zacznij od nowa za {time}",
        "mobileDescription": "Wpisz adres e-mail, a potem hasło. Nie masz jeszcze konta? Utwórz je w przeglądarce na bot.hxallai.com.",
        "mobileReady": "Wpisz hasło. Nie pamiętasz go? Zresetuj je na bot.hxallai.com.",
        "stepSignIn": "Zaloguj się adresem e-mail i hasłem.",
        "fullTitle": "Potwierdź ponownie: włączyć pełny dostęp?",
        "fullDescription": "Przy pełnym dostępie agent nie pyta już, zanim odczyta, zmieni lub usunie Twoje pliki, uruchomi polecenia albo "
                           "skorzysta ze stron internetowych. Włączaj go tylko dla agenta i zadania, którym ufasz, a po zakończeniu zadania "
                           "wróć do trybu „Dostęp na żądanie”.",
        "fullBodyMobile": "Przy pełnym dostępie agent nie pyta już, zanim odczyta, zmieni lub usunie Twoje pliki, uruchomi polecenia albo "
                          "skorzysta ze stron internetowych. Po zakończeniu zadania wróć do trybu „Dostęp na żądanie”.",
        "fullConfirm": "Włącz pełny dostęp",
        "note": "Dostęp na żądanie: agent czyta i zapisuje w swoim obszarze roboczym, w folderze współdzielonym i w folderach tymczasowych. "
                "O wszystko inne najpierw pyta i mówi, dlaczego i po co: pliki w innych miejscach, usuwanie, polecenia, strony "
                "internetowe, ekran i wyszukiwanie w sieci. Ty wybierasz, czy pozwalasz na odczyt, zapis czy usuwanie, a zgoda wygasa "
                "wraz z zadaniem.",
        "noteCommand": "Codex pyta przed każdym poleceniem i każdą zmianą pliku, a odpowiedź dają udzielone zgody. Proste odczyty, takie "
                       "jak cat czy ls, działają bez pytania, także poza obszarem roboczym.",
        "noteClaude": "Każde wywołanie narzędzia przez Claude jest sprawdzane z udzielonymi zgodami.",
        "noteUnlimited": "W trybie „Dostęp na żądanie” Computer Use jest wyłączone.",
        "noteProcess": "W macOS cały proces {provider} działa w piaskownicy, więc zapis poza nią się nie uda. To, o co prosi, jest "
                       "sprawdzane z udzielonymi zgodami; odczyt, o który nie prosi, nie jest ograniczony.",
        "noteMobile": "Agent pracuje w swoim obszarze roboczym i w folderze współdzielonym, a zanim sięgnie po coś innego, pyta Cię o zgodę. "
                      "Zgoda wygasa wraz z zadaniem.",
        "confirm": "Potwierdź",
        "macOnly": "Tryb „Dostęp na żądanie” jest dla tego dostawcy dostępny tylko w macOS. Wybierz „Pełny dostęp” w ustawieniach agenta.",
        "toolMissing": "Tryb „Dostęp na żądanie” wymaga narzędzia {tool}, którego HXBot nie znalazł. Zainstaluj je lub wybierz „Pełny "
                       "dostęp” w ustawieniach agenta.",
        "sandbox": "Tryb „Dostęp na żądanie” wymaga piaskownicy Claude, której Claude nie może uruchomić na tym komputerze: {reason}. "
                   "Wybierz „Pełny dostęp” lub innego dostawcę w ustawieniach agenta.",
        "customBlocks": "{reason}. Blokuje to tryb „Dostęp na żądanie”. Wybierz „Pełny dostęp”.",
        "secretTitle": "Ta wiadomość wygląda, jakby zawierała hasło lub klucz",
        "secretBody": "Nie wysyłaj haseł, kluczy API ani tokenów na czacie: model AI by je odczytał. Zapisz je w sejfie, a potem podaj "
                      "agentowi tylko ich nazwę. Agent, który potrzebuje takiego sekretu, pokaże bezpieczny formularz.",
        "secretBodyMobile": "Nie wysyłaj haseł, kluczy API ani tokenów na czacie: model AI by je odczytał. Zapisz je w sejfie, a potem "
                            "podaj agentowi tylko ich nazwę.",
        "secretTitleMobile": "Hasło lub klucz w wiadomości",
        "openVault": "Otwórz sejf",
        "sendAnyway": "Wyślij mimo to",
        "editMessage": "Edytuj wiadomość",
        "helpGuide": "Przewodnik",
        "helpServer": "Serwer",
        "helpDownload": "Pobierz najnowszą wersję",
        "qrOpens": "Otwiera stronę pobierania HXBot",
        "qrLabel": "Kod QR strony pobierania",
        "ghMention": "Wzmianka o aplikacji GitHub",
        "ghAssigned": "Przypisano do aplikacji GitHub",
        "joinDescription": "Wklej link z zaproszeniem od właściciela serwera. Właściciel tworzy go w aplikacji na komputer: Ustawienia "
                           "serwera → Członkowie, opublikuj serwer, a potem Zaproś osoby → Link.",
    },
    "pt": {
        "signInDescription": "Entre com seu e-mail e sua senha. Ainda não tem conta? Crie uma em bot.hxallai.com.",
        "continue": "Continuar",
        "moment": "Um momento…",
        "failed": "Algo deu errado. Tente novamente.",
        "pwTitle": "Digite sua senha",
        "pwFor": "Entrando como {email}.",
        "pwLabel": "Senha",
        "pwHint": "Esqueceu a senha? Abra bot.hxallai.com para redefini-la.",
        "pwRequired": "Digite sua senha.",
        "pwIncorrect": "O e-mail ou a senha está incorreto.",
        "pwTooMany": "Muitas senhas incorretas. Escolha “Recomeçar”.",
        "pwExpired": "Esta etapa expirou. Escolha “Recomeçar”.",
        "pwAccepted": "Senha aceita.",
        "forgot": "Esqueceu a senha?",
        "create": "Criar uma conta",
        "signIn": "Entrar",
        "verifyFailed": "Não foi possível entrar. Tente novamente.",
        "startAgain": "Recomeçar",
        "startAgainIn": "Recomeçar em {time}",
        "mobileDescription": "Digite seu e-mail e depois sua senha. Ainda não tem conta? Crie uma em bot.hxallai.com pelo navegador.",
        "mobileReady": "Digite sua senha. Esqueceu? Redefina-a em bot.hxallai.com.",
        "stepSignIn": "Entre com seu e-mail e sua senha.",
        "fullTitle": "Confirme de novo: ativar o acesso completo?",
        "fullDescription": "Com acesso completo, o agente não pergunta mais antes de ler, alterar ou excluir seus arquivos, executar comandos "
                           "ou usar sites. Ative só para um agente e uma tarefa em que você confia, e volte para “Acesso sob demanda” "
                           "quando a tarefa terminar.",
        "fullBodyMobile": "Com acesso completo, o agente não pergunta mais antes de ler, alterar ou excluir seus arquivos, executar "
                          "comandos ou usar sites. Volte para “Acesso sob demanda” quando a tarefa terminar.",
        "fullConfirm": "Ativar acesso completo",
        "note": "Acesso sob demanda: o agente lê e grava no espaço de trabalho dele, na pasta compartilhada e nas pastas temporárias. Para "
                "todo o resto, ele pergunta antes e explica por que e para quê: arquivos em outros lugares, exclusões, comandos, sites, a "
                "tela e a pesquisa na web. Você escolhe se permite ler, gravar ou excluir, e a permissão termina com a tarefa.",
        "noteCommand": "O Codex pergunta antes de cada comando e de cada alteração de arquivo, e as permissões respondem. Leituras simples, "
                       "como cat ou ls, são executadas sem perguntar, também fora do espaço de trabalho.",
        "noteClaude": "Cada chamada de ferramenta do Claude é verificada com base nas permissões.",
        "noteUnlimited": "No “Acesso sob demanda”, o Computer Use fica desativado.",
        "noteProcess": "No macOS, todo o processo do {provider} é executado em uma sandbox, então uma gravação fora dela falha. O que ele "
                       "solicita é verificado com base nas permissões; uma leitura que ele não solicita não é limitada.",
        "noteMobile": "O agente trabalha no espaço de trabalho dele e na pasta compartilhada, e pergunta antes de acessar qualquer outra "
                      "coisa. Uma permissão termina com a tarefa.",
        "confirm": "Confirmar",
        "macOnly": "Para este provedor, o “Acesso sob demanda” só está disponível no macOS. Escolha “Acesso completo” nas configurações "
                   "do agente.",
        "toolMissing": "O “Acesso sob demanda” precisa de {tool}, que o HXBot não encontrou. Instale-o ou escolha “Acesso completo” nas "
                       "configurações do agente.",
        "sandbox": "O “Acesso sob demanda” precisa da sandbox do Claude, que o Claude não consegue iniciar neste computador: {reason}. "
                   "Escolha “Acesso completo” ou outro provedor nas configurações do agente.",
        "customBlocks": "{reason}. O “Acesso sob demanda” bloqueia isso. Tente “Acesso completo”.",
        "secretTitle": "Esta mensagem parece conter uma senha ou uma chave",
        "secretBody": "Não envie senhas, chaves de API ou tokens no chat: o modelo de IA os leria. Salve-os no cofre e informe ao agente "
                      "só o nome. Um agente que precisar de um mostra um formulário seguro.",
        "secretBodyMobile": "Não envie senhas, chaves de API ou tokens no chat: o modelo de IA os leria. Salve-os no cofre e informe ao "
                            "agente só o nome.",
        "secretTitleMobile": "Senha ou chave na mensagem",
        "openVault": "Abrir o cofre",
        "sendAnyway": "Enviar mesmo assim",
        "editMessage": "Editar mensagem",
        "helpGuide": "Guia",
        "helpServer": "Servidor",
        "helpDownload": "Baixar a versão mais recente",
        "qrOpens": "Abre a página de download do HXBot",
        "qrLabel": "QR code da página de download",
        "ghMention": "Menção ao app do GitHub",
        "ghAssigned": "Atribuído ao app do GitHub",
        "joinDescription": "Cole o link de convite do proprietário do servidor. O proprietário o cria no app para desktop: Configurações do "
                           "servidor → Membros, publique o servidor e depois Convidar pessoas → Link de convite.",
    },
    "ru": {
        "signInDescription": "Войдите с помощью адреса эл. почты и пароля. Ещё нет аккаунта? Создайте его на bot.hxallai.com.",
        "continue": "Продолжить",
        "moment": "Минутку…",
        "failed": "Что-то пошло не так. Повторите попытку.",
        "pwTitle": "Введите пароль",
        "pwFor": "Вход как {email}.",
        "pwLabel": "Пароль",
        "pwHint": "Забыли пароль? Откройте bot.hxallai.com, чтобы сбросить его.",
        "pwRequired": "Введите пароль.",
        "pwIncorrect": "Неверный адрес эл. почты или пароль.",
        "pwTooMany": "Слишком много неверных паролей. Нажмите «Начать заново».",
        "pwExpired": "Время на этот шаг истекло. Нажмите «Начать заново».",
        "pwAccepted": "Пароль принят.",
        "forgot": "Забыли пароль?",
        "create": "Создать аккаунт",
        "signIn": "Войти",
        "verifyFailed": "Не удалось войти. Повторите попытку.",
        "startAgain": "Начать заново",
        "startAgainIn": "Начать заново через {time}",
        "mobileDescription": "Введите адрес эл. почты, затем пароль. Ещё нет аккаунта? Создайте его в браузере на bot.hxallai.com.",
        "mobileReady": "Введите пароль. Забыли? Сбросьте его на bot.hxallai.com.",
        "stepSignIn": "Войдите с помощью адреса эл. почты и пароля.",
        "fullTitle": "Подтвердите ещё раз: включить полный доступ?",
        "fullDescription": "С полным доступом агент больше не спрашивает, прежде чем читать, изменять или удалять ваши файлы, выполнять "
                           "команды или пользоваться сайтами. Включайте его только для агента и задачи, которым доверяете, а после "
                           "завершения задачи вернитесь к режиму «Доступ по запросу».",
        "fullBodyMobile": "С полным доступом агент больше не спрашивает, прежде чем читать, изменять или удалять ваши файлы, выполнять "
                          "команды или пользоваться сайтами. После завершения задачи вернитесь к режиму «Доступ по запросу».",
        "fullConfirm": "Включить полный доступ",
        "note": "Доступ по запросу: агент читает и записывает файлы в своём рабочем пространстве, общей папке и временных папках. Для всего "
                "остального он сначала спрашивает вас и объясняет, зачем и для чего: файлы в других местах, удаление, команды, сайты, "
                "экран и веб-поиск. Вы выбираете, разрешить ли чтение, запись или удаление, а разрешение заканчивается вместе с задачей.",
        "noteCommand": "Codex спрашивает перед каждой командой и каждым изменением файла, а ответ дают разрешения. Простые команды чтения, "
                       "такие как cat или ls, выполняются без запроса, в том числе за пределами рабочего пространства.",
        "noteClaude": "Каждый вызов инструмента Claude проверяется по выданным разрешениям.",
        "noteUnlimited": "В режиме «Доступ по запросу» Computer Use отключён.",
        "noteProcess": "В macOS весь процесс {provider} работает в песочнице, поэтому запись за её пределами не удаётся. То, что он "
                       "запрашивает, проверяется по разрешениям; чтение, которое он не запрашивает, не ограничено.",
        "noteMobile": "Агент работает в своём рабочем пространстве и общей папке и спрашивает вас, прежде чем обратиться к чему-то ещё. "
                      "Разрешение заканчивается вместе с задачей.",
        "confirm": "Подтвердить",
        "macOnly": "Режим «Доступ по запросу» для этого провайдера доступен только в macOS. Выберите «Полный доступ» в настройках агента.",
        "toolMissing": "Для режима «Доступ по запросу» нужен {tool}, но HXBot его не нашёл. Установите его или выберите «Полный доступ» "
                       "в настройках агента.",
        "sandbox": "Для режима «Доступ по запросу» нужна песочница Claude, но Claude не может запустить её на этом компьютере: {reason}. "
                   "Выберите «Полный доступ» или другого провайдера в настройках агента.",
        "customBlocks": "{reason}. Режим «Доступ по запросу» блокирует это. Попробуйте «Полный доступ».",
        "secretTitle": "Похоже, в этом сообщении есть пароль или ключ",
        "secretBody": "Не отправляйте в чат пароли, API-ключи и токены: их прочитает ИИ-модель. Сохраните их в хранилище и сообщите агенту "
                      "только название. Если агенту нужен такой секрет, он покажет защищённую форму.",
        "secretBodyMobile": "Не отправляйте в чат пароли, API-ключи и токены: их прочитает ИИ-модель. Сохраните их в хранилище и сообщите "
                            "агенту только название.",
        "secretTitleMobile": "Пароль или ключ в сообщении",
        "openVault": "Открыть хранилище",
        "sendAnyway": "Всё равно отправить",
        "editMessage": "Изменить сообщение",
        "helpGuide": "Руководство",
        "helpServer": "Сервер",
        "helpDownload": "Скачать последнюю версию",
        "qrOpens": "Открывает страницу загрузки HXBot",
        "qrLabel": "QR-код страницы загрузки",
        "ghMention": "Упоминание приложения GitHub",
        "ghAssigned": "Назначено приложению GitHub",
        "joinDescription": "Вставьте ссылку-приглашение от владельца сервера. Владелец создаёт её в приложении для компьютера: Настройки "
                           "сервера → Участники, опубликуйте сервер, затем Пригласить людей → Ссылка.",
    },
    "tr": {
        "signInDescription": "E-postanız ve şifrenizle oturum açın. Henüz hesabınız yok mu? bot.hxallai.com adresinde oluşturun.",
        "continue": "Devam et",
        "moment": "Bir saniye…",
        "failed": "Bir sorun oluştu. Tekrar deneyin.",
        "pwTitle": "Şifrenizi girin",
        "pwFor": "{email} olarak oturum açılıyor.",
        "pwLabel": "Şifre",
        "pwHint": "Şifrenizi mi unuttunuz? Sıfırlamak için bot.hxallai.com adresini açın.",
        "pwRequired": "Şifrenizi girin.",
        "pwIncorrect": "E-posta veya şifre yanlış.",
        "pwTooMany": "Çok fazla yanlış şifre girildi. “Baştan başla”yı seçin.",
        "pwExpired": "Bu adımın süresi doldu. “Baştan başla”yı seçin.",
        "pwAccepted": "Şifre kabul edildi.",
        "forgot": "Şifrenizi mi unuttunuz?",
        "create": "Hesap oluştur",
        "signIn": "Oturum aç",
        "verifyFailed": "Oturum açılamadı. Tekrar deneyin.",
        "startAgain": "Baştan başla",
        "startAgainIn": "{time} sonra baştan başla",
        "mobileDescription": "E-postanızı, ardından şifrenizi girin. Henüz hesabınız yok mu? Bir tarayıcıda bot.hxallai.com adresinde "
                             "oluşturun.",
        "mobileReady": "Şifrenizi girin. Unuttunuz mu? bot.hxallai.com adresinde sıfırlayın.",
        "stepSignIn": "E-postanız ve şifrenizle oturum açın.",
        "fullTitle": "Tekrar onaylayın: tam erişim açılsın mı?",
        "fullDescription": "Tam erişimde ajan; dosyalarınızı okumadan, değiştirmeden veya silmeden, komut çalıştırmadan ya da web sitelerini "
                           "kullanmadan önce artık sormaz. Bunu yalnızca güvendiğiniz bir ajan ve görev için açın, görev bitince "
                           "“İsteğe bağlı erişim”e geri dönün.",
        "fullBodyMobile": "Tam erişimde ajan; dosyalarınızı okumadan, değiştirmeden veya silmeden, komut çalıştırmadan ya da web sitelerini "
                          "kullanmadan önce artık sormaz. Görev bitince “İsteğe bağlı erişim”e geri dönün.",
        "fullConfirm": "Tam erişimi aç",
        "note": "İsteğe bağlı erişim: Ajan kendi çalışma alanında, paylaşılan klasörde ve geçici klasörlerde okur ve yazar. Diğer her şey "
                "için önce size sorar, nedenini ve amacını söyler: başka yerlerdeki dosyalar, silme, komutlar, web siteleri, ekran ve web "
                "araması. Okuma, yazma veya silmeye izin verip vermeyeceğinizi siz seçersiniz; izin görevle birlikte sona erer.",
        "noteCommand": "Codex her komuttan ve her dosya değişikliğinden önce sorar, yanıtı izinler verir. cat veya ls gibi basit okuma "
                       "komutları sormadan çalışır, çalışma alanının dışında da.",
        "noteClaude": "Claude'un her araç çağrısı izinlere göre denetlenir.",
        "noteUnlimited": "“İsteğe bağlı erişim”de Computer Use kapalıdır.",
        "noteProcess": "macOS'ta {provider} işleminin tamamı bir korumalı alanda çalışır, bu yüzden dışarıya yazma başarısız olur. İstediği "
                       "şeyler izinlere göre denetlenir; istemeden yaptığı okumalar sınırlanmaz.",
        "noteMobile": "Ajan kendi çalışma alanında ve paylaşılan klasörde çalışır, başka bir şeye erişmeden önce size sorar. İzin görevle "
                      "birlikte sona erer.",
        "confirm": "Onayla",
        "macOnly": "Bu sağlayıcıda “İsteğe bağlı erişim” yalnızca macOS'ta kullanılabilir. Ajan ayarlarından “Tam erişim”i seçin.",
        "toolMissing": "“İsteğe bağlı erişim” için {tool} gerekiyor, ancak HXBot bunu bulamadı. Yükleyin veya ajan ayarlarından “Tam "
                       "erişim”i seçin.",
        "sandbox": "“İsteğe bağlı erişim” için Claude korumalı alanı gerekiyor, ancak Claude bunu bu bilgisayarda başlatamıyor: {reason}. "
                   "Ajan ayarlarından “Tam erişim”i veya başka bir sağlayıcıyı seçin.",
        "customBlocks": "{reason}. “İsteğe bağlı erişim” bunu engelliyor. “Tam erişim”i deneyin.",
        "secretTitle": "Bu mesajda şifre veya anahtar var gibi görünüyor",
        "secretBody": "Sohbette şifre, API anahtarı veya token göndermeyin: Yapay zekâ modeli bunları okur. Bunları kasaya kaydedin, "
                      "ardından ajana yalnızca adını söyleyin. Bunlardan birine ihtiyaç duyan ajan güvenli bir form gösterir.",
        "secretBodyMobile": "Sohbette şifre, API anahtarı veya token göndermeyin: Yapay zekâ modeli bunları okur. Bunları kasaya kaydedin, "
                            "ardından ajana yalnızca adını söyleyin.",
        "secretTitleMobile": "Mesajda şifre veya anahtar var",
        "openVault": "Kasayı aç",
        "sendAnyway": "Yine de gönder",
        "editMessage": "Mesajı düzenle",
        "helpGuide": "Kılavuz",
        "helpServer": "Sunucu",
        "helpDownload": "En son sürümü indir",
        "qrOpens": "HXBot indirme sayfasını açar",
        "qrLabel": "İndirme sayfası QR kodu",
        "ghMention": "GitHub uygulamasından bahsedildi",
        "ghAssigned": "GitHub uygulamasına atandı",
        "joinDescription": "Sunucu sahibinden gelen davet bağlantısını yapıştırın. Sahibi bunu masaüstü uygulamasında oluşturur: Sunucu "
                           "ayarları → Üyeler, sunucuyu yayımlayın, ardından Kişileri davet edin → Davet bağlantısı.",
    },
}


def text(key: str, locale: str) -> str | None:
    """这条文字在这种语言里的译文；没有译文时为 None（界面显示英文，要登记在 untranslated.json）。"""
    phrase = KEYS.get(key)
    return PHRASES.get(locale, {}).get(phrase) if phrase else None


def has(key: str, locale: str) -> bool:
    return text(key, locale) is not None


# ---------------------------------------------------------------- 写进各语言的文字文件
def _english_modules(r, checks) -> dict[str, str]:
    """键 → 它所在的英文文件（相对 messages/en/ 的路径），和键在那个文件里的前后顺序。"""
    owner: dict[str, str] = {}
    for rel in checks.modules(r, "en"):
        try:
            entries = checks.catalog(r.read(rel))[1]
        except ValueError:
            continue
        for entry in entries:
            owner[checks.entry_key(entry)] = rel.split("/en/", 1)[1]
    return owner


def _value(entry: str, key: str) -> str | None:
    """一条文字的值（只认单个双引号字符串）；读不出来时为 None。"""
    rest = entry[entry.index(f'"{key}"') + len(key) + 2:]
    raw = rest.lstrip()
    if not raw.startswith(":"):
        return None
    raw = raw[1:].strip()
    try:
        value = json.loads(raw)
    except ValueError:
        return None
    return value if isinstance(value, str) else None


def _entry(r, key: str, value: str, prefix: str) -> str:
    """一条文字的写法，与 Biome 的格式一致：显示宽度超过 120 时值另起一行。"""
    name, quoted = json.dumps(key, ensure_ascii=False), json.dumps(value, ensure_ascii=False)
    one = f"  {name}: {quoted},"
    return prefix + (f"{name}: {quoted}" if r.display_width(one) <= 120 else f"{name}:\n    {quoted}")


def translate(r) -> None:
    import upstream_checks as checks
    owner = _english_modules(r, checks)
    english_order: dict[str, list[str]] = {}
    done: dict[str, list[str]] = {}
    removed = checks.removed_keys()
    for key in KEYS:
        if key in removed:  # 已不再使用、被删掉的文字（hx/unused-messages.txt），不写译文
            continue
        if key not in owner:
            r.errors.append(f"translations.py: {key} is not in the English catalog")
            continue
        module = owner[key]
        if module not in english_order:
            english_order[module] = [checks.entry_key(e) for e in checks.catalog(r.read(f"{MESSAGES}/en/{module}"))[1]]
        for locale in LOCALES:
            value = text(key, locale)
            if value is None:
                continue
            done.setdefault(key, []).append(locale)
            rel = f"{MESSAGES}/{locale}/{module}"
            source = r.read(rel)
            head, entries, tail = checks.catalog(source)
            keys = [checks.entry_key(entry) for entry in entries]
            trailing = source[: len(source) - len(tail)].rstrip().endswith(",")
            if key in keys:
                index = keys.index(key)
                entry = entries[index]
                if _value(entry, key) == value:
                    continue
                entries[index] = _entry(r, key, value, entry[: entry.index(f'"{key}"')])
            else:
                order = english_order[module]
                before = order[: order.index(key)]
                at = 0
                for index, existing in enumerate(keys):
                    if existing in before:
                        at = index + 1
                entries.insert(at, _entry(r, key, value, "\n  "))
            r.write(rel, checks.join_catalog(head, entries, tail, trailing))
    # 有译文的语言不再登记为“暂用英文”
    r.untranslated(add={}, translated_zh=[], translated=done)


def check_placeholders() -> list[str]:
    """译文里的占位符必须和英文一样（供测试和自查）。"""
    problems = []
    for key, phrase in KEYS.items():
        for locale in LOCALES:
            value = PHRASES[locale].get(phrase)
            if value is None:
                problems.append(f"{locale}: {phrase} missing")
                continue
            names = set(re.findall(r"\{(\w+)\}", value))
            expected = V175_PLACEHOLDERS.get(phrase, set()) if phrase in V175_KEYS.values() else \
                V174_PLACEHOLDERS.get(phrase, set()) if phrase in V174_KEYS.values() else \
                V173_HOTFIX_PLACEHOLDERS.get(phrase, set()) if phrase in V173_HOTFIX_KEYS.values() else \
                V173_PLACEHOLDERS.get(phrase, set()) if phrase in V173_KEYS.values() else \
                V171_PLACEHOLDERS.get(phrase, set()) if phrase in V171_KEYS.values() else \
                V167_PLACEHOLDERS.get(phrase, set()) if phrase in V167_KEYS.values() else \
                V166_PLACEHOLDERS.get(phrase, set()) if phrase in V166_KEYS.values() else \
                OPENCODE_PLACEHOLDERS.get(phrase, set()) if phrase in OPENCODE_KEYS.values() else \
                V165_PLACEHOLDERS.get(phrase, set()) if phrase in V165_KEYS.values() else \
                COMPUTER_PLACEHOLDERS.get(phrase, set()) if phrase in COMPUTER_KEYS.values() else \
                V162_PLACEHOLDERS.get(phrase, set()) if phrase in V162_KEYS.values() else \
                {"email"} if phrase in ("pwFor", "delConfirmDescription", "delConfirmBody") else {"time"} if phrase == "startAgainIn" else \
                {"provider"} if phrase == "noteProcess" else {"tool"} if phrase == "toolMissing" else \
                {"reason"} if phrase in ("sandbox", "customBlocks") else set()
            if names != expected:
                problems.append(f"{locale}: {phrase} has {sorted(names)}, expected {sorted(expected)}")
    return problems


# ---------------------------------------------------------------- 注销账号（v1.6.2，hx/delete_account.py）
DELETE_KEYS = {
    "account.hxDelete.title": "delTitle",
    "account.hxDelete.description": "delDescription",
    "account.hxDelete.action": "delAction",
    "account.hxDelete.confirmTitle": "delConfirmTitle",
    "account.hxDelete.confirmDescription": "delConfirmDescription",
    "account.hxDelete.passwordLabel": "pwLabel",
    "account.hxDelete.emailLabel": "delEmailLabel",
    "account.hxDelete.noPassword": "delNoPassword",
    "account.hxDelete.confirm": "delTitle",
    "account.hxDelete.pending": "delPending",
    "account.hxDelete.passwordRequired": "pwRequired",
    "account.hxDelete.emailRequired": "delEmailRequired",
    "account.hxDelete.incorrectPassword": "delIncorrect",
    "account.hxDelete.failed": "delFailed",
    "mobile.settings.hxDelete.title": "delTitle",
    "mobile.settings.hxDelete.description": "delDescription",
    "mobile.settings.hxDelete.action": "delTitle",
    "mobile.settings.hxDelete.confirmTitle": "delConfirmTitle",
    "mobile.settings.hxDelete.confirmBody": "delConfirmBody",
    "mobile.settings.hxDelete.passwordLabel": "pwLabel",
    "mobile.settings.hxDelete.emailLabel": "delEmailLabel",
    "mobile.settings.hxDelete.noPassword": "delNoPassword",
    "mobile.settings.hxDelete.confirm": "delTitle",
    "mobile.settings.hxDelete.pending": "delPending",
    "mobile.settings.hxDelete.passwordRequired": "pwRequired",
    "mobile.settings.hxDelete.emailRequired": "delEmailRequired",
    "mobile.settings.hxDelete.incorrectPassword": "delIncorrect",
    "mobile.settings.hxDelete.failed": "delFailed",
}
DELETE_PHRASES: dict[str, dict[str, str]] = {
    "ar": {
        "delTitle": "حذف الحساب",
        "delAction": "حذف الحساب…",
        "delDescription": "يحذف حسابك في HXBot نهائيًا: بيانات التسجيل والحسابات المرتبطة وتسجيلات الدخول على كل الأجهزة وعضوياتك "
                          "والخوادم التي نشرتها. يبقى الوكلاء والمحادثات والملفات على أجهزتك كما هي.",
        "delConfirmTitle": "هل تريد حذف حسابك في HXBot؟",
        "delConfirmDescription": "سيُحذف {email} فورًا ولا يمكن استعادته، وسيُسجَّل الخروج من كل الأجهزة. أدخل كلمة المرور للتأكيد.",
        "delConfirmBody": "سيُحذف {email} فورًا ولا يمكن استعادته، وسيُسجَّل الخروج من كل الأجهزة.",
        "delEmailLabel": "البريد الإلكتروني لهذا الحساب",
        "delNoPassword": "لم تعيّن كلمة مرور؟ أكّد بالبريد الإلكتروني",
        "delPending": "جارٍ الحذف…",
        "delEmailRequired": "أدخل البريد الإلكتروني لهذا الحساب.",
        "delIncorrect": "كلمة المرور غير صحيحة.",
        "delFailed": "تعذّر حذف الحساب. حاول مرة أخرى لاحقًا.",
    },
    "de": {
        "delTitle": "Konto löschen",
        "delAction": "Konto löschen…",
        "delDescription": "Löscht dein HXBot-Konto endgültig: die Registrierungsdaten, verknüpfte Konten, die Anmeldungen auf allen Geräten, "
                          "deine Mitgliedschaften und die Server, die du veröffentlicht hast. Die Agenten, Chats und Dateien auf deinen Computern bleiben erhalten.",
        "delConfirmTitle": "HXBot-Konto löschen?",
        "delConfirmDescription": "{email} wird sofort gelöscht und kann nicht wiederhergestellt werden; alle Geräte werden abgemeldet. "
                                 "Gib zur Bestätigung dein Passwort ein.",
        "delConfirmBody": "{email} wird sofort gelöscht und kann nicht wiederhergestellt werden; alle Geräte werden abgemeldet.",
        "delEmailLabel": "E-Mail-Adresse dieses Kontos",
        "delNoPassword": "Nie ein Passwort festgelegt? Mit der E-Mail-Adresse bestätigen",
        "delPending": "Wird gelöscht…",
        "delEmailRequired": "Gib die E-Mail-Adresse dieses Kontos ein.",
        "delIncorrect": "Das Passwort ist falsch.",
        "delFailed": "Das Konto konnte nicht gelöscht werden. Versuche es später erneut.",
    },
    "es": {
        "delTitle": "Eliminar cuenta",
        "delAction": "Eliminar cuenta…",
        "delDescription": "Elimina tu cuenta de HXBot para siempre: los datos de registro, las cuentas vinculadas, las sesiones en todos los "
                          "dispositivos, tus membresías y los servidores que publicaste. Los agentes, chats y archivos de tus ordenadores se conservan.",
        "delConfirmTitle": "¿Eliminar tu cuenta de HXBot?",
        "delConfirmDescription": "{email} se elimina de inmediato y no se puede recuperar, y se cierra la sesión en todos los dispositivos. "
                                 "Introduce tu contraseña para confirmar.",
        "delConfirmBody": "{email} se elimina de inmediato y no se puede recuperar, y se cierra la sesión en todos los dispositivos.",
        "delEmailLabel": "Correo de esta cuenta",
        "delNoPassword": "¿Nunca definiste una contraseña? Confirma con el correo",
        "delPending": "Eliminando…",
        "delEmailRequired": "Introduce el correo de esta cuenta.",
        "delIncorrect": "La contraseña no es correcta.",
        "delFailed": "No se pudo eliminar la cuenta. Inténtalo de nuevo más tarde.",
    },
    "fr": {
        "delTitle": "Supprimer le compte",
        "delAction": "Supprimer le compte…",
        "delDescription": "Supprime définitivement votre compte HXBot : les informations d’inscription, les comptes associés, les connexions sur "
                          "tous les appareils, vos adhésions et les serveurs que vous avez publiés. Les agents, conversations et fichiers sur vos "
                          "ordinateurs sont conservés.",
        "delConfirmTitle": "Supprimer votre compte HXBot ?",
        "delConfirmDescription": "{email} est supprimé immédiatement et ne peut pas être restauré, et tous les appareils sont déconnectés. "
                                 "Saisissez votre mot de passe pour confirmer.",
        "delConfirmBody": "{email} est supprimé immédiatement et ne peut pas être restauré, et tous les appareils sont déconnectés.",
        "delEmailLabel": "E-mail de ce compte",
        "delNoPassword": "Jamais défini de mot de passe ? Confirmez avec l’e-mail",
        "delPending": "Suppression…",
        "delEmailRequired": "Saisissez l’e-mail de ce compte.",
        "delIncorrect": "Le mot de passe est incorrect.",
        "delFailed": "Impossible de supprimer le compte. Réessayez plus tard.",
    },
    "he": {
        "delTitle": "מחיקת החשבון",
        "delAction": "מחיקת החשבון…",
        "delDescription": "מוחקת לצמיתות את חשבון HXBot שלך: פרטי ההרשמה, החשבונות המקושרים, ההתחברויות בכל המכשירים, החברויות שלך "
                          "והשרתים שפרסמת. הסוכנים, הצ׳אטים והקבצים במחשבים שלך נשארים.",
        "delConfirmTitle": "למחוק את חשבון HXBot שלך?",
        "delConfirmDescription": "{email} יימחק מיד ולא יהיה אפשר לשחזר אותו, וכל המכשירים יתנתקו. יש להזין את הסיסמה לאישור.",
        "delConfirmBody": "{email} יימחק מיד ולא יהיה אפשר לשחזר אותו, וכל המכשירים יתנתקו.",
        "delEmailLabel": "האימייל של החשבון הזה",
        "delNoPassword": "לא הגדרת סיסמה? אפשר לאשר עם האימייל",
        "delPending": "מתבצעת מחיקה…",
        "delEmailRequired": "יש להזין את האימייל של החשבון הזה.",
        "delIncorrect": "הסיסמה שגויה.",
        "delFailed": "לא ניתן היה למחוק את החשבון. יש לנסות שוב מאוחר יותר.",
    },
    "it": {
        "delTitle": "Elimina account",
        "delAction": "Elimina account…",
        "delDescription": "Elimina definitivamente il tuo account HXBot: i dati di registrazione, gli account collegati, gli accessi su tutti i "
                          "dispositivi, le tue iscrizioni e i server che hai pubblicato. Gli agenti, le chat e i file sui tuoi computer restano.",
        "delConfirmTitle": "Eliminare il tuo account HXBot?",
        "delConfirmDescription": "{email} viene eliminato subito e non può essere ripristinato, e tutti i dispositivi vengono disconnessi. "
                                 "Inserisci la password per confermare.",
        "delConfirmBody": "{email} viene eliminato subito e non può essere ripristinato, e tutti i dispositivi vengono disconnessi.",
        "delEmailLabel": "Email di questo account",
        "delNoPassword": "Non hai mai impostato una password? Conferma con l'email",
        "delPending": "Eliminazione…",
        "delEmailRequired": "Inserisci l'email di questo account.",
        "delIncorrect": "La password non è corretta.",
        "delFailed": "Impossibile eliminare l'account. Riprova più tardi.",
    },
    "ja": {
        "delTitle": "アカウントを削除",
        "delAction": "アカウントを削除…",
        "delDescription": "HXBot アカウントを完全に削除します。登録情報、連携したアカウント、すべてのデバイスでのサインイン、メンバーシップ、"
                          "公開したサーバーが削除され、元に戻せません。コンピュータ上のエージェント、チャット、ファイルはそのまま残ります。",
        "delConfirmTitle": "HXBot アカウントを削除しますか？",
        "delConfirmDescription": "{email} はすぐに削除されて復元できず、すべてのデバイスからサインアウトされます。確認のためパスワードを入力してください。",
        "delConfirmBody": "{email} はすぐに削除されて復元できず、すべてのデバイスからサインアウトされます。",
        "delEmailLabel": "このアカウントのメールアドレス",
        "delNoPassword": "パスワードを設定していない場合は、メールアドレスで確認",
        "delPending": "削除しています…",
        "delEmailRequired": "このアカウントのメールアドレスを入力してください。",
        "delIncorrect": "パスワードが正しくありません。",
        "delFailed": "アカウントを削除できませんでした。しばらくしてからもう一度お試しください。",
    },
    "ko": {
        "delTitle": "계정 삭제",
        "delAction": "계정 삭제…",
        "delDescription": "HXBot 계정을 영구적으로 삭제합니다. 가입 정보, 연결된 계정, 모든 기기의 로그인, 멤버십, 게시한 서버가 삭제되며 "
                          "복구할 수 없습니다. 컴퓨터에 있는 에이전트, 채팅, 파일은 그대로 남습니다.",
        "delConfirmTitle": "HXBot 계정을 삭제할까요?",
        "delConfirmDescription": "{email} 계정이 즉시 삭제되어 복구할 수 없으며, 모든 기기에서 로그아웃됩니다. 확인하려면 비밀번호를 입력하세요.",
        "delConfirmBody": "{email} 계정이 즉시 삭제되어 복구할 수 없으며, 모든 기기에서 로그아웃됩니다.",
        "delEmailLabel": "이 계정의 이메일",
        "delNoPassword": "비밀번호를 설정한 적이 없나요? 이메일로 확인",
        "delPending": "삭제하는 중…",
        "delEmailRequired": "이 계정의 이메일을 입력하세요.",
        "delIncorrect": "비밀번호가 올바르지 않습니다.",
        "delFailed": "계정을 삭제하지 못했습니다. 나중에 다시 시도하세요.",
    },
    "nl": {
        "delTitle": "Account verwijderen",
        "delAction": "Account verwijderen…",
        "delDescription": "Verwijdert je HXBot-account definitief: de registratiegegevens, gekoppelde accounts, aanmeldingen op alle apparaten, "
                          "je lidmaatschappen en de servers die je hebt gepubliceerd. De agents, chats en bestanden op je computers blijven bewaard.",
        "delConfirmTitle": "Je HXBot-account verwijderen?",
        "delConfirmDescription": "{email} wordt meteen verwijderd en kan niet worden hersteld, en alle apparaten worden afgemeld. "
                                 "Voer je wachtwoord in om te bevestigen.",
        "delConfirmBody": "{email} wordt meteen verwijderd en kan niet worden hersteld, en alle apparaten worden afgemeld.",
        "delEmailLabel": "E-mailadres van dit account",
        "delNoPassword": "Nooit een wachtwoord ingesteld? Bevestig met het e-mailadres",
        "delPending": "Verwijderen…",
        "delEmailRequired": "Voer het e-mailadres van dit account in.",
        "delIncorrect": "Het wachtwoord is onjuist.",
        "delFailed": "Het account kon niet worden verwijderd. Probeer het later opnieuw.",
    },
    "pl": {
        "delTitle": "Usuń konto",
        "delAction": "Usuń konto…",
        "delDescription": "Trwale usuwa Twoje konto HXBot: dane rejestracyjne, połączone konta, logowania na wszystkich urządzeniach, Twoje "
                          "członkostwa i opublikowane przez Ciebie serwery. Agenci, czaty i pliki na Twoich komputerach pozostają.",
        "delConfirmTitle": "Usunąć konto HXBot?",
        "delConfirmDescription": "Konto {email} zostanie od razu usunięte bez możliwości przywrócenia, a wszystkie urządzenia zostaną wylogowane. "
                                 "Wpisz hasło, aby potwierdzić.",
        "delConfirmBody": "Konto {email} zostanie od razu usunięte bez możliwości przywrócenia, a wszystkie urządzenia zostaną wylogowane.",
        "delEmailLabel": "Adres e-mail tego konta",
        "delNoPassword": "Nie ustawiono hasła? Potwierdź adresem e-mail",
        "delPending": "Usuwanie…",
        "delEmailRequired": "Wpisz adres e-mail tego konta.",
        "delIncorrect": "Hasło jest nieprawidłowe.",
        "delFailed": "Nie udało się usunąć konta. Spróbuj ponownie później.",
    },
    "pt": {
        "delTitle": "Excluir conta",
        "delAction": "Excluir conta…",
        "delDescription": "Exclui sua conta HXBot para sempre: os dados de cadastro, as contas vinculadas, as sessões em todos os dispositivos, "
                          "suas participações e os servidores que você publicou. Os agentes, chats e arquivos nos seus computadores permanecem.",
        "delConfirmTitle": "Excluir sua conta HXBot?",
        "delConfirmDescription": "{email} é excluída na hora e não pode ser restaurada, e todos os dispositivos são desconectados. "
                                 "Digite sua senha para confirmar.",
        "delConfirmBody": "{email} é excluída na hora e não pode ser restaurada, e todos os dispositivos são desconectados.",
        "delEmailLabel": "E-mail desta conta",
        "delNoPassword": "Nunca definiu uma senha? Confirme com o e-mail",
        "delPending": "Excluindo…",
        "delEmailRequired": "Digite o e-mail desta conta.",
        "delIncorrect": "A senha está incorreta.",
        "delFailed": "Não foi possível excluir a conta. Tente novamente mais tarde.",
    },
    "ru": {
        "delTitle": "Удалить аккаунт",
        "delAction": "Удалить аккаунт…",
        "delDescription": "Безвозвратно удаляет ваш аккаунт HXBot: регистрационные данные, привязанные аккаунты, входы на всех устройствах, "
                          "ваши членства и опубликованные вами серверы. Агенты, чаты и файлы на ваших компьютерах сохранятся.",
        "delConfirmTitle": "Удалить аккаунт HXBot?",
        "delConfirmDescription": "Аккаунт {email} будет сразу удалён без возможности восстановления, а все устройства выйдут из него. "
                                 "Введите пароль для подтверждения.",
        "delConfirmBody": "Аккаунт {email} будет сразу удалён без возможности восстановления, а все устройства выйдут из него.",
        "delEmailLabel": "Адрес эл. почты этого аккаунта",
        "delNoPassword": "Пароль не задавали? Подтвердите адресом эл. почты",
        "delPending": "Удаление…",
        "delEmailRequired": "Введите адрес эл. почты этого аккаунта.",
        "delIncorrect": "Неверный пароль.",
        "delFailed": "Не удалось удалить аккаунт. Повторите попытку позже.",
    },
    "tr": {
        "delTitle": "Hesabı sil",
        "delAction": "Hesabı sil…",
        "delDescription": "HXBot hesabınızı kalıcı olarak siler: kayıt bilgileri, bağlı hesaplar, tüm cihazlardaki oturumlar, üyelikleriniz ve "
                          "yayımladığınız sunucular. Bilgisayarlarınızdaki ajanlar, sohbetler ve dosyalar kalır.",
        "delConfirmTitle": "HXBot hesabınız silinsin mi?",
        "delConfirmDescription": "{email} hemen silinir ve geri yüklenemez; tüm cihazlarda oturum kapatılır. Onaylamak için şifrenizi girin.",
        "delConfirmBody": "{email} hemen silinir ve geri yüklenemez; tüm cihazlarda oturum kapatılır.",
        "delEmailLabel": "Bu hesabın e-postası",
        "delNoPassword": "Hiç şifre belirlemediniz mi? E-postayla onaylayın",
        "delPending": "Siliniyor…",
        "delEmailRequired": "Bu hesabın e-postasını girin.",
        "delIncorrect": "Şifre yanlış.",
        "delFailed": "Hesap silinemedi. Daha sonra tekrar deneyin.",
    },
}
KEYS.update(DELETE_KEYS)
for _locale, _phrases in DELETE_PHRASES.items():
    PHRASES[_locale].update(_phrases)

# v1.6.2：最大权限的说明（覆盖上面“按需授权”的译文）、设置 → 授权与记录、强制更新
from translations_v162 import ACCESS as _V162_ACCESS, NEW as _V162_NEW, NEW_KEYS as V162_KEYS  # noqa: E402
from translations_v162 import PLACEHOLDERS as V162_PLACEHOLDERS  # noqa: E402

KEYS.update(V162_KEYS)
for _locale in LOCALES:
    PHRASES[_locale].update(_V162_ACCESS[_locale])
    PHRASES[_locale].update(_V162_NEW[_locale])

# v1.6.4：设置窗口的分组、“关于”和“获取帮助”（hx/settings_nav.py）；新文字里没有占位符
from translations_v164 import NEW as _V164_NEW, NEW_KEYS as V164_KEYS  # noqa: E402

KEYS.update(V164_KEYS)
for _locale in LOCALES:
    PHRASES[_locale].update(_V164_NEW[_locale])

# v1.6.4：电脑操控（一）的目录和自检（hx/computer_control.py）
from translations_computer import NEW as _COMPUTER_NEW, NEW_KEYS as COMPUTER_KEYS  # noqa: E402
from translations_computer import PLACEHOLDERS as COMPUTER_PLACEHOLDERS  # noqa: E402

KEYS.update(COMPUTER_KEYS)
for _locale in LOCALES:
    PHRASES[_locale].update(_COMPUTER_NEW[_locale])

# v1.6.5：协作（一）对话里的一行小字和智能体设置里的“自动选择模型”“建议卡”（hx/auto_model.py）
from translations_v165 import NEW as _V165_NEW, NEW_KEYS as V165_KEYS  # noqa: E402
from translations_v165 import PLACEHOLDERS as V165_PLACEHOLDERS  # noqa: E402

KEYS.update(V165_KEYS)
for _locale in LOCALES:
    PHRASES[_locale].update(_V165_NEW[_locale])

# v1.6.5：“添加服务商”里的 OpenCode 全部服务商（hx/opencode_connect.py）
from translations_opencode import NEW as _OPENCODE_NEW, NEW_KEYS as OPENCODE_KEYS  # noqa: E402
from translations_opencode import PLACEHOLDERS as OPENCODE_PLACEHOLDERS  # noqa: E402

KEYS.update(OPENCODE_KEYS)
for _locale in LOCALES:
    PHRASES[_locale].update(_OPENCODE_NEW[_locale])

# v1.6.6：协作（二）发起人对话里的进度小字和智能体设置里的团队上限（hx/team.py）
from translations_v166 import NEW as _V166_NEW, NEW_KEYS as V166_KEYS  # noqa: E402
from translations_v166 import PLACEHOLDERS as V166_PLACEHOLDERS  # noqa: E402

KEYS.update(V166_KEYS)
for _locale in LOCALES:
    PHRASES[_locale].update(_V166_NEW[_locale])

# v1.6.7：电脑操控（二）对话里的操作计划、每步完成的小字、停止键（hx/computer_steps.py）
from translations_v167 import NEW as _V167_NEW, NEW_KEYS as V167_KEYS  # noqa: E402
from translations_v167 import PLACEHOLDERS as V167_PLACEHOLDERS  # noqa: E402

KEYS.update(V167_KEYS)
for _locale in LOCALES:
    PHRASES[_locale].update(_V167_NEW[_locale])

# v1.6.8：电脑操控（三）一键授权：HXBot 自己点开关，用户只输密码或按指纹（hx/computer_real.py）
from translations_v168 import NEW as _V168_NEW, NEW_KEYS as V168_KEYS  # noqa: E402

KEYS.update(V168_KEYS)
for _locale in LOCALES:
    PHRASES[_locale].update(_V168_NEW[_locale])

# v1.7.0：不打扰其他应用：不抢焦点时发的通知（hx/quiet.py）
from translations_v170 import NEW as _V170_NEW, NEW_KEYS as V170_KEYS  # noqa: E402

KEYS.update(V170_KEYS)
for _locale in LOCALES:
    PHRASES[_locale].update(_V170_NEW[_locale])

# v1.7.1：并发（一）团队不设上限、守护、排队与容量（hx/flow.py）
from translations_v171 import NEW as _V171_NEW, NEW_KEYS as V171_KEYS  # noqa: E402
from translations_v171 import PLACEHOLDERS as V171_PLACEHOLDERS  # noqa: E402

KEYS.update(V171_KEYS)
for _locale in LOCALES:
    PHRASES[_locale].update(_V171_NEW[_locale])

# v1.7.3：电脑操控（五）停放、续做和“停放后自动续做”（hx/computer_v173.py）
from translations_v173 import NEW as _V173_NEW, NEW_KEYS as V173_KEYS  # noqa: E402
from translations_v173 import PLACEHOLDERS as V173_PLACEHOLDERS  # noqa: E402

KEYS.update(V173_KEYS)
for _locale in LOCALES:
    PHRASES[_locale].update(_V173_NEW[_locale])

# v1.7.3 紧急修正：边干活边更新后“接着做”的消息、更新服务不认登录（hx/hotfix_173.py）
from translations_v173_hotfix import NEW as _V173_HOTFIX_NEW, NEW_KEYS as V173_HOTFIX_KEYS  # noqa: E402
from translations_v173_hotfix import PLACEHOLDERS as V173_HOTFIX_PLACEHOLDERS  # noqa: E402

KEYS.update(V173_HOTFIX_KEYS)
for _locale in LOCALES:
    PHRASES[_locale].update(_V173_HOTFIX_NEW[_locale])

# v1.7.4：并发（二）等待看得见、团队进度卡每个成员一行（hx/flow_v174.py）
from translations_v174 import NEW as _V174_NEW, NEW_KEYS as V174_KEYS  # noqa: E402
from translations_v174 import PLACEHOLDERS as V174_PLACEHOLDERS  # noqa: E402

KEYS.update(V174_KEYS)
for _locale in LOCALES:
    PHRASES[_locale].update(_V174_NEW[_locale])

# v1.7.5：应用工作流与定时任务升级、学到的时间、裁判自动模式、开机视频的声音（hx/routines_v175.py）
from translations_v175 import NEW as _V175_NEW, NEW_KEYS as V175_KEYS  # noqa: E402
from translations_v175 import PLACEHOLDERS as V175_PLACEHOLDERS  # noqa: E402

KEYS.update(V175_KEYS)
for _locale in LOCALES:
    PHRASES[_locale].update(_V175_NEW[_locale])
