import { act, fireEvent, render, screen } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { beforeEach, describe, expect, it } from "vitest"

import { ChatWidthHandles } from "./chat-width-handles"
import { STORAGE_KEY_CHAT_CONTENT_WIDTH } from "@/lib/appearance-script"
import {
  CHAT_CONTENT_GUTTER,
  CHAT_CONTENT_WIDTH_VAR,
} from "@/lib/chat-content-width"

const messages = {
  Folder: { chat: { messageList: { resizeWidth: "Resize" } } },
}

// jsdom has no layout: give the host a 1600px box centred at 800, and each
// handle hangs inward from the content edge of a 768px column (left handle's
// left side = column left, right handle's right side = column right).
function stubBox(el: Element, left: number, width: number) {
  el.getBoundingClientRect = () =>
    ({
      left,
      width,
      right: left + width,
      top: 0,
      bottom: 0,
      height: 0,
      x: left,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect
}

function setup() {
  const view = render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <div data-testid="host">
        <ChatWidthHandles />
      </div>
    </NextIntlClientProvider>
  )
  const host = screen.getByTestId("host")
  stubBox(host, 0, 1600)
  const [left, right] = screen.getAllByRole("separator")
  // Column edges at 800 ∓ 384 → a 768px column.
  stubBox(left, 416, 12)
  stubBox(right, 1184 - 12, 12)
  for (const h of [left, right]) {
    h.setPointerCapture = () => {}
    h.releasePointerCapture = () => {}
  }
  return { ...view, left, right }
}

// jsdom has no `PointerEvent`, so drive the handlers with real `MouseEvent`s
// under the pointer-event names (same recipe as sidebar-section-header.test).
function pointer(target: Element, type: string, clientX: number) {
  fireEvent(
    target,
    new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX,
      button: 0,
    })
  )
}

const rootVar = () =>
  document.documentElement.style.getPropertyValue(CHAT_CONTENT_WIDTH_VAR)

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute("style")
})

describe("ChatWidthHandles", () => {
  it("widens symmetrically (2x the outward travel) and persists on release", async () => {
    const { right } = setup()
    pointer(right, "pointerdown", 1184)
    pointer(right, "pointermove", 1234)
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(null)))
    })
    expect(rootVar()).toBe("868px") // 768 + 50 * 2
    pointer(right, "pointerup", 1234)
    expect(localStorage.getItem(STORAGE_KEY_CHAT_CONTENT_WIDTH)).toBe("868")
  })

  it("treats dragging the left handle leftwards as outward", () => {
    const { left } = setup()
    pointer(left, "pointerdown", 416)
    pointer(left, "pointerup", 376)
    expect(localStorage.getItem(STORAGE_KEY_CHAT_CONTENT_WIDTH)).toBe("848")
  })

  it("does not store a width for a press without movement", () => {
    const { right } = setup()
    pointer(right, "pointerdown", 1184)
    pointer(right, "pointerup", 1184)
    expect(localStorage.getItem(STORAGE_KEY_CHAT_CONTENT_WIDTH)).toBeNull()
  })

  it("clamps to the floor and to the column minus both gutters", () => {
    const { right } = setup()
    pointer(right, "pointerdown", 1184)
    pointer(right, "pointerup", 5000)
    expect(localStorage.getItem(STORAGE_KEY_CHAT_CONTENT_WIDTH)).toBe(
      `${1600 - 2 * CHAT_CONTENT_GUTTER}`
    )
    pointer(right, "pointerdown", 1184)
    pointer(right, "pointerup", -5000)
    expect(localStorage.getItem(STORAGE_KEY_CHAT_CONTENT_WIDTH)).toBe("640")
  })

  it("resets to the default on double-click", () => {
    const { right } = setup()
    localStorage.setItem(STORAGE_KEY_CHAT_CONTENT_WIDTH, "900")
    document.documentElement.style.setProperty(CHAT_CONTENT_WIDTH_VAR, "900px")
    fireEvent.doubleClick(right)
    expect(rootVar()).toBe("")
    expect(localStorage.getItem(STORAGE_KEY_CHAT_CONTENT_WIDTH)).toBeNull()
  })

  it("resizes from the keyboard, outward key widening", () => {
    const { left, right } = setup()
    fireEvent.keyDown(right, { key: "ArrowRight" })
    expect(localStorage.getItem(STORAGE_KEY_CHAT_CONTENT_WIDTH)).toBe("800")
    fireEvent.keyDown(left, { key: "ArrowRight" }) // inward on the left side
    expect(localStorage.getItem(STORAGE_KEY_CHAT_CONTENT_WIDTH)).toBe("736")
  })
})
