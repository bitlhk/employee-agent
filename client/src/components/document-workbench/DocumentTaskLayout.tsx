import { ArrowLeft } from "lucide-react";
import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";
import type {
  DocumentBottomDockProps,
  DocumentTaskHeaderProps,
  DocumentWorkbenchLayoutProps,
} from "./types";

const WORKBENCH_SIDE_PANEL_WIDTH = "min(720px, 42vw)";
const WORKBENCH_PREVIEW_TOP_OFFSET = "1rem";
const DEFAULT_BOTTOM_DOCK_SPACE = "8rem";
const COMPACT_BOTTOM_DOCK_SPACE = "9rem";

export function DocumentWorkbenchLayout({
  compact,
  selector,
  sidePanel,
  fixedLeft = "0px",
  topbarHeight = "var(--lingxia-topbar-height, 0px)",
  bottomDockSpace,
  previewBottomInset,
  children,
}: DocumentWorkbenchLayoutProps) {
  const dockSpace =
    bottomDockSpace ||
    (compact ? COMPACT_BOTTOM_DOCK_SPACE : DEFAULT_BOTTOM_DOCK_SPACE);
  const sidePanelBottomInset =
    previewBottomInset || (compact ? "1.5rem" : "1.25rem");
  return (
    <div
      className={compact ? "flex min-h-full" : "flex min-h-screen"}
      data-preview={Boolean(sidePanel)}
      style={
        {
          "--document-side-panel-width": sidePanel
            ? WORKBENCH_SIDE_PANEL_WIDTH
            : "0px",
          "--document-fixed-left": fixedLeft,
          "--document-topbar-height": topbarHeight,
          "--document-bottom-dock-space": dockSpace,
          "--document-preview-bottom-inset": sidePanelBottomInset,
          "--document-preview-top-offset": WORKBENCH_PREVIEW_TOP_OFFSET,
        } as CSSProperties
      }
    >
      {selector}
      <main className="relative flex min-w-0 flex-1">
        <section className="relative flex min-w-0 flex-1 flex-col">
          {children}
        </section>
        {sidePanel ? (
          <div className="sticky top-[var(--document-preview-top-offset)] z-30 hidden h-[calc(100dvh-var(--document-topbar-height)-var(--document-preview-top-offset)-var(--document-preview-bottom-inset))] w-[var(--document-side-panel-width)] max-w-[720px] min-w-[420px] shrink-0 pr-6 xl:block">
            {sidePanel}
          </div>
        ) : null}
      </main>
    </div>
  );
}

export function DocumentTaskHeader({
  icon,
  title,
  subtitle,
  onBack,
  actions,
}: DocumentTaskHeaderProps) {
  return (
    <header className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            title="返回办公空间"
            className="inline-flex items-center justify-center rounded-md p-1.5"
            style={{
              color: "var(--oc-text-secondary)",
              border: "1px solid var(--oc-border)",
              background: "var(--oc-panel)",
            }}
          >
            <ArrowLeft size={15} />
          </button>
        ) : null}
        {icon}
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">{title}</h2>
          {subtitle ? (
            <div
              className="truncate text-xs"
              style={{ color: "var(--oc-text-tertiary)" }}
            >
              {subtitle}
            </div>
          ) : null}
        </div>
      </div>
      {actions ? (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      ) : null}
    </header>
  );
}

export function DocumentBottomDock({
  leftClass = "",
  insetStyle,
  previewOpen,
  onDockSizeChange,
  showGradient = true,
  gradientClassName = "",
  gradientStyle,
  dockClassName,
  contentClassName = "w-full max-w-[720px]",
  children,
}: DocumentBottomDockProps) {
  const baseDockClass = dockClassName || "bottom-6 flex justify-center px-4";
  const dockRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!onDockSizeChange || !dockRef.current) return;
    const node = dockRef.current;
    let lastHeight = -1;
    const publish = () => {
      const height = Math.ceil(node.getBoundingClientRect().height);
      if (Math.abs(height - lastHeight) <= 1) return;
      lastHeight = height;
      onDockSizeChange(height);
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(node);
    window.addEventListener("resize", publish);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", publish);
    };
  }, [onDockSizeChange]);

  return (
    <>
      {showGradient ? (
        <div
          className={`pointer-events-none fixed bottom-0 left-0 right-0 z-10 h-32 xl:data-[preview=true]:right-[var(--document-side-panel-width)] ${leftClass} ${gradientClassName}`}
          data-preview={previewOpen}
          style={{
            ...(insetStyle || {}),
            background:
              "linear-gradient(to top, var(--oc-bg) 82%, color-mix(in oklab, var(--oc-bg) 94%, transparent))",
            ...(gradientStyle || {}),
          }}
        />
      ) : null}
      <div
        ref={dockRef}
        className={`pointer-events-none fixed left-0 right-0 z-20 ${baseDockClass} ${leftClass}`}
        data-preview={previewOpen}
        style={insetStyle}
      >
        <div className={contentClassName} data-preview={previewOpen}>
          {children}
        </div>
      </div>
    </>
  );
}
