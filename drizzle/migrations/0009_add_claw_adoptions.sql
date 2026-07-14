-- 灵感龙虾方案：领养主表 + 事件表（MVP）

CREATE TABLE IF NOT EXISTS `claw_adoptions` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `userId` INT NOT NULL,
  `adoptId` VARCHAR(64) NOT NULL,
  `agentId` VARCHAR(128) NOT NULL,
  `status` ENUM('creating','active','expiring','recycled','failed') NOT NULL DEFAULT 'creating',
  `permissionProfile` VARCHAR(32) NOT NULL DEFAULT 'starter',
  `ttlDays` INT NOT NULL DEFAULT 7,
  `entryUrl` VARCHAR(512) NOT NULL,
  `expiresAt` TIMESTAMP NOT NULL,
  `lastError` TEXT NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_claw_adoptions_adoptId` (`adoptId`),
  UNIQUE KEY `uk_claw_adoptions_agentId` (`agentId`),
  KEY `idx_claw_adoptions_userId_status` (`userId`, `status`),
  KEY `idx_claw_adoptions_expiresAt_status` (`expiresAt`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `claw_adoption_events` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `adoptionId` BIGINT NOT NULL,
  `eventType` ENUM('create_requested','create_succeeded','create_failed','profile_updated','ttl_extended','recycle_requested','recycle_succeeded','recycle_failed') NOT NULL,
  `operatorType` ENUM('system','user','admin') NOT NULL DEFAULT 'system',
  `operatorId` INT NULL,
  `detail` TEXT NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_claw_events_adoptionId_createdAt` (`adoptionId`, `createdAt`),
  CONSTRAINT `fk_claw_events_adoptionId` FOREIGN KEY (`adoptionId`) REFERENCES `claw_adoptions`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
