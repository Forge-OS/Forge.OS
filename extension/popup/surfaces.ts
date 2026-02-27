import type { CSSProperties } from "react";
import { C, mono } from "../../src/tokens";

type Tone = "default" | "accent" | "warn" | "danger" | "purple" | "success";

const TONE_COLOR: Record<Tone, string> = {
  default: C.border,
  accent: C.accent,
  warn: C.warn,
  danger: C.danger,
  purple: C.purple,
  success: C.ok,
};

const TONE_GLOW: Record<Tone, string> = {
  default: "rgba(143,160,181,0.08)",
  accent: "rgba(57,221,182,0.12)",
  warn: "rgba(247,178,103,0.12)",
  danger: "rgba(255,93,122,0.12)",
  purple: "rgba(143,123,255,0.12)",
  success: "rgba(57,221,182,0.1)",
};

export const popupTabStack: CSSProperties = {
  padding: "13px 15px 15px",
  display: "flex",
  flexDirection: "column",
  gap: 11,
  minWidth: 0,
};

export function popupShellBackground(): CSSProperties {
  return {
    backgroundColor: C.bg,
    backgroundImage: [
      "radial-gradient(120% 95% at 50% -8%, rgba(57,221,182,0.18) 0%, rgba(57,221,182,0.05) 40%, transparent 72%)",
      "radial-gradient(88% 86% at 92% 100%, rgba(57,221,182,0.12) 0%, transparent 70%)",
      "radial-gradient(80% 90% at 8% 88%, rgba(23,64,74,0.3) 0%, transparent 74%)",
      "linear-gradient(165deg, #0b141f 0%, #070e16 52%, #05090f 100%)",
      "repeating-linear-gradient(0deg, transparent 0px, transparent 31px, rgba(57,221,182,0.06) 32px)",
      "repeating-linear-gradient(90deg, transparent 0px, transparent 31px, rgba(57,221,182,0.05) 32px)",
    ].join(", "),
    backgroundSize: "auto, auto, auto, auto, 32px 32px, 32px 32px",
    backgroundPosition: "center, center, center, center, center, center",
  };
}

export function sectionCard(tone: Tone = "default", compact = false): CSSProperties {
  const borderColor = TONE_COLOR[tone];
  const glow = TONE_GLOW[tone];
  return {
    background: `linear-gradient(155deg, rgba(11,17,24,0.92) 0%, rgba(8,13,20,0.86) 100%)`,
    border: `1px solid ${tone === "default" ? C.border : `${borderColor}32`}`,
    borderRadius: 12,
    padding: compact ? "10px 12px" : "12px 14px",
    boxShadow: `inset 0 1px 0 rgba(255,255,255,0.04), 0 10px 22px rgba(0,0,0,0.22)`,
    position: "relative",
    overflow: "hidden",
    minWidth: 0,
    overflowWrap: "anywhere",
    backgroundImage: [
      `radial-gradient(circle at 100% 0%, ${glow}, transparent 46%)`,
      "linear-gradient(155deg, rgba(11,17,24,0.92) 0%, rgba(8,13,20,0.86) 100%)",
    ].join(", "),
  };
}

export function insetCard(): CSSProperties {
  return {
    background: "linear-gradient(180deg, rgba(5,7,10,0.62), rgba(7,11,16,0.72))",
    border: `1px solid ${C.border}`,
    borderRadius: 10,
    padding: "10px 12px",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.02)",
    minWidth: 0,
    overflowWrap: "anywhere",
  };
}

export const sectionKicker: CSSProperties = {
  fontSize: 8,
  color: C.dim,
  letterSpacing: "0.14em",
  fontWeight: 700,
  ...mono,
};

export const sectionTitle: CSSProperties = {
  fontSize: 10,
  color: C.text,
  fontWeight: 700,
  letterSpacing: "0.08em",
  ...mono,
};

export function divider(opacity = 1): CSSProperties {
  return {
    height: 1,
    background: `rgba(33,48,67,${0.9 * opacity})`,
  };
}

export function outlineButton(color = C.dim, strong = false): CSSProperties {
  return {
    background: strong
      ? `linear-gradient(180deg, rgba(14,22,32,0.9), rgba(9,14,20,0.9))`
      : "rgba(16,25,35,0.55)",
    border: `1px solid ${color === C.dim ? C.border : `${color}40`}`,
    borderRadius: 8,
    color,
    cursor: "pointer",
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.08em",
    ...mono,
    boxShadow: strong ? "0 6px 14px rgba(0,0,0,0.18)" : undefined,
    whiteSpace: "normal",
    lineHeight: 1.2,
    textAlign: "center",
  };
}

export function primaryButton(active = true): CSSProperties {
  return {
    background: active
      ? `linear-gradient(90deg, ${C.accent}, #7BE9CF)`
      : "rgba(33,48,67,0.55)",
    color: active ? "#04110E" : C.dim,
    border: "none",
    borderRadius: 8,
    cursor: active ? "pointer" : "not-allowed",
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.08em",
    ...mono,
    boxShadow: active ? "0 8px 18px rgba(57,221,182,0.16)" : undefined,
    whiteSpace: "normal",
    lineHeight: 1.2,
    textAlign: "center",
  };
}

export function monoInput(hasError = false): CSSProperties {
  return {
    width: "100%",
    boxSizing: "border-box" as const,
    background: "linear-gradient(180deg, rgba(8,13,20,0.82), rgba(9,14,21,0.9))",
    border: `1px solid ${hasError ? C.danger : C.border}`,
    borderRadius: 8,
    padding: "9px 11px",
    color: C.text,
    fontSize: 10,
    ...mono,
    outline: "none",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.02)",
    minWidth: 0,
  };
}

export function chip(color: string, filled = false): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    background: filled ? `${color}1A` : "rgba(16,25,35,0.5)",
    border: `1px solid ${color}33`,
    borderRadius: 999,
    padding: "2px 7px",
    color,
    fontSize: 8,
    fontWeight: 700,
    letterSpacing: "0.08em",
    ...mono,
  };
}
