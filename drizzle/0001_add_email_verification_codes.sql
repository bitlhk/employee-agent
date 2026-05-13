-- 创建邮箱验证码表
CREATE TABLE IF NOT EXISTS `email_verification_codes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`email` varchar(320) NOT NULL,
	`code` varchar(10) NOT NULL,
	`expiresAt` timestamp NOT NULL,
	`used` enum('yes','no') NOT NULL DEFAULT 'no',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `email_verification_codes_id` PRIMARY KEY(`id`),
	INDEX `idx_email` (`email`),
	INDEX `idx_code` (`code`),
	INDEX `idx_expiresAt` (`expiresAt`)
);

