# Smoke Case Library

Keep reusable case definitions here as the suite grows.

The current `runSmokeV1` still keeps the core cases in code because the first priority is a stable runner. New suites should move toward data files such as:

- `pages.json`
- `chat-basic.json`
- `cron.json`
- `skills.json`
- `agent-plaza.json`
- `task-workbench-lab.json`
- `admin.json`

Case files should contain prompts, expected signals, risk level, and cleanup notes. They must not contain production tokens, session cookies, private keys, or real customer data.
