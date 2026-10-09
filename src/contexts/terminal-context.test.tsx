import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { TerminalProvider, useTerminalContext } from "./terminal-context"
import { useCommandTerminalLinkStore } from "@/stores/command-terminal-link-store"

const h = vi.hoisted(() => ({
  terminalKill: vi.fn(async () => {}),
  remoteId: null as number | null,
  windowLabel: "main",
  activeFolderId: 7 as number | null,
}))

vi.mock("@/lib/api", () => ({
  getSystemTerminalSettings: vi.fn(async () => ({ default_shell: null })),
  terminalKill: h.terminalKill,
}))
vi.mock("@/lib/transport", () => ({
  getTransport: () => ({ subscribe: async () => () => {} }),
  getActiveRemoteConnectionId: () => h.remoteId,
}))
vi.mock("@/lib/browser/window-label", () => ({
  getCurrentWindowLabel: () => h.windowLabel,
}))
vi.mock("@/contexts/active-folder-context", () => ({
  useActiveFolder: () => ({
    activeFolder:
      h.activeFolderId == null
        ? null
        : { id: h.activeFolderId, path: "/tmp/codeg-749" },
    activeFolderId: h.activeFolderId,
  }),
}))
vi.mock("@/hooks/use-shortcut-settings", () => ({
  useShortcutSettings: () => ({
    shortcuts: {
      new_terminal_tab: null,
      close_current_terminal_tab: null,
    },
  }),
}))
vi.mock("@/lib/keyboard-shortcuts", () => ({
  matchShortcutEvent: () => false,
}))

function Probe() {
  const terminal = useTerminalContext()
  return (
    <div>
      <button
        onClick={() => {
          void terminal.createTerminalWithCommand("Long build", "sleep 120", 42)
        }}
      >
        Run
      </button>
      <button
        onClick={() =>
          terminal.activeTabId && terminal.closeTerminal(terminal.activeTabId)
        }
      >
        Close
      </button>
      <button
        onClick={() => {
          void terminal.createTerminalInDirectory("/tmp/codeg-749-other", "Dir")
        }}
      >
        Open dir
      </button>
      <button
        onClick={() => {
          void terminal.createTerminal()
        }}
      >
        New
      </button>
      <button
        onClick={() =>
          terminal.tabs[0] && terminal.closeTerminal(terminal.tabs[0].id)
        }
      >
        Close first
      </button>
      <button
        onClick={() =>
          terminal.activeTabId &&
          terminal.renameTerminal(terminal.activeTabId, "t".repeat(300))
        }
      >
        Rename long
      </button>
      <span data-testid="tabs">{terminal.tabs.length}</span>
      <span data-testid="titles">
        {terminal.tabs.map((tab) => tab.title.length).join(",")}
      </span>
      <span data-testid="title-text">
        {terminal.tabs.map((tab) => tab.title).join("|")}
      </span>
      <span data-testid="active">{terminal.activeTabId ?? ""}</span>
      <span data-testid="command">
        {terminal.tabs[0]?.initialCommand ?? ""}
      </span>
    </div>
  )
}

