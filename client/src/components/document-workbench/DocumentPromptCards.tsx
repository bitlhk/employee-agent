import { MoveUpRight } from "lucide-react";
import type { DocumentPromptCardsProps } from "./types";

export function DocumentPromptCards({
  title = "示例提示词",
  prompts,
  disabled,
  onChoose,
}: DocumentPromptCardsProps) {
  if (!prompts.length) return null;
  return (
    <section className="mx-auto w-full max-w-[760px]">
      <div
        className="mb-2 text-left text-sm font-semibold"
        style={{ color: "var(--oc-text-primary)" }}
      >
        {title}
      </div>
      <div className="grid grid-cols-4 gap-3">
        {prompts.map(item => {
          const displayText = item.replace(/[。.!！]$/u, "");
          return (
            <button
              key={item}
              type="button"
              disabled={disabled}
              onClick={() => onChoose(displayText)}
              className="relative h-16 min-w-0 rounded-[12px] px-4 py-3 text-left text-[13px] leading-5 transition-colors hover:bg-[var(--oc-bg-soft)] disabled:cursor-not-allowed"
              style={{
                background: "var(--oc-card)",
                border:
                  "1px solid color-mix(in oklab, var(--oc-border) 82%, var(--oc-card))",
                color: disabled
                  ? "var(--oc-text-tertiary)"
                  : "var(--oc-text-secondary)",
              }}
            >
              <span
                className="block pr-4"
                style={{
                  display: "block",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {displayText}
              </span>
              <MoveUpRight
                size={14}
                className="absolute bottom-3 right-3"
                style={{ color: "var(--oc-text-tertiary)" }}
              />
            </button>
          );
        })}
      </div>
    </section>
  );
}
