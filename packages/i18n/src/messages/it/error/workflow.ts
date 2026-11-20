import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/workflow";

export const messages = {
  "error.workflow.missing": "Questo workflow non esiste più.",
  "error.workflow.versionMissing": "Questa versione del workflow non esiste più.",
  "error.workflow.annotation": "Testi, note e forme non possono avere connessioni.",
  "error.workflow.port": "Un passaggio non può ricevere questo tipo di input.",
  "error.workflow.branch": "Solo una condizione può avere connessioni sì e no.",
  "error.workflow.conditionBranch": "Ogni connessione da una condizione deve essere sì o no.",
  "error.workflow.duplicateEdge": "Questi due passaggi hanno già questa connessione.",
  "error.workflow.serverTooOld": "Questo server non supporta i workflow. Aggiorna HXBot sul computer che lo esegue.",
  "error.workflow.nodeUnsupported":
    "Questa versione di HXBot non può ancora eseguire passaggi di immagine, file e messaggio.",
  "error.workflow.interrupted": "HXBot si è fermato durante questo passaggio. Eseguilo di nuovo.",
  "error.workflow.agentMissing": "Scegli un agente per questo passaggio.",
  "error.workflow.handoffFailed": "HXBot non è riuscito a inviare questo passaggio al suo agente.",
  "error.workflow.agentStepEnded": "Il messaggio all’agente è stato rimosso prima della sua risposta.",
  "error.workflow.conditionUnclear": "Il modello non ha risposto sì o no.",
  "error.workflow.modelFailed": "Il modello non ha potuto rispondere. Esegui di nuovo il passaggio.",
  "error.workflow.modelBusy": "È in corso un’altra richiesta al modello. Esegui di nuovo il passaggio tra poco.",
  "error.workflow.stepMissing": "Questo passaggio non esiste più.",
  "error.workflow.nodeMissing": "Questo passaggio non è nel flusso di lavoro.",
  "error.workflow.runMissing": "Questa esecuzione non esiste più.",
  "error.workflow.notRetryable": "Solo un passaggio non riuscito o fermato può essere rieseguito.",
  "error.workflow.noDecision": "Questo passaggio non attende una decisione.",
  "error.workflow.outputPlaceMissing": "Scegli un luogo di messaggistica per questo output.",
  "error.workflow.outputChannelMissing": "Scegli un canale per questo output.",
  "error.workflow.outputChannelFailed":
    "HXBot non è riuscito a pubblicare il risultato nel canale. Esegui di nuovo il passaggio.",
  "error.workflow.discordNoMessage":
    "Questo output agisce sul messaggio Discord che ha avviato l’esecuzione. Avvia l’esecuzione da una menzione su Discord o scegli Pubblica nel canale.",
  "error.workflow.slackNoMessage":
    "Questo output agisce sul messaggio Slack che ha avviato l’esecuzione. Avvia l’esecuzione da una menzione su Slack o scegli Pubblica nel canale.",
  "error.workflow.telegramNoMessage":
    "Questo output agisce sul messaggio Telegram che ha avviato l’esecuzione. Avvia l’esecuzione da una menzione su Telegram o scegli Pubblica nella chat.",
  "error.workflow.outputConnectionOff":
    "La connessione di messaggistica di questo output è disattivata o rimossa. Scegli di nuovo un luogo.",
  "error.workflow.outputNotRunning": "La connessione di messaggistica non è attiva ora. Riprova quando è attiva.",
  "error.workflow.outputRefused": "Il luogo ha rifiutato il post. Verifica che HXBot possa pubblicare lì.",
  "error.workflow.outputUncertain":
    "Il post si è fermato a metà. Una parte può essere già nel luogo. Controlla prima di riprovare.",
  "error.workflow.tooLarge":
    "Questo workflow è troppo grande per essere salvato. Rimuovi alcuni disegni o testi lunghi, poi riprova.",
  "error.workflow.tooLargeToSend":
    "Questo workflow è troppo grande per essere inviato a un altro computer. Aprilo sul computer che esegue il server.",
  "error.workflow.webhookMissing": "Questo passaggio non è un trigger webhook. Salva il workflow, poi riprova.",
  "error.workflow.githubActionMissing": "Scegli cosa fa questo output su GitHub.",
  "error.workflow.githubRepositoryMissing": "Scegli un repository per questo output.",
  "error.workflow.githubItemMissing":
    "Questo output non ha issue o pull request. Avvia l'esecuzione da un evento GitHub o inserisci il numero nel suo input.",
  "error.workflow.githubPullRequestOnly": "Questa azione funziona solo sulle pull request.",
  "error.workflow.githubTextMissing": "Questo output non ha testo da inviare. Collega un passaggio che lo scriva.",
  "error.workflow.githubEventText":
    "Questo output non può inviare l'evento grezzo del trigger. Metti un agente tra il trigger e questo output.",
  "error.workflow.githubChoiceMissing": "Scegli le etichette o la persona per questo output.",
  "error.workflow.githubChoseNothing": "Il modello non ha scelto nessuna etichetta o persona di questo repository.",
  "error.workflow.githubNotConnected": "Collega GitHub sul computer che esegue questo workflow.",
  "error.workflow.githubNoAccess":
    "La GitHub App di HXBot non vede questo repository o elemento. Apri GitHub e concedile l'accesso.",
  "error.workflow.githubNoWrite":
    "La GitHub App di HXBot non può modificare questo repository. Apri GitHub e concedile l'accesso.",
  "error.workflow.githubLocked": "Questa conversazione è bloccata su GitHub.",
  "error.workflow.githubRefused": "GitHub ha rifiutato la modifica: {detail}",
  "error.workflow.githubUnreachable": "HXBot non è riuscito a raggiungere GitHub. Esegui di nuovo il passaggio.",
  "error.workflow.githubUncertain":
    "La modifica si è fermata a metà. Può essere già su GitHub. Controlla lì prima di eseguire di nuovo il passaggio.",
  "error.workflow.githubNoEvent": "Su GitHub non c'è una issue o pull request da cui parte questo trigger.",
  "error.workflow.hxStepNoAgent": "Scegli l’agente di questo passo.",
  "error.workflow.hxStepInvalid": "Le impostazioni di questo passo non vanno bene: {reason}",
  "error.workflow.hxStepUnavailable": "HXBot si sta ancora avviando. Esegui di nuovo il passo tra un momento.",
  "error.workflow.hxStepComputerUseOff":
    "Il controllo del computer è disattivato per {agent}. Attivalo nelle impostazioni dell’agente, poi continua.",
  "error.workflow.hxActionUnknown":
    "HXBot si è fermato mentre faceva {action}, quindi il risultato non è noto. Controllalo prima: «Riprendi da questo passo» lo rifà.",
  "error.workflow.hxActionFailed": "La chiamata {action} non ha funzionato: {reason}",
  "error.workflow.hxTeamFailed": "La squadra non ha finito: {reason}",
  "error.workflow.hxConnectionOff":
    "La connessione di messaggistica di questa uscita è disattivata. Attivala, poi continua.",
  "error.workflow.hxLimitLoops":
    "Oltre il limite: un ciclo è stato ripetuto {count} volte, quindi l’esecuzione si è fermata.",
  "error.workflow.hxLimitSteps": "Oltre il limite: l’esecuzione ha raggiunto {count} passi, quindi si è fermata.",
  "error.workflow.hxLimitSeconds":
    "Oltre il limite: i suoi cicli sono durati più di {count} secondi, quindi l’esecuzione si è fermata.",
  "error.workflow.hxTurnNothing": "Questo turno non ha passi di controllo PC, skill di app o squadra da salvare.",
} as const satisfies PartialTranslation<typeof source>;
