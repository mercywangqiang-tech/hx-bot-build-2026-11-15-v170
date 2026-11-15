import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/startup";

export const messages = {
  "startup.failedTitle": "HXBot を起動できませんでした",
  "startup.failedBody":
    "{message}\n\nお使いのデータは初期化も上書きもされていません。復旧の手順はトラブルシューティングガイドをご覧ください。",
  "startup.archiveChangedTitle": "HXBot のファイルが変更されました",
  "startup.archiveChangedBody":
    "別のプログラムが HXBot のファイル app.asar を変更しました。HXBot は今は動作していますが、終了すると次は起動しません。\n\n修復するには、HXBot をもう一度インストールしてください。ローカルのデータはそのまま残ります。",
  "startup.archiveChangedDownload": "HXBot をダウンロード",
  "startup.newerDataUpdatingTitle": "HXBot を更新しています",
  "startup.newerDataUpdatingBody":
    "新しいバージョンの HXBot がデータを保存しました。HXBot は最新バージョンをインストールしてから、もう一度開きます。\n\nローカルデータはリセットも上書きもされていません。",
  "startup.newerDataTitle": "最新の HXBot をインストールしてください",
  "startup.newerDataBody":
    "新しいバージョンの HXBot がデータを保存したため、このバージョン ({version}) では開けません。データを開くには最新バージョンをインストールしてください。\n\nローカルデータはリセットも上書きもされていません。",
  "startup.newerDataDownload": "HXBot をダウンロード",
  "startup.newerDataGuide": "ガイドを開く",
  "startup.newerDataQuit": "終了",
  "startup.hxMoveTitle": "HXBot を「アプリケーション」フォルダに移動しますか？",
  "startup.hxMoveBody":
    "HXBot は「アプリケーション」フォルダの外（「ダウンロード」やディスクイメージなど）で動いています。このとき macOS は一時的な場所から起動するため、権限とアップデートがうまく働きません。HXBot が自分で移動して開き直します。",
  "startup.hxMoveNow": "移動",
  "startup.hxMoveLater": "あとで",
  "startup.hxMoveFailed":
    "HXBot は自分で移動できませんでした。HXBot を終了して、Finder で「アプリケーション」フォルダにドラッグしてください。",
} as const satisfies PartialTranslation<typeof source>;
