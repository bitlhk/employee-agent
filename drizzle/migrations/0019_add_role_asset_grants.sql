CREATE TABLE IF NOT EXISTS `role_asset_grants` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `role_key` VARCHAR(64) NOT NULL,
  `asset_type` ENUM('skill','mcp_server') NOT NULL,
  `asset_id` VARCHAR(128) NOT NULL,
  `grant_mode` ENUM('default','optional') NOT NULL DEFAULT 'optional',
  `source` ENUM('seed','admin','market') NOT NULL DEFAULT 'market',
  `enabled` BOOLEAN NOT NULL DEFAULT TRUE,
  `created_by` VARCHAR(128),
  `updated_by` VARCHAR(128),
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_role_asset_grants_scope` (`role_key`, `asset_type`, `asset_id`, `source`),
  KEY `idx_role_asset_grants_role` (`role_key`, `asset_type`, `enabled`),
  KEY `idx_role_asset_grants_asset` (`asset_type`, `asset_id`, `enabled`),
  KEY `idx_role_asset_grants_source` (`source`)
);
