import { useLayoutEffect, useState } from "react";
import { APP_SCROLL_ID } from "@/components/app-shell";

/** The least the register keeps for its rows: below it, the page scrolls instead. */
export const MIN_REGISTER_HEIGHT = 320;

/**
 * The height from `top` to the bottom of the page's own scroll area, less the page's bottom
 * padding: what a scroll area at `top` can take so it ends at the window's foot and the page itself
 * doesn't scroll. `contentTop` is where it starts within the page's scrolled content.
 */
export function remainingHeight({
  viewportHeight,
  contentTop,
  bottomPadding,
  min = MIN_REGISTER_HEIGHT,
}: {
  viewportHeight: number;
  contentTop: number;
  bottomPadding: number;
  min?: number;
}) {
  return Math.max(min, Math.floor(viewportHeight - contentTop - bottomPadding));
}

/**
 * The register's scroll area fills the window below whatever is above it (the toolbar, an
 * account's balances, a banner): one scroll area, ending at the page's foot, re-measured as the
 * window or the page above it changes size. Null until measured, or outside the app's scroll area.
 */
export function useRemainingHeight(target: HTMLElement | null) {
  const [height, setHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    const page = target?.closest<HTMLElement>(`#${APP_SCROLL_ID}`);
    if (!target || !page) return;
    // The page's padded content box (inside the scroll area's own wrapper).
    const content = page.firstElementChild?.firstElementChild ?? null;
    const measure = () => {
      const contentTop =
        target.getBoundingClientRect().top - page.getBoundingClientRect().top + page.scrollTop;
      const bottomPadding =
        content instanceof HTMLElement
          ? Number.parseFloat(getComputedStyle(content).paddingBottom) || 0
          : 0;
      setHeight(remainingHeight({ viewportHeight: page.clientHeight, contentTop, bottomPadding }));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(page);
    if (content) observer.observe(content);
    return () => observer.disconnect();
  }, [target]);
  return height;
}
