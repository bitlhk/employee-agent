type SidebarFooterProps = {
  version: string;
  expiryText: string;
  expiryColor: string;
  collapsed?: boolean;
};

function normalizeVersion(version: string) {
  return String(version || "").replace(/\s*\(.*\)\s*$/, "").trim() || "unknown";
}

export function SidebarFooter({
  version,
  collapsed = false,
}: SidebarFooterProps) {
  const cleanVersion = normalizeVersion(version);

  return (
    <div className="sidebar-footer">
      {!collapsed && (
        <div
          className="sidebar-meta"
          style={{ padding: "0", lineHeight: 1, border: "none", background: "transparent" }}
        >
          <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            fontSize: "var(--oc-text-xs)",
            color: "var(--oc-sidebar-subtle, var(--oc-text-tertiary))",
            whiteSpace: "nowrap",
          }}
        >
            <span>{cleanVersion}</span>
          </div>
        </div>
      )}
    </div>
  );
}
