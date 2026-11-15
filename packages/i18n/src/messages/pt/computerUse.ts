import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/computerUse";

export const messages = {
  "computerUse.permission.screenRecording.title": "Gravação de Tela",
  "computerUse.permission.screenRecording.description":
    "Permite que o HXBot faça capturas de tela. Clicar e digitar funcionam sem ela.",
  "computerUse.permission.screenRecording.pane": "Gravação de Tela e Áudio do Sistema",
  "computerUse.permission.accessibility.title": "Acessibilidade",
  "computerUse.permission.accessibility.description":
    "Permite que o HXBot clique e digite. Depois, o HXBot ativa a Gravação de Tela sozinho.",
  "computerUse.permission.accessibility.pane": "Acessibilidade",
  "computerUse.error.check": "O HXBot não conseguiu verificar o Uso do computador.",
  "computerUse.error.openSettings": "O HXBot não conseguiu abrir os Ajustes do Sistema.",
  "computerUse.error.startDriver": "O HXBot não conseguiu iniciar o driver de Uso do computador.",
  "computerUse.checkAgain": "Verificar de novo",
  "computerUse.checking": "Verificando o Uso do computador",
  "computerUse.unavailable.title": "O Uso do computador ainda não está disponível",
  "computerUse.permissions.title": "Permissões do sistema",
  "computerUse.permissions.description":
    "As permissões são gerenciadas pelo macOS. Depois de “Conceder”, o HXBot ativa o que puder; você só informa sua senha ou Touch ID.",
  "computerUse.ready.title": "O Uso do computador está pronto",
  "computerUse.ready.description":
    "O HXBot pode ver e interagir com aplicativos neste computador. Este sistema não pede nenhuma permissão adicional.",
  "computerUse.openSettingsFailed.title": "Não foi possível abrir os Ajustes do Sistema",
  "computerUse.compact.title": "Ativar Uso do computador",
  "computerUse.compact.description": "Permitir que o HXBot veja e interaja com aplicativos neste computador.",
  "computerUse.granted": "Concedida",
  "computerUse.opening": "Abrindo…",
  "computerUse.manage": "Gerenciar",
  "computerUse.grant": "Conceder",
  "computerUse.manageLabel": "Gerenciar {permission}",
  "computerUse.grantLabel": "Conceder {permission}",
  "computerUse.help.title": "Ativar {permission}",
  "computerUse.help.paneOpen": "Os Ajustes do Sistema estão abertos em {pane}.",
  "computerUse.help.dragLabel": "Arraste {name} para os Ajustes do Sistema ou pressione para mostrar no Finder",
  "computerUse.help.dragToAdd": "Arraste para adicionar",
  "computerUse.help.findInList": "Encontre {name} na lista.",
  "computerUse.help.dragIntoList": "Arraste {name}.app para a lista.",
  "computerUse.help.turnOn": "Ative a opção.",
  "computerUse.help.showInFinder": "Mostrar no Finder",
  "computerUse.help.revealFailed": "Não foi possível mostrar o aplicativo no Finder.",
  "computerUse.help.dragFailed": "Não foi possível arrastar o aplicativo.",
  "computerUse.highlight.working": "O HXBot está trabalhando em {title}",
  "computerUse.help.hxPressesScreen":
    "Quando o HXBot tem Acessibilidade, ele ativa esta chave sozinho. Quando o macOS pedir, digite sua senha ou use o Touch ID.",
  "computerUse.help.hxThenScreen":
    "O macOS só deixa você ativar esta chave para o HXBot. Depois, o HXBot ativa a Gravação de Tela sozinho.",
  "computerUse.hxAskTitle": "O HXBot precisa de uma permissão",
  "computerUse.hxAskBody":
    "Clique para abrir a página nos Ajustes do Sistema. O HXBot não a abre enquanto você trabalha em outro app.",
} as const satisfies PartialTranslation<typeof source>;
