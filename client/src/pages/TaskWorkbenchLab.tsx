import DocumentTaskWorkbench, { type DocumentTaskWorkbenchProps } from "@/components/document-workbench/DocumentTaskWorkbench";

export type TaskWorkbenchLabProps = DocumentTaskWorkbenchProps;

export default function TaskWorkbenchLab(props: TaskWorkbenchLabProps = {}) {
  return <DocumentTaskWorkbench {...props} />;
}
