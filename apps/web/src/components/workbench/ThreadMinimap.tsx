// Codex-style message position rail, ported from T3 Code's TimelineMinimap
// (pingdotgg/t3code, apps/web/src/components/chat/MessagesTimeline.tsx): a
// vertical strip of dashes in the left gutter, one per user message. Hovering
// the strip previews the nearest message (user text + final assistant reply),
// clicking jumps the transcript to it. Rides the shadcn MessageScroller
// context for scroll + visibility, so it must render inside
// MessageScrollerProvider (and inside the MessageScroller root, which is the
// positioning parent).
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react";

import { Streamdown } from "streamdown";

import { cn } from "@/lib/utils";
import {
  useMessageScroller,
  useMessageScrollerVisibility,
} from "@/components/ai-elements/message-scroller";

/** Cap on the raw markdown fed to the preview renderer — enough for the
 *  visible window, cheap enough to re-render on every hover move. */
const MINIMAP_PREVIEW_MARKDOWN_CHARS = 800;

export interface ThreadMinimapItem {
  id: string;
  userText: string | null;
  assistantText: string | null;
}

const MINIMAP_MIN_ITEMS = 2;
const MINIMAP_ITEM_SPACING = 8;
const MINIMAP_MAX_HEIGHT_CSS = "calc(100vh - 18rem)";
const MINIMAP_HIT_STRIP_LEFT = 12;
const MINIMAP_HIT_STRIP_MAX_WIDTH = 40;
const MINIMAP_EXPANDED_HIT_STRIP_WIDTH = "22rem";
/** Matches the transcript column's max-w-[750px]. */
const MINIMAP_CONTENT_MAX_WIDTH = 750;
const MINIMAP_PERSISTENT_GUTTER = 48;

/** Collapse a message body to a one-line preview; null when empty. */
export function compactMinimapPreview(text: string | null | undefined) {
  const compact = text?.replace(/\s+/g, " ").trim() ?? "";
  return compact.length > 0 ? compact : null;
}

function minimapTopPercent(index: number, itemCount: number): number {
  if (itemCount <= 1) return 0;
  return (Math.max(0, Math.min(index, itemCount - 1)) / (itemCount - 1)) * 100;
}

function minimapIndexFromPointer(input: {
  itemCount: number;
  railTop: number;
  railHeight: number;
  pointerY: number;
}): number | null {
  if (input.itemCount <= 0 || input.railHeight <= 0) return null;
  if (input.itemCount === 1) return 0;
  const progress = Math.max(
    0,
    Math.min(1, (input.pointerY - input.railTop) / input.railHeight),
  );
  return Math.max(
    0,
    Math.min(input.itemCount - 1, Math.round(progress * (input.itemCount - 1))),
  );
}

function minimapHeightStyle(itemCount: number): string {
  const naturalHeight = Math.max(1, (itemCount - 1) * MINIMAP_ITEM_SPACING);
  return `min(${naturalHeight}px, ${MINIMAP_MAX_HEIGHT_CSS})`;
}

function minimapEventTargetsPreview(target: EventTarget): boolean {
  return (
    target instanceof Element &&
    target.closest("[data-minimap-preview]") !== null
  );
}

