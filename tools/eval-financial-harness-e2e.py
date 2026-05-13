#!/usr/bin/env python3
from __future__ import annotations

import json
import argparse
import os
import subprocess
import time
import urllib.request
from pathlib import Path
from typing import Any


CASES = [
    {
        "id": "market_cross_border_payment",
        "kind": "market",
        "prompt": "跨境支付最近有什么新的动态？请整理成金融市场研究简报。",
    },
    {
        "id": "market_bank_ai_agent",
        "kind": "market",
        "prompt": "银行业 AI Agent 落地最近有什么趋势？请给我一份研究简报。",
    },
    {
        "id": "market_stablecoin_banks",
        "kind": "market",
        "prompt": "稳定币发展对商业银行支付业务有什么影响？",
    },
    {
        "id": "market_fintech_competition",
        "kind": "market",
        "prompt": "请分析一家金融科技公司在企业级智能体平台方向的竞争格局。",
    },
    {
        "id": "market_regulation_bank_it",
        "kind": "market",
        "prompt": "近期监管政策对银行科技投入和智能化建设有什么影响？",
    },
    {
        "id": "meeting_bank_tech_dept",
        "kind": "meeting",
        "prompt": "我要拜访某银行科技部，请帮我准备会议背景、交流提纲和问题清单。",
    },
    {
        "id": "meeting_branch_ai_transformation",
        "kind": "meeting",
        "prompt": "给某分行行长准备一次 AI 转型交流，需要准备哪些材料和问题？",
    },
    {
        "id": "meeting_agent_platform_customer",
        "kind": "meeting",
        "prompt": "准备和客户沟通智能体平台建设方案，请生成拜访准备包。",
    },
    {
        "id": "meeting_brokerage_digital",
        "kind": "meeting",
        "prompt": "我要拜访某券商数字化部门，帮我准备会议问题清单和机会点。",
    },
    {
        "id": "meeting_insurance_service",
        "kind": "meeting",
        "prompt": "某保险客户想聊智能客服和坐席助手场景，拜访前应该准备什么？",
    },
]


def service_token() -> str:
    service_names = [
        os.getenv("FIN_HARNESS_EXECUTOR_SERVICE", ""),
        os.getenv("LINGXIA_FIN_HARNESS_EXECUTOR_SERVICE", ""),
        os.getenv("LINGXIA_FIN_HARNESS_SERVICE", ""),
        "financial-agent-harness-executor.service",
        "lingxia-financial-harness-executor.service",
    ]
    for service_name in dict.fromkeys(name for name in service_names if name):
        try:
            raw = subprocess.check_output(
                ["systemctl", "--user", "show", service_name, "-p", "Environment"],
                text=True,
            )
        except subprocess.CalledProcessError:
            continue
        env: dict[str, str] = {}
        for part in raw.strip().removeprefix("Environment=").split(" "):
            if "=" in part:
                key, value = part.split("=", 1)
                env[key] = value
        token = env.get("FIN_HARNESS_EXECUTOR_KEY") or env.get("HERMES_HTTP_KEY") or ""
        if token:
            return token
    return ""


def parse_sse(text: str) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    for block in text.replace("\r\n", "\n").split("\n\n"):
        data: list[str] = []
        event = "message"
        for line in block.split("\n"):
            if line.startswith("event:"):
                event = line.split(":", 1)[1].strip()
            elif line.startswith("data:"):
                data.append(line.split(":", 1)[1].strip())
        if not data:
            continue
        raw = "\n".join(data)
        if raw == "[DONE]":
            events.append({"event": "done_marker"})
            continue
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            payload = {"raw": raw[:500]}
        events.append({"event": event, "payload": payload})
    return events


