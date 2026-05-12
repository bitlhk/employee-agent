CREATE TABLE IF NOT EXISTS `business_agent_audit` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `tenant_token` varchar(128) NOT NULL,
  `agent_id` varchar(128) NOT NULL,
  `action` varchar(64) NOT NULL,
  `session_key` varchar(128),
  `meta` text,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_business_agent_audit_user` (`user_id`),
  KEY `idx_business_agent_audit_agent` (`agent_id`),
  KEY `idx_business_agent_audit_tenant` (`tenant_token`),
  KEY `idx_business_agent_audit_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `business_agent_tenant_map` (
  `tenant_token` varchar(128) NOT NULL,
  `user_id` int NOT NULL,
  `agent_id` varchar(128) NOT NULL,
  `workspace_path` varchar(512),
  `first_used_at` timestamp NULL DEFAULT NULL,
  `last_used_at` timestamp NULL DEFAULT NULL,
  `message_count` int NOT NULL DEFAULT 0,
  PRIMARY KEY (`tenant_token`),
  KEY `idx_business_agent_tenant_map_user` (`user_id`),
  KEY `idx_business_agent_tenant_map_agent` (`agent_id`),
  KEY `idx_business_agent_tenant_map_last_used` (`last_used_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
