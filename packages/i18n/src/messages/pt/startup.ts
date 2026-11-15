import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/startup";

export const messages = {
  "startup.failedTitle": "O HXBot não conseguiu iniciar",
  "startup.failedBody":
    "{message}\n\nSeus dados locais não foram redefinidos nem sobrescritos. Consulte o guia de solução de problemas para ver os passos de recuperação.",
  "startup.archiveChangedTitle": "Arquivos do HXBot foram alterados",
  "startup.archiveChangedBody":
    "Outro programa alterou o arquivo app.asar do HXBot. O HXBot funciona agora, mas não vai abrir depois que você fechá-lo.\n\nPara reparar, instale o HXBot novamente. Seus dados locais são mantidos.",
  "startup.archiveChangedDownload": "Baixar HXBot",
  "startup.newerDataUpdatingTitle": "Atualizando o HXBot",
  "startup.newerDataUpdatingBody":
    "Uma versão mais recente do HXBot salvou seus dados. O HXBot instala a versão mais recente e depois abre de novo.\n\nSeus dados locais não foram redefinidos nem substituídos.",
  "startup.newerDataTitle": "Instale o HXBot mais recente",
  "startup.newerDataBody":
    "Uma versão mais recente do HXBot salvou seus dados, e esta versão ({version}) não consegue abri-los. Instale a versão mais recente para abrir seus dados.\n\nSeus dados locais não foram redefinidos nem substituídos.",
  "startup.newerDataDownload": "Baixar HXBot",
  "startup.newerDataGuide": "Abrir guia",
  "startup.newerDataQuit": "Sair",
  "startup.hxMoveTitle": "Mover o HXBot para Aplicativos?",
  "startup.hxMoveBody":
    "O HXBot está rodando fora da pasta Aplicativos, por exemplo de Downloads ou de uma imagem de disco. O macOS então o executa de um local temporário, e as permissões e as atualizações não funcionam. O HXBot se move sozinho e abre de novo.",
  "startup.hxMoveNow": "Mover",
  "startup.hxMoveLater": "Agora não",
  "startup.hxMoveFailed":
    "O HXBot não conseguiu se mover. Encerre o HXBot e arraste-o para a pasta Aplicativos no Finder.",
} as const satisfies PartialTranslation<typeof source>;
