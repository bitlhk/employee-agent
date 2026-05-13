-- Step2 preparation only: do NOT execute automatically on shared production DB

CREATE TABLE IF NOT EXISTS `visit_stats_daily` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `statDate` VARCHAR(10) NOT NULL,
  `scenarioId` VARCHAR(64) NOT NULL,
  `experienceId` VARCHAR(128) NOT NULL,
  `userType` ENUM('registered', 'unlogged') NOT NULL,
  `pv` BIGINT NOT NULL DEFAULT 0,
  `uv` BIGINT NOT NULL DEFAULT 0,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uk_daily_dim` (`statDate`, `scenarioId`, `experienceId`, `userType`),
  KEY `idx_date` (`statDate`),
  KEY `idx_scenario_date` (`scenarioId`, `statDate`),
  KEY `idx_exp_date` (`experienceId`, `statDate`)
);

-- Existing table index optimization (execute during low-traffic window)
CREATE INDEX `idx_vs_created_at` ON `visit_stats` (`createdAt`);
CREATE INDEX `idx_vs_scenario_exp_time` ON `visit_stats` (`scenarioId`, `experienceId`, `createdAt`);
CREATE INDEX `idx_vs_registration_time` ON `visit_stats` (`registrationId`, `createdAt`);

CREATE INDEX `idx_iplog_action_time` ON `ip_access_logs` (`action`, `createdAt`);
CREATE INDEX `idx_iplog_user_time` ON `ip_access_logs` (`userId`, `createdAt`);
