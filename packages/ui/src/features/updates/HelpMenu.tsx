import { BookOpen, CircleQuestionMark, Download, DropdownMenu, Megaphone, MotionTooltip, Server } from "@hxbot/ui";
import { createSignal } from "solid-js";
import { useText } from "../../text";

// HXBot: every item of the Help menu opens the HXBot server (the portal on bot.hxallai.com)
// or writes to 弘犀智能: the guide, the server (what a server is and how invite links work), the
// latest installers, and feedback by email. HXBot's release notes, changelog and Discord community
// are not part of HXBot. The callers keep their names: the changelog item opens the downloads, and
// the item that opened HXBot's Discord opens the server page.

/** One line of the What's new list: the headline of a release note and the date of its release. */
export interface HelpMenuNews {
  headline: string;
  /** `YYYY-MM-DD`, as the release notes write it. */
  date: string;
}

export interface HelpMenuProps {
  /** HXBot shows no What's new list. The callers still pass it. */
  news: readonly HelpMenuNews[];
  /** The class of the button that opens the menu, so it matches the buttons around it. */
  triggerClass?: string;
  /** Called when the menu opens. */
  onOpen?: () => void;
  onOpenWhatsNew: () => void;
  /** HXBot: the downloads on the HXBot server. */
  onOpenChangelog: () => void;
  /** HXBot: the guide on the HXBot server. */
  onOpenGuides: () => void;
  /** HXBot: the server page (servers and invite links) on the HXBot server. */
  onOpenDiscord: () => void;
  onSendFeedback: () => void;
}

/** The Help menu of HXBot. */
export function HelpMenu(props: HelpMenuProps) {
  const { t } = useText();
  const [open, setOpen] = createSignal(false);
  return (
    <DropdownMenu.Root
      placement="right-end"
      gutter={10}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) props.onOpen?.();
      }}
    >
      <MotionTooltip content={t("app.help.label")} suppressed={open()}>
        <DropdownMenu.Trigger class={props.triggerClass} aria-label={t("app.help.label")}>
          <CircleQuestionMark aria-hidden="true" />
        </DropdownMenu.Trigger>
      </MotionTooltip>
      <DropdownMenu.Portal>
        <DropdownMenu.Content class="agent-context-menu help-menu" aria-label={t("app.help.label")}>
          <DropdownMenu.Item onSelect={() => props.onOpenGuides()}>
            <BookOpen class="agent-context-icon size-4" aria-hidden="true" />
            <span>{t("app.help.guides")}</span>
          </DropdownMenu.Item>
          <DropdownMenu.Item onSelect={() => props.onOpenDiscord()}>
            <Server class="agent-context-icon size-4" aria-hidden="true" />
            <span>{t("app.help.discord")}</span>
          </DropdownMenu.Item>
          <DropdownMenu.Item onSelect={() => props.onOpenChangelog()}>
            <Download class="agent-context-icon size-4" aria-hidden="true" />
            <span>{t("app.help.changelog")}</span>
          </DropdownMenu.Item>
          <DropdownMenu.Separator />
          <DropdownMenu.Item onSelect={() => props.onSendFeedback()}>
            <Megaphone class="agent-context-icon size-4" aria-hidden="true" />
            <span>{t("account.menu.sendFeedback")}</span>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
