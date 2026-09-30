import { act, cleanup, render, waitFor } from "@testing-library/react"
import { StrictMode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => {
  const store = {
    upsertFolder: vi.fn(),
    setBranch: vi.fn(),
    refreshConversations: vi.fn(() => Promise.resolve()),
  }
  const useAppWorkspaceStore = Object.assign(
    (
      selector: (state: {
        openFolder: unknown
        foldersHydrated: boolean
      }) => unknown
    ) =>
      selector({
        openFolder: mocks.openFolder,
        foldersHydrated: mocks.foldersHydrated,
      }),
    { getState: () => store }
  )
  return {
    store,
    useAppWorkspaceStore,
    foldersHydrated: true,
    tabsHydrated: true,
    openFolder: vi.fn(),
    subscribe: vi.fn(),
    takePendingFinderDirectories: vi.fn(),
    openNewConversationTab: vi.fn(),
    openConversations: vi.fn(),
    toastError: vi.fn(),
    isDesktop: vi.fn(() => true),
    isRemoteDesktopMode: vi.fn(() => false),
    detectPlatform: vi.fn(() => "macos"),
  }
})

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}))

vi.mock("@/stores/app-workspace-store", () => ({
  useAppWorkspaceStore: mocks.useAppWorkspaceStore,
}))

vi.mock("@/hooks/use-platform", () => ({
  detectPlatform: mocks.detectPlatform,
}))

vi.mock("@/contexts/tab-context", () => ({
  useTabActions: () => ({
    openNewConversationTab: mocks.openNewConversationTab,
  }),
  useTabStore: (selector: (state: { tabsHydrated: boolean }) => unknown) =>
    selector({ tabsHydrated: mocks.tabsHydrated }),
}))

vi.mock("@/contexts/workbench-route-context", () => ({
  useWorkbenchRoute: () => ({ openConversations: mocks.openConversations }),
}))

vi.mock("@/lib/platform", () => ({
  detectPlatform: mocks.detectPlatform,
  isDesktop: mocks.isDesktop,
  subscribe: mocks.subscribe,
}))

vi.mock("@/lib/transport", () => ({
  isRemoteDesktopMode: mocks.isRemoteDesktopMode,
}))

vi.mock("@/lib/api", () => ({
  FINDER_DIRECTORY_OPENED_EVENT: "finder://directory-opened",
  FOLDER_OPEN_IN_WORKSPACE_EVENT: "folder://open-in-workspace",
  takePendingFinderDirectories: mocks.takePendingFinderDirectories,
}))

vi.mock("sonner", () => ({ toast: { error: mocks.toastError } }))

import { WorkspaceOpenFolderListener } from "./workspace-open-folder-listener"
import type { FinderDirectoryOpened } from "@/lib/api"

let eventHandler: ((payload: unknown) => void) | null
let unsubscribe: ReturnType<typeof vi.fn>

const folder = {
  id: 7,
  name: "项目",
  path: "/Users/me/project",
  git_branch: null,
  default_agent_type: "claude_code",
  last_opened_at: "2026-10-01T00:00:00Z",
  sort_order: 1,
  color: "inherit",
  parent_id: null,
  kind: "regular",
  alias: null,
  group_id: null,
}

function emit(path: string) {
  if (!eventHandler) throw new Error("Finder 事件监听器尚未建立")
  eventHandler({ path })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.foldersHydrated = true
  mocks.tabsHydrated = true
  eventHandler = null
  unsubscribe = vi.fn()
  mocks.subscribe.mockImplementation(
    async (_event: string, handler: (payload: unknown) => void) => {
      eventHandler = handler
      return unsubscribe
    }
  )
  mocks.takePendingFinderDirectories.mockResolvedValue([])
  mocks.openFolder.mockResolvedValue(folder)
})

afterEach(() => {
  vi.useRealTimers()
  cleanup()
})

