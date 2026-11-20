"""HXBot v1.7.5 应用工作流与定时任务升级（需求规格说明书 V2.4 第 5.5 节）。

需求：RTN-11、RTN-01、RTN-02、RTN-03、RTN-04、RTN-06、RTN-07、RTN-08、MIG-03、CONC-13、CONC-14、CONC-16、UI-27。

HX 自己的代码在 src/backend/hx-routines/ 等目录（不是上游文件，直接在树里）。这一步只改上游文件：
- 改动由 /home/claude/v175/tools/genstep.py 从工作区和 v1.7.4 提交的差异生成，放在 hx/v175_pairs.py：
  每个上游文件一组，先加 import（每条一行，加在文件开头），再按顺序替换。生成时把改名后的写法
  （@hxbot/、hxBot…）换回上游写法，所以在上游代码上重放和在已改造的树上重放结果一样。
- 界面文字：英文、中文在这里（TEXT），其他 13 种语言在 hx/translations_v175.py。

RTN-01（定时任务时区必填、预览下三次、标出夏令时）：
1. routine-schedule.ts：写明时刻的日程（每天、工作日、每周、每月、高级里的“在某时刻”、一次、小时字段不以 * 开头的
   cron）按墙上时间：春季不存在的时刻顺延到缺口后的第一分钟，秋季重复的时刻只在第一次执行；每小时、每隔几分钟按
   经过的时间。hxRoutineUpcoming 给出下三次（所在时区的时间、UTC、偏移、从哪个时刻顺延、是否重复）。
2. routine-scheduler.ts：智能体新建定时任务时，时区用你登记的时区（服务器时区设置不是“自动”时），或调用里给的；
   都没有时让智能体问你一次，记住你选的；不再悄悄用主机时区或发消息的设备时区。update_routine 可以改时区。
   工具结果带下三次，智能体在对话里告诉你。编辑器、团队接口保存的第一个时区也记成登记的时区。
3. routine-store.ts、ipc-routines.ts、agent-inputs.ts：修改定时任务可以带新时区，下次运行按新时区算。
"""

from __future__ import annotations

import brand_rename
import v175_pairs

MESSAGES = "packages/i18n/src/messages"

ERROR_EN = {
    "error.backend.hxRoutineZoneUnknown": '"{zone}" is not a timezone this computer knows. Choose a zone from the list, such as Asia/Shanghai.',
    "error.backend.hxRoutineConfirmGone": "This question is no longer open.",
}
ERROR_ZH = {
    "error.backend.hxRoutineZoneUnknown": "“{zone}”不是这台电脑认得的时区。请从列表里选，例如 Asia/Shanghai。",
    "error.backend.hxRoutineConfirmGone": "这个问题已经关闭。",
}

# RTN-11、RTN-07、RTN-08：工作流的新步骤、上限和检查（src/backend/hx-workflows/）
WORKFLOW_ERROR_EN = {
    "error.workflow.hxStepNoAgent": "Choose the agent of this step.",
    "error.workflow.hxStepInvalid": "The settings of this step do not fit: {reason}",
    "error.workflow.hxStepUnavailable": "HXBot is still starting. Run the step again in a moment.",
    "error.workflow.hxStepComputerUseOff": "Computer Use is off for {agent}. Turn it on in the agent's settings, then continue.",
    "error.workflow.hxActionUnknown": "HXBot stopped while it did {action}, so its result is not known. Check it first: Continue from this step does it again.",
    "error.workflow.hxActionFailed": "The call {action} did not work: {reason}",
    "error.workflow.hxTeamFailed": "The team did not finish: {reason}",
    "error.workflow.hxConnectionOff": "The messaging connection of this output is off. Turn it on, then continue.",
    "error.workflow.hxLimitLoops": "Over the limit: a loop ran {count} times, so the run stopped.",
    "error.workflow.hxLimitSteps": "Over the limit: the run reached {count} steps, so it stopped.",
    "error.workflow.hxLimitSeconds": "Over the limit: its loops ran longer than {count} seconds, so the run stopped.",
    "error.workflow.hxTurnNothing": "This turn has no Computer Use, app skill or team step to save.",
}
WORKFLOW_ERROR_ZH = {
    "error.workflow.hxStepNoAgent": "请选择这一步的智能体。",
    "error.workflow.hxStepInvalid": "这一步的设置不对：{reason}",
    "error.workflow.hxStepUnavailable": "HXBot 还在启动，请稍后再运行这一步。",
    "error.workflow.hxStepComputerUseOff": "{agent} 的“电脑操控”是关着的。在智能体设置里打开后再继续。",
    "error.workflow.hxActionUnknown": "HXBot 做“{action}”时停了，结果未知。请先核对：点“从这一步继续”会再做一次。",
    "error.workflow.hxActionFailed": "调用“{action}”没有成功：{reason}",
    "error.workflow.hxTeamFailed": "团队没有完成：{reason}",
    "error.workflow.hxConnectionOff": "这个输出的消息连接已关闭，打开后再继续。",
    "error.workflow.hxLimitLoops": "超出上限：循环已跑 {count} 次，运行已停止。",
    "error.workflow.hxLimitSteps": "超出上限：这次运行已到 {count} 个步骤，已停止。",
    "error.workflow.hxLimitSeconds": "超出上限：循环已超过 {count} 秒，运行已停止。",
    "error.workflow.hxTurnNothing": "这一轮没有可以存下的电脑操作、应用技能或团队步骤。",
}

