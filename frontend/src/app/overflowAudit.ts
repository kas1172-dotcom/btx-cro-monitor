// DEV-ONLY overflow auditor. Call after route/view changes in development builds.
// Walks key containers and warns about any element whose scroll dimensions exceed
// its client box by >2px. Provides a CSS selector path for easy identification.

function selectorPath(el: Element): string {
  const parts: string[] = [];
  let current: Element | null = el;
  while (current && current !== document.body) {
    let selector = current.tagName.toLowerCase();
    if (current.id) {
      selector += `#${current.id}`;
    } else if (current.className && typeof current.className === "string") {
      const classes = current.className.trim().split(/\s+/).slice(0, 3).join(".");
      if (classes) selector += `.${classes}`;
    }
    parts.unshift(selector);
    current = current.parentElement;
  }
  return parts.join(" > ");
}

const AUDIT_SELECTORS = [
  ".today-strip button",
  ".brain-rail-btn",
  ".sample-library-list button",
  ".ask-action-row button",
  ".current-account-row",
  ".rec-row",
  ".map-prospect",
  ".memory-row",
  ".document-section",
  "td",
  "th",
  ".chip",
  ".tour-typewriter",
  ".recent-line",
];

export function runOverflowAudit(): void {
  const env = (import.meta as ImportMeta & { env?: { PROD?: boolean } }).env;
  if (env?.PROD) return;
  let count = 0;
  for (const selector of AUDIT_SELECTORS) {
    const elements = document.querySelectorAll(selector);
    for (const el of elements) {
      const { scrollWidth, scrollHeight, clientWidth, clientHeight } = el;
      const overflowX = scrollWidth - clientWidth;
      const overflowY = scrollHeight - clientHeight;
      if (overflowX > 2 || overflowY > 2) {
        const path = selectorPath(el);
        if (overflowX > 2) console.warn(`[overflow-x +${overflowX}px] ${path}`);
        if (overflowY > 2) console.warn(`[overflow-y +${overflowY}px] ${path}`);
        count++;
      }
    }
  }
  if (count === 0) console.info("[overflow-audit] ✓ no overflow detected");
}
