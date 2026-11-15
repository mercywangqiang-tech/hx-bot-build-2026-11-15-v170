import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/startup";

export const messages = {
  "startup.failedTitle": "HXBot konnte nicht starten",
  "startup.failedBody":
    "{message}\n\nDeine lokalen Daten wurden weder zurückgesetzt noch überschrieben. Schritte zur Wiederherstellung findest du in der Anleitung zur Fehlerbehebung.",
  "startup.archiveChangedTitle": "HXBot-Dateien wurden geändert",
  "startup.archiveChangedBody":
    "Ein anderes Programm hat die HXBot-Datei app.asar geändert. HXBot läuft jetzt, startet aber nicht mehr, wenn du es beendest.\n\nInstalliere HXBot erneut, um es zu reparieren. Deine lokalen Daten bleiben erhalten.",
  "startup.archiveChangedDownload": "HXBot laden",
  "startup.newerDataUpdatingTitle": "HXBot wird aktualisiert",
  "startup.newerDataUpdatingBody":
    "Eine neuere Version von HXBot hat deine Daten gespeichert. HXBot installiert die neueste Version und startet dann neu.\n\nDeine lokalen Daten wurden nicht zurückgesetzt oder überschrieben.",
  "startup.newerDataTitle": "Neueste HXBot-Version installieren",
  "startup.newerDataBody":
    "Eine neuere Version von HXBot hat deine Daten gespeichert, und diese Version ({version}) kann sie nicht öffnen. Installiere die neueste Version, um deine Daten zu öffnen.\n\nDeine lokalen Daten wurden nicht zurückgesetzt oder überschrieben.",
  "startup.newerDataDownload": "HXBot laden",
  "startup.newerDataGuide": "Anleitung öffnen",
  "startup.newerDataQuit": "Beenden",
  "startup.hxMoveTitle": "HXBot in den Ordner „Programme“ bewegen?",
  "startup.hxMoveBody":
    "HXBot läuft außerhalb des Ordners „Programme“, zum Beispiel aus „Downloads“ oder einem Festplattenimage. macOS startet es dann von einem temporären Ort, und Berechtigungen und Updates funktionieren nicht. HXBot bewegt sich selbst und öffnet sich neu.",
  "startup.hxMoveNow": "Bewegen",
  "startup.hxMoveLater": "Nicht jetzt",
  "startup.hxMoveFailed":
    "HXBot konnte sich nicht selbst bewegen. Beende HXBot und ziehe es im Finder in den Ordner „Programme“.",
} as const satisfies PartialTranslation<typeof source>;
