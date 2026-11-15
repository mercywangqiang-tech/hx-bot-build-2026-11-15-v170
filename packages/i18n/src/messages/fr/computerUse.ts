import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/computerUse";

export const messages = {
  // Computer Use settings, the permission help window, and the window highlight.
  "computerUse.permission.screenRecording.title": "Enregistrement de l’écran",
  "computerUse.permission.screenRecording.description":
    "Permet à HXBot de faire des captures d’écran. Cliquer et saisir fonctionnent sans elle.",
  "computerUse.permission.screenRecording.pane": "Enregistrement de l’écran et de l’audio du système",
  "computerUse.permission.accessibility.title": "Accessibilité",
  "computerUse.permission.accessibility.description":
    "Permet à HXBot de cliquer et de saisir. Ensuite, HXBot active lui-même l’enregistrement de l’écran.",
  "computerUse.permission.accessibility.pane": "Accessibilité",
  "computerUse.error.check": "HXBot n’a pas pu vérifier Computer Use.",
  "computerUse.error.openSettings": "HXBot n’a pas pu ouvrir Réglages Système.",
  "computerUse.error.startDriver": "HXBot n’a pas pu démarrer le pilote de Computer Use.",
  "computerUse.checkAgain": "Revérifier",
  "computerUse.checking": "Vérification de Computer Use",
  "computerUse.unavailable.title": "Computer Use n’est pas encore disponible",
  "computerUse.permissions.title": "Autorisations du système",
  "computerUse.permissions.description":
    "macOS gère les autorisations. Après « Accorder », HXBot active ce qu’il peut ; vous ne donnez que votre mot de passe ou Touch ID.",
  "computerUse.ready.title": "Computer Use est prêt",
  "computerUse.ready.description":
    "HXBot peut voir les apps de cet ordinateur et interagir avec elles. Ce système ne demande aucune autorisation supplémentaire.",
  "computerUse.openSettingsFailed.title": "Impossible d’ouvrir Réglages Système",
  "computerUse.compact.title": "Activer Computer Use",
  "computerUse.compact.description": "Permettez à HXBot de voir les apps de cet ordinateur et d’interagir avec elles.",
  "computerUse.granted": "Accordée",
  "computerUse.opening": "Ouverture…",
  "computerUse.manage": "Gérer",
  "computerUse.grant": "Accorder",
  "computerUse.manageLabel": "Gérer {permission}",
  "computerUse.grantLabel": "Accorder {permission}",
  "computerUse.help.title": "Activer {permission}",
  "computerUse.help.paneOpen": "Réglages Système est ouvert sur {pane}.",
  "computerUse.help.dragLabel":
    "Faites glisser {name} dans Réglages Système, ou appuyez pour l’afficher dans le Finder",
  "computerUse.help.dragToAdd": "Glisser pour ajouter",
  "computerUse.help.findInList": "Trouvez {name} dans la liste.",
  "computerUse.help.dragIntoList": "Faites glisser {name}.app dans la liste.",
  "computerUse.help.turnOn": "Activez l’interrupteur.",
  "computerUse.help.showInFinder": "Afficher dans le Finder",
  "computerUse.help.revealFailed": "Impossible d’afficher l’application dans le Finder.",
  "computerUse.help.dragFailed": "Impossible de faire glisser l’application.",
  "computerUse.highlight.working": "HXBot travaille dans {title}",
  "computerUse.help.hxPressesScreen":
    "Quand HXBot a l’Accessibilité, il active lui-même cet interrupteur. Quand macOS le demande, saisissez votre mot de passe ou utilisez Touch ID.",
  "computerUse.help.hxThenScreen":
    "macOS ne laisse que vous activer cet interrupteur pour HXBot. Ensuite, HXBot active lui-même l’enregistrement de l’écran.",
  "computerUse.hxAskTitle": "HXBot a besoin d’une autorisation",
  "computerUse.hxAskBody":
    "Cliquez pour ouvrir la page dans Réglages Système. HXBot ne l’ouvre pas pendant que vous travaillez dans une autre app.",
} as const satisfies PartialTranslation<typeof source>;
