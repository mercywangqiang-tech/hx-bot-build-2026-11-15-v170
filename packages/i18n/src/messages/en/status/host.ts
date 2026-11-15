import { defineMessages } from "../../../message";

export const messages = defineMessages("status.host", {
  // Status lines of the WebRTC host.
  "status.host.registered": "Registered this HXBot for WebRTC access.",
  "status.host.keyRotated": "Server key changed. Paired devices stay paired.",
  "status.host.identityUpdated": "Server identity updated.",
  "status.host.starting": "Starting the WebRTC host…",
  "status.host.ready": "This HXBot is ready for WebRTC connections.",
  "status.host.signalLost": "Other devices cannot reach this HXBot now. It connects again.",
  "status.host.stopping": "Making this HXBot private…",
  "status.host.private": "This HXBot is private.",
  "status.host.removed": "This HXBot was removed from your account. Publish it again to share it.",
});
