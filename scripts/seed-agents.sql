-- seed-agents.sql — 灵虾业务 Agent 示例数据
-- 全部 enabled=0，部署者按需启用
-- 使用: mysql -u linggan -p linggan < scripts/seed-agents.sql

INSERT INTO business_agents (id, name, description, kind, api_url, remote_agent_id, icon, enabled, sort_order, system_prompt)
VALUES
  -- 通用助手（本地 OpenClaw）
  ('task-assistant', '通用助手', '基础对话助手，可处理日常问题', 'local', NULL, 'main', '🤖', 0, 1,
   '你是一个有用的 AI 助手。用简洁清晰的中文回复用户问题。'),

  -- 代码助手（需要远端 OpenClaw + claude-code）
  ('task-code', '代码助手', '编程辅助，支持代码生成、调试、解释', 'remote', 'http://127.0.0.1:19800', 'claude-code', '💻', 0, 10,
   '你是代码助手。帮助用户编写、调试和解释代码。用中文交流，代码部分用英文。'),

  -- 示例: Hermes 协议 Agent（需要部署 Hermes Agent Gateway）
  ('task-hermes-example', '智能问答(示例)', '基于 Hermes Agent 的深度问答', 'remote', 'http://127.0.0.1:8642', 'hermes-agent', '🧠', 0, 20,
   NULL)

ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  description = VALUES(description);
