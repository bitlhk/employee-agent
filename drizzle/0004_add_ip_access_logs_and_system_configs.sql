-- 创建IP访问统计表
CREATE TABLE `ip_access_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ip` varchar(45) NOT NULL,
	`action` varchar(50) NOT NULL,
	`path` varchar(500),
	`userAgent` text,
	`userId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ip_access_logs_id` PRIMARY KEY(`id`),
	INDEX `idx_ip_access_logs_ip` (`ip`),
	INDEX `idx_ip_access_logs_createdAt` (`createdAt`),
	INDEX `idx_ip_access_logs_userId` (`userId`)
);
--> statement-breakpoint
-- 创建系统配置表
CREATE TABLE `system_configs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`key` varchar(100) NOT NULL,
	`value` text NOT NULL,
	`description` text,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`updatedBy` int,
	CONSTRAINT `system_configs_id` PRIMARY KEY(`id`),
	CONSTRAINT `system_configs_key_unique` UNIQUE(`key`),
	INDEX `idx_system_configs_key` (`key`)
);
--> statement-breakpoint
-- 初始化系统配置：未注册用户每日访问限制（默认10次）
INSERT INTO `system_configs` (`key`, `value`, `description`) VALUES
('unregistered_daily_limit', '10', '未注册用户每日访问次数限制');

