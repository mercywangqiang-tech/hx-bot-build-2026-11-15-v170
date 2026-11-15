import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/startup";

export const messages = {
  // The one native error box: the app could not start, so no renderer exists to show it.
  "startup.failedTitle": "HXBot 无法启动",
  "startup.failedBody": "{message}\n\n你的本地数据没有被重置或覆盖。请查看故障排查指南了解恢复步骤。",
  "startup.archiveChangedTitle": "HXBot 文件已被更改",
  "startup.archiveChangedBody":
    "另一个程序更改了 HXBot 的文件 app.asar。HXBot 现在仍在运行，但退出后将无法再次打开。\n\n要修复 HXBot，请重新安装。你的本地数据会保留。",
  "startup.archiveChangedDownload": "下载 HXBot",
  "startup.newerDataUpdatingTitle": "正在更新 HXBot",
  "startup.newerDataUpdatingBody":
    "较新版本的 HXBot 保存了你的数据。HXBot 将安装最新版本，然后重新打开。\n\n你的本地数据未被重置或覆盖。",
  "startup.newerDataTitle": "请安装最新版 HXBot",
  "startup.newerDataBody":
    "较新版本的 HXBot 保存了你的数据，此版本（{version}）无法打开这些数据。请安装最新版本以打开你的数据。\n\n你的本地数据未被重置或覆盖。",
  "startup.newerDataDownload": "下载 HXBot",
  "startup.newerDataGuide": "打开指南",
  "startup.newerDataQuit": "退出",
  "startup.hxMoveTitle": "把 HXBot 移到“应用程序”文件夹？",
  "startup.hxMoveBody":
    "HXBot 现在不在“应用程序”文件夹里运行（例如在“下载”或磁盘映像里）。macOS 会把这样运行的应用放到临时位置，授权和更新都会出问题。点“移过去”，HXBot 自己移过去并重新打开。",
  "startup.hxMoveNow": "移过去",
  "startup.hxMoveLater": "以后再说",
  "startup.hxMoveFailed": "HXBot 没能自己移过去。请退出 HXBot，再在访达里把它拖到“应用程序”文件夹。",
} as const satisfies PartialTranslation<typeof source>;
