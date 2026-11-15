import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/computerUse";

export const messages = {
  "computerUse.permission.screenRecording.title": "Registrazione schermo",
  "computerUse.permission.screenRecording.description":
    "Permette a HXBot di fare screenshot. Clic e digitazione funzionano anche senza.",
  "computerUse.permission.screenRecording.pane": "Registrazione schermo e audio di sistema",
  "computerUse.permission.accessibility.title": "Accessibilità",
  "computerUse.permission.accessibility.description":
    "Permette a HXBot di fare clic e digitare. Poi HXBot attiva da solo la registrazione dello schermo.",
  "computerUse.permission.accessibility.pane": "Accessibilità",
  "computerUse.error.check": "HXBot non è riuscito a verificare il Controllo del computer.",
  "computerUse.error.openSettings": "HXBot non è riuscito ad aprire le Impostazioni di Sistema.",
  "computerUse.error.startDriver": "HXBot non è riuscito ad avviare il driver del Controllo del computer.",
  "computerUse.checkAgain": "Ricontrolla",
  "computerUse.checking": "Verifica del Controllo del computer in corso",
  "computerUse.unavailable.title": "Il Controllo del computer non è ancora disponibile",
  "computerUse.permissions.title": "Permessi di sistema",
  "computerUse.permissions.description":
    "I permessi sono gestiti da macOS. Dopo «Concedi», HXBot attiva ciò che può; tu inserisci solo la password o Touch ID.",
  "computerUse.ready.title": "Il Controllo del computer è pronto",
  "computerUse.ready.description":
    "HXBot può vedere le app di questo computer e usarle. Questo sistema non richiede altri permessi.",
  "computerUse.openSettingsFailed.title": "Impossibile aprire le Impostazioni di Sistema",
  "computerUse.compact.title": "Attiva il Controllo del computer",
  "computerUse.compact.description": "Lascia che HXBot veda le app di questo computer e le usi.",
  "computerUse.granted": "Concesso",
  "computerUse.opening": "Apertura…",
  "computerUse.manage": "Gestisci",
  "computerUse.grant": "Concedi",
  "computerUse.manageLabel": "Gestisci {permission}",
  "computerUse.grantLabel": "Concedi {permission}",
  "computerUse.help.title": "Attiva {permission}",
  "computerUse.help.paneOpen": "Le Impostazioni di Sistema sono aperte su {pane}.",
  "computerUse.help.dragLabel": "Trascina {name} nelle Impostazioni di Sistema, oppure premi per mostrarlo nel Finder",
  "computerUse.help.dragToAdd": "Trascina per aggiungere",
  "computerUse.help.findInList": "Trova {name} nell'elenco.",
  "computerUse.help.dragIntoList": "Trascina {name}.app nell'elenco.",
  "computerUse.help.turnOn": "Attiva l'interruttore.",
  "computerUse.help.showInFinder": "Mostra nel Finder",
  "computerUse.help.revealFailed": "Impossibile mostrare l'applicazione nel Finder.",
  "computerUse.help.dragFailed": "Impossibile trascinare l'applicazione.",
  "computerUse.highlight.working": "HXBot sta lavorando in {title}",
  "computerUse.help.hxPressesScreen":
    "Quando HXBot ha l'Accessibilità, attiva da solo questo interruttore. Quando macOS lo chiede, inserisci la password o usa Touch ID.",
  "computerUse.help.hxThenScreen":
    "macOS permette solo a te di attivare questo interruttore per HXBot. Poi HXBot attiva da solo la registrazione dello schermo.",
  "computerUse.hxAskTitle": "HXBot ha bisogno di un permesso",
  "computerUse.hxAskBody":
    "Fai clic per aprire la pagina in Impostazioni di Sistema. HXBot non la apre mentre lavori in un’altra app.",
} as const satisfies PartialTranslation<typeof source>;
