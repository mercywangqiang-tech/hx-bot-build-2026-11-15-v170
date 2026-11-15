import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/menu";

export const messages = {
  "menu.stopAllAgents": "Parar todos os agentes",
  "menu.checkForUpdates": "Buscar atualizações…",
  "menu.preferences": "Configurações…",
  "menu.actualSize": "Tamanho real",
  "menu.zoomIn": "Ampliar",
  "menu.zoomOut": "Reduzir",
  "menu.copyLink": "Copiar link",
  "menu.quit": "Sair do HXBot",
  "menu.quitConfirmTitle": "Sair do HXBot?",
  "menu.quitConfirmBody": "Os agentes e as rotinas param até você abrir o HXBot de novo.",
  "menu.quitConfirm": "Sair",
  "menu.quitHint": "Mantenha ⌘Q pressionado ou pressione duas vezes para sair",
  "menu.trayOpen": "Abrir o HXBot",
  "menu.trayQuit": "Sair do HXBot",
  "menu.trayTooltip": "HXBot",
  "menu.undo": "Desfazer",
  "menu.redo": "Refazer",
  "menu.cut": "Recortar",
  "menu.copy": "Copiar",
  "menu.paste": "Colar",
  "menu.pasteAndMatchStyle": "Colar e manter estilo",
  "menu.delete": "Excluir",
  "menu.selectAll": "Selecionar tudo",
} as const satisfies PartialTranslation<typeof source>;