# RTN-11、RTN-07、RTN-08：工作流画布和“存成工作流”的界面文字
WORKFLOW_EN = {
    "workflow.hx.savedTitle": "{agent}: saved steps, {date}",
    "workflow.hx.confirmStep": "Go on with {what}? This step changes things outside HXBot.",
    "workflow.hx.node.appAction": "App action",
    "workflow.hx.node.appSkill": "App skill",
    "workflow.hx.node.team": "Team task",
    "workflow.hx.node.appActionHint": "Computer Use calls, done in order by the agent.",
    "workflow.hx.node.appSkillHint": "One app skill call. It reads its result back.",
    "workflow.hx.node.teamHint": "A team from a proposal card does one piece of work.",
    "workflow.hx.field.actions": "Calls (JSON list)",
    "workflow.hx.field.skill": "Skill",
    "workflow.hx.field.action": "Action",
    "workflow.hx.field.args": "Files, output and params (JSON)",
    "workflow.hx.field.team": "Proposal card (JSON)",
    "workflow.hx.field.inputHint": "Write {token} where the answer of the step before goes.",
    "workflow.hx.unsupported": "Not supported yet",
    "workflow.hx.unsupportedHint": "This version of HXBot has no runner for this step. Delete it to save and run the workflow.",
    "workflow.hx.declares": "Needs: {permission} · Repeats safely: {idempotent} · Checks: {readback}",
    "workflow.hx.permission.none": "nothing",
    "workflow.hx.permission.person": "your answer",
    "workflow.hx.permission.agent": "the agent",
    "workflow.hx.permission.computer-use": "the agent's Computer Use",
    "workflow.hx.permission.connection": "the connection",
    "workflow.hx.idempotent.yes": "yes",
    "workflow.hx.idempotent.key": "once per run",
    "workflow.hx.idempotent.no": "no",
    "workflow.hx.readback.value": "its value",
    "workflow.hx.readback.answer": "the answer",
    "workflow.hx.readback.file": "the file it wrote",
    "workflow.hx.readback.delivery": "the agent's reply",
    "workflow.hx.readback.post": "the post",
    "workflow.hx.readback.team": "the team's result",
    "workflow.hx.readback.person": "your answer",
    "workflow.hx.modelAuto": "Auto (HXBot picks by the work)",
    "workflow.hx.modelAgent": "The agent's model",
    "workflow.hx.limits.title": "Run limits",
    "workflow.hx.limits.loops": "Passes of a loop",
    "workflow.hx.limits.steps": "Steps of a run",
    "workflow.hx.limits.seconds": "Seconds of the loops",
    "workflow.hx.limits.save": "Save limits",
    "workflow.hx.limits.reset": "Use the defaults",
    "workflow.hx.limits.hint": "At a limit the run stops and says so. Each limit stays finite.",
    "workflow.hx.limits.range": "Enter a whole number from 1 to {max}.",
    "workflow.hx.limits.defaults": "Defaults: {loops} passes, {steps} steps, {seconds} seconds.",
    "workflow.hx.limits.menu": "Run limits…",
    "workflow.hx.limits.loadFailed": "HXBot could not read the limits of this workflow.",
}
WORKFLOW_ZH = {
    "workflow.hx.savedTitle": "{agent} 的操作 · {date}",
    "workflow.hx.confirmStep": "继续做“{what}”吗？这一步会改动 HXBot 以外的东西。",
    "workflow.hx.node.appAction": "应用操作",
    "workflow.hx.node.appSkill": "应用技能",
    "workflow.hx.node.team": "团队任务",
    "workflow.hx.node.appActionHint": "一串电脑操控动作，由智能体按顺序做。",
    "workflow.hx.node.appSkillHint": "调用一次应用技能，做完会读回核对。",
    "workflow.hx.node.teamHint": "按建议卡组队，完成一件事。",
    "workflow.hx.field.actions": "动作（JSON 列表）",
    "workflow.hx.field.skill": "技能",
    "workflow.hx.field.action": "动作",
    "workflow.hx.field.args": "文件、输出和参数（JSON）",
    "workflow.hx.field.team": "建议卡（JSON）",
    "workflow.hx.field.inputHint": "要用上一步的结果的地方写 {token}。",
    "workflow.hx.unsupported": "暂不支持",
    "workflow.hx.unsupportedHint": "这个版本的 HXBot 还不能运行这一步。删掉它才能保存和运行这个工作流。",
    "workflow.hx.declares": "需要：{permission} · 可安全重做：{idempotent} · 核对：{readback}",
    "workflow.hx.permission.none": "无",
    "workflow.hx.permission.person": "你的回答",
    "workflow.hx.permission.agent": "智能体",
    "workflow.hx.permission.computer-use": "智能体的电脑操控",
    "workflow.hx.permission.connection": "消息连接",
    "workflow.hx.idempotent.yes": "是",
    "workflow.hx.idempotent.key": "每次运行只做一次",
    "workflow.hx.idempotent.no": "否",
    "workflow.hx.readback.value": "它的值",
    "workflow.hx.readback.answer": "回答",
    "workflow.hx.readback.file": "写出的文件",
    "workflow.hx.readback.delivery": "智能体的回复",
    "workflow.hx.readback.post": "发出的消息",
    "workflow.hx.readback.team": "团队的结果",
    "workflow.hx.readback.person": "你的回答",
    "workflow.hx.modelAuto": "自动（按工作内容选）",
    "workflow.hx.modelAgent": "用智能体自己的模型",
    "workflow.hx.limits.title": "运行上限",
    "workflow.hx.limits.loops": "循环次数",
    "workflow.hx.limits.steps": "每次运行的步骤数",
    "workflow.hx.limits.seconds": "循环的总秒数",
    "workflow.hx.limits.save": "保存上限",
    "workflow.hx.limits.reset": "恢复默认",
    "workflow.hx.limits.hint": "到了上限，运行会停下并写明原因。每个上限都必须是有限值。",
    "workflow.hx.limits.range": "请输入 1 到 {max} 之间的整数。",
    "workflow.hx.limits.defaults": "默认：循环 {loops} 次、{steps} 步、{seconds} 秒。",
    "workflow.hx.limits.menu": "运行上限…",
    "workflow.hx.limits.loadFailed": "HXBot 读不到这个工作流的上限。",
}