describe("TerminalProvider reload recovery", () => {
  beforeEach(() => {
    h.terminalKill.mockClear()
    h.remoteId = null
    h.windowLabel = "main"
    h.activeFolderId = 7
    sessionStorage.clear()
    window.name = ""
    useCommandTerminalLinkStore.setState({ links: {} })
  })

  it("keeps a running command owned by this page and restores its tab after reload", () => {
    const first = render(
      <TerminalProvider>
        <Probe />
      </TerminalProvider>
    )
    fireEvent.click(screen.getByRole("button", { name: "Run" }))
    expect(screen.getByTestId("tabs")).toHaveTextContent("1")
    expect(screen.getByTestId("command")).toHaveTextContent("sleep 120")
    const originalId = screen.getByTestId("active").textContent

    expect(sessionStorage.getItem("codeg:terminal-session:v1")).not.toContain(
      "sleep 120"
    )
    first.unmount()
    expect(h.terminalKill).not.toHaveBeenCalled()

    render(
      <TerminalProvider>
        <Probe />
      </TerminalProvider>
    )
    expect(screen.getByTestId("tabs")).toHaveTextContent("1")
    expect(screen.getByTestId("active").textContent).toBe(originalId)
    expect(screen.getByTestId("command")).toBeEmptyDOMElement()
  })

  it("explicit close kills the terminal even before a view has started it", () => {
    // No view is mounted, so nothing has launched yet. The kill goes out
    // anyway: the backend turns it into a cancellation of the launch.
    render(
      <TerminalProvider>
        <Probe />
      </TerminalProvider>
    )
    fireEvent.click(screen.getByRole("button", { name: "Run" }))
    const id = screen.getByTestId("active").textContent
    fireEvent.click(screen.getByRole("button", { name: "Close" }))
    expect(h.terminalKill).toHaveBeenCalledWith(id)
    expect(screen.getByTestId("tabs")).toHaveTextContent("0")
    expect(sessionStorage.getItem("codeg:terminal-session:v1")).not.toContain(
      id
    )
  })

  it("restores nothing under a window name it did not give, and keeps that name", () => {
    // Everything else in the stored session is valid, so the window name is
    // the only thing that can be refusing it. A forged terminal ID under a
    // name of ours costs only that tab: "drops only the stored tab it cannot
    // validate" below.
    const id = "3f2c1b0a-9e8d-4c7b-a6f5-e4d3c2b1a098"
    window.name = "host-window"
    sessionStorage.setItem(
      "codeg:terminal-session:v1",
      JSON.stringify({
        version: 1,
        scope: JSON.stringify(["main", null]),
        pageId: "host-window",
        isOpen: true,
        activeTabId: id,
        tabs: [{ id, folderId: 7, title: "valid", workingDir: "/tmp" }],
      })
    )
    render(
      <TerminalProvider>
        <Probe />
      </TerminalProvider>
    )
    expect(window.name).toBe("host-window")
    expect(screen.getByTestId("tabs")).toHaveTextContent("0")
  })

  it("does not auto-attach a copied opener session in a new tab", () => {
    const first = render(
      <TerminalProvider>
        <Probe />
      </TerminalProvider>
    )
    fireEvent.click(screen.getByRole("button", { name: "Run" }))
    const copiedStorage = sessionStorage.getItem("codeg:terminal-session:v1")
    expect(copiedStorage).toBeTruthy()
    first.unmount()

    // New browsing context: the opener's sessionStorage is cloned, but the
    // browser gives this tab its own window.name.
    window.name = ""
    sessionStorage.setItem("codeg:terminal-session:v1", copiedStorage!)
    render(
      <TerminalProvider>
        <Probe />
      </TerminalProvider>
    )
    expect(screen.getByTestId("tabs")).toHaveTextContent("0")
    expect(h.terminalKill).not.toHaveBeenCalled()
  })

  it.each([
    ["another window", { windowLabel: "remote-workspace-4", remoteId: 3 }],
    [
      "another remote connection",
      { windowLabel: "remote-workspace-3", remoteId: 4 },
    ],
  ])("does not restore terminals saved for %s", (_, other) => {
    // Either half of the scope alone must keep the session out.
    h.windowLabel = "remote-workspace-3"
    h.remoteId = 3
    const first = render(
      <TerminalProvider>
        <Probe />
      </TerminalProvider>
    )
    fireEvent.click(screen.getByRole("button", { name: "Run" }))
    expect(screen.getByTestId("tabs")).toHaveTextContent("1")
    first.unmount()

    h.windowLabel = other.windowLabel
    h.remoteId = other.remoteId
    render(
      <TerminalProvider>
        <Probe />
      </TerminalProvider>
    )
    expect(screen.getByTestId("tabs")).toHaveTextContent("0")
  })

  it("restores a tab opened while no workspace tab is active, with the rest", () => {
    // With no active workspace tab the provider records folder 0 (the
    // sidebar's "open in terminal" does this). The reader must take back what
    // the writer wrote, or one such tab costs every tab its way back.
    const first = render(
      <TerminalProvider>
        <Probe />
      </TerminalProvider>
    )
    fireEvent.click(screen.getByRole("button", { name: "Run" }))
    h.activeFolderId = null
    first.rerender(
      <TerminalProvider>
        <Probe />
      </TerminalProvider>
    )
    fireEvent.click(screen.getByRole("button", { name: "Open dir" }))
    expect(screen.getByTestId("tabs")).toHaveTextContent("2")
    first.unmount()

    render(
      <TerminalProvider>
        <Probe />
      </TerminalProvider>
    )
    expect(screen.getByTestId("tabs")).toHaveTextContent("2")
  })

  it("stores an over-long title clamped rather than losing the session", () => {
    const first = render(
      <TerminalProvider>
        <Probe />
      </TerminalProvider>
    )
    fireEvent.click(screen.getByRole("button", { name: "Run" }))
    fireEvent.click(screen.getByRole("button", { name: "Rename long" }))
    expect(screen.getByTestId("titles")).toHaveTextContent("300")
    // Clamped on the way in, not only on the way back out.
    const stored = JSON.parse(
      sessionStorage.getItem("codeg:terminal-session:v1") ?? "{}"
    )
    expect(stored.tabs[0].title).toHaveLength(256)
    first.unmount()

    render(
      <TerminalProvider>
        <Probe />
      </TerminalProvider>
    )
    expect(screen.getByTestId("tabs")).toHaveTextContent("1")
    expect(screen.getByTestId("titles")).toHaveTextContent("256")
  })

  it("drops only the stored tab it cannot validate, and clamps a long title", () => {
    const pageId = "0b6f3d7e-5a1c-4e2b-9f8a-1c2d3e4f5a6b"
    const goodId = "3f2c1b0a-9e8d-4c7b-a6f5-e4d3c2b1a098"
    window.name = `codeg-terminal-page:${pageId}`
    sessionStorage.setItem(
      "codeg:terminal-session:v1",
      JSON.stringify({
        version: 1,
        scope: JSON.stringify(["main", null]),
        pageId,
        isOpen: true,
        activeTabId: "not-a-terminal-id",
        tabs: [
          {
            id: "not-a-terminal-id",
            folderId: 7,
            title: "forged",
            workingDir: "/tmp",
          },
          {
            id: goodId,
            folderId: 7,
            title: "k".repeat(300),
            workingDir: "/tmp",
          },
        ],
      })
    )
    render(
      <TerminalProvider>
        <Probe />
      </TerminalProvider>
    )
    expect(screen.getByTestId("tabs")).toHaveTextContent("1")
    expect(screen.getByTestId("active").textContent).toBe(goodId)
    expect(screen.getByTestId("titles")).toHaveTextContent("256")
  })

  it("restores every tab, however many there are", () => {
    const first = render(
      <TerminalProvider>
        <Probe />
      </TerminalProvider>
    )
    for (let n = 0; n < 40; n++) {
      fireEvent.click(screen.getByRole("button", { name: "Open dir" }))
    }
    expect(screen.getByTestId("tabs")).toHaveTextContent("40")
    first.unmount()

    render(
      <TerminalProvider>
        <Probe />
      </TerminalProvider>
    )
    expect(screen.getByTestId("tabs")).toHaveTextContent("40")
  })

  it("never repeats a default title a restored tab still shows", () => {
    const first = render(
      <TerminalProvider>
        <Probe />
      </TerminalProvider>
    )
    for (let n = 0; n < 3; n++) {
      fireEvent.click(screen.getByRole("button", { name: "New" }))
    }
    fireEvent.click(screen.getByRole("button", { name: "Close first" }))
    expect(screen.getByTestId("title-text")).toHaveTextContent(
      "Terminal 2|Terminal 3"
    )
    first.unmount()

    render(
      <TerminalProvider>
        <Probe />
      </TerminalProvider>
    )
    fireEvent.click(screen.getByRole("button", { name: "New" }))
    expect(screen.getByTestId("title-text")).toHaveTextContent(
      "Terminal 2|Terminal 3|Terminal 4"
    )
  })

  it("links the launcher back to a command tab after a reload", () => {
    // The launcher's links are in memory and a reload starts them empty.
    // Unless the tab brings its command's id back, the launcher offers to
    // run a second copy of a command that is still running in it.
    const first = render(
      <TerminalProvider>
        <Probe />
      </TerminalProvider>
    )
    fireEvent.click(screen.getByRole("button", { name: "Run" }))
    const id = screen.getByTestId("active").textContent
    first.unmount()
    useCommandTerminalLinkStore.setState({ links: {} })

    render(
      <TerminalProvider>
        <Probe />
      </TerminalProvider>
    )
    expect(useCommandTerminalLinkStore.getState().links).toEqual({ 42: id })
    expect(sessionStorage.getItem("codeg:terminal-session:v1")).not.toContain(
      "sleep 120"
    )
  })

  it("restores a tab whose stored command link is unusable, without the link", () => {
    const pageId = "0b6f3d7e-5a1c-4e2b-9f8a-1c2d3e4f5a6b"
    const id = "3f2c1b0a-9e8d-4c7b-a6f5-e4d3c2b1a098"
    window.name = `codeg-terminal-page:${pageId}`
    sessionStorage.setItem(
      "codeg:terminal-session:v1",
      JSON.stringify({
        version: 1,
        scope: JSON.stringify(["main", null]),
        pageId,
        isOpen: true,
        activeTabId: id,
        tabs: [
          {
            id,
            folderId: 7,
            title: "dev",
            workingDir: "/tmp",
            commandId: "rm -rf /",
          },
        ],
      })
    )
    render(
      <TerminalProvider>
        <Probe />
      </TerminalProvider>
    )
    expect(screen.getByTestId("tabs")).toHaveTextContent("1")
    expect(useCommandTerminalLinkStore.getState().links).toEqual({})
  })
})
