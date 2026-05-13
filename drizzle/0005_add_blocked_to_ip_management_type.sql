-- 确保 ip_management.type 的 ENUM 包含 'blocked'，否则从安全日志「封禁IP」写入的记录无法正确存储，在 IP 管理中看不到
-- 若已包含 'blocked'，执行本句不会报错
ALTER TABLE `ip_management`
  MODIFY COLUMN `type` ENUM('blacklist','whitelist','suspicious','blocked') NOT NULL;