# RTN-11：对话里“存成工作流”的一行
SAVE_TURN_EN = {
    "conversation.hx.saveTurn.text": "This turn did {count} steps with apps. Save them as a workflow to run them again.",
    "conversation.hx.saveTurn.save": "Save as workflow",
    "conversation.hx.saveTurn.saved": "Saved as the workflow “{title}”.",
    "conversation.hx.saveTurn.savedBefore": "Saved as a workflow.",
    "conversation.hx.saveTurn.open": "Open",
    "conversation.hx.saveTurn.failed": "It was not saved: {reason}",
}
SAVE_TURN_ZH = {
    "conversation.hx.saveTurn.text": "这一轮用应用做了 {count} 步。存成工作流以后可以再跑。",
    "conversation.hx.saveTurn.save": "存成工作流",
    "conversation.hx.saveTurn.saved": "已存成工作流“{title}”。",
    "conversation.hx.saveTurn.savedBefore": "已存成工作流。",
    "conversation.hx.saveTurn.open": "打开",
    "conversation.hx.saveTurn.failed": "没有存上：{reason}",
}

# RTN-02、MIG-03、CONC-14：定时任务运行前等你确认的卡片（src/backend/hx-routines/confirm.ts）
STATUS_EN = {
    "status.agent.hxLearned.teamProgress": "Team · As you chose last time, the next reminder comes after {minutes} minutes with no progress.",
    "status.agent.hxLearned.workProgress": "Team · As you chose, work like this is now reminded after {minutes} minutes with no progress.",
    "status.agent.hxLearned.yield": "Computer Use · You used the computer again just after HXBot went on, so it now waits {seconds} seconds after you stop.",
    "status.agent.hxRoutineConfirm.title": 'Routine "{name}" waits for your yes before it runs',
    "status.agent.hxRoutineConfirm.titleMany": "{count} routines wait for your yes before they run",
    "status.agent.hxRoutineConfirm.noteCatchUp": "Missed {count} times ({from} – {until}) while HXBot was closed or the computer slept. It runs once for them.",
    "status.agent.hxRoutineConfirm.noteLate": "This run makes up for a missed time.",
    "status.agent.hxRoutineConfirm.noteEach": "Since the upgrade to v1.7.5 it asks before each run, because it sends, posts, pays or deletes.",
    "status.agent.hxRoutineConfirm.actions.send": "This run sends messages or mail. Nothing is sent before you say yes.",
    "status.agent.hxRoutineConfirm.actions.publish": "This run posts or publishes. Nothing is posted before you say yes.",
    "status.agent.hxRoutineConfirm.actions.pay": "This run pays or buys. Nothing is paid before you say yes.",
    "status.agent.hxRoutineConfirm.actions.delete": "This run deletes. Nothing is deleted before you say yes.",
    "status.agent.hxRoutineConfirm.actions.several": "This run sends, posts, pays or deletes. Nothing happens before you say yes.",
    "status.agent.hxRoutineConfirm.actions.each": "This routine asks before each run.",
    "status.agent.hxRoutineConfirm.outcome.yes": "You said yes: it runs now.",
    "status.agent.hxRoutineConfirm.outcome.no": "You said no: skipped this time.",
    "status.agent.hxRoutineConfirm.outcome.expired": "No answer before its next time: skipped this time.",
    "status.agent.hxRoutineConfirm.outcome.paused": "The routine is paused: this time does not run.",
    "status.agent.hxRoutineResult.unverifiedTitle": "Routine result not verified",
    "status.agent.hxRoutineResult.missingFile": 'The run of "{name}" says it saved {files}, but HXBot did not find it there. Check the result before you rely on it.',
    "status.agent.hxRoutineResult.notReadBack": 'The run of "{name}" changed a file that HXBot could not read back. Check the result before you rely on it.',
    "status.agent.hxRoutineResult.actionUnknown": 'The run of "{name}" sent, posted, paid or deleted something, and HXBot does not know the result. Check it before you rely on it.',
    "status.agent.hxRoutineResult.noToolStep": 'The run of "{name}" should send, post, pay or delete, but it ended without one step. Check the result before you rely on it.',
}
STATUS_ZH = {
    "status.agent.hxLearned.teamProgress": "协作 · 按你上次的选择，改为 {minutes} 分钟没进展再提醒。",
    "status.agent.hxLearned.workProgress": "协作 · 按你的选择，这类工作以后 {minutes} 分钟没进展就提醒。",
    "status.agent.hxLearned.yield": "电脑操控 · HXBot 接着做后你马上又用了电脑，以后你停手 {seconds} 秒再接着做。",
    "status.agent.hxRoutineConfirm.title": "定时任务「{name}」等你确认后才运行",
    "status.agent.hxRoutineConfirm.titleMany": "{count} 个定时任务等你确认后才运行",
    "status.agent.hxRoutineConfirm.noteCatchUp": "HXBot 关闭或电脑睡眠时错过 {count} 次（{from} – {until}），按“补跑一次”处理。",
    "status.agent.hxRoutineConfirm.noteLate": "这次运行补上错过的一次。",
    "status.agent.hxRoutineConfirm.noteEach": "升级到 v1.7.5 后，它每次运行前先问你，因为它会发送、发布、付款或删除。",
    "status.agent.hxRoutineConfirm.actions.send": "这次会发送消息或邮件。你确认前不会发送。",
    "status.agent.hxRoutineConfirm.actions.publish": "这次会发帖或发布。你确认前不会发布。",
    "status.agent.hxRoutineConfirm.actions.pay": "这次会付款或购买。你确认前不会付款。",
    "status.agent.hxRoutineConfirm.actions.delete": "这次会删除。你确认前不会删除。",
    "status.agent.hxRoutineConfirm.actions.several": "这次会发送、发布、付款或删除。你确认前什么都不做。",
    "status.agent.hxRoutineConfirm.actions.each": "这个定时任务每次运行前都先问你。",
    "status.agent.hxRoutineConfirm.outcome.yes": "你已确认：现在运行。",
    "status.agent.hxRoutineConfirm.outcome.no": "你选了不运行：这次已跳过。",
    "status.agent.hxRoutineConfirm.outcome.expired": "到下次运行时间前没有回答：这次已跳过。",
    "status.agent.hxRoutineConfirm.outcome.paused": "定时任务已暂停：这次不运行。",
    "status.agent.hxRoutineResult.unverifiedTitle": "定时任务结果未核实",
    "status.agent.hxRoutineResult.missingFile": "「{name}」这次运行说已保存 {files}，但 HXBot 在那里没找到。用结果前请先核对。",
    "status.agent.hxRoutineResult.notReadBack": "「{name}」这次运行改了文件，但 HXBot 没能读回核对。用结果前请先核对。",
    "status.agent.hxRoutineResult.actionUnknown": "「{name}」这次运行发送、发布、付款或删除了内容，HXBot 不知道结果。用之前请先核对。",
    "status.agent.hxRoutineResult.noToolStep": "「{name}」这次应当发送、发布、付款或删除，但一个步骤都没做就结束了。用结果前请先核对。",
}

