import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/update";

export const messages = {
  "error.update.unsupported": "As atualizações estão disponíveis nas versões instaladas para computador.",
  "error.update.notReady": "Nenhuma atualização está pronta para instalar.",
  "error.update.restartFailed": "O HXBot não conseguiu reiniciar para instalar a atualização.",
  "error.update.downloadStalled": "O download da atualização parou de responder. Tente novamente.",
  "error.update.installFailed":
    "Não foi possível instalar a atualização. Encerre e abra o HXBot novamente, depois tente outra vez.",
  "error.update.downloadFailed": "Não foi possível baixar a atualização. Tente novamente.",
  "error.update.checkFailed": "Não foi possível verificar se há atualizações. Tente novamente.",
  "error.update.checkStalled": "A verificação de atualizações parou de responder. Tente novamente.",
  "error.update.checkOffline":
    "Não foi possível acessar o serviço de atualizações. Verifique sua conexão com a internet e tente novamente.",
  "error.update.checkUnavailable":
    "O serviço de atualizações não respondeu. O HXBot tentará novamente automaticamente em alguns minutos.",
  "error.update.checkNoRelease":
    "Nenhuma atualização publicada foi encontrada para esta plataforma. O HXBot tentará novamente automaticamente em alguns minutos.",
  "error.update.managedByNix": "O Nix instala as atualizações desta cópia do HXBot. Atualize-a com o Nix.",
  "error.update.managedByHost":
    "As atualizações neste Mac são instaladas pelo computador anfitrião. A atualização permanece pronta para instalação até a manutenção do computador anfitrião ser executada.",
  "error.update.siblingSession":
    "Outra sessão do HXBot ainda está em execução neste aplicativo. Encerre o HXBot em todas as outras contas de usuário do macOS e instale a atualização novamente.",
  "error.update.siblingSessionSameAccount":
    "Outro processo do HXBot ainda está rodando nesta conta de usuário. Feche-o e instale a atualização de novo.",
  "error.update.siblingCheckFailed":
    "Não foi possível verificar outras sessões do HXBot. Tente novamente antes de instalar.",
  "error.update.remoteDisabled":
    "As atualizações feitas por administradores do servidor estão desativadas neste computador.",
  "error.update.restartStarted": "O HXBot já está reiniciando para instalar a atualização.",
  "error.update.alreadyRestarting": "O HXBot já está reiniciando.",
  "error.update.checkSignedOut":
    "O servidor de atualizações não aceitou seu login. Entre no HXBot novamente e depois procure atualizações.",
} as const satisfies PartialTranslation<typeof source>;
