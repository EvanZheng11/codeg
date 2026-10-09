/**
 * The blank, window-draggable slot a top tab strip keeps under one of the
 * fixed corner overlays (LeftEdgeChrome / RightEdgeChrome, plus the Win/Linux
 * caption buttons on the right). Width 0 when the strip doesn't own that
 * window edge.
 *
 * Always mounted, sized by width, so a sidebar/aux toggle can ANIMATE it: the
 * owning column slides over 240ms (`.panel-slide-animating`), and a reserve
 * that popped in or out at once made the tabs jump by its full width and then
 * slide back — a squeeze-and-stretch most visible on desktop Win/Linux, where
 * the right reserve also covers the 138px caption buttons. Under that class
 * the width transitions with the same timing as the panels (globals.css), so
 * the space the tabs get changes in one smooth, monotonic motion.
 */
export function ChromeReserve({ width }: { width: number }) {
  return (
    <div
      data-tauri-drag-region
      aria-hidden
      className="chrome-reserve h-full shrink-0 ws-strip-line"
      style={{ width }}
    />
  )
}
