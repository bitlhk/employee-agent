CREATE TABLE IF NOT EXISTS `business_agents` (
  `id` varchar(64) NOT NULL,
  `name` varchar(128) NOT NULL,
  `description` text,
  `kind` enum('local','remote') NOT NULL DEFAULT 'remote',
  `api_url` varchar(512),
  `api_token` varchar(256),
  `remote_agent_id` varchar(128) DEFAULT 'main',
  `local_agent_id` varchar(128),
  `skills` text COMMENT 'JSON array of skill names for local agents',
  `icon` varchar(8) DEFAULT '🤖',
  `enabled` tinyint(1) NOT NULL DEFAULT 1,
  `sort_order` int NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
);

INSERT IGNORE INTO `business_agents`
  (`id`,`name`,`description`,`kind`,`api_url`,`api_token`,`remote_agent_id`,`local_agent_id`,`icon`,`enabled`,`sort_order`)
VALUES
  ('task-ppt','PPT 生成','多轮对话生成 PPT，完成后可下载','local',NULL,NULL,NULL,'task-ppt','📊',1,1),
  ('task-code','代码助手','在沙箱中执行代码，安全隔离','local',NULL,NULL,NULL,'task-code','💻',1,2),
  ('task-finance','金融投顾','DCF/LBO 建模、竞争分析、行业研究报告','remote','http://198.51.100.10:19789','public-skill-demo-2026','main',NULL,'📈',1,3);
