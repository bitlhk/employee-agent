#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent
EXECUTOR_PATH = ROOT / "financial-harness-executor.py"
RECONCILE_PATH = ROOT / "reconcile-hermes-profile-policy.mjs"
MANIFEST_PATH = ROOT / "agent-manifests.seed.json"
DEFAULT_PROFILE_ROOT = Path("/home/ubuntu/.hermes/profiles")
POLICY_FILE = ".financial-agent-policies.json"
LEGACY_POLICY_FILE = ".lingxia-policies.json"


def load_executor():
    spec = importlib.util.spec_from_file_location("financial_harness_executor", EXECUTOR_PATH)
    if not spec or not spec.loader:
        raise RuntimeError(f"cannot import executor from {EXECUTOR_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def assert_true(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def worker(
    *,
    worker_id: str,
    role: str,
    tools: list[str],
    mcp_servers: list[str],
    write_holder: bool = False,
    output_schema_ref: str | None = None,
) -> dict[str, Any]:
    return {
        "id": worker_id,
        "role": role,
        "trustBoundary": "stage5_negative_smoke",
        "tools": tools,
        "mcpServers": mcp_servers,
        "skills": [],
        "outputSchemaRef": output_schema_ref,
        "writeHolder": write_holder,
    }


def run_permission_smoke() -> list[dict[str, Any]]:
    executor = load_executor()
    cases = [
        {
            "id": "reader_cannot_write",
            "stage": {
                "stageId": "reader_bad_write",
                "profile": "market-sector-reader",
                "role": "Reader",
                "manifestWorker": worker(
                    worker_id="reader-bad-write",
                    role="reader",
                    tools=["read", "write"],
                    mcp_servers=["brave"],
                    output_schema_ref="server/_core/agent/data/schemas/market-sector-reader.schema.json",
                ),
            },
            "expected": "reader cannot declare write tools",
        },
        {
            "id": "writer_cannot_search",
            "stage": {
                "stageId": "writer_bad_search",
                "profile": "market-note-writer",
                "role": "Writer",
                "manifestWorker": worker(
                    worker_id="writer-bad-search",
                    role="writer",
                    tools=["read", "write", "edit"],
                    mcp_servers=["brave"],
                    write_holder=True,
                ),
            },
            "expected": "writer cannot receive external search MCP servers",
        },
        {
            "id": "analyst_cannot_write",
            "stage": {
                "stageId": "analyst_bad_write",
                "profile": "market-comps-spreader",
                "role": "Analyst",
                "manifestWorker": worker(
                    worker_id="analyst-bad-write",
                    role="analyst",
                    tools=["read", "grep", "edit"],
                    mcp_servers=[],
                ),
            },
            "expected": "analyst cannot declare write tools",
        },
    ]
    rows: list[dict[str, Any]] = []
    for item in cases:
        result = executor.run_worker(item["stage"], "stage 5 negative smoke", [], "stage5_smoke")
        error = str(result.get("error") or "")
        ok = result.get("status") == "failed" and "permission_policy_violation" in error and item["expected"] in error
        assert_true(ok, f"{item['id']} did not fail with expected policy error: {error}")
        rows.append({"id": item["id"], "ok": True, "error": error})

    valid_reader_policy = executor.permission_policy_for_stage({
        "manifestWorker": worker(
            worker_id="reader-good",
            role="reader",
            tools=["read", "grep"],
            mcp_servers=["brave", "bocha"],
            output_schema_ref="server/_core/agent/data/schemas/market-sector-reader.schema.json",
        )
    })
    assert_true(valid_reader_policy.get("externalSearchAllowed") is True, "valid reader should allow external search injection")
    assert_true(not valid_reader_policy.get("writeAllowed"), "valid reader should not allow writes")
    rows.append({"id": "valid_reader_search_only", "ok": True, "error": ""})
    return rows


def copy_profile_root(source: Path, target: Path) -> None:
    required_profiles = [
        "financial-harness",
        "market-sector-reader",
        "market-comps-spreader",
        "market-note-writer",
        "meeting-news-reader",
        "meeting-profiler",
        "meeting-pack-writer",
    ]
    for profile in required_profiles:
        src_dir = source / profile
        dst_dir = target / profile
        dst_dir.mkdir(parents=True, exist_ok=True)
        for name in ["config.yaml", POLICY_FILE, LEGACY_POLICY_FILE]:
            src = src_dir / name
            if src.exists():
                shutil.copy2(src, dst_dir / name)


def run_policy_drift_smoke(profile_root: Path) -> dict[str, Any]:
    source_policy = profile_root / "market-note-writer" / POLICY_FILE
    if not source_policy.exists():
        source_policy = profile_root / "market-note-writer" / LEGACY_POLICY_FILE
    if not source_policy.exists():
        return {
            "id": "policy_drift_detected",
            "ok": True,
            "skipped": True,
            "error": f"policy root not available: {profile_root}",
        }
    with tempfile.TemporaryDirectory(prefix="financial-agent-stage5-policy-") as tmp:
        tmp_root = Path(tmp)
        copy_profile_root(profile_root, tmp_root)
        policy_file = tmp_root / "market-note-writer" / source_policy.name
        data = json.loads(policy_file.read_text(encoding="utf-8"))
        data["policies"][0]["allowedMcpServers"] = ["brave"]
        policy_file.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

        completed = subprocess.run(
            [
                "node",
                str(RECONCILE_PATH),
                "--manifest",
                str(MANIFEST_PATH),
                "--profile-root",
                str(tmp_root),
            ],
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            check=False,
        )
        assert_true(completed.returncode != 0, "policy drift reconcile unexpectedly passed")
        assert_true("differs from manifest-derived policy" in completed.stdout, "policy drift was not reported")
        return {
            "id": "policy_drift_detected",
            "ok": True,
            "error": "drift detected as expected",
        }


def main() -> None:
    profile_root = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_PROFILE_ROOT
    rows = run_permission_smoke()
    rows.append(run_policy_drift_smoke(profile_root))
    print(json.dumps({"ok": True, "checks": rows}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
