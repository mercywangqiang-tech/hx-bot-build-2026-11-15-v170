import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/update";

export const messages = {
  "error.update.unsupported": "Las actualizaciones están disponibles en las versiones de escritorio instaladas.",
  "error.update.notReady": "No hay ninguna actualización lista para instalar.",
  "error.update.restartFailed": "HXBot no pudo reiniciarse para instalar la actualización.",
  "error.update.downloadStalled": "La descarga de la actualización dejó de responder. Inténtalo de nuevo.",
  "error.update.installFailed":
    "No se pudo instalar la actualización. Cierra y vuelve a abrir HXBot e inténtalo de nuevo.",
  "error.update.downloadFailed": "No se pudo descargar la actualización. Inténtalo de nuevo.",
  "error.update.checkFailed": "No se pudieron buscar actualizaciones. Inténtalo de nuevo.",
  "error.update.checkStalled": "La búsqueda de actualizaciones dejó de responder. Inténtalo de nuevo.",
  "error.update.checkOffline":
    "No se pudo acceder al servicio de actualizaciones. Comprueba tu conexión a Internet e inténtalo de nuevo.",
  "error.update.checkUnavailable":
    "El servicio de actualizaciones no respondió. HXBot lo volverá a intentar automáticamente en unos minutos.",
  "error.update.checkNoRelease":
    "No se encontró ninguna actualización publicada para esta plataforma. HXBot lo volverá a intentar automáticamente en unos minutos.",
  "error.update.managedByNix": "Nix instala las actualizaciones de esta copia de HXBot. Actualízala con Nix.",
  "error.update.managedByHost":
    "El host instala las actualizaciones en este Mac. La actualización permanecerá lista hasta que se ejecute el mantenimiento del host.",
  "error.update.siblingSession":
    "Otra sesión de HXBot sigue ejecutándose desde esta aplicación. Primero detén HXBot en todas las demás cuentas de usuario de macOS y vuelve a instalar la actualización.",
  "error.update.siblingSessionSameAccount":
    "Otro proceso de HXBot sigue ejecutándose en esta cuenta de usuario. Ciérralo y vuelve a instalar la actualización.",
  "error.update.siblingCheckFailed":
    "No se pudieron verificar otras sesiones de HXBot. Inténtalo de nuevo antes de instalar.",
  "error.update.remoteDisabled":
    "Las actualizaciones por parte de administradores del servidor están desactivadas en este equipo.",
  "error.update.restartStarted": "HXBot ya se está reiniciando para instalar la actualización.",
  "error.update.alreadyRestarting": "HXBot ya se está reiniciando.",
  "error.update.checkSignedOut":
    "El servidor de actualizaciones no aceptó tu inicio de sesión. Vuelve a iniciar sesión en HXBot y busca actualizaciones de nuevo.",
} as const satisfies PartialTranslation<typeof source>;
