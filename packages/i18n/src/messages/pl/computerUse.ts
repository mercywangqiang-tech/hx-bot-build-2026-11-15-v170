import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/computerUse";

export const messages = {
  "computerUse.permission.screenRecording.title": "Nagrywanie ekranu",
  "computerUse.permission.screenRecording.description":
    "Pozwala HXBot robić zrzuty ekranu. Klikanie i pisanie działają bez tego.",
  "computerUse.permission.screenRecording.pane": "Nagrywanie ekranu i dźwięku systemowego",
  "computerUse.permission.accessibility.title": "Dostępność",
  "computerUse.permission.accessibility.description":
    "Pozwala HXBot klikać i pisać. Potem HXBot sam włącza nagrywanie ekranu.",
  "computerUse.permission.accessibility.pane": "Dostępność",
  "computerUse.error.check": "HXBot nie mógł sprawdzić Sterowania komputerem.",
  "computerUse.error.openSettings": "HXBot nie mógł otworzyć Ustawień systemowych.",
  "computerUse.error.startDriver": "HXBot nie mógł uruchomić sterownika Sterowania komputerem.",
  "computerUse.checkAgain": "Sprawdź ponownie",
  "computerUse.checking": "Sprawdzanie Sterowania komputerem",
  "computerUse.unavailable.title": "Sterowanie komputerem nie jest jeszcze dostępne",
  "computerUse.permissions.title": "Uprawnienia systemowe",
  "computerUse.permissions.description":
    "Uprawnieniami zarządza macOS. Po „Przyznaj” HXBot włącza to, co może; ty podajesz tylko hasło lub Touch ID.",
  "computerUse.ready.title": "Sterowanie komputerem jest gotowe",
  "computerUse.ready.description":
    "HXBot widzi aplikacje na tym komputerze i może ich używać. Ten system nie wymaga dodatkowych uprawnień.",
  "computerUse.openSettingsFailed.title": "Nie udało się otworzyć Ustawień systemowych",
  "computerUse.compact.title": "Włącz Sterowanie komputerem",
  "computerUse.compact.description": "Pozwól HXBot widzieć aplikacje na tym komputerze i ich używać.",
  "computerUse.granted": "Przyznano",
  "computerUse.opening": "Otwieranie…",
  "computerUse.manage": "Zarządzaj",
  "computerUse.grant": "Przyznaj",
  "computerUse.manageLabel": "Zarządzaj: {permission}",
  "computerUse.grantLabel": "Przyznaj: {permission}",
  "computerUse.help.title": "Włącz: {permission}",
  "computerUse.help.paneOpen": "Ustawienia systemowe są otwarte w sekcji {pane}.",
  "computerUse.help.dragLabel": "Przeciągnij {name} do Ustawień systemowych lub naciśnij, aby pokazać w Finderze",
  "computerUse.help.dragToAdd": "Przeciągnij, aby dodać",
  "computerUse.help.findInList": "Znajdź {name} na liście.",
  "computerUse.help.dragIntoList": "Przeciągnij {name}.app na listę.",
  "computerUse.help.turnOn": "Włącz przełącznik.",
  "computerUse.help.showInFinder": "Pokaż w Finderze",
  "computerUse.help.revealFailed": "Nie udało się pokazać aplikacji w Finderze.",
  "computerUse.help.dragFailed": "Nie udało się przeciągnąć aplikacji.",
  "computerUse.highlight.working": "HXBot pracuje w: {title}",
  "computerUse.help.hxPressesScreen":
    "Gdy HXBot ma Dostępność, sam włącza ten przełącznik. Gdy macOS poprosi, podaj hasło lub użyj Touch ID.",
  "computerUse.help.hxThenScreen":
    "macOS pozwala tylko tobie włączyć ten przełącznik dla HXBot. Potem HXBot sam włącza nagrywanie ekranu.",
  "computerUse.hxAskTitle": "HXBot potrzebuje uprawnienia",
  "computerUse.hxAskBody":
    "Kliknij, aby otworzyć stronę w Ustawieniach systemowych. HXBot nie otwiera jej, gdy pracujesz w innej aplikacji.",
} as const satisfies PartialTranslation<typeof source>;