ROUTINE_EN = {
    "routine.hx.upcoming.title": "Next three runs",
    "routine.hx.upcoming.utc": "{time} UTC",
    "routine.hx.upcoming.gap": "Daylight saving starts: {time} does not exist on this day, so it runs at {actual}.",
    "routine.hx.upcoming.repeated": "Daylight saving ends: {time} occurs twice on this day. It runs once, at the first one ({offset}).",
    "routine.hx.upcoming.paused": "Paused: no upcoming runs.",
    "routine.hx.upcoming.none": "No more runs: the time has passed.",
    "routine.hx.upcoming.chooseZone": "Choose a timezone to see the next three runs.",
    "routine.hx.zone.label": "Timezone",
    "routine.hx.zone.placeholder": "Choose a timezone",
    "routine.hx.zone.required": "Choose the timezone that this routine runs in.",
    "routine.hx.zone.firstHint": "No timezone is registered yet. Choose one once: HXBot remembers it and uses it for new routines.",
    "routine.hx.zone.registeredOption": "{zone} (your registered timezone)",
    "routine.hx.zone.deviceOption": "{zone} (this device)",
    "routine.hx.zone.fixed": "This host keeps the timezone of a saved routine. To use another timezone, create the routine again.",
    "routine.hx.zone.unconfirmed": "Timezone not confirmed: this routine is from an earlier version and runs in {zone}. Choose its timezone to confirm it.",
    "routine.hx.history.skip.previousRunning": "Skipped: the last run was still running",
    "routine.hx.history.skip.planLimit": "Skipped: the plan limit was reached",
    "routine.hx.history.skip.declined": "Skipped: you said no this time",
    "routine.hx.history.skip.expired": "Skipped: no answer before the next time",
    "routine.hx.history.skip.cancelled": "Skipped: the routine was paused",
    "routine.hx.history.skip.unasked": "Skipped: this run needs your yes, and HXBot could not ask",
    "routine.hx.waiting.title": "Waits for your yes: {time}",
    "routine.hx.waiting.each": "this routine asks before each run",
    "routine.hx.waiting.late": "this run makes up for a missed time",
    "routine.hx.waiting.catchUp": "missed {count} times ({from} – {until}), runs once for them",
    "routine.hx.history.missed.offlineSkip": "Host offline: missed {count}, skipped as the routine is set",
    "routine.hx.history.missed.offlineRunOnce": "Host offline: missed {count}, ran once for them",
    "routine.hx.history.missed.asleepSkip": "The computer slept: missed {count}, skipped as the routine is set",
    "routine.hx.history.missed.asleepRunOnce": "The computer slept: missed {count}, ran once for them",
    "routine.hx.history.result.unverified": "Result not verified",
    "routine.hx.history.result.noUpdate": "No update",
    "routine.hx.history.catchUp": "Made up for {count} missed runs",
    "routine.hx.history.filter.label": "Show",
    "routine.hx.history.filter.all": "All",
    "routine.hx.history.filter.succeeded": "Succeeded",
    "routine.hx.history.filter.noUpdate": "No update",
    "routine.hx.history.filter.unverified": "Result not verified",
    "routine.hx.history.filter.failed": "Failed",
    "routine.hx.history.filter.skipped": "Skipped or missed",
    "routine.hx.badge.confirmEach": "Asks before each run",
    "routine.hx.badge.zoneUnconfirmed": "Timezone not confirmed",
    "routine.hx.upgrade.title": "The upgrade to v1.7.5 changed {count} routines. Every routine keeps all of its settings.",
    "routine.hx.upgrade.zone": "Timezone not confirmed: runs in {zone} as before",
    "routine.hx.upgrade.zoneDone": "Timezone confirmed: {zone}",
    "routine.hx.upgrade.confirmEach": "Asks before each run, because it sends, posts, pays or deletes",
    "routine.hx.upgrade.confirmAll": "Confirm these timezones",
    "routine.hx.upgrade.dismiss": "Got it",
    "routine.hx.upgrade.failed": "{count} could not be saved. Open them to choose their timezone.",
    "routine.hx.queue.none": "No queued triggers.",
    "routine.hx.queue.some": "Waiting to run: {count}",
    "routine.hx.queue.running": "The run that already works: {status}. Stop it in the chat.",
    "routine.hx.queue.open": "Open in chat",
}
ROUTINE_ZH = {
    "routine.hx.upcoming.title": "接下来三次",
    "routine.hx.upcoming.utc": "UTC {time}",
    "routine.hx.upcoming.gap": "夏令时开始：这天没有 {time}，顺延到 {actual}。",
    "routine.hx.upcoming.repeated": "夏令时结束：这天 {time} 有两次，只在第一次（{offset}）运行一次。",
    "routine.hx.upcoming.paused": "已暂停，接下来不会运行。",
    "routine.hx.upcoming.none": "没有后续运行：时间已过。",
    "routine.hx.upcoming.chooseZone": "选好时区后，这里显示接下来三次。",
    "routine.hx.zone.label": "时区",
    "routine.hx.zone.placeholder": "选择时区",
    "routine.hx.zone.required": "请选择这个定时任务按哪个时区运行。",
    "routine.hx.zone.firstHint": "还没有登记时区。请选一次，HXBot 会记住，以后新建定时任务默认用它。",
    "routine.hx.zone.registeredOption": "{zone}（你登记的时区）",
    "routine.hx.zone.deviceOption": "{zone}（这台设备）",
    "routine.hx.zone.fixed": "这台主机不能改已保存定时任务的时区。要换时区，请重新建一个。",
    "routine.hx.zone.unconfirmed": "时区未确认：这个定时任务来自旧版本，现在按 {zone} 运行。请选择时区确认。",
    "routine.hx.history.skip.previousRunning": "已跳过：上一次还在运行",
    "routine.hx.history.skip.planLimit": "已跳过：用量到了上限",
    "routine.hx.history.skip.declined": "已跳过：这次你选了不运行",
    "routine.hx.history.skip.expired": "已跳过：到下次时间前没人回答",
    "routine.hx.history.skip.cancelled": "已跳过：定时任务已暂停",
    "routine.hx.history.skip.unasked": "已跳过：这次要你确认，但没能问到你",
    "routine.hx.waiting.title": "等你确认：{time}",
    "routine.hx.waiting.each": "这个定时任务每次运行前都先问你",
    "routine.hx.waiting.late": "这次是补跑错过的一次",
    "routine.hx.waiting.catchUp": "错过 {count} 次（{from}～{until}），补跑一次",
    "routine.hx.history.missed.offlineSkip": "主机离线，错过 {count} 次，按跳过处理",
    "routine.hx.history.missed.offlineRunOnce": "主机离线，错过 {count} 次，按补跑一次处理",
    "routine.hx.history.missed.asleepSkip": "电脑睡眠，错过 {count} 次，按跳过处理",
    "routine.hx.history.missed.asleepRunOnce": "电脑睡眠，错过 {count} 次，按补跑一次处理",
    "routine.hx.history.result.unverified": "结果未核实",
    "routine.hx.history.result.noUpdate": "无更新",
    "routine.hx.history.catchUp": "补上错过的 {count} 次",
    "routine.hx.history.filter.label": "显示",
    "routine.hx.history.filter.all": "全部",
    "routine.hx.history.filter.succeeded": "成功",
    "routine.hx.history.filter.noUpdate": "无更新",
    "routine.hx.history.filter.unverified": "结果未核实",
    "routine.hx.history.filter.failed": "失败",
    "routine.hx.history.filter.skipped": "跳过和错过",
    "routine.hx.badge.confirmEach": "每次运行前先问你",
    "routine.hx.badge.zoneUnconfirmed": "时区未确认",
    "routine.hx.upgrade.title": "升级到 v1.7.5 时改了 {count} 个定时任务。每个定时任务的设置都保留着。",
    "routine.hx.upgrade.zone": "时区未确认：照旧按 {zone} 运行",
    "routine.hx.upgrade.zoneDone": "时区已确认：{zone}",
    "routine.hx.upgrade.confirmEach": "改为每次运行前先问你，因为它会发送、发布、付款或删除",
    "routine.hx.upgrade.confirmAll": "确认这些时区",
    "routine.hx.upgrade.dismiss": "知道了",
    "routine.hx.upgrade.failed": "{count} 个没能保存。请打开它们选择时区。",
    "routine.hx.queue.none": "没有排队的触发。",
    "routine.hx.queue.some": "等着运行：{count} 个",
    "routine.hx.queue.running": "已经在跑的那次：{status}。请在对话里停止它。",
    "routine.hx.queue.open": "在对话中打开",
}

