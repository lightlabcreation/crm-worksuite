-- =====================================================
-- Activities Table Migration
-- Tracks all activities/actions in the system
-- =====================================================

CREATE TABLE IF NOT EXISTS `activities` (
  `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `company_id` INT UNSIGNED NOT NULL,
  `user_id` INT UNSIGNED NULL,
  `user_name` VARCHAR(255) NULL,
  `module` VARCHAR(100) NOT NULL,
  `module_id` INT UNSIGNED NULL,
  `action` VARCHAR(100) NOT NULL,
  `description` TEXT NOT NULL,
  `related_to_type` ENUM('project', 'task', 'client', 'lead', 'invoice', 'payment', 'contract', 'estimate', 'proposal', 'expense', 'ticket', 'document', 'note', 'other') NULL,
  `related_to_id` INT UNSIGNED NULL,
  `old_value` TEXT NULL,
  `new_value` TEXT NULL,
  `ip_address` VARCHAR(45) NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_company` (`company_id`),
  INDEX `idx_user` (`user_id`),
  INDEX `idx_module` (`module`),
  INDEX `idx_module_id` (`module_id`),
  INDEX `idx_related` (`related_to_type`, `related_to_id`),
  INDEX `idx_created_at` (`created_at`),
  FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

