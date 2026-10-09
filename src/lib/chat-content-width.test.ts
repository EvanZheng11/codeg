import { beforeEach, describe, expect, it } from "vitest"

import { STORAGE_KEY_CHAT_CONTENT_WIDTH } from "./appearance-script"
import {
  CHAT_CONTENT_GUTTER,
  CHAT_CONTENT_MIN,
  CHAT_CONTENT_WIDTH_VAR,
  applyChatContentWidth,
  clampChatContentWidth,
  commitChatContentWidth,
  maxChatContentWidth,
  readChatContentWidth,
} from "./chat-content-width"

const rootVar = () =>
  document.documentElement.style.getPropertyValue(CHAT_CONTENT_WIDTH_VAR)

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute("style")
})

describe("readChatContentWidth", () => {
  it("is null when nothing is stored", () => {
    expect(readChatContentWidth()).toBeNull()
  })

  it.each(["abc", "0", "-5", "NaN", "99999"])("rejects %s", (raw) => {
    localStorage.setItem(STORAGE_KEY_CHAT_CONTENT_WIDTH, raw)
    expect(readChatContentWidth()).toBeNull()
  })

  it("returns a valid stored width", () => {
    localStorage.setItem(STORAGE_KEY_CHAT_CONTENT_WIDTH, "900")
    expect(readChatContentWidth()).toBe(900)
  })
})

describe("commitChatContentWidth", () => {
  it("applies and persists a width, and null resets both", () => {
    commitChatContentWidth(960)
    expect(rootVar()).toBe("960px")
    expect(localStorage.getItem(STORAGE_KEY_CHAT_CONTENT_WIDTH)).toBe("960")

    commitChatContentWidth(null)
    expect(rootVar()).toBe("")
    expect(localStorage.getItem(STORAGE_KEY_CHAT_CONTENT_WIDTH)).toBeNull()
  })

  it("applyChatContentWidth does not touch storage", () => {
    applyChatContentWidth(800)
    expect(rootVar()).toBe("800px")
    expect(localStorage.getItem(STORAGE_KEY_CHAT_CONTENT_WIDTH)).toBeNull()
  })
})

describe("clampChatContentWidth", () => {
  it("floors at the minimum", () => {
    expect(clampChatContentWidth(100, 1600)).toBe(CHAT_CONTENT_MIN)
  })

  it("caps at the column minus the gutter on both sides", () => {
    expect(clampChatContentWidth(5000, 1600)).toBe(
      1600 - 2 * CHAT_CONTENT_GUTTER
    )
    expect(maxChatContentWidth(1600)).toBe(1600 - 2 * CHAT_CONTENT_GUTTER)
  })

  it("scales the ceiling with the column, not a fixed px cap", () => {
    expect(clampChatContentWidth(5000, 3000)).toBe(
      3000 - 2 * CHAT_CONTENT_GUTTER
    )
  })

  it("never drops the ceiling below the floor on a narrow column", () => {
    expect(clampChatContentWidth(900, 600)).toBe(CHAT_CONTENT_MIN)
  })

  it("passes an in-range width through", () => {
    expect(clampChatContentWidth(900, 1600)).toBe(900)
  })
})