CONVERSATION_EN = {
    "conversation.hx.routineConfirm.run": "Run this time",
    "conversation.hx.routineConfirm.skip": "Skip this time",
    "conversation.hx.routineConfirm.started": "Started: {count}",
    "conversation.hx.routineConfirm.skipped": "Skipped: {count}",
    "conversation.hx.routineConfirm.already": "This question was already answered.",
    "conversation.hx.routineConfirm.failed": "The answer did not go through: {reason}",
    "conversation.hx.routineConfirm.remote": "Answer this on the computer that runs this agent.",
}
CONVERSATION_ZH = {
    "conversation.hx.routineConfirm.run": "运行这一次",
    "conversation.hx.routineConfirm.skip": "这次跳过",
    "conversation.hx.routineConfirm.started": "已开始：{count} 个",
    "conversation.hx.routineConfirm.skipped": "已跳过：{count} 个",
    "conversation.hx.routineConfirm.already": "这个问题已经回答过了。",
    "conversation.hx.routineConfirm.failed": "没有答上：{reason}",
    "conversation.hx.routineConfirm.remote": "请在运行这个助手的电脑上回答。",
}


CONVERSATION_EN.update(SAVE_TURN_EN)
CONVERSATION_ZH.update(SAVE_TURN_ZH)

# CONC-16：裁判自动模式（团队进度卡上的按钮，和对话里的说明）
JUDGE_CONVERSATION_EN = {
    "conversation.hx.teamJudge.auto": "From now on, do as the judge says in cases like this",
    "conversation.hx.teamJudge.autoHint": "Only on this computer. You can go back to being asked each time.",
    "conversation.hx.teamJudge.finish": "Wrap up",
    "conversation.hx.teamJudge.stop": "Stop",
    "conversation.hx.teamJudge.askAgain": "Ask me each time again",
    "conversation.hx.teamJudge.remote": "Change this on the computer that runs this team.",
    "conversation.hx.teamJudge.refused": "This choice is not open now.",
    "conversation.hx.teamJudge.failed": "That did not go through: {reason}",
}
JUDGE_CONVERSATION_ZH = {
    "conversation.hx.teamJudge.auto": "以后这类情况按裁判的办",
    "conversation.hx.teamJudge.autoHint": "只在这台电脑上。随时可以改回每次问你。",
    "conversation.hx.teamJudge.finish": "收尾",
    "conversation.hx.teamJudge.stop": "停",
    "conversation.hx.teamJudge.askAgain": "以后还是每次问我",
    "conversation.hx.teamJudge.remote": "请在运行这个团队的电脑上改。",
    "conversation.hx.teamJudge.refused": "现在不能这样选。",
    "conversation.hx.teamJudge.failed": "没有改成：{reason}",
}
CONVERSATION_EN.update(JUDGE_CONVERSATION_EN)
CONVERSATION_ZH.update(JUDGE_CONVERSATION_ZH)

