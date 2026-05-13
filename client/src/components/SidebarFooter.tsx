type SidebarFooterProps = {
  version: string;
  expiryText: string;
  expiryColor: string;
  collapsed?: boolean;
  onDocsClick?: () => void;
};

function normalizeVersion(version: string) {
  return String(version || "").replace(/\s*\(.*\)\s*$/, "").trim() || "unknown";
}

export function SidebarFooter({
  version,
  expiryText,
  expiryColor,
  collapsed = false,
  onDocsClick,
}: SidebarFooterProps) {
  const cleanVersion = normalizeVersion(version);

  return (
    <div className="sidebar-footer">
      {!collapsed && (
        <div
          className="sidebar-meta"
          style={{ padding: "10px 14px", lineHeight: 1 }}
        >
          {/* 版本行 */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 6,
            }}
          >
            <span
              style={{
                fontSize: "var(--oc-text-xs)",
                color: "var(--oc-text-secondary)",
                letterSpacing: "0.1px",
              }}
            >
              版本
            </span>
            <span
              style={{
                fontSize: "var(--oc-text-xs)",
                color: "var(--oc-text-secondary)",
                display: "flex",
                alignItems: "center",
                gap: 5,
              }}
            >
              {cleanVersion}
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: "#22c55e",
                  display: "inline-block",
                  flexShrink: 0,
                }}
              />
            </span>
          </div>
          {/* 有效期行 */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <span
              style={{
                fontSize: "var(--oc-text-xs)",
                color: "var(--oc-text-secondary)",
                letterSpacing: "0.1px",
              }}
            >
              有效期
            </span>
            <span
              style={{
                fontSize: "var(--oc-text-xs)",
                color: expiryColor,
                fontWeight: "var(--oc-weight-medium)",
              }}
            >
              {expiryText}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
