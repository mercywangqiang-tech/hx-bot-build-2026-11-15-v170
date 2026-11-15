import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/computerUse";

export const messages = {
  "computerUse.permission.screenRecording.title": "Запись экрана",
  "computerUse.permission.screenRecording.description":
    "Позволяет HXBot делать снимки экрана. Нажатия и ввод работают без этого.",
  "computerUse.permission.screenRecording.pane": "Запись экрана и системного звука",
  "computerUse.permission.accessibility.title": "Универсальный доступ",
  "computerUse.permission.accessibility.description":
    "Позволяет HXBot нажимать и вводить текст. Затем HXBot сам включает запись экрана.",
  "computerUse.permission.accessibility.pane": "Универсальный доступ",
  "computerUse.error.check": "HXBot не смог проверить управление компьютером.",
  "computerUse.error.openSettings": "HXBot не смог открыть «Системные настройки».",
  "computerUse.error.startDriver": "HXBot не смог запустить драйвер управления компьютером.",
  "computerUse.checkAgain": "Проверить снова",
  "computerUse.checking": "Проверка управления компьютером",
  "computerUse.unavailable.title": "Управление компьютером пока недоступно",
  "computerUse.permissions.title": "Системные разрешения",
  "computerUse.permissions.description":
    "Разрешениями управляет macOS. После «Разрешить» HXBot сам включает то, что может; вы только вводите пароль или Touch ID.",
  "computerUse.ready.title": "Управление компьютером готово",
  "computerUse.ready.description":
    "HXBot может видеть приложения на этом компьютере и работать с ними. Эта система не запрашивает дополнительных разрешений.",
  "computerUse.openSettingsFailed.title": "Не удалось открыть «Системные настройки»",
  "computerUse.compact.title": "Включить управление компьютером",
  "computerUse.compact.description": "Позвольте HXBot видеть приложения на этом компьютере и работать с ними.",
  "computerUse.granted": "Разрешено",
  "computerUse.opening": "Открывается…",
  "computerUse.manage": "Настроить",
  "computerUse.grant": "Разрешить",
  "computerUse.manageLabel": "Настроить: {permission}",
  "computerUse.grantLabel": "Разрешить: {permission}",
  "computerUse.help.title": "Включите «{permission}»",
  "computerUse.help.paneOpen": "«Системные настройки» открыты на разделе «{pane}».",
  "computerUse.help.dragLabel": "Перетащите {name} в «Системные настройки» или нажмите, чтобы показать в Finder",
  "computerUse.help.dragToAdd": "Перетащите, чтобы добавить",
  "computerUse.help.findInList": "Найдите {name} в списке.",
  "computerUse.help.dragIntoList": "Перетащите {name}.app в список.",
  "computerUse.help.turnOn": "Включите переключатель.",
  "computerUse.help.showInFinder": "Показать в Finder",
  "computerUse.help.revealFailed": "Не удалось показать приложение в Finder.",
  "computerUse.help.dragFailed": "Не удалось перетащить приложение.",
  "computerUse.highlight.working": "HXBot работает в «{title}»",
  "computerUse.help.hxPressesScreen":
    "Когда у HXBot есть универсальный доступ, он сам включает этот переключатель. Когда macOS попросит, введите пароль или используйте Touch ID.",
  "computerUse.help.hxThenScreen":
    "macOS разрешает включить этот переключатель для HXBot только вам. Затем HXBot сам включает запись экрана.",
  "computerUse.hxAskTitle": "HXBot нужно разрешение",
  "computerUse.hxAskBody":
    "Нажмите, чтобы открыть страницу в Системных настройках. Пока вы работаете в другом приложении, HXBot не открывает её сам.",
} as const satisfies PartialTranslation<typeof source>;