STATUS_EN.update({
    "status.agent.hxTeam.judgeAuto.went": "Team · The judge says it can go on: {reason} As you set, it did not stop to ask you.",
    "status.agent.hxTeam.judgeAuto.third": "Team · It went on twice already for this cause as the judge said, so this time it asks you.",
    "status.agent.hxTeam.judgeAuto.back": "Team · Twice you stopped a team after the judge let it go on, so cases like this ask you again each time.",
    "status.agent.hxTeam.judgeAuto.on": "Team · From now on, cases like this ({cause}) go as the judge says, on this computer only.",
    "status.agent.hxTeam.judgeAuto.off": "Team · Cases like this ({cause}) ask you each time again.",
    "status.agent.hxTeam.card.judgeOffer": "The judge's view agreed with your choice {count} times in a row.",
    "status.agent.hxTeam.card.judgeWent": "The judge let it go on: {reason}",
    "status.agent.hxTeam.cause.G1": "no progress for a while",
    "status.agent.hxTeam.cause.G2": "work that goes round in circles",
    "status.agent.hxTeam.cause.G3": "work that spreads too wide",
})
STATUS_ZH.update({
    "status.agent.hxTeam.judgeAuto.went": "协作 · 裁判判断可以继续：{reason} 按你的设置，没有停下来问你。",
    "status.agent.hxTeam.judgeAuto.third": "协作 · 同一原因已经按裁判的意见继续过 2 次，这次停下来问你。",
    "status.agent.hxTeam.judgeAuto.back": "协作 · 裁判判断继续之后你两次停了团队，这类情况改回每次问你。",
    "status.agent.hxTeam.judgeAuto.on": "协作 · 以后这类情况（{cause}）按裁判的办，只在这台电脑上。",
    "status.agent.hxTeam.judgeAuto.off": "协作 · 这类情况（{cause}）改回每次问你。",
    "status.agent.hxTeam.card.judgeOffer": "裁判的看法已经连续 {count} 次和你的选择一致。",
    "status.agent.hxTeam.card.judgeWent": "裁判判断继续：{reason}",
    "status.agent.hxTeam.cause.G1": "一段时间没有进展",
    "status.agent.hxTeam.cause.G2": "工作来回转手",
    "status.agent.hxTeam.cause.G3": "工作越分越散",
})


