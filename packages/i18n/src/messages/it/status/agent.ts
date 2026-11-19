import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/agent";

export const messages = {
  "status.agent.claudeWriteOutside":
    "Scrittura di {path}, fuori dal workspace dell'agente, dalla cartella condivisa e dalle cartelle temporanee.",
  "status.agent.contextCleared": "Contesto cancellato. Da qui inizia una nuova chat.",
  "status.agent.instructionsChanged": "Ha aggiornato le sue istruzioni",
  "status.agent.modelSwitchedForLimit": "Limite di utilizzo raggiunto. Passato a {model}.",
  "status.agent.modelReturnedAfterLimit": "Limite di utilizzo terminato. Tornato a {model}.",
  "status.agent.modelSwitchedForError": "Errore del provider. Passato a {model}.",
  "status.agent.modelReturnedAfterError": "Tornato a {model} dopo l’errore del provider.",
  "status.agent.marketplaceSuggested": "Ha suggerito un'app del Marketplace: {app}.",
  "status.agent.channelMemberAdded": "{agent} ha aggiunto {member} al canale. Lo ha chiesto {person}.",
  "status.agent.channelMemberRemoved": "{agent} ha rimosso {member} dal canale. Lo ha chiesto {person}.",
  "status.agent.channelInstructionsChanged": "{agent} ha modificato le istruzioni del canale. Lo ha chiesto {person}.",
  "status.agent.channelRoutineCreated": "{agent} ha creato la routine {routine}. Lo ha chiesto {person}.",
  "status.agent.channelRoutineUpdated": "{agent} ha modificato la routine {routine}. Lo ha chiesto {person}.",
  "status.agent.channelRoutineDeleted": "{agent} ha eliminato la routine {routine}. Lo ha chiesto {person}.",
  "status.agent.channelTaskCancelled":
    "{agent} ha annullato l’attività «{task}» e le sue sottoattività. Lo ha chiesto {person}.",
  "status.agent.screenCaptureScreen":
    "Acquisizione dello schermo principale e invio dell'immagine al modello dell'agente.",
  "status.agent.screenCaptureChannel":
    "L'immagine appare nel canale {channel} e ogni membro di questo server che legge il canale può vederla.",
  "status.agent.screenCaptureDisplay":
    "Acquisizione dello schermo {name} e invio dell'immagine al modello dell'agente.",
  "status.agent.screenCaptureWindow":
    "Acquisizione della finestra {name} e invio dell'immagine al modello dell'agente.",
  "status.agent.screenCaptureRegion":
    "Acquisizione dell'area dello schermo a {x}, {y}, {width} × {height} punti e invio dell'immagine al modello dell'agente.",
  "status.agent.workflowDelete":
    "Elimina il flusso di lavoro {title} con le sue esecuzioni e versioni. I suoi passaggi aperti si fermano.",
  "status.agent.screenCaptureProgress": "Richiesta di acquisizione dello schermo…",
  "status.agent.screenCaptureReviewing": "Analisi dell'acquisizione dello schermo…",
  "status.agent.browserOpening": "Apertura di una pagina web…",
  "status.agent.browserReading": "Lettura della pagina web…",
  "status.agent.browserClicking": "Clic sulla pagina web…",
  "status.agent.browserTyping": "Digitazione nella pagina web…",
  "status.agent.browserActing": "Uso della pagina web…",
  "status.agent.browserReviewing": "Analisi della pagina web…",
  "status.agent.memoriesSearching": "Ricerca nelle sue memorie…",
  "status.agent.memoriesSearched": {
    one: "Ha cercato nelle sue memorie: {count} trovata",
    other: "Ha cercato nelle sue memorie: {count} trovate",
  },
  "status.agent.memoriesUpdating": "Aggiornamento delle sue memorie…",
  "status.agent.skillUsing": "Uso della skill {name}…",
  "status.agent.skillReading": "Lettura di una skill…",
  "status.agent.toolStepFailed":
    "Un passaggio dello strumento è fallito; analisi del risultato e scelta del prossimo tentativo…",
  "status.agent.toolResultReviewing": "Analisi dell’ultimo risultato dello strumento…",
  "status.agent.sourcesSearching": "Ricerca di informazioni aggiornate…",
  "status.agent.sourcesReviewing": "Analisi delle fonti e delle informazioni trovate…",
  "status.agent.informationGathering": "Raccolta delle informazioni rilevanti…",
  "status.agent.informationReviewing": "Analisi delle informazioni raccolte…",
  "status.agent.workChecking": "Verifica del lavoro…",
  "status.agent.workReviewing": "Analisi dei risultati della verifica…",
  "status.agent.changesMaking": "Esecuzione delle modifiche richieste…",
  "status.agent.changesReviewing": "Analisi delle modifiche effettuate…",
  "status.agent.agentCoordinating": "Coordinamento con un altro agente…",
  "status.agent.agentResponseReviewing": "Analisi della risposta dell’altro agente…",
  "status.agent.commandRunningUnnamed": "Esecuzione di un comando…",
  "status.agent.toolStepWorking": "Elaborazione del prossimo passaggio assistito dallo strumento…",
  "status.agent.webSearching": "Ricerca sul web di «{query}»…",
  "status.agent.urlFetching": "Apertura di {host}…",
  "status.agent.fileReading": "Lettura di {name}…",
  "status.agent.filesReading": "Lettura dei file…",
  "status.agent.filesListing": "Esame di {path}…",
  "status.agent.filesLooking": "Esame dei file…",
  "status.agent.textSearching": "Ricerca di «{query}»…",
  "status.agent.filesSearchingText": "Ricerca nei file…",
  "status.agent.folderSizesMeasuring": "Misurazione delle dimensioni delle cartelle…",
  "status.agent.diskSpaceChecking": "Controllo dello spazio libero su disco…",
  "status.agent.processesChecking": "Controllo dei processi in esecuzione…",
  "status.agent.gitChecking": "Controllo del repository Git…",
  "status.agent.commandRunning": "Esecuzione di {program}…",
  "status.agent.memoryChanges": "Memorie: {saved} salvate, {updated} aggiornate, {forgotten} dimenticate.",
  "status.agent.memoryChangesWithConflicts":
    "Memorie: {saved} salvate, {updated} aggiornate, {forgotten} dimenticate, {notChanged} non modificate perché un altro thread le ha modificate prima.",
  "status.agent.nextStepContinues":
    "L'agente si è fermato prima del passaggio successivo. Continua ({current} di {limit}).",
  "status.agent.planContinues": "Il piano ha passaggi aperti. L'agente continua ({current} di {limit}).",
  "status.agent.branchTitle": "Chat ramificata",
  "status.agent.hxAuto.switched.chat": "Modello automatico · Chat: passato a {model}.",
  "status.agent.hxAuto.switched.writing": "Modello automatico · Scrittura: passato a {model}.",
  "status.agent.hxAuto.switched.codeSmall": "Modello automatico · Piccola modifica al codice: passato a {model}.",
  "status.agent.hxAuto.switched.codeLarge": "Modello automatico · Programmazione su più file: passato a {model}.",
  "status.agent.hxAuto.switched.data": "Modello automatico · Dati: passato a {model}.",
  "status.agent.hxAuto.switched.vision": "Modello automatico · Immagini: passato a {model}.",
  "status.agent.hxAuto.switched.longContext": "Modello automatico · Materiale lungo: passato a {model}.",
  "status.agent.hxAuto.switched.reasoning": "Modello automatico · Pianificazione e ragionamento: passato a {model}.",
  "status.agent.hxAuto.switched.computer": "Modello automatico · Usare questo computer: passato a {model}.",
  "status.agent.hxAuto.kept.chat": "Modello automatico · Chat: se ne occupa {model}.",
  "status.agent.hxAuto.kept.writing": "Modello automatico · Scrittura: se ne occupa {model}.",
  "status.agent.hxAuto.kept.codeSmall": "Modello automatico · Piccola modifica al codice: se ne occupa {model}.",
  "status.agent.hxAuto.kept.codeLarge": "Modello automatico · Programmazione su più file: se ne occupa {model}.",
  "status.agent.hxAuto.kept.data": "Modello automatico · Dati: se ne occupa {model}.",
  "status.agent.hxAuto.kept.vision": "Modello automatico · Immagini: se ne occupa {model}.",
  "status.agent.hxAuto.kept.longContext": "Modello automatico · Materiale lungo: se ne occupa {model}.",
  "status.agent.hxAuto.kept.reasoning": "Modello automatico · Pianificazione e ragionamento: se ne occupa {model}.",
  "status.agent.hxAuto.kept.computer": "Modello automatico · Usare questo computer: se ne occupa {model}.",
  "status.agent.hxAuto.switched": "Modello automatico: passato a {model}.",
  "status.agent.hxAuto.suggest": "Questo lavoro non è andato bene. Rispondi «redo» per rifarlo con {model}.",
  "status.agent.hxTeam.started": "Squadra avviata: {members}; la guida {lead}. L’avanzamento torna qui.",
  "status.agent.hxTeam.assigned": "Squadra · {from} ha dato «{task}» a {to} (passaggio {count} di {limit}).",
  "status.agent.hxTeam.returned": "Squadra · {name} ha restituito un risultato ({done} di {steps} passi fatti).",
  "status.agent.hxTeam.failedOnce":
    "Squadra · {name} non è riuscito a finire una parte del lavoro; se fallisce di nuovo, la squadra si ferma e ti chiede.",
  "status.agent.hxTeam.stuck":
    "Squadra · Il lavoro aspetta: un compito è stato fermato o è fallito. Riprendilo nella stanza, oppure dimmi cosa fare.",
  "status.agent.hxTeam.done": "Squadra finita in {minutes} min. Il risultato segue.",
  "status.agent.hxTeam.stopped.user": "Squadra fermata su tua richiesta.",
  "status.agent.hxTeam.stopped.minutes": "Squadra fermata: ha raggiunto il limite di {minutes} minuti.",
  "status.agent.hxTeam.stopped.retry": "Squadra fermata: lo stesso lavoro è fallito due volte.",
  "status.agent.hxTeam.stopped.room": "Squadra fermata: la sua stanza è stata archiviata o eliminata.",
  "status.agent.hxTeam.stopped.cancelled": "Squadra fermata: il suo lavoro è stato annullato nella stanza.",
  "status.agent.hxTeam.rounds":
    "Squadra · Ha raggiunto il limite di {limit} passaggi; chi guida chiude con quello che ha.",
  "status.agent.hxTeam.message": "Squadra · Le tue parole sono andate a {name}.",
  "status.agent.hxTeam.swapped": "Squadra · {new} ha preso il posto di {old}.",
  "status.agent.hxTeam.kept": "Squadra · I membri creati per lei restano: {names}.",
  "status.agent.hxTeam.collapsed": "Squadra · I membri creati per lei sono nascosti: {names}.",
  "status.agent.hxComputer.plan": "Lavoro su questo computer · {app} · {keys} lo ferma",
  "status.agent.hxComputer.stopped": "Lavoro su questo computer fermato: hai premuto i tasti di arresto.",
  "status.agent.hxComputer.needBoth":
    "Il controllo PC richiede due autorizzazioni: Registrazione schermo e Accessibilità. Impostazioni di Sistema è aperto sulla prima: attiva HXBot lì, poi la seconda. Chiedi di nuovo quando sono attive entrambe. Impostazioni → Controllo PC le mostra.",
  "status.agent.hxComputer.needScreen":
    "Il controllo PC richiede l’autorizzazione Registrazione schermo. Impostazioni di Sistema è aperto su quella pagina: attiva HXBot lì e chiedi di nuovo. Impostazioni → Controllo PC la mostra anche.",
  "status.agent.hxComputer.needAccessibility":
    "Il controllo PC richiede l’autorizzazione Accessibilità. Impostazioni di Sistema è aperto su quella pagina: attiva HXBot lì e chiedi di nuovo. Impostazioni → Controllo PC la mostra anche.",
  "status.agent.hxComputer.notRunning":
    "Il controllo PC non è attivo: {reason}. Impostazioni → Controllo PC mostra il motivo.",
  "status.agent.hxTeam.handedOver": "Team · {from} ha passato l’intera attività a {to} (passaggio {count}).",
  "status.agent.hxTeam.progressOpen": "Team · {count} passaggi · {minutes} min",
  "status.agent.hxTeam.progressPaused": "Team · in pausa, aspetta te · {count} passaggi · {minutes} min",
  "status.agent.hxTeam.paused":
    "Il team è in pausa: {reason} Non avvia nuovo lavoro; quello in corso finisce. Continuare, chiudere o fermare?",
  "status.agent.hxTeam.continued": "Team · Continua.",
  "status.agent.hxTeam.wrapUp": "Team · Il responsabile chiude con quello che il team ha.",
  "status.agent.hxTeam.priority.urgent": "Team · Più urgente: passa prima degli altri team finché non finisce.",
  "status.agent.hxTeam.priority.normal": "Team · Torna all’ordine normale.",
  "status.agent.hxTeam.priority.relaxed": "Team · Non urgente: gli altri team passano prima finché non finisce.",
  "status.agent.hxTeam.spend.api": "Team · Spesi finora circa ¥{yuan}. Continua; indica un limite per fermarlo lì.",
  "status.agent.hxTeam.spend.plan":
    "Team · Usato il {percent}% del periodo del piano. Continua; indica un limite per fermarlo lì.",
  "status.agent.hxTeam.spend.tokens":
    "Team · Usati finora circa {millions} milioni di token (prezzo sconosciuto). Continua.",
  "status.agent.hxComputer.parked":
    "In attesa: il passaggio in {app} continua quando non usi la tastiera né il mouse per {seconds} secondi e la sua finestra è in primo piano. Rispondi «ora» per farlo subito, o «scarta» per lasciarlo.",
  "status.agent.hxComputer.parkedLocked":
    "In attesa: lo schermo è bloccato. Il passaggio in {app} continua quando lo sblocchi e la sua finestra è in primo piano. Rispondi «ora» per farlo subito, o «scarta» per lasciarlo.",
  "status.agent.hxComputer.parkedLong":
    "Il passaggio in {app} aspetta da 30 minuti. Rispondi «ora» per farlo subito, o «scarta» per lasciarlo.",
  "status.agent.hxComputer.resume":
    "(Inviato da HXBot) L’utente si è fermato e {app} è in primo piano: continua il passaggio in sospeso. Guarda prima la finestra, poi fai i {count} passaggi rimasti. Chiedi all’utente prima di un invio, un pagamento o un’eliminazione, come sempre.",
  "status.agent.hxUpdate.resume":
    "(Inviato da HXBot) HXBot si è riavviato per installare un aggiornamento e ora è alla versione {version}. Il riavvio ha interrotto il tuo ultimo turno: controlla prima fin dove è arrivato il lavoro, non ripetere un passaggio che ha già cambiato qualcosa, poi completa il resto.",
  "status.agent.hxTeam.card.paused": "In pausa: {reason}",
  "status.agent.hxTeam.card.urgent": "Più urgente: passa prima degli altri team. Di' «non urgente» per cambiarlo.",
  "status.agent.hxTeam.card.relaxed": "Non urgente: gli altri team vanno prima. Di' «urgente» per cambiarlo.",
  "status.agent.hxTeam.member.doing": "{name}: sta facendo «{what}»",
  "status.agent.hxTeam.member.queued": "{name}: in coda (posto {position}, circa {minutes} min)",
  "status.agent.hxTeam.member.after": "{name}: inizia quando il lavoro che gli serve è finito",
  "status.agent.hxTeam.member.reply": "{name}: aspetta una risposta",
  "status.agent.hxTeam.member.screen": "{name}: aspetta lo schermo",
  "status.agent.hxTeam.member.yourTurn": "{name}: aspetta che tu smetta di usare il computer",
  "status.agent.hxTeam.member.free": "{name}: libero",
  "status.agent.hxAutoModel.overloadPaused":
    "Il fornitore di {from} è in pausa dopo un limite di frequenza: questo nuovo lavoro usa {to}.",
  "status.agent.hxAutoModel.overloadQueue": "Il lavoro aspetta a lungo {from}: questo nuovo lavoro usa {to}.",
  "status.agent.hxTeam.overloadMove":
    "Team · {name}: il fornitore di {from} è in pausa da minuti, quindi il suo nuovo lavoro usa {to}.",
  "status.agent.hxTeam.card.judge": "Il parere del giudice (solo un consiglio): {verdict}. {reason}",
  "status.agent.hxTeam.member.starting": "{name}: inizia ora",
  "status.agent.hxTeam.member.provider":
    "{name}: aspetta il fornitore del suo modello (posto {position}, circa {minutes} min)",
  "status.agent.hxTeam.member.held": "{name}: in attesa finché il team è in pausa o sta chiudendo",
  "status.agent.hxSkill.space.header": "Spazio delle versioni",
  "status.agent.hxSkill.space.cap":
    "Lo spazio per le versioni precedenti dei file è pieno ({used} di {cap}). Per tenere la versione di {file} prima di questa modifica, HXBot ha bisogno di altri {needed}. Che cosa deve fare HXBot?",
  "status.agent.hxSkill.space.disk":
    "Sul disco non c'è spazio per tenere la versione di {file} prima di questa modifica (servono {needed}). Che cosa deve fare HXBot?",
  "status.agent.hxSkill.space.detail":
    "Non cambia nulla finché non scegli. Puoi cambiare lo spazio in Impostazioni → Controllo PC.",
  "status.agent.hxSkill.space.cleanOld": "Rimuovi le versioni più vecchie",
  "status.agent.hxSkill.space.cleanOldDetail":
    "Rimuove le versioni tenute per le attività più vecchie (mai per questa) finché c'è spazio, poi fa la modifica.",
  "status.agent.hxSkill.space.noVersion": "Modifica senza versione",
  "status.agent.hxSkill.space.noVersionDetail": "Fa la modifica ora. Non potrai riportare questo file a com'era prima.",
  "status.agent.hxSkill.space.cancel": "Annulla la modifica",
  "status.agent.hxSkill.space.cancelDetail": "Il file resta com'è, e restano tutte le versioni.",
} as const satisfies PartialTranslation<typeof source>;
