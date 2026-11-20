import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/workflow";

export const messages = {
  "error.workflow.missing": "이 워크플로는 더 이상 존재하지 않아요.",
  "error.workflow.versionMissing": "이 버전의 워크플로는 더 이상 존재하지 않아요.",
  "error.workflow.annotation": "텍스트, 메모, 도형에는 연결을 추가할 수 없어요.",
  "error.workflow.port": "단계가 이 유형의 입력을 받을 수 없어요.",
  "error.workflow.branch": "‘예’와 ‘아니요’ 연결은 조건에만 있을 수 있어요.",
  "error.workflow.conditionBranch": "조건에서 나가는 각 연결은 ‘예’ 또는 ‘아니요’여야 해요.",
  "error.workflow.duplicateEdge": "이 두 단계에는 이미 이 연결이 있어요.",
  "error.workflow.serverTooOld":
    "이 서버는 워크플로를 지원하지 않아요. 서버를 실행하는 컴퓨터에서 HXBot을 업데이트하세요.",
  "error.workflow.nodeUnsupported": "이 버전의 HXBot은 아직 이미지, 파일, 메시지 단계를 실행할 수 없어요.",
  "error.workflow.interrupted": "이 단계가 실행되는 동안 HXBot이 중지됐어요. 다시 실행해 주세요.",
  "error.workflow.agentMissing": "이 단계의 에이전트를 선택하세요.",
  "error.workflow.handoffFailed": "HXBot이 이 단계를 에이전트에 보내지 못했어요.",
  "error.workflow.agentStepEnded": "에이전트가 답하기 전에 이 단계의 메시지가 삭제됐어요.",
  "error.workflow.conditionUnclear": "모델이 ‘예’ 또는 ‘아니요’로 답하지 않았어요.",
  "error.workflow.modelFailed": "모델이 답할 수 없었어요. 단계를 다시 실행해 주세요.",
  "error.workflow.modelBusy": "다른 모델 요청이 실행 중이에요. 잠시 후 단계를 다시 실행해 주세요.",
  "error.workflow.stepMissing": "이 단계는 더 이상 존재하지 않아요.",
  "error.workflow.nodeMissing": "이 단계는 워크플로에 없어요.",
  "error.workflow.runMissing": "이 실행은 더 이상 존재하지 않아요.",
  "error.workflow.notRetryable": "실패했거나 중지된 단계만 다시 실행할 수 있어요.",
  "error.workflow.noDecision": "이 단계는 결정을 기다리고 있지 않아요.",
  "error.workflow.outputPlaceMissing": "이 출력의 메시징 위치를 선택하세요.",
  "error.workflow.outputChannelMissing": "이 출력의 채널을 선택하세요.",
  "error.workflow.outputChannelFailed": "HXBot이 결과를 채널에 게시하지 못했습니다. 단계를 다시 실행하세요.",
  "error.workflow.discordNoMessage":
    "이 출력은 실행을 시작한 Discord 메시지에 작동합니다. Discord 멘션으로 실행을 시작하거나 채널에 게시를 선택하세요.",
  "error.workflow.slackNoMessage":
    "이 출력은 실행을 시작한 Slack 메시지에 작동합니다. Slack 멘션으로 실행을 시작하거나 채널에 게시를 선택하세요.",
  "error.workflow.telegramNoMessage":
    "이 출력은 실행을 시작한 Telegram 메시지에 작동합니다. Telegram 멘션으로 실행을 시작하거나 채팅에 게시를 선택하세요.",
  "error.workflow.outputConnectionOff": "이 출력의 메시징 연결이 꺼져 있거나 삭제됐어요. 위치를 다시 선택하세요.",
  "error.workflow.outputNotRunning": "메시징 연결이 지금 실행되고 있지 않아요. 실행될 때 다시 시도해 주세요.",
  "error.workflow.outputRefused": "위치에서 게시를 거부했어요. HXBot이 그곳에 게시할 수 있는지 확인하세요.",
  "error.workflow.outputUncertain":
    "게시가 도중에 멈췄어요. 일부가 이미 그 위치에 있을 수 있어요. 다시 시도하기 전에 확인하세요.",
  "error.workflow.tooLarge":
    "이 워크플로는 너무 커서 저장할 수 없어요. 그림이나 긴 텍스트를 일부 삭제한 후 다시 시도해 주세요.",
  "error.workflow.tooLargeToSend":
    "이 워크플로는 너무 커서 다른 컴퓨터로 보낼 수 없어요. 서버를 실행하는 컴퓨터에서 여세요.",
  "error.workflow.webhookMissing": "이 단계는 웹훅 트리거가 아니에요. 워크플로를 저장한 후 다시 시도해 주세요.",
  "error.workflow.githubActionMissing": "이 출력이 GitHub에서 할 동작을 선택하세요.",
  "error.workflow.githubRepositoryMissing": "이 출력의 저장소를 선택하세요.",
  "error.workflow.githubItemMissing":
    "이 출력에는 이슈나 풀 리퀘스트가 없어요. GitHub 이벤트에서 실행을 시작하거나 입력에 번호를 넣으세요.",
  "error.workflow.githubPullRequestOnly": "이 동작은 풀 리퀘스트에서만 작동해요.",
  "error.workflow.githubTextMissing": "이 출력에는 보낼 텍스트가 없어요. 텍스트를 작성하는 단계를 연결하세요.",
  "error.workflow.githubEventText":
    "이 출력은 트리거의 원본 이벤트를 보낼 수 없어요. 트리거와 이 출력 사이에 에이전트를 넣으세요.",
  "error.workflow.githubChoiceMissing": "이 출력의 레이블 또는 사용자를 선택하세요.",
  "error.workflow.githubChoseNothing": "모델이 이 저장소의 레이블이나 사용자를 하나도 선택하지 않았어요.",
  "error.workflow.githubNotConnected": "이 워크플로를 실행하는 컴퓨터에서 GitHub를 연결하세요.",
  "error.workflow.githubNoAccess":
    "HXBot GitHub App이 이 저장소나 항목을 볼 수 없어요. GitHub를 열고 액세스 권한을 주세요.",
  "error.workflow.githubNoWrite":
    "HXBot GitHub App이 이 저장소를 변경할 수 없어요. GitHub를 열고 액세스 권한을 주세요.",
  "error.workflow.githubLocked": "이 대화는 GitHub에서 잠겨 있어요.",
  "error.workflow.githubRefused": "GitHub가 변경을 거부했어요: {detail}",
  "error.workflow.githubUnreachable": "HXBot이 GitHub에 연결하지 못했어요. 단계를 다시 실행해 주세요.",
  "error.workflow.githubUncertain":
    "변경이 도중에 멈췄어요. GitHub에 이미 반영됐을 수 있어요. 단계를 다시 실행하기 전에 GitHub를 확인하세요.",
  "error.workflow.githubNoEvent": "이 트리거가 시작할 이슈나 풀 리퀘스트가 GitHub에 없어요.",
  "error.workflow.hxStepNoAgent": "이 단계의 에이전트를 고르세요.",
  "error.workflow.hxStepInvalid": "이 단계의 설정이 맞지 않습니다: {reason}",
  "error.workflow.hxStepUnavailable": "HXBot이 아직 시작하는 중입니다. 잠시 후 단계를 다시 실행하세요.",
  "error.workflow.hxStepComputerUseOff": "{agent}의 컴퓨터 제어가 꺼져 있습니다. 에이전트 설정에서 켠 다음 계속하세요.",
  "error.workflow.hxActionUnknown":
    "HXBot이 {action}을(를) 하는 도중에 멈춰서 결과를 알 수 없습니다. 먼저 확인하세요. “이 단계부터 계속”을 누르면 다시 실행합니다.",
  "error.workflow.hxActionFailed": "{action} 호출이 되지 않았습니다: {reason}",
  "error.workflow.hxTeamFailed": "팀이 끝내지 못했습니다: {reason}",
  "error.workflow.hxConnectionOff": "이 출력의 메시지 연결이 꺼져 있습니다. 켠 다음 계속하세요.",
  "error.workflow.hxLimitLoops": "한도 초과: 반복이 {count}번 실행되어 실행을 멈췄습니다.",
  "error.workflow.hxLimitSteps": "한도 초과: 실행이 {count}단계에 이르러 멈췄습니다.",
  "error.workflow.hxLimitSeconds": "한도 초과: 반복이 {count}초보다 오래 실행되어 실행을 멈췄습니다.",
  "error.workflow.hxTurnNothing": "이번 턴에는 저장할 컴퓨터 제어, 앱 스킬, 팀 단계가 없습니다.",
} as const satisfies PartialTranslation<typeof source>;