def upstream_files(r) -> None:
    for path, imports, pairs in v175_pairs.FILES:
        for line in imports:
            brand_rename.add_import(r, path, line)
        for old, new in pairs:
            r.replace(path, old, new)


SETTINGS_EN = {
    "settings.hxBoot.sound.title": "Sound of the start film",
    "settings.hxBoot.sound.description": "The film plays on the first start and the first start after each update. Off: it plays without sound.",
    "settings.hxLearned.title": "Times HXBot learned from your choices",
    "settings.hxLearned.description": "Kept on this computer only. A team with no progress is reminded after {minutes} minutes by default (15 minutes to 2 hours); “Continue” gives that team twice the time, “Wrap up” or “Stop” makes work of that kind reminded sooner. HXBot goes on with your computer {seconds} seconds after you stop (3 to 15 seconds), longer when you come back right after it went on.",
    "settings.hxLearned.changed": "Changed: {list}",
    "settings.hxLearned.work": "{work} {minutes} min",
    "settings.hxLearned.none": "Nothing changed yet.",
    "settings.hxLearned.reset": "Use the defaults",
    "settings.hxLearned.failed": "HXBot could not read or change the learned times.",
}
SETTINGS_ZH = {
    "settings.hxBoot.sound.title": "开机视频的声音",
    "settings.hxBoot.sound.description": "第一次打开和每次升级后第一次打开时播放开机视频。关着时没有声音。",
    "settings.hxLearned.title": "按你的选择调整的时间",
    "settings.hxLearned.description": "只存在这台电脑上。团队没进展时默认 {minutes} 分钟提醒一次（15 分钟～2 小时）：你点“继续”，这个团队的间隔改为 2 倍；点“收尾”或“停”，这类工作以后提醒得早一些。你停手 {seconds} 秒后 HXBot 接着操作电脑（3～15 秒）：接着做后你马上又用电脑的次数多了，就多等一会儿。",
    "settings.hxLearned.changed": "已调整：{list}",
    "settings.hxLearned.work": "{work} {minutes} 分钟",
    "settings.hxLearned.none": "还没有调整过。",
    "settings.hxLearned.reset": "恢复默认",
    "settings.hxLearned.failed": "HXBot 读不到或改不了这些时间。",
}


