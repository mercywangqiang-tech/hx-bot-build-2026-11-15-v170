declare module "@hxbot/renderer-preview" {
  import type { JSX } from "@solidjs/web";

  export interface HxBotPlaygroundProps {
    variant?: "default" | "landing";
    theme?: "dark" | "light";
  }

  export function HxBotPlayground(props: HxBotPlaygroundProps): JSX.Element;
}
