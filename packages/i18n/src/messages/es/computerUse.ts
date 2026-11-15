import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/computerUse";

export const messages = {
  "computerUse.permission.screenRecording.title": "Grabación de pantalla",
  "computerUse.permission.screenRecording.description":
    "Permite que HXBot haga capturas de pantalla. Hacer clic y escribir funcionan sin él.",
  "computerUse.permission.screenRecording.pane": "Grabación de pantalla y audio del sistema",
  "computerUse.permission.accessibility.title": "Accesibilidad",
  "computerUse.permission.accessibility.description":
    "Permite que HXBot haga clic y escriba. Después, HXBot activa la grabación de pantalla por sí mismo.",
  "computerUse.permission.accessibility.pane": "Accesibilidad",
  "computerUse.error.check": "HXBot no pudo comprobar el uso del equipo.",
  "computerUse.error.openSettings": "HXBot no pudo abrir los Ajustes del Sistema.",
  "computerUse.error.startDriver": "HXBot no pudo iniciar el controlador de uso del equipo.",
  "computerUse.checkAgain": "Comprobar",
  "computerUse.checking": "Comprobando el uso del equipo",
  "computerUse.unavailable.title": "El uso del equipo aún no está disponible",
  "computerUse.permissions.title": "Permisos del sistema",
  "computerUse.permissions.description":
    "macOS gestiona los permisos. Tras «Conceder», HXBot activa lo que puede; tú solo das tu contraseña o Touch ID.",
  "computerUse.ready.title": "El uso del equipo está listo",
  "computerUse.ready.description":
    "HXBot puede ver las aplicaciones de este equipo e interactuar con ellas. Este sistema no solicita permisos adicionales.",
  "computerUse.openSettingsFailed.title": "No se pudieron abrir los Ajustes del Sistema",
  "computerUse.compact.title": "Activar el uso del equipo",
  "computerUse.compact.description": "Permite que HXBot vea las aplicaciones de este equipo e interactúe con ellas.",
  "computerUse.granted": "Concedido",
  "computerUse.opening": "Abriendo…",
  "computerUse.manage": "Gestionar",
  "computerUse.grant": "Conceder",
  "computerUse.manageLabel": "Gestionar {permission}",
  "computerUse.grantLabel": "Conceder {permission}",
  "computerUse.help.title": "Activa {permission}",
  "computerUse.help.paneOpen": "Los Ajustes del Sistema están abiertos en {pane}.",
  "computerUse.help.dragLabel": "Arrastra {name} a los Ajustes del Sistema o pulsa para mostrarlo en Finder",
  "computerUse.help.dragToAdd": "Arrastra para añadir",
  "computerUse.help.findInList": "Busca {name} en la lista.",
  "computerUse.help.dragIntoList": "Arrastra {name}.app a la lista.",
  "computerUse.help.turnOn": "Activa el interruptor.",
  "computerUse.help.showInFinder": "Mostrar en Finder",
  "computerUse.help.revealFailed": "No se pudo mostrar la aplicación en Finder.",
  "computerUse.help.dragFailed": "No se pudo arrastrar la aplicación.",
  "computerUse.highlight.working": "HXBot está trabajando en {title}",
  "computerUse.help.hxPressesScreen":
    "Cuando HXBot tiene Accesibilidad, activa este interruptor por sí mismo. Cuando macOS lo pida, introduce tu contraseña o usa Touch ID.",
  "computerUse.help.hxThenScreen":
    "macOS solo te deja a ti activar este interruptor para HXBot. Después, HXBot activa la grabación de pantalla por sí mismo.",
  "computerUse.hxAskTitle": "HXBot necesita un permiso",
  "computerUse.hxAskBody":
    "Haz clic para abrir la página en Ajustes del Sistema. HXBot no la abre mientras trabajas en otra app.",
} as const satisfies PartialTranslation<typeof source>;
