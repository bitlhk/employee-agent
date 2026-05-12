CREATE TABLE IF NOT EXISTS `lx_coop_user_hidden` (
  `user_id` int NOT NULL,
  `session_id` varchar(64) NOT NULL,
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uk_lx_coop_user_hidden_user_session` (`user_id`, `session_id`),
  KEY `idx_lx_coop_user_hidden_user` (`user_id`),
  KEY `idx_lx_coop_user_hidden_session` (`session_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
