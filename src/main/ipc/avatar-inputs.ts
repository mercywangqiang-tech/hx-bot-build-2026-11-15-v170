import { isAvatarMimeType, isValidAvatarImage } from "@hxbot/contracts/avatar-images";
import type { AvatarImageInput } from "@hxbot/contracts/ipc";
import { isString } from "@hxbot/contracts/runtime-values";
import { sourceText } from "@hxbot/i18n/source";
import { isObject } from "./validation";

export function parseAvatarImage(value: unknown): AvatarImageInput | null {
  if (value === null) return null;
  if (
    !isObject(value) ||
    !isString(value.mimeType) ||
    !isAvatarMimeType(value.mimeType) ||
    !(value.bytes instanceof Uint8Array) ||
    !isValidAvatarImage(value.mimeType, value.bytes)
  ) {
    throw new Error(sourceText("error.team.logoInvalid"));
  }
  return { mimeType: value.mimeType, bytes: value.bytes };
}
