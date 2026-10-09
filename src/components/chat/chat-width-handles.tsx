"use client"

import { useCallback, useRef } from "react"
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  WheelEvent as ReactWheelEvent,
} from "react"
import { useTranslations } from "next-intl"

import { useChatContentWidth } from "@/hooks/use-appearance"
import { clampChatContentWidth } from "@/lib/chat-content-width"
import { cn } from "@/lib/utils"

/** Width change per arrow-key press, in px (split across both sides). */
const KEY_STEP = 32

const WHEEL_DELTA_LINE = 1
const WHEEL_DELTA_PAGE = 2
const FALLBACK_WHEEL_LINE_PX = 16

type Side = "left" | "right"

// Where the content edge sits inside the (relative) host: the same `min()` the
// `chat-content-w` utility resolves, so the handle tracks the column exactly.
const EDGE_OFFSET =
  "min(var(--chat-content-width, 48rem), 100% - 2 * var(--chat-gutter, 0px)) / 2"

function wheelDeltaY(event: ReactWheelEvent, scrollport: HTMLElement): number {
  if (event.deltaMode === WHEEL_DELTA_LINE) {
    const lineHeight = Number.parseFloat(
      getComputedStyle(scrollport).lineHeight
    )
    return (
      event.deltaY *
      (Number.isFinite(lineHeight) ? lineHeight : FALLBACK_WHEEL_LINE_PX)
    )
  }
  if (event.deltaMode === WHEEL_DELTA_PAGE) {
    return event.deltaY * scrollport.clientHeight
  }
  return event.deltaY
}

/**
 * The content column's current width, read off this handle's own position.
 * Each handle hangs INSIDE the column from its edge (see the render), so the
 * edge is the handle's outer side.
 */
function measureContentWidth(handle: HTMLElement, side: Side): number | null {
  const host = handle.parentElement
  if (!host) return null
  const hostBox = host.getBoundingClientRect()
  const handleBox = handle.getBoundingClientRect()
  const hostCenter = hostBox.left + hostBox.width / 2
  const edge = side === "left" ? handleBox.left : handleBox.right
  return Math.abs(edge - hostCenter) * 2
}

function WidthHandle({ side }: { side: Side }) {
  const t = useTranslations("Folder.chat.messageList")
  const { setChatContentWidth, previewChatContentWidth } = useChatContentWidth()
  const drag = useRef<{
    pointerId: number
    originX: number
    baseWidth: number
    latestX: number
    frame: number | null
  } | null>(null)

  const outwardWidth = (
    state: NonNullable<typeof drag.current>,
    host: HTMLElement
  ) => {
    const dx = state.latestX - state.originX
    const outward = side === "right" ? dx : -dx
    return clampChatContentWidth(
      state.baseWidth + outward * 2,
      host.getBoundingClientRect().width
    )
  }

  const endDrag = useCallback((handle: HTMLElement) => {
    const state = drag.current
    if (!state) return
    if (state.frame !== null) cancelAnimationFrame(state.frame)
    drag.current = null
    handle.toggleAttribute("data-dragging", false)
  }, [])

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return
      const handle = event.currentTarget
      const baseWidth = measureContentWidth(handle, side)
      if (baseWidth === null) return
      event.preventDefault()
      handle.setPointerCapture(event.pointerId)
      drag.current = {
        pointerId: event.pointerId,
        originX: event.clientX,
        baseWidth,
        latestX: event.clientX,
        frame: null,
      }
      handle.toggleAttribute("data-dragging", true)
    },
    [side]
  )

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const state = drag.current
      const host = event.currentTarget.parentElement
      if (!state || !host || state.pointerId !== event.pointerId) return
      state.latestX = event.clientX
      state.frame ??= requestAnimationFrame(() => {
        state.frame = null
        previewChatContentWidth(outwardWidth(state, host))
      })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `side` is the only closure input
    [side, previewChatContentWidth]
  )

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const state = drag.current
      const handle = event.currentTarget
      const host = handle.parentElement
      if (!state || !host || state.pointerId !== event.pointerId) return
      state.latestX = event.clientX
      const moved = state.latestX !== state.originX
      // Press-and-release without moving must not freeze the default width
      // into storage as if it were a chosen preference.
      if (moved) setChatContentWidth(outwardWidth(state, host))
      endDrag(handle)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `side` is the only closure input
    [endDrag, side, setChatContentWidth]
  )

  const onPointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      endDrag(event.currentTarget)
    },
    [endDrag]
  )

  const onDoubleClick = useCallback(() => {
    setChatContentWidth(null)
  }, [setChatContentWidth])

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const host = event.currentTarget.parentElement
      if (!host) return
      if (event.key === "Escape" || event.key === "Home") {
        event.preventDefault()
        setChatContentWidth(null)
        return
      }
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
      const current = measureContentWidth(event.currentTarget, side)
      if (current === null) return
      event.preventDefault()
      // The key that moves the handle outward widens the column.
      const outwardKey = side === "right" ? "ArrowRight" : "ArrowLeft"
      const delta = event.key === outwardKey ? KEY_STEP : -KEY_STEP
      setChatContentWidth(
        clampChatContentWidth(
          current + delta,
          host.getBoundingClientRect().width
        )
      )
    },
    [side, setChatContentWidth]
  )

  // The handle overlays the transcript's scrollport, so wheel events over it
  // would otherwise be swallowed instead of scrolling the messages.
  const onWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    if (event.ctrlKey || event.deltaY === 0) return
    const scrollport =
      event.currentTarget.parentElement?.querySelector<HTMLElement>(
        ".chat-scroll-port"
      )
    scrollport?.scrollBy({ top: wheelDeltaY(event, scrollport) })
  }, [])

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t("resizeWidth")}
      title={t("resizeWidth")}
      tabIndex={0}
      data-width-handle={side}
      // Hangs inward from the column edge: the 12px hit zone lies over the
      // rows' own px-4 padding (no text under it) and, with the shell's
      // gutter, never reaches the window border.
      className={cn(
        "group absolute inset-y-0 z-10 hidden w-3 cursor-col-resize touch-none select-none outline-none md:block",
        side === "right" && "-translate-x-full"
      )}
      style={{
        left:
          side === "left"
            ? `calc(50% - ${EDGE_OFFSET})`
            : `calc(50% + ${EDGE_OFFSET})`,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onPointerCancel}
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
      onWheel={onWheel}
    >
      <span
        className={cn(
          "absolute inset-y-0 w-px bg-transparent transition-colors group-hover:bg-border group-focus-visible:bg-ring group-data-[dragging]:bg-primary/60",
          side === "left" ? "left-0" : "right-0"
        )}
      />
    </div>
  )
}

/**
 * Two drag handles on the left/right edges of the chat column. Dragging either
 * outward widens the column symmetrically (width = start + 2 × outward travel);
 * double-click (or Esc/Home) restores the default. The width is a global
 * preference: it lives on `<html>` as `--chat-content-width`, so every
 * transcript and composer in the app follows it. Must be mounted inside a
 * `relative` host that spans the transcript.
 */
export function ChatWidthHandles() {
  return (
    <>
      <WidthHandle side="left" />
      <WidthHandle side="right" />
    </>
  )
}
