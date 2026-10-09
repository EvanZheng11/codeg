import type React from "react"

import { STORAGE_KEY_CHAT_CONTENT_WIDTH } from "./appearance-script"

/** The `<html>` custom property the `chat-content-w` utility reads. */
export const CHAT_CONTENT_WIDTH_VAR = "--chat-content-width"

/** Floor for a dragged content width. */
export const CHAT_CONTENT_MIN = 640

/**
 * Blank strip (px) kept on EACH side of the chat column, whatever the width.
 * The column may never run edge to edge: the drag handles sit just inside its
 * edges, and a handle pushed onto the window border would lose every later
 * press to the window's own resize grip (4px on Linux, ~8px on Windows).
 * Exposed to CSS as `--chat-gutter` on the conversation shell (see
 * `chatGutterStyle`), which the `chat-content-w` utility subtracts.
 */
export const CHAT_CONTENT_GUTTER = 12

/** CSS variable the `chat-content-w` utility reads for the gutter. */
export const CHAT_GUTTER_VAR = "--chat-gutter"

/** Inline style that turns the gutter on for a subtree. */
export const chatGutterStyle = {
  [CHAT_GUTTER_VAR]: `${CHAT_CONTENT_GUTTER}px`,
} as React.CSSProperties

/** Upper bound for a stored value; anything larger is treated as corrupt. */
const CHAT_CONTENT_SANE_MAX = 10000

/** The persisted width preference in px, or null when absent or corrupt. */
export function readChatContentWidth(): number | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_CHAT_CONTENT_WIDTH)
    if (raw === null) return null
    const value = Number(raw)
    return Number.isFinite(value) && value > 0 && value <= CHAT_CONTENT_SANE_MAX
      ? value
      : null
  } catch {
    return null
  }
}

/** Show `px` (or the built-in default for null) without touching storage. */
export function applyChatContentWidth(px: number | null) {
  const style = document.documentElement.style
  if (px === null) style.removeProperty(CHAT_CONTENT_WIDTH_VAR)
  else style.setProperty(CHAT_CONTENT_WIDTH_VAR, `${px}px`)
}

/** Apply and persist; null resets to the default. */
export function commitChatContentWidth(px: number | null) {
  applyChatContentWidth(px)
  try {
    if (px === null) localStorage.removeItem(STORAGE_KEY_CHAT_CONTENT_WIDTH)
    else localStorage.setItem(STORAGE_KEY_CHAT_CONTENT_WIDTH, `${px}`)
  } catch {
    // Storage unavailable: the width still holds for this session.
  }
}

/**
 * The widest the column can be in a `columnWidth` px host: all of it but the
 * gutter on both sides. Relative to the host, so it follows the window (and
 * the side panels) instead of being a fixed px ceiling.
 */
export function maxChatContentWidth(columnWidth: number): number {
  return Math.max(0, columnWidth - 2 * CHAT_CONTENT_GUTTER)
}

/**
 * Clamp a wanted width for a column `columnWidth` px wide. The ceiling never
 * drops below the floor; on a column narrower than that, CSS (the same
 * `100% - 2 × gutter` cap) is what keeps the content — and the handles — in.
 */
export function clampChatContentWidth(px: number, columnWidth: number): number {
  const max = Math.max(CHAT_CONTENT_MIN, maxChatContentWidth(columnWidth))
  return Math.round(Math.min(Math.max(px, CHAT_CONTENT_MIN), max))
}
