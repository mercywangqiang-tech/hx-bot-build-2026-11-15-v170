import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/startup";

export const messages = {
  "startup.failedTitle": "HXBot kan niet starten",
  "startup.failedBody":
    "{message}\n\nJe lokale gegevens zijn niet gereset of overschreven. Bekijk de handleiding voor probleemoplossing voor herstelstappen.",
  "startup.archiveChangedTitle": "HXBot-bestanden zijn gewijzigd",
  "startup.archiveChangedBody":
    "Een ander programma heeft het HXBot-bestand app.asar gewijzigd. HXBot werkt nu, maar opent niet meer nadat je het afsluit.\n\nInstalleer HXBot opnieuw om het te herstellen. Je lokale gegevens blijven bewaard.",
  "startup.archiveChangedDownload": "HXBot downloaden",
  "startup.newerDataUpdatingTitle": "HXBot wordt bijgewerkt",
  "startup.newerDataUpdatingBody":
    "Een nieuwere versie van HXBot heeft je gegevens opgeslagen. HXBot installeert de nieuwste versie en opent daarna opnieuw.\n\nJe lokale gegevens zijn niet gereset of overschreven.",
  "startup.newerDataTitle": "Installeer de nieuwste HXBot",
  "startup.newerDataBody":
    "Een nieuwere versie van HXBot heeft je gegevens opgeslagen, en deze versie ({version}) kan ze niet openen. Installeer de nieuwste versie om je gegevens te openen.\n\nJe lokale gegevens zijn niet gereset of overschreven.",
  "startup.newerDataDownload": "HXBot downloaden",
  "startup.newerDataGuide": "Gids openen",
  "startup.newerDataQuit": "Stoppen",
  "startup.hxMoveTitle": "HXBot naar Apps verplaatsen?",
  "startup.hxMoveBody":
    "HXBot draait buiten de map Apps, bijvoorbeeld vanuit Downloads of een schijfkopie. macOS start het dan vanaf een tijdelijke plek, en machtigingen en updates werken niet. HXBot verplaatst zichzelf en opent opnieuw.",
  "startup.hxMoveNow": "Verplaats",
  "startup.hxMoveLater": "Niet nu",
  "startup.hxMoveFailed": "HXBot kon zichzelf niet verplaatsen. Stop HXBot en sleep het in de Finder naar de map Apps.",
} as const satisfies PartialTranslation<typeof source>;
