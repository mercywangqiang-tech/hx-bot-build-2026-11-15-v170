import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/startup";

export const messages = {
  "startup.failedTitle": "HXBot non è riuscito ad avviarsi",
  "startup.failedBody":
    "{message}\n\nI tuoi dati locali non sono stati reimpostati né sovrascritti. Consulta la guida alla risoluzione dei problemi per i passaggi di ripristino.",
  "startup.archiveChangedTitle": "I file di HXBot sono stati modificati",
  "startup.archiveChangedBody":
    "Un altro programma ha modificato il file app.asar di HXBot. HXBot ora funziona, ma non si aprirà più dopo la chiusura.\n\nPer ripararlo, installa di nuovo HXBot. I tuoi dati locali restano.",
  "startup.archiveChangedDownload": "Scarica HXBot",
  "startup.newerDataUpdatingTitle": "Aggiornamento di HXBot",
  "startup.newerDataUpdatingBody":
    "Una versione più recente di HXBot ha salvato i tuoi dati. HXBot installa l’ultima versione e poi si riapre.\n\nI tuoi dati locali non sono stati reimpostati né sovrascritti.",
  "startup.newerDataTitle": "Installa l’ultima versione di HXBot",
  "startup.newerDataBody":
    "Una versione più recente di HXBot ha salvato i tuoi dati e questa versione ({version}) non può aprirli. Installa l’ultima versione per aprire i tuoi dati.\n\nI tuoi dati locali non sono stati reimpostati né sovrascritti.",
  "startup.newerDataDownload": "Scarica HXBot",
  "startup.newerDataGuide": "Apri guida",
  "startup.newerDataQuit": "Esci",
  "startup.hxMoveTitle": "Spostare HXBot in Applicazioni?",
  "startup.hxMoveBody":
    "HXBot è in esecuzione fuori dalla cartella Applicazioni, per esempio da Download o da un'immagine disco. macOS lo avvia allora da una posizione temporanea, e permessi e aggiornamenti non funzionano. HXBot si sposta da solo e si riapre.",
  "startup.hxMoveNow": "Sposta",
  "startup.hxMoveLater": "Non ora",
  "startup.hxMoveFailed":
    "HXBot non è riuscito a spostarsi. Esci da HXBot e trascinalo nella cartella Applicazioni nel Finder.",
} as const satisfies PartialTranslation<typeof source>;
