import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/computerUse";

export const messages = {
  // Computer Use settings, the permission help window, and the window highlight.
  "computerUse.permission.screenRecording.title": "画面収録",
  "computerUse.permission.screenRecording.description":
    "HXBot がスクリーンショットを撮れるようにします。クリックと入力はこれがなくても使えます。",
  "computerUse.permission.screenRecording.pane": "画面収録とシステムオーディオ録音",
  "computerUse.permission.accessibility.title": "アクセシビリティ",
  "computerUse.permission.accessibility.description":
    "HXBot がクリックと入力をできるようにします。その後、HXBot が画面収録を自分でオンにします。",
  "computerUse.permission.accessibility.pane": "アクセシビリティ",
  "computerUse.error.check": "HXBot は Computer Use を確認できませんでした。",
  "computerUse.error.openSettings": "HXBot はシステム設定を開けませんでした。",
  "computerUse.error.startDriver": "HXBot は Computer Use ドライバーを起動できませんでした。",
  "computerUse.checkAgain": "もう一度確認",
  "computerUse.checking": "Computer Use を確認しています",
  "computerUse.unavailable.title": "Computer Use はまだ利用できません",
  "computerUse.permissions.title": "システムの権限",
  "computerUse.permissions.description":
    "権限は macOS が管理します。「許可」の後、HXBot はオンにできるものを自分でオンにします。あなたはパスワードか Touch ID を使うだけです。",
  "computerUse.ready.title": "Computer Use の準備ができました",
  "computerUse.ready.description":
    "HXBot はこのコンピューターのアプリを見て操作できます。このシステムでは追加の権限は必要ありません。",
  "computerUse.openSettingsFailed.title": "システム設定を開けませんでした",
  "computerUse.compact.title": "Computer Use を有効にする",
  "computerUse.compact.description": "HXBot がこのコンピューターのアプリを見て操作できるようにします。",
  "computerUse.granted": "許可済み",
  "computerUse.opening": "開いています…",
  "computerUse.manage": "管理",
  "computerUse.grant": "許可",
  "computerUse.manageLabel": "{permission}を管理",
  "computerUse.grantLabel": "{permission}を許可",
  "computerUse.help.title": "{permission}をオンにする",
  "computerUse.help.paneOpen": "システム設定で「{pane}」が開いています。",
  "computerUse.help.dragLabel": "{name} をシステム設定にドラッグするか、押して Finder に表示します",
  "computerUse.help.dragToAdd": "ドラッグして追加",
  "computerUse.help.findInList": "リストで {name} を探してください。",
  "computerUse.help.dragIntoList": "{name}.app をリストにドラッグしてください。",
  "computerUse.help.turnOn": "スイッチをオンにしてください。",
  "computerUse.help.showInFinder": "Finder に表示",
  "computerUse.help.revealFailed": "アプリケーションを Finder に表示できませんでした。",
  "computerUse.help.dragFailed": "アプリケーションをドラッグできませんでした。",
  "computerUse.highlight.working": "HXBot が {title} で作業しています",
  "computerUse.help.hxPressesScreen":
    "HXBot にアクセシビリティの許可があると、このスイッチを自分でオンにします。macOS に求められたら、パスワードを入力するか Touch ID を使ってください。",
  "computerUse.help.hxThenScreen":
    "このスイッチは macOS の決まりで、あなたしかオンにできません。その後、HXBot が画面収録を自分でオンにします。",
  "computerUse.hxAskTitle": "HXBot に許可が必要です",
  "computerUse.hxAskBody":
    "クリックするとシステム設定のそのページが開きます。ほかのアプリで作業している間、HXBot は自分では開きません。",
} as const satisfies PartialTranslation<typeof source>;
