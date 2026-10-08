"use client"

import { useCallback, useEffect, useState, useSyncExternalStore } from "react"
import { Loader2, WifiOff } from "lucide-react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import type { RemoteDesktopTransport } from "@/lib/transport/remote-desktop-transport"

type ConnectionHealth = Pick<
  RemoteDesktopTransport,
  | "getConnectionSnapshot"
  | "subscribeConnection"
  | "eventStream"
  | "reconnectNow"
>

/** Mounted after the remote transport is configured, so it cannot subscribe
 * to the local shell by mistake. Keep the workspace mounted during an outage
 * and show a manual recovery action once the proxy has stopped retrying. */
export function RemoteConnectionStatus({
  transport,
}: {
  transport: ConnectionHealth
}) {
  const t = useTranslations("WebConnection")
  const subscribe = useCallback(
    (callback: () => void) => transport.subscribeConnection(callback),
    [transport]
  )
  const getSnapshot = useCallback(
    () => transport.getConnectionSnapshot(),
    [transport]
  )
  const state = useSyncExternalStore(subscribe, getSnapshot, () => "connected")
  const [graceElapsed, setGraceElapsed] = useState(false)

  useEffect(() => {
    // Settings and other restored remote shells may have no conversation
    // subscribers yet. Start the same shared proxy, not a second socket.
    transport.eventStream()
  }, [transport])

  useEffect(() => {
    if (state !== "reconnecting") return
    const timer = setTimeout(() => setGraceElapsed(true), 4_000)
    return () => {
      clearTimeout(timer)
      setGraceElapsed(false)
    }
  }, [state])

  if (state === "connected" || (state === "reconnecting" && !graceElapsed)) {
    return null
  }

  const retrying = state === "reconnecting"
  return (
    <div
      role="status"
      className="fixed inset-x-4 bottom-4 z-50 mx-auto flex w-fit max-w-[calc(100%_-_2rem)] items-center gap-3 rounded-xl border bg-background px-4 py-3 text-sm shadow-lg"
    >
      {retrying ? (
        <Loader2 className="size-4 shrink-0 animate-spin" />
      ) : (
        <WifiOff className="size-4 shrink-0 text-destructive" />
      )}
      <div>
        <p>{t("disconnectedTitle")}</p>
        {retrying && (
          <p className="text-muted-foreground">
            {t("reconnectingDescription")}
          </p>
        )}
      </div>
      {!retrying && (
        <Button size="sm" onClick={() => transport.reconnectNow()}>
          {t("reconnectNow")}
        </Button>
      )}
    </div>
  )
}
