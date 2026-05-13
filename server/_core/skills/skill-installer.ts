import { execFileSync } from "child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from "fs";
import os from "os";
import path from "path";

export type SkillInstallKind = "directory" | "zip";

export type SkillInstallResult = {
  kind: SkillInstallKind;
  sourceRoot: string;
};

export interface SkillInstaller {
  installFromSource(sourcePath: string, runtimePath: string): SkillInstallResult;
  canInstall(sourcePath: string): boolean;
}

function isZipSource(sourcePath: string): boolean {
  const ext = path.extname(sourcePath).toLowerCase();
  return ext === ".zip" || ext === ".skill";
}

function hasSkillManifest(dir: string): boolean {
  return existsSync(path.join(dir, "SKILL.md"));
}

function findSkillRoot(dir: string, depth = 0): string | null {
  if (hasSkillManifest(dir)) return dir;
  if (depth >= 3) return null;
  const candidates: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const found = findSkillRoot(path.join(dir, entry.name), depth + 1);
    if (found) candidates.push(found);
  }
  if (candidates.length === 1) return candidates[0];
  if (candidates.length > 1) {
    throw new Error("zip contains multiple skill roots; please upload one skill package at a time");
  }
  return null;
}

function safeExtractZip(zipPath: string, destPath: string): void {
  const script = `
import os, sys, zipfile
zip_path, dest = sys.argv[1], sys.argv[2]
base = os.path.realpath(dest)
with zipfile.ZipFile(zip_path) as z:
    for member in z.infolist():
        target = os.path.realpath(os.path.join(dest, member.filename))
        if target != base and not target.startswith(base + os.sep):
            raise RuntimeError("zip entry escapes target directory: " + member.filename)
    z.extractall(dest)
`;
  execFileSync("python3", ["-c", script, zipPath, destPath], { stdio: "pipe" });
}

export class FileSystemSkillInstaller implements SkillInstaller {
  canInstall(sourcePath: string): boolean {
    if (!existsSync(sourcePath)) return false;
    try {
      const stat = statSync(sourcePath);
      return stat.isDirectory() || isZipSource(sourcePath);
    } catch {
      return false;
    }
  }

  installFromSource(sourcePath: string, runtimePath: string): SkillInstallResult {
    if (!existsSync(sourcePath)) throw new Error("skill source is missing");
    const stat = statSync(sourcePath);
    rmSync(runtimePath, { recursive: true, force: true });
    mkdirSync(path.dirname(runtimePath), { recursive: true });

    if (stat.isDirectory()) {
      cpSync(sourcePath, runtimePath, { recursive: true });
      return { kind: "directory", sourceRoot: sourcePath };
    }

    if (!isZipSource(sourcePath)) {
      throw new Error("unsupported skill source; expected directory or .zip package");
    }

    const tempRoot = mkdtempSync(path.join(os.tmpdir(), "lingxia-skill-"));
    try {
      safeExtractZip(sourcePath, tempRoot);
      const skillRoot = findSkillRoot(tempRoot);
      if (!skillRoot) throw new Error("zip package does not contain SKILL.md");
      cpSync(skillRoot, runtimePath, { recursive: true });
      return { kind: "zip", sourceRoot: skillRoot };
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  }
}

export const skillInstaller = new FileSystemSkillInstaller();
