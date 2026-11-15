import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/computerUse";

export const messages = {
  "computerUse.permission.screenRecording.title": "Schermopname",
  "computerUse.permission.screenRecording.description":
    "Laat HXBot schermafbeeldingen maken. Klikken en typen werken ook zonder.",
  "computerUse.permission.screenRecording.pane": "Scherm- en systeemaudio-opname",
  "computerUse.permission.accessibility.title": "Toegankelijkheid",
  "computerUse.permission.accessibility.description":
    "Laat HXBot klikken en typen. Daarna zet HXBot schermopname zelf aan.",
  "computerUse.permission.accessibility.pane": "Toegankelijkheid",
  "computerUse.error.check": "HXBot kan Computerbesturing niet controleren.",
  "computerUse.error.openSettings": "HXBot kan Systeeminstellingen niet openen.",
  "computerUse.error.startDriver": "HXBot kan het stuurprogramma voor Computerbesturing niet starten.",
  "computerUse.checkAgain": "Opnieuw controleren",
  "computerUse.checking": "Computerbesturing controleren",
  "computerUse.unavailable.title": "Computerbesturing is nog niet beschikbaar",
  "computerUse.permissions.title": "Systeemmachtigingen",
  "computerUse.permissions.description":
    "macOS beheert de machtigingen. Na ‘Verlenen’ zet HXBot aan wat het kan; jij geeft alleen je wachtwoord of Touch ID.",
  "computerUse.ready.title": "Computerbesturing is klaar",
  "computerUse.ready.description":
    "HXBot kan apps op deze computer zien en bedienen. Dit systeem vraagt geen extra machtiging.",
  "computerUse.openSettingsFailed.title": "Kan Systeeminstellingen niet openen",
  "computerUse.compact.title": "Computerbesturing inschakelen",
  "computerUse.compact.description": "Laat HXBot apps op deze computer zien en bedienen.",
  "computerUse.granted": "Verleend",
  "computerUse.opening": "Openen…",
  "computerUse.manage": "Beheren",
  "computerUse.grant": "Verlenen",
  "computerUse.manageLabel": "{permission} beheren",
  "computerUse.grantLabel": "{permission} verlenen",
  "computerUse.help.title": "Zet {permission} aan",
  "computerUse.help.paneOpen": "Systeeminstellingen is geopend bij {pane}.",
  "computerUse.help.dragLabel": "Sleep {name} naar Systeeminstellingen, of druk om het in Finder te tonen",
  "computerUse.help.dragToAdd": "Sleep om toe te voegen",
  "computerUse.help.findInList": "Zoek {name} in de lijst.",
  "computerUse.help.dragIntoList": "Sleep {name}.app naar de lijst.",
  "computerUse.help.turnOn": "Zet de schakelaar aan.",
  "computerUse.help.showInFinder": "Toon in Finder",
  "computerUse.help.revealFailed": "Kan de app niet tonen in Finder.",
  "computerUse.help.dragFailed": "Kan de app niet slepen.",
  "computerUse.highlight.working": "HXBot werkt in {title}",
  "computerUse.help.hxPressesScreen":
    "Heeft HXBot Toegankelijkheid, dan zet het deze schakelaar zelf aan. Vraagt macOS erom, geef dan je wachtwoord of gebruik Touch ID.",
  "computerUse.help.hxThenScreen":
    "Alleen jij mag deze schakelaar voor HXBot aanzetten (regel van macOS). Daarna zet HXBot schermopname zelf aan.",
  "computerUse.hxAskTitle": "HXBot heeft een toestemming nodig",
  "computerUse.hxAskBody":
    "Klik om de pagina in Systeeminstellingen te openen. HXBot opent die niet terwijl je in een andere app werkt.",
} as const satisfies PartialTranslation<typeof source>;
