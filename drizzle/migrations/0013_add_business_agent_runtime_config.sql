ALTER TABLE `business_agents`
  ADD COLUMN `provider_type` varchar(64) NULL AFTER `ui_config`,
  ADD COLUMN `adapter_protocol` varchar(96) NULL AFTER `provider_type`,
  ADD COLUMN `capabilities_json` text NULL AFTER `adapter_protocol`,
  ADD COLUMN `endpoint_config_json` text NULL AFTER `capabilities_json`;

UPDATE `business_agents`
SET
  `provider_type` = CASE
    WHEN `id` = 'task-stock' THEN 'http-sse'
    WHEN `id` IN ('task-hermes', 'task-my-wealth', 'task-bond', 'task-credit-risk', 'task-claim-ev') THEN 'hermes'
    WHEN `kind` = 'local' THEN 'openclaw-local'
    ELSE 'openai-compatible'
  END,
  `adapter_protocol` = CASE
    WHEN `id` = 'task-stock' THEN 'stock-agent-v1'
    WHEN `id` = 'task-hermes' THEN 'hermes-events'
    WHEN `id` = 'task-my-wealth' THEN 'my-wealth-hermes-v1'
    WHEN `id` = 'task-bond' THEN 'bond-hermes-v1'
    WHEN `id` = 'task-credit-risk' THEN 'credit-risk-hermes-v1'
    WHEN `id` = 'task-claim-ev' THEN 'claim-ev-hermes-v1'
    WHEN `kind` = 'local' THEN 'openclaw-chat'
    ELSE 'openai-chat-completions'
  END,
  `capabilities_json` = CASE
    WHEN `id` IN ('task-ppt', 'task-code', 'task-slides') THEN '["chat","files","artifacts","long_task"]'
    WHEN `id` IN ('task-hermes', 'task-my-wealth', 'task-bond', 'task-credit-risk', 'task-claim-ev') THEN '["chat","tools","long_task"]'
    WHEN `id` = 'task-stock' THEN '["chat","tools","long_task"]'
    ELSE '["chat"]'
  END
WHERE `provider_type` IS NULL OR `adapter_protocol` IS NULL;
