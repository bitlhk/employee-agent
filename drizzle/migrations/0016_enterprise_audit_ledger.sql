CREATE TABLE IF NOT EXISTS `audit_events` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `event_id` VARCHAR(64) NOT NULL UNIQUE,
  `event_time` TIMESTAMP NOT NULL,
  `category` VARCHAR(64) NOT NULL,
  `action` VARCHAR(128) NOT NULL,
  `result` ENUM('success','failed','denied','warning') NOT NULL DEFAULT 'success',
  `severity` ENUM('info','low','medium','high','critical') NOT NULL DEFAULT 'info',
  `actor_type` VARCHAR(32) NOT NULL DEFAULT 'user',
  `actor_user_id` INT NULL,
  `actor_name` VARCHAR(128) NULL,
  `actor_email` VARCHAR(320) NULL,
  `actor_role` VARCHAR(64) NULL,
  `actor_org_id` VARCHAR(64) NULL,
  `actor_department_id` VARCHAR(64) NULL,
  `target_type` VARCHAR(64) NULL,
  `target_id` VARCHAR(128) NULL,
  `target_name` VARCHAR(256) NULL,
  `resource_type` VARCHAR(64) NULL,
  `resource_id` VARCHAR(128) NULL,
  `resource_name` VARCHAR(256) NULL,
  `workspace_id` VARCHAR(128) NULL,
  `agent_instance_id` VARCHAR(128) NULL,
  `runtime_type` VARCHAR(64) NULL,
  `runtime_agent_id` VARCHAR(128) NULL,
  `request_id` VARCHAR(128) NULL,
  `session_id` VARCHAR(128) NULL,
  `correlation_id` VARCHAR(128) NULL,
  `ip` VARCHAR(45) NULL,
  `user_agent` TEXT NULL,
  `source` VARCHAR(64) NOT NULL DEFAULT 'platform',
  `environment` VARCHAR(64) NULL,
  `detail_type` VARCHAR(64) NULL,
  `detail_id` VARCHAR(128) NULL,
  `error_code` VARCHAR(64) NULL,
  `policy_code` VARCHAR(64) NULL,
  `risk_type` VARCHAR(64) NULL,
  `channel` VARCHAR(64) NULL,
  `tool_name` VARCHAR(128) NULL,
  `metadata_json` JSON NULL,
  `metadata_truncated` TINYINT(1) NOT NULL DEFAULT 0,
  `metadata_original_bytes` INT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY `idx_audit_events_time` (`event_time`),
  KEY `idx_audit_events_actor` (`actor_user_id`, `event_time`),
  KEY `idx_audit_events_category` (`category`, `action`, `event_time`),
  KEY `idx_audit_events_target` (`target_type`, `target_id`),
  KEY `idx_audit_events_agent` (`agent_instance_id`, `runtime_agent_id`),
  KEY `idx_audit_events_severity` (`severity`, `result`, `event_time`),
  KEY `idx_audit_events_correlation` (`correlation_id`),
  KEY `idx_audit_events_error_code` (`error_code`),
  KEY `idx_audit_events_policy_code` (`policy_code`)
);

CREATE TABLE IF NOT EXISTS `audit_tool_events` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `event_id` VARCHAR(64) NOT NULL UNIQUE,
  `tool_type` VARCHAR(64) NOT NULL,
  `tool_name` VARCHAR(128) NOT NULL,
  `original_tool_name` VARCHAR(128) NULL,
  `routed_tool_name` VARCHAR(128) NULL,
  `executor` VARCHAR(64) NULL,
  `policy_decision` ENUM('allow','deny','rewrite') NOT NULL,
  `deny_reason` VARCHAR(128) NULL,
  `command` TEXT NULL,
  `args_json` JSON NULL,
  `cwd` VARCHAR(512) NULL,
  `url` TEXT NULL,
  `method` VARCHAR(16) NULL,
  `timeout_ms` INT NULL,
  `exit_code` INT NULL,
  `stdout_bytes` INT NULL,
  `stderr_bytes` INT NULL,
  `truncated` TINYINT(1) NOT NULL DEFAULT 0,
  `duration_ms` INT NULL,
  `metadata_json` JSON NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY `idx_audit_tool_type` (`tool_type`, `tool_name`),
  KEY `idx_audit_tool_policy` (`policy_decision`),
  KEY `idx_audit_tool_created` (`created_at`)
);

