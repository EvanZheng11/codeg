import { beforeEach, describe, expect, it, vi } from "vitest"

const call = vi.fn()

vi.mock("@/lib/transport", () => ({
  getTransport: () => ({ call }),
  getShellTransport: () => ({ call: vi.fn() }),
  isDesktop: () => true,
  isRemoteDesktopMode: () => false,
  getActiveRemoteConnectionId: () => null,
  notifyRemoteDesktopUnauthorized: vi.fn(),
}))

import { takePendingFinderDirectories } from "@/lib/api"

describe("takePendingFinderDirectories", () => {
  beforeEach(() => {
    call.mockReset()
  })

  it("调用 Rust 冷启动消费命令并返回目录 payload", async () => {
    const pending = [{ path: "/Users/me/project" }]
    call.mockResolvedValue(pending)

    await expect(takePendingFinderDirectories()).resolves.toEqual(pending)
    expect(call).toHaveBeenCalledWith("take_pending_finder_directories")
  })
})