def call_case(token: str, case: dict[str, str], timeout_seconds: int) -> dict[str, Any]:
    payload = {
        "prompt": case["prompt"],
        "available_templates": ["market-researcher", "meeting-prep-agent"],
    }
    request = urllib.request.Request(
        "http://127.0.0.1:8670/v1/harness/run-stream",
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"content-type": "application/json", "authorization": f"Bearer {token}"},
        method="POST",
    )
    started = time.time()
    with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
        text = response.read().decode("utf-8", errors="replace")
    events = parse_sse(text)
    final = None
    for item in events:
        if item["event"] == "run_done":
            final = item["payload"].get("result")
    if final is None:
        final = {"status": "failed", "error": "missing run_done", "stages": [], "finalOutput": ""}
    stages = final.get("stages") or []
    route = (final.get("route") or {}).get("result") or {}
    summary: dict[str, Any] = {
        "id": case["id"],
        "kind": case["kind"],
        "prompt": case["prompt"],
        "durationMs": round((time.time() - started) * 1000),
        "status": final.get("status"),
        "templateId": (final.get("harnessPlan") or {}).get("templateId") or route.get("template_id"),
        "confidence": (final.get("harnessPlan") or {}).get("confidenceScore") or route.get("confidence"),
        "stageEvents": [
            item["event"]
            for item in events
            if item["event"] in {"route_done", "stage_started", "stage_done", "run_done", "run_failed"}
        ],
        "stages": [],
        "finalOutputPreview": str(final.get("finalOutput") or "")[:1800],
    }
    for stage in stages:
        policy = stage.get("permissionPolicy") or {}
        summary["stages"].append({
            "stageId": stage.get("stageId"),
            "role": stage.get("role"),
            "profile": stage.get("profile"),
            "status": stage.get("status"),
            "durationMs": stage.get("durationMs"),
            "schemaRef": stage.get("schemaRef"),
            "schemaOk": bool(stage.get("schemaPayload")) and not bool(stage.get("schemaErrors")) if stage.get("schemaRef") else None,
            "schemaErrors": stage.get("schemaErrors") or [],
            "searchProviders": stage.get("searchProviders") or [],
            "searchProvidersAttempted": stage.get("searchProvidersAttempted") or [],
            "searchResultCount": stage.get("searchResultCount") or 0,
            "skillRefs": stage.get("skillRefs") or [],
            "writeAllowed": policy.get("writeAllowed"),
            "externalSearchAllowed": policy.get("externalSearchAllowed"),
            "outputPreview": str(stage.get("output") or stage.get("error") or "")[:800],
        })
    return summary


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run Financial Harness end-to-end eval cases.")
    parser.add_argument("--limit", type=int, default=len(CASES), help="number of cases to run")
    parser.add_argument("--offset", type=int, default=0, help="start offset")
    parser.add_argument("--timeout-seconds", type=int, default=600, help="per-case HTTP timeout")
    parser.add_argument("--out", default="reports/financial-harness-e2e-10cases.json", help="final JSON report")
    parser.add_argument("--jsonl", default="reports/financial-harness-e2e-10cases.jsonl", help="incremental JSONL output")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    token = service_token()
    if not token:
        raise SystemExit("missing executor token")
    selected_cases = CASES[args.offset: args.offset + max(1, args.limit)]
    jsonl = Path(args.jsonl)
    jsonl.parent.mkdir(parents=True, exist_ok=True)
    results = []
    for index, case in enumerate(selected_cases, 1):
        print(f"[e2e] {index}/{len(selected_cases)} {case['id']} ...", flush=True)
        try:
            result = call_case(token, case, args.timeout_seconds)
        except Exception as exc:
            result = {
                "id": case["id"],
                "kind": case["kind"],
                "prompt": case["prompt"],
                "status": "exception",
                "error": f"{type(exc).__name__}: {exc}",
            }
        print(
            f"[e2e] {case['id']} status={result.get('status')} "
            f"template={result.get('templateId')} durationMs={result.get('durationMs')} "
            f"stages={[item.get('status') for item in result.get('stages', [])]}",
            flush=True,
        )
        results.append(result)
        with jsonl.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(result, ensure_ascii=False) + "\n")

    report = {
        "createdAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "endpoint": "http://127.0.0.1:8670",
        "offset": args.offset,
        "limit": len(selected_cases),
        "total": len(results),
        "completed": sum(1 for item in results if item.get("status") == "completed"),
        "failed": sum(1 for item in results if item.get("status") != "completed"),
        "results": results,
    }
    output = Path(args.out)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[e2e] wrote {output}")
    print(json.dumps({key: report[key] for key in ["total", "completed", "failed"]} | {"path": str(output), "jsonl": str(jsonl)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
