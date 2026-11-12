/**
 * Scroll reveals: each `[data-reveal]` fades and rises into place the first time it enters the
 * viewport.
 */
export function initReveal() {
  const reveals = document.querySelectorAll<HTMLElement>("[data-reveal]");
  if (!("IntersectionObserver" in window)) {
    for (const el of reveals) el.classList.add("is-visible");
  } else {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -10% 0px" },
    );
    for (const el of reveals) observer.observe(el);
  }
}
