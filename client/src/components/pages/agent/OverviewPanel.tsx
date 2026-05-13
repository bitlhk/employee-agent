import type { CoreFileMeta, EffectiveResp, ToolPolicy } from "./types";

export function OverviewPanel({
  adoptId,
  effective,
  policy,
  coreFiles,
  sharedSkills,
  systemSkills,
  privateSkills,
  visibleTools,
  runnableTools,
}: {
  adoptId: string;
  effective: EffectiveResp | null;
  policy: ToolPolicy | null;
  coreFiles: CoreFileMeta[];
  sharedSkills: any[];
  systemSkills: any[];
  privateSkills: any[];
  visibleTools: number;
  runnableTools: number;
}) {
  const allSkills = [...(sharedSkills || []), ...(systemSkills || []), ...(privateSkills || [])];
  const visibleSkills = allSkills.filter((s: any) => s?.visible !== false).length;
  const runnableSkills = allSkills.filter((s: any) => s?.runnable !== false).length;
  const existingFiles = coreFiles.filter((f) => f.exists).length;

  return (
    <div className="grid gap-3 max-w-5xl">
      <div className="settings-card">
        <div className="text-sm font-semibold" style={{ color: "var(--oc-text-primary)" }}>Identity</div>
        <dl className="mt-2 text-xs space-y-1" style={{ color: "var(--oc-text-secondary)" }}>
          <div className="flex justify-between"><dt>adoptId</dt><dd className="font-mono">{adoptId || "-"}</dd></div>
          <div className="flex justify-between"><dt>session</dt><dd className="font-mono">{effective?.sessionKey || "-"}</dd></div>
          <div className="flex justify-between"><dt>mode</dt><dd>{effective?.resolutionMode || "-"}</dd></div>
        </dl>
      </div>

      <div className="settings-card">
        <div className="text-sm font-semibold" style={{ color: "var(--oc-text-primary)" }}>Execution</div>
        <dl className="mt-2 text-xs space-y-1" style={{ color: "var(--oc-text-secondary)" }}>
          <div className="flex justify-between">
            <dt>exec 模式</dt>
            <dd className="font-mono">{policy?.profile === "coding" ? "sandbox_exec (Docker)" : policy?.profile === "full" ? "native exec" : "disabled"}</dd>
          </div>
          <div className="flex justify-between">
            <dt>宿主 exec</dt>
            <dd style={{ color: policy?.profile === "full" ? "#22c55e" : "#ef4444" }}>{policy?.profile === "full" ? "ON" : "OFF"}</dd>
          </div>
          <div className="flex justify-between">
            <dt>sandbox_exec</dt>
            <dd style={{ color: policy?.profile === "coding" || policy?.profile === "full" ? "#22c55e" : "#6b7280" }}>{policy?.profile === "coding" ? "ON (Docker 隔离)" : policy?.profile === "full" ? "ON (native)" : "OFF"}</dd>
          </div>
          {policy?.profile === "coding" && (
            <div className="mt-1 text-[11px]" style={{ color: "#6b7280" }}>
              限制：--network none · --memory 256m · --cpus 0.5 · --pids-limit 50 · --read-only · --cap-drop ALL
            </div>
          )}
        </dl>
      </div>

      <div className="settings-card">
        <div className="text-sm font-semibold" style={{ color: "var(--oc-text-primary)" }}>Tool Profile</div>
        <dl className="mt-2 text-xs space-y-1" style={{ color: "var(--oc-text-secondary)" }}>
          <div className="flex justify-between"><dt>profile</dt><dd className="font-mono">{policy?.profile || "-"}</dd></div>
          <div className="flex justify-between"><dt>source</dt><dd className="font-mono">{policy?.source || "-"}</dd></div>
          <div><dt>allow</dt><dd className="font-mono">{(policy?.allow || []).join(", ") || "-"}</dd></div>
          <div><dt>alsoAllow</dt><dd className="font-mono">{(policy?.alsoAllow || []).join(", ") || "-"}</dd></div>
          <div><dt>deny</dt><dd className="font-mono">{(policy?.deny || []).join(", ") || "-"}</dd></div>
        </dl>
      </div>

      <div className="settings-card">
        <div className="text-sm font-semibold" style={{ color: "var(--oc-text-primary)" }}>Runtime Summary</div>
        <div className="mt-2 grid grid-cols-2 gap-2 text-xs" style={{ color: "var(--oc-text-secondary)" }}>
          <div>Skills: visible {visibleSkills}/{allSkills.length}</div>
          <div>Skills: runnable {runnableSkills}/{allSkills.length}</div>
          <div>Tools: visible {visibleTools}/{visibleTools}</div>
          <div>Tools: runnable {runnableTools}/{visibleTools}</div>
          <div>Core Files: visible {coreFiles.length}/{coreFiles.length}</div>
          <div>Core Files: exists {existingFiles}/{coreFiles.length}</div>
        </div>
      </div>
    </div>
  );
}
