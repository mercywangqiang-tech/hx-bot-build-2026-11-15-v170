import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/menu";

export const messages = {
  "menu.stopAllAgents": "Alle Agenten stoppen",
  "menu.checkForUpdates": "Nach Updates suchen…",
  "menu.preferences": "Einstellungen…",
  "menu.actualSize": "Originalgröße",
  "menu.zoomIn": "Vergrößern",
  "menu.zoomOut": "Verkleinern",
  "menu.copyLink": "Link kopieren",
  "menu.quit": "HXBot beenden",
  "menu.quitConfirmTitle": "HXBot beenden?",
  "menu.quitConfirmBody": "Agenten und Routinen stoppen, bis du HXBot wieder öffnest.",
  "menu.quitConfirm": "Beenden",
  "menu.quitHint": "Halte ⌘Q gedrückt oder drücke zweimal, um zu beenden",
  "menu.trayOpen": "HXBot öffnen",
  "menu.trayQuit": "HXBot beenden",
  "menu.trayTooltip": "HXBot",
  "menu.undo": "Rückgängig",
  "menu.redo": "Wiederholen",
  "menu.cut": "Ausschneiden",
  "menu.copy": "Kopieren",
  "menu.paste": "Einfügen",
  "menu.pasteAndMatchStyle": "Einsetzen und Stil anpassen",
  "menu.delete": "Löschen",
  "menu.selectAll": "Alles auswählen",
} as const satisfies PartialTranslation<typeof source>;
