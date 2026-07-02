DELETE FROM `business_agents`
WHERE `id` IN (
  'task-hermes',
  'task-trace',
  'task-stock',
  'task-my-wealth',
  'task-bond',
  'task-credit-risk',
  'task-claim-ev',
  'task-ppt',
  'task-code',
  'task-slides',
  'task-finance',
  'task-assistant',
  'task-hermes-example',
  'mcp-tavily-search',
  'a2a-sg-research'
);
