import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/startup";

export const messages = {
  "startup.failedTitle": "Nie udało się uruchomić HXBot",
  "startup.failedBody":
    "{message}\n\nTwoje lokalne dane nie zostały zresetowane ani nadpisane. Kroki przywracania znajdziesz w przewodniku rozwiązywania problemów.",
  "startup.archiveChangedTitle": "Pliki HXBot zostały zmienione",
  "startup.archiveChangedBody":
    "Inny program zmienił plik app.asar HXBot. HXBot działa teraz, ale nie uruchomi się po zamknięciu.\n\nAby naprawić HXBot, zainstaluj go ponownie. Twoje lokalne dane zostaną zachowane.",
  "startup.archiveChangedDownload": "Pobierz HXBot",
  "startup.newerDataUpdatingTitle": "Aktualizowanie HXBot",
  "startup.newerDataUpdatingBody":
    "Nowsza wersja HXBot zapisała Twoje dane. HXBot instaluje najnowszą wersję, a potem uruchomi się ponownie.\n\nTwoje lokalne dane nie zostały zresetowane ani nadpisane.",
  "startup.newerDataTitle": "Zainstaluj najnowszy HXBot",
  "startup.newerDataBody":
    "Nowsza wersja HXBot zapisała Twoje dane, a ta wersja ({version}) nie może ich otworzyć. Zainstaluj najnowszą wersję, aby otworzyć swoje dane.\n\nTwoje lokalne dane nie zostały zresetowane ani nadpisane.",
  "startup.newerDataDownload": "Pobierz HXBot",
  "startup.newerDataGuide": "Otwórz przewodnik",
  "startup.newerDataQuit": "Zakończ",
  "startup.hxMoveTitle": "Przenieść HXBot do folderu Aplikacje?",
  "startup.hxMoveBody":
    "HXBot działa poza folderem Aplikacje, na przykład z Pobranych lub z obrazu dysku. macOS uruchamia go wtedy z tymczasowego miejsca i uprawnienia oraz aktualizacje nie działają. HXBot sam się przeniesie i otworzy ponownie.",
  "startup.hxMoveNow": "Przenieś",
  "startup.hxMoveLater": "Nie teraz",
  "startup.hxMoveFailed":
    "HXBot nie mógł się przenieść. Zamknij HXBot i przeciągnij go w Finderze do folderu Aplikacje.",
} as const satisfies PartialTranslation<typeof source>;
