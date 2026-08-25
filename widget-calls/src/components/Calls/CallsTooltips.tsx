import { useEffect, useRef } from "react";

const TOUCH_TOOLTIP_MS = 4200;

/** Presentation-only tooltip bridge for existing title attributes. */
export default function CallsTooltips() {
  const anchorRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const anchor = anchorRef.current;
    const root = anchor?.closest<HTMLElement>(".calls-page");
    if (!root) return;
    const tooltip = document.createElement("div");
    tooltip.className = "calls-tooltip";
    tooltip.setAttribute("role", "tooltip");
    tooltip.setAttribute("aria-hidden", "true");
    tooltip.hidden = true;
    document.body.appendChild(tooltip);
    let hideTimer: number | undefined;
    let touchMode = false;
    const prepare = (element: Element) => {
      if (!(element instanceof HTMLElement)) return;
      const title = element.getAttribute("title");
      if (title && !element.dataset.callsTooltip) { element.dataset.callsTooltip = title; element.removeAttribute("title"); }
    };
    const prepareAll = () => root.querySelectorAll<HTMLElement>("[title]").forEach(prepare);
    const hide = () => { if (hideTimer) window.clearTimeout(hideTimer); hideTimer = undefined; tooltip.hidden = true; };
    const show = (target: HTMLElement, temporary: boolean) => {
      const text = target.dataset.callsTooltip;
      if (!text) return;
      if (hideTimer) window.clearTimeout(hideTimer);
      tooltip.textContent = text; tooltip.hidden = false;
      const rect = target.getBoundingClientRect();
      const maxWidth = Math.min(320, window.innerWidth - 24);
      tooltip.style.maxWidth = `${maxWidth}px`;
      tooltip.style.left = `${Math.max(12, Math.min(window.innerWidth - maxWidth - 12, rect.left + rect.width / 2 - maxWidth / 2))}px`;
      const tooltipHeight = tooltip.offsetHeight;
      let tooltipTop = rect.top - tooltipHeight - 10;
      if (tooltipTop < 12) tooltipTop = rect.bottom + 10;
      if (tooltipTop + tooltipHeight > window.innerHeight - 12) {
        tooltipTop = Math.max(12, window.innerHeight - tooltipHeight - 12);
      }
      tooltip.style.top = String(tooltipTop) + "px";      hideTimer = window.setTimeout(hide, TOUCH_TOOLTIP_MS);
    };
    const targetFor = (event: Event) => (event.target as Element | null)?.closest<HTMLElement>("[data-calls-tooltip]");
    const onPointerOver = (event: PointerEvent) => { const target = targetFor(event); if (!target || !root.contains(target)) return; touchMode = event.pointerType === "touch" || event.pointerType === "pen"; show(target, touchMode); };
    const onPointerOut = (event: PointerEvent) => { if (touchMode) return; const target = targetFor(event); const related = event.relatedTarget as Node | null; if (target && (!related || !target.contains(related))) hide(); };
    const onPointerDown = (event: PointerEvent) => { const target = targetFor(event); if (target && root.contains(target)) show(target, true); };
    const onFocusIn = (event: FocusEvent) => { const target = targetFor(event); if (target && root.contains(target)) show(target, false); };
    const onFocusOut = () => hide();
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") hide(); };
    prepareAll();
    const observer = new MutationObserver(prepareAll);
    observer.observe(root, { childList: true, subtree: true });
    root.addEventListener("pointerover", onPointerOver); root.addEventListener("pointerout", onPointerOut); root.addEventListener("pointerdown", onPointerDown); root.addEventListener("focusin", onFocusIn); root.addEventListener("focusout", onFocusOut); root.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", hide); window.addEventListener("scroll", hide, true);
    return () => { observer.disconnect(); hide(); root.querySelectorAll<HTMLElement>("[data-calls-tooltip]").forEach((element) => { element.setAttribute("title", element.dataset.callsTooltip || ""); delete element.dataset.callsTooltip; }); root.removeEventListener("pointerover", onPointerOver); root.removeEventListener("pointerout", onPointerOut); root.removeEventListener("pointerdown", onPointerDown); root.removeEventListener("focusin", onFocusIn); root.removeEventListener("focusout", onFocusOut); root.removeEventListener("keydown", onKeyDown); window.removeEventListener("resize", hide); window.removeEventListener("scroll", hide, true); tooltip.remove(); };
  }, []);
  return <span ref={anchorRef} className="calls-tooltip-anchor" aria-hidden="true" />;
}