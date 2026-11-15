import type { AppThemePalette } from "@hxbot/contracts/app-appearance";

/** `color-mix` of one palette color into transparency, as the base palettes use translucent ink. */
function clear(color: string, percent: number): string {
  return `color-mix(in srgb, ${color} ${percent}%, transparent)`;
}

function mix(color: string, other: string, percent: number): string {
  return `color-mix(in srgb, ${color}, ${other} ${percent}%)`;
}

/**
 * The tokens that a palette sets, over the light or dark palette that its scheme names. A palette
 * gives twelve colors; the other tokens of each family come from them, as the base palettes make
 * their hover, soft and strong steps from one color. Tokens not listed here keep the base value:
 * illustrations, provider logos, charts and the file colors stay as they are in each scheme.
 *
 * Cards, sheets and controls are a step above the canvas: lighter than it in both base palettes. A
 * dark palette gives that step as `surface`. A light theme has no color lighter than its background
 * (Catppuccin Latte's `surface` is darker), so a light palette makes the step from its canvas and
 * white, as the base light palette is white over a grey canvas, and uses `surface` for the tab bar.
 */
function paletteTokens({ scheme, colors }: AppThemePalette): Record<string, string> {
  const raised = scheme === "light" ? mix(colors.canvas, "#ffffff", 70) : colors.surface;
  const tabsBar = scheme === "light" ? mix(colors.canvas, colors.surface, 30) : colors.surface;
  return {
    "--hxbot-bg-canvas": colors.canvas,
    "--hxbot-bg-canvas-clear": clear(colors.canvas, 0),
    "--hxbot-bg-frame": colors.frame,
    "--hxbot-bg-sidebar": colors.sidebar,
    "--hxbot-bg-native-sidebar": colors.sidebar,
    "--hxbot-bg-sheet": raised,
    "--hxbot-bg-sheet-inset": colors.frame,
    "--hxbot-bg-grouped": raised,
    "--hxbot-bg-surface": raised,
    "--hxbot-bg-surface-raised": mix(raised, colors.text, 3),
    "--hxbot-bg-control": raised,
    "--hxbot-bg-control-hover": mix(raised, colors.text, 4),
    "--hxbot-bg-control-active": mix(raised, colors.text, 8),
    "--hxbot-tabs-bar-bg": tabsBar,
    "--hxbot-tabs-pill-bg": scheme === "light" ? raised : mix(colors.surface, colors.text, 8),
    "--hxbot-marketplace-detail-bg": colors.frame,
    "--hxbot-bg-overlay": clear(colors.canvas, 92),
    "--hxbot-bg-glass": clear(raised, 76),
    "--hxbot-scroll-edge-overlay": clear(colors.canvas, 72),

    "--hxbot-border": clear(colors.border, 35),
    "--hxbot-border-strong": clear(colors.border, 50),
    "--hxbot-border-grouped": colors.border,
    "--hxbot-dialog-ring": clear(colors.border, 70),
    "--hxbot-image-outline": clear(colors.border, 60),
    "--hxbot-hover": clear(colors.text, 5),

    "--hxbot-text-primary": colors.text,
    "--hxbot-text-secondary": mix(colors.text, colors.textMuted, 25),
    "--hxbot-text-muted": colors.textMuted,
    "--hxbot-text-dim": mix(colors.textMuted, colors.canvas, 30),
    "--hxbot-text-placeholder": colors.textMuted,
    "--hxbot-text-readable": colors.textMuted,
    "--hxbot-text-grouped-secondary": colors.textMuted,
    "--hxbot-settings-text-muted": colors.textMuted,

    // The inverted element (the default button, a checked switch, the user's bubble) is the text
    // color on the canvas, as it is in both base palettes.
    "--hxbot-surface-light": colors.text,
    "--hxbot-text-on-light": colors.canvas,
    "--hxbot-text-muted-on-light": clear(colors.canvas, 64),
    "--hxbot-text-dim-on-light": clear(colors.canvas, 40),
    "--hxbot-border-on-light": clear(colors.canvas, 16),

    "--hxbot-accent": colors.accent,
    "--hxbot-accent-hover": mix(colors.accent, colors.text, 15),
    "--hxbot-accent-text": colors.accent,
    "--hxbot-accent-soft": clear(colors.accent, 16),
    "--hxbot-accent-strong": clear(colors.accent, 34),
    "--hxbot-text-on-accent": colors.accentForeground,

    "--hxbot-success": colors.success,
    "--hxbot-success-text": colors.success,
    "--hxbot-success-soft": clear(colors.success, 14),
    "--hxbot-success-wash": clear(colors.success, 6),
    "--hxbot-warning": colors.warning,
    "--hxbot-warning-text": colors.warning,
    "--hxbot-warning-soft": clear(colors.warning, 14),
    "--hxbot-danger": colors.danger,
    "--hxbot-danger-hover": mix(colors.danger, colors.text, 15),
    "--hxbot-danger-text": colors.danger,
    "--hxbot-danger-soft": clear(colors.danger, 14),
    "--hxbot-danger-soft-hover": clear(colors.danger, 22),
    "--hxbot-danger-focus": clear(colors.danger, 36),
    "--hxbot-danger-border": clear(colors.danger, 45),
  };
}

let applied: string[] = [];

/**
 * Sets the palette tokens on the root element, or removes them for null. Inline properties on the
 * root win over `tokens.css` and `tokens-light.css`, so the base palette shows again once they go.
 * The preload let only hex colors through, so each value is a color or a `color-mix` of colors.
 */
export function applyThemePalette(palette: AppThemePalette | null): void {
  const style = document.documentElement.style;
  for (const name of applied) style.removeProperty(name);
  applied = [];
  if (palette === null) return;
  for (const [name, value] of Object.entries(paletteTokens(palette))) {
    style.setProperty(name, value);
    applied.push(name);
  }
}
