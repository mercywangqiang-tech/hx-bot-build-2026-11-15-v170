/** HXBot: the name of each kind of work (auto model), for the settings pages that list them. */

import type { HxWorkType } from "@hxbot/contracts/hx-auto-model";
import type { AppTextKey } from "@hxbot/i18n";

export { isHxWorkType } from "@hxbot/contracts/hx-auto-model";

export const HX_WORK_LABEL: Record<HxWorkType, AppTextKey> = {
  chat: "settings.hxAutoModel.work.chat",
  writing: "settings.hxAutoModel.work.writing",
  "code-small": "settings.hxAutoModel.work.codeSmall",
  "code-large": "settings.hxAutoModel.work.codeLarge",
  data: "settings.hxAutoModel.work.data",
  vision: "settings.hxAutoModel.work.vision",
  "long-context": "settings.hxAutoModel.work.longContext",
  reasoning: "settings.hxAutoModel.work.reasoning",
  computer: "settings.hxAutoModel.work.computer",
};
