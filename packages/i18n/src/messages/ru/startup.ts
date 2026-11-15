import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/startup";

export const messages = {
  "startup.failedTitle": "HXBot не удалось запустить",
  "startup.failedBody":
    "{message}\n\nЛокальные данные не сброшены и не перезаписаны. Шаги восстановления — в руководстве по устранению неполадок.",
  "startup.archiveChangedTitle": "Файлы HXBot изменены",
  "startup.archiveChangedBody":
    "Другая программа изменила файл HXBot app.asar. Сейчас HXBot работает, но после выхода он больше не запустится.\n\nЧтобы исправить это, установите HXBot заново. Ваши локальные данные сохранятся.",
  "startup.archiveChangedDownload": "Скачать HXBot",
  "startup.newerDataUpdatingTitle": "Обновление HXBot",
  "startup.newerDataUpdatingBody":
    "Более новая версия HXBot сохранила ваши данные. HXBot устанавливает последнюю версию и затем откроется снова.\n\nВаши локальные данные не были сброшены или перезаписаны.",
  "startup.newerDataTitle": "Установите последнюю версию HXBot",
  "startup.newerDataBody":
    "Более новая версия HXBot сохранила ваши данные, и эта версия ({version}) не может их открыть. Установите последнюю версию, чтобы открыть данные.\n\nВаши локальные данные не были сброшены или перезаписаны.",
  "startup.newerDataDownload": "Скачать HXBot",
  "startup.newerDataGuide": "Открыть руководство",
  "startup.newerDataQuit": "Выйти",
  "startup.hxMoveTitle": "Переместить HXBot в папку «Программы»?",
  "startup.hxMoveBody":
    "HXBot запущен не из папки «Программы», например из «Загрузок» или с образа диска. Тогда macOS запускает его из временного места, и разрешения и обновления не работают. HXBot переместится сам и откроется снова.",
  "startup.hxMoveNow": "Переместить",
  "startup.hxMoveLater": "Не сейчас",
  "startup.hxMoveFailed": "HXBot не смог переместиться. Закройте HXBot и перетащите его в Finder в папку «Программы».",
} as const satisfies PartialTranslation<typeof source>;
