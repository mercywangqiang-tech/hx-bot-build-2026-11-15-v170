import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/startup";

export const messages = {
  // The one native error box: the app could not start, so no renderer exists to show it.
  "startup.failedTitle": "HXBot n’a pas pu démarrer",
  "startup.failedBody":
    "{message}\n\nVos données locales n’ont pas été réinitialisées ni écrasées. Consultez le guide de dépannage pour savoir comment récupérer la situation.",
  "startup.archiveChangedTitle": "Des fichiers d’HXBot ont été modifiés",
  "startup.archiveChangedBody":
    "Un autre programme a modifié le fichier app.asar d’HXBot. HXBot fonctionne maintenant, mais il ne s’ouvrira plus après sa fermeture.\n\nPour le réparer, réinstallez HXBot. Vos données locales sont conservées.",
  "startup.archiveChangedDownload": "Télécharger HXBot",
  "startup.newerDataUpdatingTitle": "Mise à jour d’HXBot",
  "startup.newerDataUpdatingBody":
    "Une version plus récente d’HXBot a enregistré vos données. HXBot installe la dernière version, puis se rouvre.\n\nVos données locales n’ont pas été réinitialisées ni écrasées.",
  "startup.newerDataTitle": "Installez la dernière version d’HXBot",
  "startup.newerDataBody":
    "Une version plus récente d’HXBot a enregistré vos données, et cette version ({version}) ne peut pas les ouvrir. Installez la dernière version pour ouvrir vos données.\n\nVos données locales n’ont pas été réinitialisées ni écrasées.",
  "startup.newerDataDownload": "Télécharger HXBot",
  "startup.newerDataGuide": "Ouvrir le guide",
  "startup.newerDataQuit": "Quitter",
  "startup.hxMoveTitle": "Déplacer HXBot dans Applications ?",
  "startup.hxMoveBody":
    "HXBot s’exécute hors du dossier Applications, par exemple depuis Téléchargements ou une image disque. macOS le lance alors depuis un emplacement temporaire, et les autorisations et les mises à jour ne fonctionnent pas. HXBot se déplace lui-même et se rouvre.",
  "startup.hxMoveNow": "Déplacer",
  "startup.hxMoveLater": "Plus tard",
  "startup.hxMoveFailed":
    "HXBot n’a pas pu se déplacer. Quittez HXBot, puis faites-le glisser dans le dossier Applications dans le Finder.",
} as const satisfies PartialTranslation<typeof source>;
