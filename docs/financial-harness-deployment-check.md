# Financial Agent Harness Deployment Check

This document records the deployment checks for the Lingxia Financial Agent Harness pilot.

The Harness has two deployment roles:

- **Runtime node**: Singapore Huawei Cloud. Runs Hermes profiles, runtime skills, policy files, and the Financial Harness executor.
- **Control node**: Shanghai Lingxia app. Holds the product UI/API and reaches the runtime node through the local SSH tunnel.

## Runtime Node Check

Run on the Singapore node:

```bash
cd /home/ubuntu/lingxia-financial-harness-executor
node check-financial-harness-deployment.mjs \
  --mode runtime \
  --endpoint http://127.0.0.1:8670 \
  --report reports/financial-harness-runtime-report.json
```

This checks:

- manifest registry
- runtime skill root and commit pin
- every required `SKILL.md`
- reader JSON schemas
- Hermes profile directories
- profile policy drift
- executor systemd user service
- executor health endpoint
- authenticated SSE smoke event flow

Expected SSE smoke flow:

```text
stage_started -> stage_done -> run_done
```

## Control Node Check

Run on the Shanghai Lingxia node:

```bash
cd /root/linggan-platform
node tools/check-financial-harness-deployment.mjs \
  --mode control \
  --endpoint http://127.0.0.1:18650 \
  --report reports/financial-harness-control-report.json
```

This checks:

- manifest registry
- reader JSON schemas
- manifest structural validator
- Shanghai to Singapore tunnel health

It intentionally skips local runtime skills and Hermes profile directories because those live on the Singapore runtime node.

## Notes

- The script does not print secrets.
- `runtime` mode should be the stricter deployment gate.
- `control` mode is a control-plane/tunnel health check.
- Automatic repair is not enabled yet; the script only reports drift and missing dependencies.
