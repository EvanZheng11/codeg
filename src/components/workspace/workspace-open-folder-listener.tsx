"use client"

import { useEffect, useRef } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { useAppWorkspaceStore } from "@/stores/app-workspace-store"
import { useTabActions, useTabStore } from "@/contexts/tab-context"
import { useWorkbenchRoute } from "@/contexts/workbench-route-context"
import { detectPlatform } from "@/hooks/use-platform"
import { isRemoteDesktopMode } from "@/lib/transport"
import { isDesktop, subscribe } from "@/lib/platform"
import {
  FINDER_DIRECTORY_OPENED_EVENT,
  FOLDER_OPEN_IN_WORKSPACE_EVENT,
  takePendingFinderDirectories,
  type FinderDirectoryOpened,
} from "@/lib/api"
import { toErrorMessage } from "@/lib/app-error"
import type { FolderDetail } from "@/lib/types"

const FINDER_RETRY_DELAY_MS = 50
const FINDER_MAX_RETRIES = 3

/**
 * 处理项目启动器和 macOS Finder 打开的目录：更新本窗口工作区，创建未发送
 * 会话草稿并聚焦。Finder 事件只绑定本机 macOS 桌面窗口，不读取远程工作区。
 */
export function WorkspaceOpenFolderListener() {
  const t = useTranslations("Folder.workspaceDialog")
  const { openNewConversationTab } = useTabActions()
  const { openConversations } = useWorkbenchRoute()
  const openFolder = useAppWorkspaceStore((state) => state.openFolder)
  const foldersHydrated = useAppWorkspaceStore((state) => state.foldersHydrated)
  const tabsHydrated = useTabStore((state) => state.tabsHydrated)
  const finderLifecycle = useRef<{
    started: boolean
    disposed: boolean
    unlisten?: () => void
    cleanupTimer?: ReturnType<typeof setTimeout>
    retryTimer?: ReturnType<typeof setTimeout>
    subscribed: boolean
    subscribing: boolean
    consuming: boolean
    pendingReady: boolean
    listenRetries: number
    consumeRetries: number
    kick?: () => void
  }>({
    started: false,
    disposed: false,
    subscribed: false,
    subscribing: false,
    consuming: false,
    pendingReady: false,
    listenRetries: 0,
    consumeRetries: 0,
  })
  const finderHydration = useRef({ foldersHydrated, tabsHydrated })
  finderHydration.current = { foldersHydrated, tabsHydrated }
  const finderCallbacks = useRef({
    openFolder,
    openConversations,
    openNewConversationTab,
    t,
  })

  useEffect(() => {
    finderCallbacks.current = {
      openFolder,
      openConversations,
      openNewConversationTab,
      t,
    }
  }, [openConversations, openFolder, openNewConversationTab, t])

  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | undefined

    void (async () => {
      const dispose = await subscribe<FolderDetail>(
        FOLDER_OPEN_IN_WORKSPACE_EVENT,
        (detail) => {
          const store = useAppWorkspaceStore.getState()
          store.upsertFolder(detail)
          store.setBranch(detail.id, detail.git_branch ?? null)
          // Return to the conversation workspace if a route (e.g. Automations)
          // was covering the content region, else the new tab opens unseen.
          openConversations()
          openNewConversationTab(detail.id, detail.path)
          void store.refreshConversations()
        }
      )
      // The effect may have torn down while the async subscribe was in
      // flight; dispose immediately so we don't leak a subscription.
      if (disposed) dispose()
      else unlisten = dispose
    })()

    return () => {
      disposed = true
      unlisten?.()
    }
  }, [openNewConversationTab, openConversations])

  useEffect(() => {
    if (!isDesktop() || isRemoteDesktopMode() || detectPlatform() !== "macos") {
      return
    }

    const lifecycle = finderLifecycle.current
    if (lifecycle.started) {
      // React StrictMode 会在开发环境中重复执行 effect；复用第一次已建立的
      // 监听和消费流程，避免冷启动队列被取走两次。
      if (lifecycle.cleanupTimer) clearTimeout(lifecycle.cleanupTimer)
      lifecycle.cleanupTimer = undefined
      lifecycle.disposed = false
      return () => {
        lifecycle.disposed = true
        lifecycle.cleanupTimer = setTimeout(() => {
          if (!lifecycle.disposed) return
          lifecycle.unlisten?.()
          lifecycle.unlisten = undefined
        }, 0)
      }
    }
    lifecycle.started = true
    lifecycle.disposed = false

    const bufferedEvents: FinderDirectoryOpened[] = []
    let processing = Promise.resolve()

    const processDirectory = async (detail: FinderDirectoryOpened) => {
      if (!detail || typeof detail.path !== "string" || !detail.path) {
        console.warn("[Finder目录] 忽略无效目录事件")
        return
      }

      try {
        const folder = await finderCallbacks.current.openFolder(detail.path)
        console.info(`[Finder目录] 已打开工作区目录：${folder.path}`)
        finderCallbacks.current.openConversations()
        finderCallbacks.current.openNewConversationTab(folder.id, folder.path, {
          folderDefaultAgent: folder.default_agent_type,
          forceNewDraft: true,
        })
      } catch (error) {
        console.error(`[Finder目录] 打开工作区目录失败：${detail.path}`, error)
        toast.error(finderCallbacks.current.t("openFailed"), {
          description: toErrorMessage(error),
        })
      }
    }

    const enqueue = (detail: FinderDirectoryOpened) => {
      if (lifecycle.disposed) return
      processing = processing
        .then(() => processDirectory(detail))
        .catch((error) => {
          console.error("[Finder目录] 串行处理目录失败", error)
        })
    }

    const handleEvent = (detail: FinderDirectoryOpened) => {
      if (lifecycle.disposed) return
      if (!lifecycle.pendingReady) bufferedEvents.push(detail)
      else enqueue(detail)
    }

    const reportFinalFailure = (stage: "监听" | "消费", error: unknown) => {
      console.error(`[Finder目录] ${stage}失败，重试次数已用尽`, error)
    }

    const scheduleRetry = (stage: "监听" | "消费", error: unknown) => {
      if (lifecycle.disposed || lifecycle.retryTimer) return
      const retries =
        stage === "监听" ? lifecycle.listenRetries : lifecycle.consumeRetries
      if (retries >= FINDER_MAX_RETRIES) {
        reportFinalFailure(stage, error)
        return
      }
      if (stage === "监听") lifecycle.listenRetries += 1
      else lifecycle.consumeRetries += 1
      lifecycle.retryTimer = setTimeout(() => {
        lifecycle.retryTimer = undefined
        if (lifecycle.disposed) return
        lifecycle.kick?.()
      }, FINDER_RETRY_DELAY_MS)
    }

    const consumePending = async () => {
      if (
        lifecycle.disposed ||
        !lifecycle.subscribed ||
        lifecycle.consuming ||
        lifecycle.retryTimer ||
        lifecycle.pendingReady ||
        !finderHydration.current.foldersHydrated ||
        !finderHydration.current.tabsHydrated
      ) {
        return
      }
      lifecycle.consuming = true
      try {
        const pending = await takePendingFinderDirectories()
        if (lifecycle.disposed) return
        lifecycle.pendingReady = true
        lifecycle.consumeRetries = 0
        for (const detail of pending) enqueue(detail)
        for (const detail of bufferedEvents) enqueue(detail)
        bufferedEvents.length = 0
      } catch (error) {
        scheduleRetry("消费", error)
      } finally {
        lifecycle.consuming = false
      }
    }

    const subscribeToFinder = async () => {
      if (
        lifecycle.disposed ||
        lifecycle.subscribed ||
        lifecycle.subscribing ||
        lifecycle.retryTimer
      ) {
        return
      }
      lifecycle.subscribing = true
      try {
        const dispose = await subscribe<FinderDirectoryOpened>(
          FINDER_DIRECTORY_OPENED_EVENT,
          handleEvent
        )
        if (lifecycle.disposed) {
          lifecycle.subscribing = false
          dispose()
          return
        }
        lifecycle.subscribed = true
        lifecycle.subscribing = false
        lifecycle.listenRetries = 0
        lifecycle.unlisten = dispose
        void consumePending()
      } catch (error) {
        lifecycle.subscribing = false
        scheduleRetry("监听", error)
      }
    }

    lifecycle.kick = () => {
      void subscribeToFinder()
      void consumePending()
    }
    lifecycle.kick()

    return () => {
      lifecycle.disposed = true
      if (lifecycle.retryTimer) clearTimeout(lifecycle.retryTimer)
      lifecycle.retryTimer = undefined
      lifecycle.cleanupTimer = setTimeout(() => {
        if (!lifecycle.disposed) return
        lifecycle.unlisten?.()
        lifecycle.unlisten = undefined
        lifecycle.subscribed = false
      }, 0)
    }
  }, [])

  useEffect(() => {
    finderLifecycle.current.kick?.()
  }, [foldersHydrated, tabsHydrated])

  return null
}