describe("WorkspaceOpenFolderListener", () => {
  it("先建立监听再消费冷启动目录，并使用目录默认智能体打开新 draft", async () => {
    mocks.takePendingFinderDirectories.mockResolvedValue([
      { path: folder.path },
    ])

    render(<WorkspaceOpenFolderListener />)

    await waitFor(() =>
      expect(mocks.takePendingFinderDirectories).toHaveBeenCalled()
    )

    expect(mocks.subscribe).toHaveBeenCalledWith(
      "finder://directory-opened",
      expect.any(Function)
    )
    expect(mocks.subscribe.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.takePendingFinderDirectories.mock.invocationCallOrder[0]
    )
    await waitFor(() =>
      expect(mocks.openFolder).toHaveBeenCalledWith(folder.path)
    )
    expect(mocks.openConversations).toHaveBeenCalled()
    expect(mocks.openNewConversationTab).toHaveBeenCalledWith(
      folder.id,
      folder.path,
      {
        folderDefaultAgent: "claude_code",
        forceNewDraft: true,
      }
    )
  })

  it("延迟 hydration 时只缓存事件，完成后按冷启动和实时顺序处理", async () => {
    let releasePending!: (value: FinderDirectoryOpened[]) => void
    mocks.foldersHydrated = false
    mocks.tabsHydrated = false
    mocks.takePendingFinderDirectories.mockImplementation(
      () =>
        new Promise<FinderDirectoryOpened[]>((resolve) => {
          releasePending = resolve
        })
    )
    const { rerender } = render(<WorkspaceOpenFolderListener />)

    await waitFor(() => expect(eventHandler).toBeTruthy())
    emit("/Users/me/realtime")
    expect(mocks.takePendingFinderDirectories).not.toHaveBeenCalled()
    expect(mocks.openFolder).not.toHaveBeenCalled()

    mocks.foldersHydrated = true
    rerender(<WorkspaceOpenFolderListener />)
    expect(mocks.openFolder).not.toHaveBeenCalled()

    mocks.tabsHydrated = true
    rerender(<WorkspaceOpenFolderListener />)
    await waitFor(() =>
      expect(mocks.takePendingFinderDirectories).toHaveBeenCalledTimes(1)
    )
    expect(mocks.openFolder).not.toHaveBeenCalled()

    await act(async () => {
      releasePending([{ path: "/Users/me/pending" }])
    })
    await waitFor(() => expect(mocks.openFolder).toHaveBeenCalledTimes(2))
    expect(mocks.openFolder.mock.calls.map(([path]) => path)).toEqual([
      "/Users/me/pending",
      "/Users/me/realtime",
    ])
  })

  it("消费失败时保持未 ready，并在第二次消费成功后放行缓存", async () => {
    vi.useFakeTimers()
    mocks.takePendingFinderDirectories
      .mockRejectedValueOnce(new Error("消费失败"))
      .mockResolvedValueOnce([{ path: folder.path }])

    render(<WorkspaceOpenFolderListener />)
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(mocks.takePendingFinderDirectories).toHaveBeenCalledTimes(1)
    emit("/Users/me/realtime")
    expect(mocks.openFolder).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(50)
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(mocks.takePendingFinderDirectories).toHaveBeenCalledTimes(2)
    expect(mocks.openFolder).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })

  it("监听失败后重试建立监听并处理恢复后的事件", async () => {
    vi.useFakeTimers()
    let finderAttempts = 0
    mocks.subscribe.mockImplementation(
      async (event: string, handler: (payload: unknown) => void) => {
        if (event === "finder://directory-opened" && finderAttempts++ === 0) {
          throw new Error("监听失败")
        }
        if (event === "finder://directory-opened") eventHandler = handler
        return unsubscribe
      }
    )

    render(<WorkspaceOpenFolderListener />)
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(mocks.openFolder).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(50)
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(eventHandler).toBeTruthy()
    emit(folder.path)
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(mocks.openFolder).toHaveBeenCalledWith(folder.path)
    vi.useRealTimers()
  })

  it("监听连续失败超过三次后仍继续重试并处理后续事件", async () => {
    vi.useFakeTimers()
    let finderAttempts = 0
    mocks.subscribe.mockImplementation(
      async (event: string, handler: (payload: unknown) => void) => {
        if (event === "finder://directory-opened" && finderAttempts++ < 4) {
          throw new Error("监听失败")
        }
        if (event === "finder://directory-opened") eventHandler = handler
        return unsubscribe
      }
    )

    render(<WorkspaceOpenFolderListener />)
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    for (const delay of [50, 100, 200, 400]) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(delay)
        await Promise.resolve()
        await Promise.resolve()
      })
    }

    expect(eventHandler).toBeTruthy()
    emit(folder.path)
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(mocks.openFolder).toHaveBeenCalledWith(folder.path)
    vi.useRealTimers()
  })

  it("消费连续失败超过三次后仍继续重试并处理待处理及后续事件", async () => {
    vi.useFakeTimers()
    mocks.takePendingFinderDirectories
      .mockRejectedValueOnce(new Error("消费失败"))
      .mockRejectedValueOnce(new Error("消费失败"))
      .mockRejectedValueOnce(new Error("消费失败"))
      .mockRejectedValueOnce(new Error("消费失败"))
      .mockResolvedValueOnce([{ path: folder.path }])

    render(<WorkspaceOpenFolderListener />)
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    emit("/Users/me/realtime-after-retries")
    expect(mocks.openFolder).not.toHaveBeenCalled()

    for (const delay of [50, 100, 200, 400]) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(delay)
        await Promise.resolve()
        await Promise.resolve()
      })
    }

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(mocks.openFolder).toHaveBeenCalledTimes(2)
    expect(mocks.openFolder.mock.calls.map(([path]) => path)).toEqual([
      folder.path,
      "/Users/me/realtime-after-retries",
    ])
    vi.useRealTimers()
  })

  it("卸载时取消监听失败的重试定时器", async () => {
    vi.useFakeTimers()
    mocks.subscribe.mockImplementation(async (event: string) => {
      if (event === "finder://directory-opened") throw new Error("监听失败")
      return unsubscribe
    })

    const { unmount } = render(<WorkspaceOpenFolderListener />)
    await act(async () => {})
    const callsBeforeUnmount = mocks.subscribe.mock.calls.filter(
      ([event]) => event === "finder://directory-opened"
    ).length
    unmount()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })
    expect(
      mocks.subscribe.mock.calls.filter(
        ([event]) => event === "finder://directory-opened"
      )
    ).toHaveLength(callsBeforeUnmount)
    vi.useRealTimers()
  })

  it("卸载时取消消费失败的重试定时器", async () => {
    vi.useFakeTimers()
    mocks.takePendingFinderDirectories.mockRejectedValue(new Error("消费失败"))

    const { unmount } = render(<WorkspaceOpenFolderListener />)
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(mocks.takePendingFinderDirectories).toHaveBeenCalledTimes(1)
    unmount()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })
    expect(mocks.takePendingFinderDirectories).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it("已运行时串行处理重复目录，每次复用工作区但创建并聚焦新的 draft", async () => {
    let releaseFirst!: () => void
    const firstFinished = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    mocks.openFolder
      .mockImplementationOnce(async () => {
        await firstFinished
        return folder
      })
      .mockResolvedValueOnce(folder)

    render(<WorkspaceOpenFolderListener />)
    await waitFor(() => expect(eventHandler).toBeTruthy())

    await act(async () => emit(folder.path))
    await waitFor(() => expect(mocks.openFolder).toHaveBeenCalledTimes(1))

    await act(async () => emit(folder.path))
    await Promise.resolve()
    expect(mocks.openFolder).toHaveBeenCalledTimes(1)

    await act(async () => releaseFirst())

    await waitFor(() => expect(mocks.openFolder).toHaveBeenCalledTimes(2))
    expect(mocks.openFolder).toHaveBeenNthCalledWith(1, folder.path)
    expect(mocks.openFolder).toHaveBeenNthCalledWith(2, folder.path)
    expect(mocks.openNewConversationTab).toHaveBeenCalledTimes(2)
    expect(mocks.openNewConversationTab.mock.calls[0][2]).toEqual(
      expect.objectContaining({ forceNewDraft: true })
    )
    expect(mocks.openNewConversationTab.mock.calls[1][2]).toEqual(
      expect.objectContaining({ forceNewDraft: true })
    )
  })

  it("失败后继续处理后续事件并显示现有中文错误 toast", async () => {
    mocks.openFolder
      .mockRejectedValueOnce(new Error("打开失败"))
      .mockResolvedValueOnce(folder)

    render(<WorkspaceOpenFolderListener />)
    await waitFor(() => expect(eventHandler).toBeTruthy())

    await act(async () => {
      emit("/Users/me/失败目录")
      emit(folder.path)
    })

    await waitFor(() => expect(mocks.openFolder).toHaveBeenCalledTimes(2))
    expect(mocks.toastError).toHaveBeenCalledWith("openFailed", {
      description: "打开失败",
    })
    expect(mocks.openNewConversationTab).toHaveBeenCalledTimes(1)
  })

  it("StrictMode 下只消费一次冷启动队列且不处理远程工作区", async () => {
    mocks.takePendingFinderDirectories.mockResolvedValue([
      { path: folder.path },
    ])

    render(
      <StrictMode>
        <WorkspaceOpenFolderListener />
      </StrictMode>
    )

    await waitFor(() => expect(mocks.openFolder).toHaveBeenCalledTimes(1))
    expect(mocks.takePendingFinderDirectories).toHaveBeenCalledTimes(1)

    cleanup()
    vi.clearAllMocks()
    mocks.isRemoteDesktopMode.mockReturnValue(true)
    render(<WorkspaceOpenFolderListener />)
    await act(async () => {})
    expect(
      mocks.subscribe.mock.calls.some(
        ([event]) => event === "finder://directory-opened"
      )
    ).toBe(false)
    expect(mocks.takePendingFinderDirectories).not.toHaveBeenCalled()
  })
})
