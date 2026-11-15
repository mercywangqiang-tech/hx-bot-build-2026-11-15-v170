import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/host";

export const messages = {
  // Status lines of the WebRTC host.
  "status.host.registered": "Cet HXBot est enregistré pour l’accès WebRTC.",
  "status.host.keyRotated": "Clé du serveur changée. Les appareils associés restent associés.",
  "status.host.identityUpdated": "Identité du serveur mise à jour.",
  "status.host.starting": "Démarrage de l’hôte WebRTC…",
  "status.host.ready": "Cet HXBot est prêt pour les connexions WebRTC.",
  "status.host.signalLost": "Les autres appareils ne peuvent pas joindre cet HXBot pour le moment. Il se reconnecte.",
  "status.host.stopping": "Passage de cet HXBot en mode privé…",
  "status.host.private": "Cet HXBot est privé.",
  "status.host.removed": "Cet HXBot a été retiré de votre compte. Publiez-le à nouveau pour le partager.",
} as const satisfies PartialTranslation<typeof source>;