MOBILE_SETTINGS_EN = {
    "mobile.settings.appearance.hxBootSound": "Sound of the start film",
    "mobile.settings.appearance.hxBootSoundFooter": "The film plays on the first start and the first start after each update. Off: it plays without sound.",
}
MOBILE_SETTINGS_ZH = {
    "mobile.settings.appearance.hxBootSound": "开机视频的声音",
    "mobile.settings.appearance.hxBootSoundFooter": "第一次打开和每次更新后第一次打开时播放开机视频。关着时没有声音。",
}


def text(r) -> None:
    """界面文字（英文、中文在这里；其他 13 种语言在 hx/translations_v175.py）。"""
    r.add_messages(f"{MESSAGES}/en/error/backend.ts", "\n});\n", ERROR_EN)
    r.add_messages(f"{MESSAGES}/zh/error/backend.ts", "\n} as const satisfies", ERROR_ZH)
    r.add_messages(f"{MESSAGES}/en/status/agent.ts", "\n});\n", STATUS_EN)
    r.add_messages(f"{MESSAGES}/zh/status/agent.ts", "\n} as const satisfies", STATUS_ZH)
    r.add_messages(f"{MESSAGES}/en/conversation.ts", "\n});\n", CONVERSATION_EN)
    r.add_messages(f"{MESSAGES}/zh/conversation.ts", "\n} as const satisfies", CONVERSATION_ZH)
    r.add_messages(f"{MESSAGES}/en/routine.ts", "\n});\n", ROUTINE_EN)
    r.add_messages(f"{MESSAGES}/zh/routine.ts", "\n} as const satisfies", ROUTINE_ZH)
    r.add_messages(f"{MESSAGES}/en/error/workflow.ts", "\n});\n", WORKFLOW_ERROR_EN)
    r.add_messages(f"{MESSAGES}/zh/error/workflow.ts", "\n} as const satisfies", WORKFLOW_ERROR_ZH)
    r.add_messages(f"{MESSAGES}/en/workflow.ts", "\n});\n", WORKFLOW_EN)
    r.add_messages(f"{MESSAGES}/zh/workflow.ts", "\n} as const satisfies", WORKFLOW_ZH)
    r.add_messages(f"{MESSAGES}/en/settings.ts", "\n});\n", SETTINGS_EN)
    r.add_messages(f"{MESSAGES}/zh/settings.ts", "\n} as const satisfies", SETTINGS_ZH)
    r.add_messages(f"{MESSAGES}/en/mobile/settings.ts", "\n});\n", MOBILE_SETTINGS_EN)
    r.add_messages(f"{MESSAGES}/zh/mobile/settings.ts", "\n} as const satisfies", MOBILE_SETTINGS_ZH)


def apply(r) -> None:
    upstream_files(r)
    text(r)
