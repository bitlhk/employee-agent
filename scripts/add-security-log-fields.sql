-- 为 security_logs 表添加处理状态相关字段
-- 如果表不存在，需要先创建表

-- 检查并添加 status 字段
ALTER TABLE `security_logs` 
ADD COLUMN IF NOT EXISTS `status` ENUM('pending', 'resolved', 'ignored', 'blocked') NOT NULL DEFAULT 'pending' AFTER `severity`;

-- 检查并添加 handledBy 字段
ALTER TABLE `security_logs` 
ADD COLUMN IF NOT EXISTS `handledBy` INT NULL AFTER `status`;

-- 检查并添加 handledAt 字段
ALTER TABLE `security_logs` 
ADD COLUMN IF NOT EXISTS `handledAt` TIMESTAMP NULL AFTER `handledBy`;

-- 检查并添加 handledNote 字段
ALTER TABLE `security_logs` 
ADD COLUMN IF NOT EXISTS `handledNote` TEXT NULL AFTER `handledAt`;

