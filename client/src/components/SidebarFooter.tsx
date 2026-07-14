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
        <div className="sidebar-meta sidebar-footer-meta">
          <div className="sidebar-footer-row">
            <a
              className="sidebar-footer-link"
              href="https://atomgit.com/openJiuwen/jiuwenswarm"
              target="_blank"
              rel="noreferrer"
              title="访问 JiuwenSwarm 代码仓"
            >
              {cleanVersion}
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
