import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/sitePage";

export const messages = {
  "sitePage.error.title": "Impossible de charger cette page",
  "sitePage.error.body":
    "Vérifiez votre connexion et rechargez la page. Si elle ne se charge toujours pas, revenez à la page d’accueil.",
  "sitePage.error.reload": "Recharger la page",
  "sitePage.error.home": "Retour à l’accueil",
  "sitePage.join.title": "Rejoindre un serveur HXBot",
  "sitePage.join.description": "Ouvrez une invitation privée à un serveur dans HXBot.",
  "sitePage.join.eyebrow": "Invitation privée",
  "sitePage.join.intro":
    "Ouvrez cette invitation dans HXBot. L’app vérifie le serveur et vous demande de confirmer avant de se connecter.",
  "sitePage.join.invalid":
    "Ce lien d’invitation n’est pas valide ou est incomplet. Demandez une nouvelle invitation au propriétaire du serveur.",
  "sitePage.join.open": "Ouvrir HXBot",
  "sitePage.join.noApp": "Pas d’app ? {browser} ou {download}.",
  "sitePage.join.noAppMobile": "Pas d’app ? {browser}.",
  "sitePage.join.browserLink": "Rejoignez dans ce navigateur",
  "sitePage.join.downloadLink": "téléchargez HXBot",
  "sitePage.join.notOpened":
    "Si HXBot est installé sur cet ordinateur, lancez-le, puis cliquez à nouveau sur {open}. Sinon, téléchargez-le d’abord.",
  "sitePage.join.mobile":
    "Si HXBot est installé, touchez {open}. Vous pouvez aussi coller ce lien dans Ajouter un serveur dans l’app.",
  "sitePage.join.email": "Si l’invitation est arrivée par e-mail, connectez-vous à HXBot avec cette adresse e-mail.",
  "sitePage.connect.title": "Revenir à HXBot",
  "sitePage.connect.failedTitle": "La connexion n’a pas abouti",
  "sitePage.connect.openApp": "Ouvrir HXBot",
  "sitePage.connect.tryAgainApp": "Réessayer dans HXBot",
  "sitePage.connect.tryAgainBrowser": "Réessayer dans le navigateur",
  "sitePage.connect.doneInWebClient":
    "Votre onglet HXBot termine la connexion à {name}. Vous pouvez fermer cet onglet.",
  "sitePage.connect.doneInApp": "HXBot termine la connexion à {name} sur votre ordinateur.",
  "sitePage.connect.failure.cancelled": "La connexion à {name} a été annulée. Rien n’a changé.",
  "sitePage.connect.failure.expired": "La connexion à {name} a expiré. Relancez la connexion.",
  "sitePage.connect.failure.exchange": "{name} n’a pas confirmé la connexion. Réessayez.",
  "sitePage.connect.failure.enterprise": "Connectez un espace de travail Slack, pas une organisation entière.",
  "sitePage.connect.failure.takenSlack":
    "Un autre serveur HXBot répond déjà dans cet espace de travail Slack. Déconnectez-le sur ce serveur, puis réessayez.",
  "sitePage.connect.failure.takenDiscord":
    "Un autre serveur HXBot répond déjà sur ce serveur Discord. Déconnectez-le sur ce serveur, puis réessayez.",
  "sitePage.connect.failure.unavailable":
    "HXBot ne peut pas se connecter à {name} pour le moment. Réessayez plus tard.",
  "sitePage.connect.failure.tabClosed":
    "L’onglet HXBot qui a lancé la connexion à {name} n’a pas répondu. Ouvrez HXBot dans votre navigateur et connectez de nouveau {name}.",
  "sitePage.connect.failure.failed": "{name} n’a pas terminé la connexion. Réessayez.",
  "sitePage.connect.restartHint":
    "Dans HXBot, ouvrez {marketplace}, puis {apps}, puis {name}, et sélectionnez {connect}.",
  "sitePage.connect.notOpened":
    "Lancez HXBot, puis réessayez. Si HXBot n’est pas sur cet ordinateur, téléchargez-le et connectez {name} depuis l’app.",
  "sitePage.openApp.title": "Rien ne s’est ouvert ?",
  "sitePage.openApp.dismiss": "Plus tard",
  "sitePage.billing.pageTitle": "Facturation HXBot",
  "sitePage.billing.updatedTitle": "Facturation mise à jour",
  "sitePage.billing.updatedBody": "Revenez à HXBot. Vous pouvez fermer cette page.",
  "sitePage.billing.cancelledTitle": "Paiement annulé",
  "sitePage.billing.cancelledBody": "Rien n’a été facturé. Revenez à HXBot.",
  "sitePage.report.pageTitle": "Signaler un site hébergé — HXBot",
  "sitePage.report.title": "Signaler un site hébergé",
  "sitePage.report.intro": "Envoyez un signalement sur un contenu nuisible ou illégal à une adresse HXBot.",
  "sitePage.report.hostnameLabel": "Adresse du site",
  "sitePage.report.hostnameMissing": "Saisissez l’adresse du site",
  "sitePage.report.reasonLabel": "Motif",
  "sitePage.report.reason.phishing": "Hameçonnage",
  "sitePage.report.reason.malware": "Logiciel malveillant",
  "sitePage.report.reason.abuse": "Abus",
  "sitePage.report.reason.copyright": "Droit d’auteur",
  "sitePage.report.reason.other": "Autre",
  "sitePage.report.detailsLabel": "Détails",
  "sitePage.report.optional": "Facultatif",
  "sitePage.report.detailsPlaceholder": "Quel est le problème avec ce site ?",
  "sitePage.report.send": "Envoyer",
  "sitePage.report.sending": "Envoi…",
  "sitePage.report.tooMany": "Trop de signalements. Réessayez plus tard.",
  "sitePage.report.sendFailed": "Impossible d’envoyer le signalement. Réessayez.",
  "sitePage.report.writeTo": "Vous pouvez aussi écrire à {email}.",
  "sitePage.report.sentTitle": "Signalement envoyé",
  "sitePage.report.sentBody": "Merci. Nous avons reçu votre signalement.",
  "sitePage.report.home": "Aller à la page d’accueil",
  "sitePage.marketplace.downloadFor": "Télécharger pour {platform}",
} as const satisfies PartialTranslation<typeof source>;
