// HXBot：聊天框发送前拦下像密码、密钥的内容（桌面端、网页版）。
//
// A message that seems to hold a password, a key or a token waits in the composer: the notice asks
// the user to save it in the 保密箱 (the Vault) instead, or to send it anyway. "Send anyway" lets
// exactly that text through once; any change to the text asks again. Nothing leaves this computer
// for the check: hx-secret-detect.ts runs here.
import { findHxSecrets } from "@hxbot/contracts/hx-secret-detect";
import { createSignal } from "solid-js";

interface HeldSecretMessage {
  /** The text that waits. The notice shows while the draft still has this text. */
  text: string;
  /** Sends it again, past the check, when the user chooses Send anyway. */
  resume: () => void;
}

const [held, setHeld] = createSignal<HeldSecretMessage | null>(null);
/** The text the user chose to send anyway. Used once. */
let allowedText: string | null = null;
let vaultOpener: ((serverId: string, trigger: HTMLElement | null) => void) | null = null;

/** The message that waits for the user, or null. */
export const heldSecretMessage = held;

/**
 * True when `text` seems to hold a secret and now waits for the user: the caller does not send it.
 * `resume` runs the same send again after Send anyway.
 */
export function holdSecretMessage(text: string, resume: () => void): boolean {
  if (allowedText !== null && allowedText === text) {
    allowedText = null;
    setHeld(null);
    return false;
  }
  allowedText = null;
  if (findHxSecrets(text).length === 0) {
    setHeld(null);
    return false;
  }
  setHeld({ text, resume });
  return true;
}

/** Sends the waiting message as it is. */
export function sendHeldSecretAnyway(): void {
  const message = held();
  if (!message) return;
  allowedText = message.text;
  setHeld(null);
  message.resume();
}

/** Closes the notice; the text stays in the composer for the user to change. */
export function dismissHeldSecret(): void {
  setHeld(null);
}

/** The workspace that can open the Vault section of server settings sets this; it returns the reset. */
export function registerHxVaultOpener(open: (serverId: string, trigger: HTMLElement | null) => void): () => void {
  vaultOpener = open;
  return () => {
    if (vaultOpener === open) vaultOpener = null;
  };
}

/** True when this window can open the Vault. */
export function canOpenHxVault(): boolean {
  return vaultOpener !== null;
}

/** Opens the Vault section of the server's settings, where the user saves the secret. */
export function openHxVault(serverId: string, trigger: HTMLElement | null): void {
  vaultOpener?.(serverId, trigger);
}
