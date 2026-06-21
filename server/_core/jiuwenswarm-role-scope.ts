import path from "path";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, symlinkSync, unlinkSync, writeFileSync } from "fs";
import type { AgentRoleTemplate } from "./role-templates";
import type { EffectiveRoleAssets } from "./role-asset-grants";

export const JIUWENSWARM_ROLE_SCOPE_MANIFEST = ".linggan-role-scope.json";

export type JiuwenSwarmRoleScopeManifest = {
  version: 1;
  runtime: "jiuwenswarm";
  role: {
    id: string;
    name: string;
    industry: string;
    status: string;
  };
  effectiveAssets: EffectiveRoleAssets;
  enforcement: {
    skills: "per-agent-workspace";
    mcp: "service-side-agent-context";
  };
};

export type JiuwenSwarmRoleScopeWriteResult = {
  manifestPath: string;
  changed: boolean;
  linkedSharedSkills: string[];
  removedSharedSkills: string[];
};

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean))).sort();
}

function defaultRoleSkillIds(effectiveAssets: EffectiveRoleAssets): string[] {
  return uniqueSorted(effectiveAssets.skills.default);
}

function activeRoleSkillIds(effectiveAssets: EffectiveRoleAssets, activeSkillIds: string[] = []): string[] {
  return uniqueSorted([
    ...effectiveAssets.skills.default,
    ...activeSkillIds,
  ]);
}

export function buildJiuwenSwarmRoleScopeManifest(
  role: AgentRoleTemplate,
  effectiveAssets: EffectiveRoleAssets,
): JiuwenSwarmRoleScopeManifest {
  return {
    version: 1,
    runtime: "jiuwenswarm",
    role: {
      id: role.id,
      name: role.name,
      industry: role.industry,
      status: role.status,
    },
    effectiveAssets,
    enforcement: {
      skills: "per-agent-workspace",
      mcp: "service-side-agent-context",
    },
  };
}

export function writeJiuwenSwarmRoleScopeManifest(args: {
  workspaceDir: string;
  role: AgentRoleTemplate;
  effectiveAssets: EffectiveRoleAssets;
  sharedSkillsDir?: string | null;
  skillSourceDirs?: string[];
  activeSkillIds?: string[];
}): JiuwenSwarmRoleScopeWriteResult {
  const workspaceDir = path.resolve(args.workspaceDir);
  const manifestPath = path.join(workspaceDir, JIUWENSWARM_ROLE_SCOPE_MANIFEST);
  const manifest = buildJiuwenSwarmRoleScopeManifest(args.role, args.effectiveAssets);
  const next = `${JSON.stringify(manifest, null, 2)}\n`;
  const current = existsSync(manifestPath) ? readFileSync(manifestPath, "utf8") : "";

  mkdirSync(workspaceDir, { recursive: true });
  mkdirSync(path.join(workspaceDir, "skills"), { recursive: true });

  const skillSourceDirs = uniqueSorted([
    ...(args.skillSourceDirs || []),
    ...(args.sharedSkillsDir ? [args.sharedSkillsDir] : []),
  ]);

  const linkResult = skillSourceDirs.length > 0
    ? reconcileJiuwenSwarmSharedSkillLinks({
      workspaceDir,
      sharedSkillsDirs: skillSourceDirs,
      allowedSkillIds: activeRoleSkillIds(args.effectiveAssets, args.activeSkillIds || []),
    })
    : { linkedSharedSkills: [], removedSharedSkills: [] };

  if (current === next) return { manifestPath, changed: false, ...linkResult };

  writeFileSync(manifestPath, next, "utf8");
  return { manifestPath, changed: true, ...linkResult };
}

export function reconcileJiuwenSwarmSharedSkillLinks(params: {
  workspaceDir: string;
  sharedSkillsDir?: string;
  sharedSkillsDirs?: string[];
  allowedSkillIds: string[];
}): { linkedSharedSkills: string[]; removedSharedSkills: string[] } {
  const allowed = new Set(uniqueSorted(params.allowedSkillIds));
  const linkedSharedSkills: string[] = [];
  const removedSharedSkills: string[] = [];
  const workspaceSkillsDir = path.join(params.workspaceDir, "skills");
  const sharedSkillsDirs = uniqueSorted([
    ...(params.sharedSkillsDirs || []),
    ...(params.sharedSkillsDir ? [params.sharedSkillsDir] : []),
  ]).filter((dir) => existsSync(dir));
  if (sharedSkillsDirs.length === 0) return { linkedSharedSkills, removedSharedSkills };
  mkdirSync(workspaceSkillsDir, { recursive: true });
  const sharedRoots = sharedSkillsDirs.map((dir) => path.resolve(dir));

  for (const entry of readdirSync(workspaceSkillsDir, { withFileTypes: true })) {
    const skillId = entry.name;
    const skillPath = path.join(workspaceSkillsDir, skillId);
    if (!entry.isSymbolicLink()) continue;
    let target = "";
    try {
      target = lstatSync(skillPath).isSymbolicLink() ? readlinkSync(skillPath) : "";
    } catch {
      continue;
    }
    const resolvedTarget = path.resolve(path.dirname(skillPath), target);
    const isManagedLink = sharedRoots.some((sharedRoot) =>
      resolvedTarget.startsWith(sharedRoot + path.sep) || resolvedTarget === sharedRoot
    );
    if (!isManagedLink) continue;
    if (!allowed.has(skillId)) {
      unlinkSync(skillPath);
      removedSharedSkills.push(skillId);
    }
  }

  for (const skillId of allowed) {
    const sharedRoot = sharedSkillsDirs.find((dir) => existsSync(path.join(dir, skillId)));
    if (!sharedRoot) continue;
    const sharedPath = path.join(sharedRoot, skillId);
    const linkPath = path.join(workspaceSkillsDir, skillId);
    if (!existsSync(sharedPath) || existsSync(linkPath)) continue;
    symlinkSync(path.relative(path.dirname(linkPath), sharedPath), linkPath, "dir");
    linkedSharedSkills.push(skillId);
  }

  return {
    linkedSharedSkills: linkedSharedSkills.sort(),
    removedSharedSkills: removedSharedSkills.sort(),
  };
}
