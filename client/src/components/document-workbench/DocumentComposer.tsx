import {
  ArrowUp,
  AudioLines,
  Loader2,
  Mic,
  Paperclip,
  Plus,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import type { DocumentComposerProps } from "./types";

export function DocumentComposer({
  value,
  onChange,
  onSubmit,
  disabled,
  busy,
  placeholder = "分配一个任务或提问任何问题",
  rows,
  textareaRef,
  attachments = [],
  onAdd,
  onAttachFiles,
  attachmentAccept,
  onRemoveAttachment,
  selectedLabel,
  showSelectedPill,
  showSelectedHeader,
  onClearSelection,
  compact = true,
  activeTone = "dark",
}: DocumentComposerProps) {
  const active = value.trim().length > 0 && !disabled && !busy;
  const submitTitle = busy ? "执行中" : compact ? "开始任务" : "发送";
  const submitColor =
    activeTone === "accent" ? "var(--oc-accent)" : "var(--oc-text-primary)";

  return (
    <div
      className={`${compact ? "pointer-events-auto mx-auto w-full rounded-[16px] border px-5 py-3 backdrop-blur-xl focus-within:border-[var(--oc-text-tertiary)]" : "pointer-events-auto rounded-[18px] border bg-white/95 px-3 py-2 shadow-[0_18px_48px_rgba(15,23,42,0.14)] backdrop-blur-xl"}`}
      style={
        compact
          ? {
              background: showSelectedPill
                ? "color-mix(in oklab, var(--oc-bg-surface) 92%, transparent)"
                : "color-mix(in oklab, var(--oc-bg-surface) 82%, transparent)",
              borderColor:
                "color-mix(in oklab, var(--oc-border) 88%, var(--oc-text-tertiary))",
              boxShadow: showSelectedPill
                ? "0 10px 24px rgba(15, 23, 42, 0.035)"
                : "0 2px 8px rgba(15, 23, 42, 0.025)",
              minHeight: showSelectedPill ? 128 : 128,
            }
          : { borderColor: "var(--oc-border)" }
      }
    >
      {showSelectedHeader && selectedLabel ? (
        <div
          className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-2xl px-3 py-2"
          style={{ background: "var(--oc-bg-soft)" }}
        >
          <div className="flex min-w-0 items-center gap-2">
            <span
              className="rounded-full px-2 py-0.5 text-[11px] font-medium"
              style={{
                background:
                  "color-mix(in oklab, var(--oc-accent) 12%, transparent)",
                color: "var(--oc-accent)",
              }}
            >
              已选任务
            </span>
            <span
              className="truncate text-xs font-medium"
              style={{ color: "var(--oc-text-primary)" }}
            >
              {selectedLabel}
            </span>
          </div>
          {onClearSelection ? (
            <button
              type="button"
              onClick={onClearSelection}
              disabled={disabled || busy}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
              style={{ color: "var(--oc-text-secondary)" }}
              title="退出任务模式"
            >
              <X size={14} />
            </button>
          ) : null}
        </div>
      ) : null}

      {attachments.length ? (
        <div className="mb-2 flex flex-wrap gap-2 px-1">
          {attachments.map(attachment => (
            <span
              key={attachment.name}
              className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs"
              style={{
                background: "var(--oc-bg-soft)",
                color: "var(--oc-text-secondary)",
              }}
            >
              <Paperclip size={13} />
              {attachment.name}
              {onRemoveAttachment ? (
                <button
                  type="button"
                  onClick={() => onRemoveAttachment(attachment.name)}
                  aria-label={`移除 ${attachment.name}`}
                >
                  <X size={13} />
                </button>
              ) : null}
            </span>
          ))}
        </div>
      ) : null}

      <div
        className={
          compact
            ? "flex h-full min-h-[98px] flex-col"
            : "flex items-center gap-2"
        }
      >
        {!compact ? (
          onAdd ? (
            <button
              type="button"
              onClick={onAdd}
              disabled={disabled || busy}
              className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
              style={{ color: "var(--oc-text-secondary)" }}
              title="上传附件"
            >
              <Plus size={20} />
            </button>
          ) : (
            <label
              className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full transition hover:bg-slate-100"
              style={{ color: "var(--oc-text-secondary)" }}
              title="上传附件"
            >
              <Plus size={20} />
              <input
                type="file"
                multiple
                accept={attachmentAccept}
                className="hidden"
                onChange={event => onAttachFiles?.(event.target.files)}
              />
            </label>
          )
        ) : null}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={event => onChange(event.target.value)}
          onKeyDown={event => {
            if (
              event.key !== "Enter" ||
              event.shiftKey ||
              event.nativeEvent.isComposing
            )
              return;
            event.preventDefault();
            if (active) onSubmit();
          }}
          disabled={disabled || busy}
          rows={compact ? 2 : (rows ?? 1)}
          spellCheck={false}
          className={`${compact ? "min-h-0 flex-1 px-0 pb-1 pt-0 text-[15px] leading-6 placeholder:text-slate-400" : "max-h-[256px] min-h-10 flex-1 px-1 py-2 text-sm leading-6"} resize-none border-0 bg-transparent outline-none ring-0 focus:border-transparent focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0`}
          style={{ color: "var(--oc-text-primary)", boxShadow: "none" }}
          placeholder={placeholder}
        />
        {compact ? (
          <div className="flex h-9 shrink-0 items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              {onAdd ? (
                <button
                  type="button"
                  disabled={disabled || busy}
                  onClick={onAdd}
                  className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                  style={{
                    color: "var(--oc-text-secondary)",
                    background:
                      "color-mix(in oklab, var(--oc-text-secondary) 8%, transparent)",
                    border:
                      "1px solid color-mix(in oklab, var(--oc-border) 80%, transparent)",
                  }}
                  title="上传附件"
                >
                  <Plus size={17} />
                </button>
              ) : (
                <label
                  className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full transition hover:bg-slate-100"
                  style={{
                    color: "var(--oc-text-secondary)",
                    background:
                      "color-mix(in oklab, var(--oc-text-secondary) 8%, transparent)",
                    border:
                      "1px solid color-mix(in oklab, var(--oc-border) 80%, transparent)",
                  }}
                  title="上传附件"
                >
                  <Plus size={17} />
                  <input
                    type="file"
                    multiple
                    accept={attachmentAccept}
                    className="hidden"
                    onChange={event => onAttachFiles?.(event.target.files)}
                  />
                </label>
              )}
              {showSelectedPill && selectedLabel ? (
                <span
                  className="inline-flex h-8 max-w-[190px] items-center gap-1.5 rounded-full px-3 text-xs"
                  style={{
                    background:
                      "color-mix(in oklab, var(--oc-info) 12%, var(--oc-bg-elevated))",
                    color: "var(--oc-info)",
                    border:
                      "1px solid color-mix(in oklab, var(--oc-info) 24%, var(--oc-border))",
                  }}
                >
                  <Sparkles size={13} />
                  <span className="truncate">{selectedLabel}</span>
                  {onClearSelection ? (
                    <button
                      type="button"
                      onClick={onClearSelection}
                      disabled={disabled || busy}
                      className="-mr-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition hover:bg-black/10 disabled:cursor-not-allowed disabled:opacity-50"
                      title="移除当前能力"
                    >
                      <X size={12} />
                    </button>
                  ) : null}
                </span>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                className="flex h-8 w-8 items-center justify-center rounded-full transition hover:bg-slate-100"
                style={{ color: "var(--oc-text-secondary)" }}
                title="语音"
              >
                <AudioLines size={16} />
              </button>
              <button
                type="button"
                className="flex h-8 w-8 items-center justify-center rounded-full transition hover:bg-slate-100"
                style={{ color: "var(--oc-text-secondary)" }}
                title="麦克风"
              >
                <Mic size={16} />
              </button>
              <button
                type="button"
                onClick={onSubmit}
                disabled={!active}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition disabled:cursor-not-allowed"
                style={{
                  background: active
                    ? submitColor
                    : "color-mix(in oklab, var(--oc-text-secondary) 14%, transparent)",
                  color: active ? "var(--oc-bg)" : "var(--oc-text-tertiary)",
                }}
                title={submitTitle}
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ArrowUp size={16} />
                )}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={onSubmit}
            disabled={!active}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white transition disabled:cursor-not-allowed disabled:opacity-50"
            style={{
              background: active
                ? submitColor
                : "color-mix(in oklab, var(--oc-text-secondary) 16%, transparent)",
              color: active ? "var(--oc-bg)" : "var(--oc-text-tertiary)",
            }}
            title={submitTitle}
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send size={16} />
            )}
          </button>
        )}
      </div>
    </div>
  );
}
