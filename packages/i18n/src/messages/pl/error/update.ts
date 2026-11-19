import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/update";

export const messages = {
  "error.update.unsupported": "Aktualizacje są dostępne w zainstalowanych wersjach desktopowych.",
  "error.update.notReady": "Aktualizacja nie jest gotowa do instalacji.",
  "error.update.restartFailed": "HXBot nie mógł uruchomić się ponownie, aby zainstalować aktualizację.",
  "error.update.downloadStalled": "Pobieranie aktualizacji przestało odpowiadać. Spróbuj ponownie.",
  "error.update.installFailed":
    "Nie udało się zainstalować aktualizacji. Zamknij i otwórz ponownie HXBot, a potem spróbuj ponownie.",
  "error.update.downloadFailed": "Nie udało się pobrać aktualizacji. Spróbuj ponownie.",
  "error.update.checkFailed": "Nie udało się sprawdzić aktualizacji. Spróbuj ponownie.",
  "error.update.checkStalled": "Sprawdzanie aktualizacji przestało odpowiadać. Spróbuj ponownie.",
  "error.update.checkOffline":
    "Nie udało się połączyć z usługą aktualizacji. Sprawdź połączenie z internetem i spróbuj ponownie.",
  "error.update.checkUnavailable": "Usługa aktualizacji nie odpowiedziała. HXBot sam spróbuje ponownie za kilka minut.",
  "error.update.checkNoRelease":
    "Nie znaleziono opublikowanej aktualizacji dla tej platformy. HXBot sam spróbuje ponownie za kilka minut.",
  "error.update.managedByNix": "Aktualizacje tej kopii HXBot instaluje Nix. Zaktualizuj ją przez Nix.",
  "error.update.managedByHost":
    "Aktualizacje na tym Macu instaluje host. Aktualizacja pozostaje gotowa do czasu konserwacji hosta.",
  "error.update.siblingSession":
    "Inna sesja HXBot nadal działa z tej aplikacji. Najpierw zatrzymaj HXBot na każdym innym koncie użytkownika macOS, a potem ponownie zainstaluj aktualizację.",
  "error.update.siblingSessionSameAccount":
    "Inny proces HXBot nadal działa na tym koncie użytkownika. Zamknij go, a potem ponownie zainstaluj aktualizację.",
  "error.update.siblingCheckFailed": "Nie udało się sprawdzić innych sesji HXBot. Spróbuj ponownie przed instalacją.",
  "error.update.remoteDisabled": "Aktualizacje od administratorów serwera są wyłączone na tym komputerze.",
  "error.update.restartStarted": "HXBot już uruchamia się ponownie, aby zainstalować aktualizację.",
  "error.update.alreadyRestarting": "HXBot już uruchamia się ponownie.",
  "error.update.checkSignedOut":
    "Serwer aktualizacji nie przyjął twojego logowania. Zaloguj się ponownie do HXBot, a potem sprawdź aktualizacje.",
} as const satisfies PartialTranslation<typeof source>;
