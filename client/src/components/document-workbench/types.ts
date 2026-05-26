import type { CSSProperties, ReactNode, RefObject } from "react";

export type DocumentTaskHeaderProps = {
  icon?: ReactNode;
  title: string;
  subtitle?: string;
  onBack?: () => void;
  actions?: ReactNode;
};

export type DocumentComposerAttachment = {
  name: string;
};

export type DocumentComposerProps = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  busy?: boolean;
  placeholder?: string;
  rows?: number;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
  attachments?: DocumentComposerAttachment[];
  onAdd?: () => void;
  onAttachFiles?: (files: FileList | null) => void;
  attachmentAccept?: string;
  onRemoveAttachment?: (name: string) => void;
  selectedLabel?: string;
  showSelectedPill?: boolean;
  showSelectedHeader?: boolean;
  onClearSelection?: () => void;
  compact?: boolean;
  activeTone?: "dark" | "accent";
};

export type DocumentPromptCardsProps = {
  title?: string;
  prompts: string[];
  disabled?: boolean;
  onChoose: (prompt: string) => void;
};

export type DocumentBottomDockProps = {
  leftClass?: string;
  insetStyle?: CSSProperties;
  previewOpen?: boolean;
  onDockSizeChange?: (height: number) => void;
  showGradient?: boolean;
  gradientClassName?: string;
  gradientStyle?: CSSProperties;
  dockClassName?: string;
  contentClassName?: string;
  children: ReactNode;
};

export type DocumentWorkbenchLayoutProps = {
  compact?: boolean;
  selector?: ReactNode;
  sidePanel?: ReactNode;
  fixedLeft?: string;
  topbarHeight?: string;
  bottomDockSpace?: string;
  previewBottomInset?: string;
  children: ReactNode;
};

export type DocumentUserPromptBubbleProps = {
  prompt: string;
};

export type DocumentTimelineProps = {
  compact?: boolean;
  children: ReactNode;
};

export type DocumentArtifactCardProps = {
  name: string;
  typeLabel: string;
  sizeLabel?: string;
  previewable?: boolean;
  downloadUrl?: string;
  onPreview?: () => void;
};