export function ThreadMinimap({
  items,
}: {
  items: ReadonlyArray<ThreadMinimapItem>;
}) {
  const { scrollToMessage } = useMessageScroller();
  const { visibleMessageIds } = useMessageScrollerVisibility();
  const containerRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  // The rail overlays the viewport's left edge while the content column is
  // centered; when the side gutter shrinks (narrow pane, artifact panel) the
  // hover strip is width-capped so it never sits on top of message text.
  const [hitStripWidth, setHitStripWidth] = useState(0);
  const [hasPersistentGutter, setHasPersistentGutter] = useState(false);

  useEffect(() => {
    const host = containerRef.current?.parentElement;
    if (!host) return;
    const update = () => {
      const width = host.clientWidth;
      const contentWidth = Math.min(width, MINIMAP_CONTENT_MAX_WIDTH);
      const sideGutter = Math.max(0, (width - contentWidth) / 2);
      setHitStripWidth(
        Math.max(
          0,
          Math.min(
            MINIMAP_HIT_STRIP_MAX_WIDTH,
            Math.floor(sideGutter) - MINIMAP_HIT_STRIP_LEFT,
          ),
        ),
      );
      setHasPersistentGutter(sideGutter >= MINIMAP_PERSISTENT_GUTTER);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  const visibleIds = useMemo(
    () => new Set(visibleMessageIds),
    [visibleMessageIds],
  );

  const resolvedActiveIndex =
    activeIndex !== null && activeIndex < items.length ? activeIndex : null;
  const activeItem =
    resolvedActiveIndex === null ? null : (items[resolvedActiveIndex] ?? null);
  const activeTopPercent =
    resolvedActiveIndex === null
      ? 0
      : minimapTopPercent(resolvedActiveIndex, items.length);
  const activeTooltipTranslate =
    resolvedActiveIndex === null
      ? "-50%"
      : resolvedActiveIndex === 0
        ? "0%"
        : resolvedActiveIndex === items.length - 1
          ? "-100%"
          : "-50%";

  const resolveActiveIndexFromPointer = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      const rect = event.currentTarget.getBoundingClientRect();
      return minimapIndexFromPointer({
        itemCount: items.length,
        railTop: rect.top,
        railHeight: rect.height,
        pointerY: event.clientY,
      });
    },
    [items.length],
  );

  const moveActiveIndex = useCallback(
    (delta: number) => {
      setActiveIndex((current) => {
        const base = current ?? 0;
        return Math.max(0, Math.min(items.length - 1, base + delta));
      });
    },
    [items.length],
  );

  const handleSelect = useCallback(
    (item: ThreadMinimapItem) => {
      scrollToMessage(item.id, {
        behavior: "smooth",
        align: "start",
        scrollMargin: 16,
      });
    },
    [scrollToMessage],
  );

  if (items.length < MINIMAP_MIN_ITEMS) {
    return null;
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        "group/minimap pointer-events-none absolute inset-y-0 left-0 z-40 hidden w-18 [@media(pointer:fine)]:block",
        hasPersistentGutter
          ? "opacity-100"
          : "opacity-0 transition-opacity duration-150 focus-within:opacity-100 hover:opacity-100",
      )}
      data-testid="thread-minimap"
    >
      <div className="relative h-full w-full select-none">
        <button
          aria-label={`Jump to message: ${activeItem?.userText ?? "User message"}`}
          className={cn(
            "absolute left-3 top-1/2 -translate-y-1/2 cursor-pointer bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70",
            hitStripWidth > 0 ? "pointer-events-auto" : "pointer-events-none",
          )}
          onBlur={() => setActiveIndex(null)}
          onClick={(event) => {
            if (minimapEventTargetsPreview(event.target)) return;
            const nextIndex = resolveActiveIndexFromPointer(event);
            const nextItem =
              nextIndex === null ? null : (items[nextIndex] ?? null);
            if (nextItem) handleSelect(nextItem);
            event.currentTarget.blur();
          }}
          onFocus={() => setActiveIndex((current) => current ?? 0)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              moveActiveIndex(1);
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              moveActiveIndex(-1);
            } else if (event.key === "Home") {
              event.preventDefault();
              setActiveIndex(0);
            } else if (event.key === "End") {
              event.preventDefault();
              setActiveIndex(items.length - 1);
            } else if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              if (activeItem) handleSelect(activeItem);
            }
          }}
          onMouseDown={(event) => {
            if (minimapEventTargetsPreview(event.target)) return;
            event.preventDefault();
          }}
          onMouseLeave={() => setActiveIndex(null)}
          onMouseMove={(event) =>
            setActiveIndex(resolveActiveIndexFromPointer(event))
          }
          style={{
            height: minimapHeightStyle(items.length),
            width:
              activeItem !== null
                ? MINIMAP_EXPANDED_HIT_STRIP_WIDTH
                : hitStripWidth,
          }}
          type="button"
        >
          <div className="absolute left-3 top-0 h-full w-px bg-border/15" />
          {items.map((item, index) => {
            const top = `${minimapTopPercent(index, items.length)}%`;
            const activeDistance =
              resolvedActiveIndex === null
                ? null
                : Math.abs(index - resolvedActiveIndex);
            return (
              <span
                aria-hidden="true"
                className={cn(
                  "pointer-events-none absolute left-0 h-0.5 -translate-y-1/2 rounded-full bg-muted-foreground/35 transition-[background-color,width] duration-150 data-[in-view=true]:bg-foreground/90",
                  activeDistance === 0
                    ? "w-6 bg-muted-foreground/75"
                    : activeDistance === 1
                      ? "w-4"
                      : activeDistance === 2
                        ? "w-2.5"
                        : "w-2",
                )}
                data-in-view={visibleIds.has(item.id) ? "true" : "false"}
                data-minimap-strip
                key={item.id}
                style={{ top }}
              />
            );
          })}
          {activeItem ? (
            <span
              className="pointer-events-auto absolute left-8 w-80 cursor-text select-text"
              data-minimap-preview
              onMouseMove={(event) => event.stopPropagation()}
              style={{
                top: `${activeTopPercent}%`,
                transform: `translateY(${activeTooltipTranslate})`,
              }}
            >
              <span className="block rounded-xl border border-border/60 bg-popover/95 p-3 text-left text-popover-foreground shadow-xl shadow-black/25 backdrop-blur">
                <span className="block max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-sm font-medium leading-5">
                  {activeItem.userText ?? "User message"}
                </span>
                {activeItem.assistantText ? (
                  <span className="mt-1 block max-h-28 overflow-hidden text-sm leading-5 text-muted-foreground">
                    {/* Formatted markdown, not raw text — headings/tables are
                        scaled down to preview size and the box crops rather
                        than line-clamps (block children break -webkit-box). */}
                    <Streamdown className="[&_*]:my-0 [&_h1]:text-sm [&_h2]:text-sm [&_h3]:text-sm [&_h4]:text-sm [&_table]:text-xs [&_pre]:text-xs [&_p]:text-sm space-y-1 [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold [&_button]:hidden">
                      {activeItem.assistantText.slice(
                        0,
                        MINIMAP_PREVIEW_MARKDOWN_CHARS,
                      )}
                    </Streamdown>
                  </span>
                ) : null}
              </span>
            </span>
          ) : null}
        </button>
      </div>
    </div>
  );
}