CREATE TABLE IF NOT EXISTS `audit_security_findings` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `finding_id` VARCHAR(64) NOT NULL UNIQUE,
  `event_id` VARCHAR(64) NULL,
  `finding_type` VARCHAR(128) NOT NULL,
  `severity` ENUM('low','medium','high','critical') NOT NULL DEFAULT 'medium',
  `status` ENUM('open','acknowledged','resolved','ignored') NOT NULL DEFAULT 'open',
  `title` VARCHAR(256) NOT NULL,
  `description` TEXT NULL,
  `evidence_json` JSON NULL,
  `target_type` VARCHAR(64) NULL,
  `target_id` VARCHAR(128) NULL,
  `handled_by` INT NULL,
  `handled_at` TIMESTAMP NULL,
  `handled_note` TEXT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY `idx_audit_findings_status` (`status`, `severity`),
  KEY `idx_audit_findings_type` (`finding_type`),
  KEY `idx_audit_findings_event` (`event_id`),
  KEY `idx_audit_findings_created` (`created_at`)
);

CREATE TABLE IF NOT EXISTS `audit_exports` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `export_id` VARCHAR(64) NOT NULL UNIQUE,
  `actor_user_id` INT NOT NULL,
  `actor_email` VARCHAR(320) NULL,
  `filters_json` JSON NULL,
  `format` ENUM('csv','json','xlsx') NOT NULL DEFAULT 'csv',
  `row_count` INT NOT NULL DEFAULT 0,
  `storage_key` VARCHAR(128) NOT NULL,
  `file_hash` VARCHAR(64) NOT NULL,
  `file_size_bytes` BIGINT NOT NULL,
  `encrypted` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expires_at` TIMESTAMP NULL,
  KEY `idx_audit_exports_actor` (`actor_user_id`, `created_at`),
  KEY `idx_audit_exports_created` (`created_at`),
  KEY `idx_audit_exports_storage_key` (`storage_key`)
);

DROP TRIGGER IF EXISTS `audit_events_no_update`;
DROP TRIGGER IF EXISTS `audit_events_no_delete`;
DROP TRIGGER IF EXISTS `audit_tool_events_no_update`;
DROP TRIGGER IF EXISTS `audit_tool_events_no_delete`;
DROP TRIGGER IF EXISTS `audit_exports_no_update`;
DROP TRIGGER IF EXISTS `audit_exports_no_delete`;
DROP TRIGGER IF EXISTS `audit_security_findings_no_delete`;
DROP TRIGGER IF EXISTS `audit_security_findings_restricted_update`;

DELIMITER //

CREATE TRIGGER `audit_events_no_update`
BEFORE UPDATE ON `audit_events`
FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_events is WORM, UPDATE not allowed'//

CREATE TRIGGER `audit_events_no_delete`
BEFORE DELETE ON `audit_events`
FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_events is WORM, DELETE not allowed'//

CREATE TRIGGER `audit_tool_events_no_update`
BEFORE UPDATE ON `audit_tool_events`
FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_tool_events is WORM, UPDATE not allowed'//

CREATE TRIGGER `audit_tool_events_no_delete`
BEFORE DELETE ON `audit_tool_events`
FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_tool_events is WORM, DELETE not allowed'//

CREATE TRIGGER `audit_exports_no_update`
BEFORE UPDATE ON `audit_exports`
FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_exports is WORM, UPDATE not allowed'//

CREATE TRIGGER `audit_exports_no_delete`
BEFORE DELETE ON `audit_exports`
FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_exports is WORM, DELETE not allowed'//

CREATE TRIGGER `audit_security_findings_no_delete`
BEFORE DELETE ON `audit_security_findings`
FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_security_findings is WORM, DELETE not allowed'//

CREATE TRIGGER `audit_security_findings_restricted_update`
BEFORE UPDATE ON `audit_security_findings`
FOR EACH ROW
BEGIN
  IF NOT (
    OLD.`id` <=> NEW.`id`
    AND OLD.`finding_id` <=> NEW.`finding_id`
    AND OLD.`event_id` <=> NEW.`event_id`
    AND OLD.`finding_type` <=> NEW.`finding_type`
    AND OLD.`severity` <=> NEW.`severity`
    AND OLD.`title` <=> NEW.`title`
    AND OLD.`description` <=> NEW.`description`
    AND OLD.`evidence_json` <=> NEW.`evidence_json`
    AND OLD.`target_type` <=> NEW.`target_type`
    AND OLD.`target_id` <=> NEW.`target_id`
    AND OLD.`created_at` <=> NEW.`created_at`
  ) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_security_findings immutable fields cannot be updated';
  END IF;
END//

DELIMITER ;
