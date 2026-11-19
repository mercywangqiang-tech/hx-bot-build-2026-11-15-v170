import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/agent";

export const messages = {
  "status.agent.claudeWriteOutside":
    "In {path} schreiben, außerhalb des Agentenarbeitsbereichs, des geteilten Ordners und der temporären Ordner.",
  "status.agent.contextCleared": "Kontext geleert. Hier beginnt ein neuer Chat.",
  "status.agent.instructionsChanged": "Hat seine Anweisungen aktualisiert",
  "status.agent.modelSwitchedForLimit": "Nutzungslimit erreicht. Zu {model} gewechselt.",
  "status.agent.modelReturnedAfterLimit": "Nutzungslimit beendet. Zurück zu {model} gewechselt.",
  "status.agent.modelSwitchedForError": "Anbieterfehler. Zu {model} gewechselt.",
  "status.agent.modelReturnedAfterError": "Nach dem Anbieterfehler zurück zu {model} gewechselt.",
  "status.agent.marketplaceSuggested": "Eine Marketplace-App wurde vorgeschlagen: {app}.",
  "status.agent.channelMemberAdded": "{agent} hat {member} zum Kanal hinzugefügt. {person} hat darum gebeten.",
  "status.agent.channelMemberRemoved": "{agent} hat {member} aus dem Kanal entfernt. {person} hat darum gebeten.",
  "status.agent.channelInstructionsChanged":
    "{agent} hat die Anweisungen des Kanals geändert. {person} hat darum gebeten.",
  "status.agent.channelRoutineCreated": "{agent} hat die Routine {routine} erstellt. {person} hat darum gebeten.",
  "status.agent.channelRoutineUpdated": "{agent} hat die Routine {routine} geändert. {person} hat darum gebeten.",
  "status.agent.channelRoutineDeleted": "{agent} hat die Routine {routine} gelöscht. {person} hat darum gebeten.",
  "status.agent.channelTaskCancelled":
    "{agent} hat die Aufgabe „{task}“ und ihre Teilaufgaben abgebrochen. {person} hat darum gebeten.",
  "status.agent.screenCaptureScreen": "Den Hauptbildschirm aufnehmen und das Bild an das Modell des Agenten senden.",
  "status.agent.screenCaptureChannel":
    "Das Bild erscheint im Kanal {channel}, und jedes Mitglied dieses Servers, das den Kanal liest, kann es sehen.",
  "status.agent.screenCaptureDisplay": "Den Bildschirm {name} aufnehmen und das Bild an das Modell des Agenten senden.",
  "status.agent.screenCaptureWindow": "Das Fenster {name} aufnehmen und das Bild an das Modell des Agenten senden.",
  "status.agent.screenCaptureRegion":
    "Den Bildschirmbereich bei {x}, {y}, {width} × {height} Punkten aufnehmen und das Bild an das Modell des Agenten senden.",
  "status.agent.workflowDelete":
    "Den Workflow {title} mit seinen Ausführungen und Versionen löschen. Seine offenen Schritte werden beendet.",
  "status.agent.screenCaptureProgress": "Bildschirmaufnahme wird angefragt…",
  "status.agent.screenCaptureReviewing": "Bildschirmaufnahme wird geprüft…",
  "status.agent.browserOpening": "Webseite wird geöffnet…",
  "status.agent.browserReading": "Webseite wird gelesen…",
  "status.agent.browserClicking": "Klick auf der Webseite…",
  "status.agent.browserTyping": "Eingabe auf der Webseite…",
  "status.agent.browserActing": "Webseite wird bedient…",
  "status.agent.browserReviewing": "Webseite wird geprüft…",
  "status.agent.memoriesSearching": "Erinnerungen werden durchsucht…",
  "status.agent.memoriesSearched": {
    one: "Erinnerungen durchsucht: {count} gefunden",
    other: "Erinnerungen durchsucht: {count} gefunden",
  },
  "status.agent.memoriesUpdating": "Erinnerungen werden aktualisiert…",
  "status.agent.skillUsing": "Fähigkeit {name} wird verwendet…",
  "status.agent.skillReading": "Fähigkeit wird gelesen…",
  "status.agent.toolStepFailed":
    "Ein Tool-Schritt ist fehlgeschlagen; das Ergebnis wird geprüft und entschieden, was als Nächstes versucht wird…",
  "status.agent.toolResultReviewing": "Das letzte Tool-Ergebnis wird geprüft…",
  "status.agent.sourcesSearching": "Nach aktuellen Informationen wird gesucht…",
  "status.agent.sourcesReviewing": "Die gefundenen Quellen und Informationen werden geprüft…",
  "status.agent.informationGathering": "Die relevanten Informationen werden gesammelt…",
  "status.agent.informationReviewing": "Die gesammelten Informationen werden geprüft…",
  "status.agent.workChecking": "Die Arbeit wird geprüft…",
  "status.agent.workReviewing": "Die Verifizierungsergebnisse werden geprüft…",
  "status.agent.changesMaking": "Die gewünschten Änderungen werden vorgenommen…",
  "status.agent.changesReviewing": "Die vorgenommenen Änderungen werden geprüft…",
  "status.agent.agentCoordinating": "Es wird mit einem anderen Agenten abgestimmt…",
  "status.agent.agentResponseReviewing": "Die Antwort des anderen Agenten wird geprüft…",
  "status.agent.commandRunningUnnamed": "Befehl wird ausgeführt…",
  "status.agent.toolStepWorking": "Der nächste toolgestützte Schritt wird abgearbeitet…",
  "status.agent.webSearching": "Suche im Web nach „{query}“…",
  "status.agent.urlFetching": "{host} wird geöffnet…",
  "status.agent.fileReading": "{name} wird gelesen…",
  "status.agent.filesReading": "Dateien werden gelesen…",
  "status.agent.filesListing": "{path} wird durchgesehen…",
  "status.agent.filesLooking": "Dateien werden durchgesehen…",
  "status.agent.textSearching": "Suche nach „{query}“…",
  "status.agent.filesSearchingText": "Dateien werden durchsucht…",
  "status.agent.folderSizesMeasuring": "Ordnergrößen werden gemessen…",
  "status.agent.diskSpaceChecking": "Freier Speicherplatz wird geprüft…",
  "status.agent.processesChecking": "Laufende Prozesse werden geprüft…",
  "status.agent.gitChecking": "Git-Repository wird geprüft…",
  "status.agent.commandRunning": "{program} wird ausgeführt…",
  "status.agent.memoryChanges": "Erinnerungen: {saved} gespeichert, {updated} aktualisiert, {forgotten} vergessen.",
  "status.agent.memoryChangesWithConflicts":
    "Erinnerungen: {saved} gespeichert, {updated} aktualisiert, {forgotten} vergessen, {notChanged} nicht geändert, weil ein anderer Thread sie zuerst geändert hat.",
  "status.agent.nextStepContinues":
    "Der Agent hat vor dem nächsten Schritt angehalten. Er macht weiter ({current} von {limit}).",
  "status.agent.planContinues": "Der Plan hat offene Schritte. Der Agent macht weiter ({current} von {limit}).",
  "status.agent.branchTitle": "Abgezweigter Chat",
  "status.agent.hxAuto.switched.chat": "Automatisches Modell · Chat: gewechselt zu {model}.",
  "status.agent.hxAuto.switched.writing": "Automatisches Modell · Schreiben: gewechselt zu {model}.",
  "status.agent.hxAuto.switched.codeSmall": "Automatisches Modell · Kleine Codeänderung: gewechselt zu {model}.",
  "status.agent.hxAuto.switched.codeLarge":
    "Automatisches Modell · Programmieren über mehrere Dateien: gewechselt zu {model}.",
  "status.agent.hxAuto.switched.data": "Automatisches Modell · Daten: gewechselt zu {model}.",
  "status.agent.hxAuto.switched.vision": "Automatisches Modell · Bilder: gewechselt zu {model}.",
  "status.agent.hxAuto.switched.longContext": "Automatisches Modell · Lange Unterlagen: gewechselt zu {model}.",
  "status.agent.hxAuto.switched.reasoning": "Automatisches Modell · Planen und Abwägen: gewechselt zu {model}.",
  "status.agent.hxAuto.switched.computer": "Automatisches Modell · Diesen Computer bedienen: gewechselt zu {model}.",
  "status.agent.hxAuto.kept.chat": "Automatisches Modell · Chat: {model} übernimmt.",
  "status.agent.hxAuto.kept.writing": "Automatisches Modell · Schreiben: {model} übernimmt.",
  "status.agent.hxAuto.kept.codeSmall": "Automatisches Modell · Kleine Codeänderung: {model} übernimmt.",
  "status.agent.hxAuto.kept.codeLarge": "Automatisches Modell · Programmieren über mehrere Dateien: {model} übernimmt.",
  "status.agent.hxAuto.kept.data": "Automatisches Modell · Daten: {model} übernimmt.",
  "status.agent.hxAuto.kept.vision": "Automatisches Modell · Bilder: {model} übernimmt.",
  "status.agent.hxAuto.kept.longContext": "Automatisches Modell · Lange Unterlagen: {model} übernimmt.",
  "status.agent.hxAuto.kept.reasoning": "Automatisches Modell · Planen und Abwägen: {model} übernimmt.",
  "status.agent.hxAuto.kept.computer": "Automatisches Modell · Diesen Computer bedienen: {model} übernimmt.",
  "status.agent.hxAuto.switched": "Automatisches Modell: gewechselt zu {model}.",
  "status.agent.hxAuto.suggest":
    "Diese Arbeit lief nicht gut. Antworte „redo“, um sie mit {model} noch einmal zu machen.",
  "status.agent.hxTeam.started": "Team gestartet: {members}; {lead} leitet. Der Fortschritt kommt hierher zurück.",
  "status.agent.hxTeam.assigned": "Team · {from} hat „{task}“ an {to} gegeben (Übergabe {count} von {limit}).",
  "status.agent.hxTeam.returned":
    "Team · {name} hat ein Ergebnis zurückgegeben ({done} von {steps} Schritten erledigt).",
  "status.agent.hxTeam.failedOnce":
    "Team · {name} konnte eine Arbeit nicht abschließen; scheitert sie noch einmal, hält das Team an und fragt dich.",
  "status.agent.hxTeam.stuck":
    "Team · Die Arbeit wartet: Eine Aufgabe wurde angehalten oder ist fehlgeschlagen. Setze sie im Raum fort oder sag mir, was zu tun ist.",
  "status.agent.hxTeam.done": "Team fertig in {minutes} Min. Das Ergebnis folgt.",
  "status.agent.hxTeam.stopped.user": "Team auf deinen Wunsch angehalten.",
  "status.agent.hxTeam.stopped.minutes": "Team angehalten: Es hat sein Limit von {minutes} Minuten erreicht.",
  "status.agent.hxTeam.stopped.retry": "Team angehalten: Dieselbe Arbeit ist zweimal fehlgeschlagen.",
  "status.agent.hxTeam.stopped.room": "Team angehalten: Sein Raum wurde archiviert oder gelöscht.",
  "status.agent.hxTeam.stopped.cancelled": "Team angehalten: Seine Arbeit wurde im Raum abgebrochen.",
  "status.agent.hxTeam.rounds":
    "Team · Es hat sein Limit von {limit} Übergaben erreicht; die Leitung schließt mit dem ab, was da ist.",
  "status.agent.hxTeam.message": "Team · Deine Worte sind an {name} gegangen.",
  "status.agent.hxTeam.swapped": "Team · {new} hat von {old} übernommen.",
  "status.agent.hxTeam.kept": "Team · Die dafür erstellten Mitglieder bleiben: {names}.",
  "status.agent.hxTeam.collapsed": "Team · Die dafür erstellten Mitglieder sind ausgeblendet: {names}.",
  "status.agent.hxComputer.plan": "Arbeit auf diesem Computer · {app} · {keys} hält sie an",
  "status.agent.hxComputer.stopped": "Arbeit auf diesem Computer angehalten: Du hast die Stopptasten gedrückt.",
  "status.agent.hxComputer.needBoth":
    "Die PC-Steuerung braucht zwei Freigaben: Bildschirmaufnahme und Bedienungshilfen. Die Systemeinstellungen zeigen die erste: Schalte dort HXBot ein, dann die zweite. Frag erneut, wenn beide an sind. Einstellungen → PC-Steuerung zeigt beide.",
  "status.agent.hxComputer.needScreen":
    "Die PC-Steuerung braucht die Freigabe „Bildschirmaufnahme“. Die Systemeinstellungen zeigen diese Seite: Schalte dort HXBot ein und frag erneut. Einstellungen → PC-Steuerung zeigt sie auch.",
  "status.agent.hxComputer.needAccessibility":
    "Die PC-Steuerung braucht die Freigabe „Bedienungshilfen“. Die Systemeinstellungen zeigen diese Seite: Schalte dort HXBot ein und frag erneut. Einstellungen → PC-Steuerung zeigt sie auch.",
  "status.agent.hxComputer.notRunning":
    "Die PC-Steuerung läuft nicht: {reason}. Einstellungen → PC-Steuerung zeigt den Grund.",
  "status.agent.hxTeam.handedOver": "Team · {from} hat die ganze Aufgabe an {to} übergeben (Übergabe {count}).",
  "status.agent.hxTeam.progressOpen": "Team · {count} Übergaben · {minutes} Min.",
  "status.agent.hxTeam.progressPaused": "Team · pausiert, wartet auf dich · {count} Übergaben · {minutes} Min.",
  "status.agent.hxTeam.paused":
    "Team pausiert: {reason} Es beginnt keine neue Arbeit; laufende Arbeit wird fertig. Weitermachen, abschließen oder stoppen?",
  "status.agent.hxTeam.continued": "Team · Es geht weiter.",
  "status.agent.hxTeam.wrapUp": "Team · Die Leitung schließt mit dem ab, was das Team hat.",
  "status.agent.hxTeam.priority.urgent": "Team · Dringender: Es kommt vor anderen Teams dran, bis es fertig ist.",
  "status.agent.hxTeam.priority.normal": "Team · Wieder normale Reihenfolge.",
  "status.agent.hxTeam.priority.relaxed": "Team · Nicht dringend: Andere Teams kommen zuerst dran, bis es fertig ist.",
  "status.agent.hxTeam.spend.api":
    "Team · Bisher etwa ¥{yuan} ausgegeben. Es arbeitet weiter; nenne eine Grenze, um es dort zu stoppen.",
  "status.agent.hxTeam.spend.plan":
    "Team · {percent} % des Planzeitraums sind verbraucht. Es arbeitet weiter; nenne eine Grenze, um es dort zu stoppen.",
  "status.agent.hxTeam.spend.tokens":
    "Team · Bisher etwa {millions} Mio. Tokens verbraucht (Preis unbekannt). Es arbeitet weiter.",
  "status.agent.hxComputer.parked":
    "Wartet auf dich: Der Schritt in {app} geht weiter, wenn du {seconds} Sekunden lang weder Tastatur noch Maus benutzt hast und sein Fenster vorne ist. Antworte „jetzt“, damit er sofort erledigt wird, oder „verwerfen“, um ihn zu lassen.",
  "status.agent.hxComputer.parkedLocked":
    "Wartet auf dich: Der Bildschirm ist gesperrt. Der Schritt in {app} geht weiter, wenn du entsperrst und sein Fenster vorne ist. Antworte „jetzt“, damit er sofort erledigt wird, oder „verwerfen“, um ihn zu lassen.",
  "status.agent.hxComputer.parkedLong":
    "Der Schritt in {app} wartet seit 30 Minuten. Antworte „jetzt“, damit er sofort erledigt wird, oder „verwerfen“, um ihn zu lassen.",
  "status.agent.hxComputer.resume":
    "(Von HXBot gesendet) Der Benutzer hat aufgehört, und {app} ist vorne: Setze den geparkten Schritt fort. Sieh dir zuerst das Fenster an, dann erledige die {count} restlichen Schritte. Frage den Benutzer wie immer vor einem Senden, einer Zahlung oder einem Löschen.",
  "status.agent.hxUpdate.resume":
    "(Von HXBot gesendet) HXBot wurde neu gestartet, um ein Update zu installieren, und ist jetzt Version {version}. Der Neustart hat deinen letzten Durchlauf unterbrochen: Prüfe zuerst, wie weit die Arbeit gekommen ist, wiederhole keinen Schritt, der schon etwas geändert hat, und erledige dann den Rest.",
} as const satisfies PartialTranslation<typeof source>;
