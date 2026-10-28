/**
 * Scroll reveals: each `[data-reveal]` fades and rises into place the first time it enters the
 * viewport. Then the tagline: its words turn from muted to full one at a time, in reading order,
 * as the reader scrolls through it. Scroll work is batched into one requestAnimationFrame.
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

  const tagline = document.querySelector<HTMLElement>("[data-tagline]");
  if (!tagline) return;
  const words = [...tagline.querySelectorAll<HTMLElement>("[data-word]")];
  let frame = 0;
  // Progress runs from the block's top reaching 75% of the viewport to its bottom reaching 45%;
  // that share of the words, counted in reading order, is lit.
  const update = () => {
    frame = 0;
    const vh = window.innerHeight;
    const rect = tagline.getBoundingClientRect();
    const progress = Math.min(1, Math.max(0, (vh * 0.75 - rect.top) / (rect.height + vh * 0.3)));
    const lit = Math.round(progress * words.length);
    words.forEach((word, i) => {
      word.classList.toggle("is-on", i < lit);
    });
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(update);
  };
  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", schedule);
  update();
}
