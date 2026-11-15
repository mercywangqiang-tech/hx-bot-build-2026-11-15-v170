// HXBot 电脑操控（三）：第一次打开时移到“应用程序”文件夹（v1.6.8，「HXBot-Mac隐私与权限-最优方案」⑥）。
//
// 从“下载”或磁盘映像里直接运行时，macOS 把应用挪到一个临时位置运行（App Translocation），授权记在那个位置上，
// 应用内更新也换不了它。这时 HXBot 问一次“移到应用程序文件夹”：点“移过去”由 Electron 移过去并重新打开；
// 点“以后再说”，这一版不再问。移不过去时说清楚怎么自己拖过去。
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AppTranslate } from "@hxbot/i18n";
import { createHxBotLogger, toLogValue } from "@hxbot/logging";
import { Option, Schema } from "effect";
import { app, dialog } from "electron";

const logger = createHxBotLogger("hx-move-to-applications");
/** The version the user said "Not now" for. */
const ANSWER_FILE = "hx-move-to-applications.json";

const decodeAnswer = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Struct({ version: Schema.String })));

function answeredFor(file: string): string | null {
  try {
    const answer = decodeAnswer(readFileSync(file, "utf8"));
    return Option.isSome(answer) ? answer.value.version : null;
  } catch {
    return null;
  }
}

/** Asks once per version, on a packaged Mac build that runs outside /Applications. Never rejects. */
export async function hxOfferMoveToApplications(translate: AppTranslate): Promise<void> {
  if (process.platform !== "darwin" || !app.isPackaged || app.isInApplicationsFolder()) return;
  const file = join(app.getPath("userData"), ANSWER_FILE);
  const version = app.getVersion();
  if (answeredFor(file) === version) return;
  try {
    const { response } = await dialog.showMessageBox({
      type: "question",
      message: translate("startup.hxMoveTitle"),
      detail: translate("startup.hxMoveBody"),
      buttons: [translate("startup.hxMoveNow"), translate("startup.hxMoveLater")],
      defaultId: 0,
      cancelId: 1,
    });
    if (response !== 0) {
      writeFileSync(file, JSON.stringify({ version }));
      return;
    }
    // A copy in Applications is replaced; one that runs now is left alone. On success HXBot opens again.
    app.moveToApplicationsFolder({ conflictHandler: (conflict) => conflict !== "existsAndRunning" });
  } catch (cause) {
    logger.warn("HXBot could not move itself to Applications.", { cause: toLogValue(cause) });
    await dialog
      .showMessageBox({
        type: "warning",
        message: translate("startup.hxMoveFailed"),
        buttons: [translate("common.close")],
      })
      .catch(() => undefined);
  }
}
