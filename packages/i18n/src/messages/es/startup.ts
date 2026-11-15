import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/startup";

export const messages = {
  "startup.failedTitle": "HXBot no pudo iniciarse",
  "startup.failedBody":
    "{message}\n\nTus datos locales no se han restablecido ni sobrescrito. Consulta la guía de solución de problemas para recuperarlos.",
  "startup.archiveChangedTitle": "Se cambiaron archivos de HXBot",
  "startup.archiveChangedBody":
    "Otro programa cambió el archivo app.asar de HXBot. HXBot funciona ahora, pero no se abrirá después de cerrarlo.\n\nPara repararlo, vuelve a instalar HXBot. Tus datos locales se conservan.",
  "startup.archiveChangedDownload": "Descargar HXBot",
  "startup.newerDataUpdatingTitle": "Actualizando HXBot",
  "startup.newerDataUpdatingBody":
    "Una versión más reciente de HXBot guardó tus datos. HXBot instala la última versión y luego se abre de nuevo.\n\nTus datos locales no se restablecieron ni se sobrescribieron.",
  "startup.newerDataTitle": "Instala la última versión de HXBot",
  "startup.newerDataBody":
    "Una versión más reciente de HXBot guardó tus datos y esta versión ({version}) no puede abrirlos. Instala la última versión para abrir tus datos.\n\nTus datos locales no se restablecieron ni se sobrescribieron.",
  "startup.newerDataDownload": "Descargar HXBot",
  "startup.newerDataGuide": "Abrir guía",
  "startup.newerDataQuit": "Salir",
  "startup.hxMoveTitle": "¿Mover HXBot a Aplicaciones?",
  "startup.hxMoveBody":
    "HXBot se ejecuta fuera de la carpeta Aplicaciones, por ejemplo desde Descargas o una imagen de disco. Entonces macOS lo ejecuta desde un lugar temporal, y los permisos y las actualizaciones no funcionan. HXBot se mueve solo y se abre de nuevo.",
  "startup.hxMoveNow": "Mover",
  "startup.hxMoveLater": "Ahora no",
  "startup.hxMoveFailed":
    "HXBot no pudo moverse solo. Cierra HXBot y arrástralo a la carpeta Aplicaciones en el Finder.",
} as const satisfies PartialTranslation<typeof source>;
