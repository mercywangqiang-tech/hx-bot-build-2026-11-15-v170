import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/host";

export const messages = {
  "status.host.registered": "Se registró este HXBot para el acceso WebRTC.",
  "status.host.keyRotated": "Clave del servidor cambiada. Los dispositivos vinculados siguen vinculados.",
  "status.host.identityUpdated": "Identidad del servidor actualizada.",
  "status.host.starting": "Iniciando el host WebRTC…",
  "status.host.ready": "Este HXBot está listo para conexiones WebRTC.",
  "status.host.signalLost": "Otros dispositivos no pueden llegar a este HXBot ahora. Se vuelve a conectar.",
  "status.host.stopping": "Haciendo privado este HXBot…",
  "status.host.private": "Este HXBot es privado.",
  "status.host.removed": "Este HXBot se quitó de tu cuenta. Publícalo de nuevo para compartirlo.",
} as const satisfies PartialTranslation<typeof source>;
