-- Migration: Convert role_permissions from old schema (role_id, permission_id) to new (role_id, module, can_view, can_add, can_edit, can_delete)
--
-- WHEN TO RUN: Only if you get "Field 'permission_id' doesn't have a default value" or API code ROLES_PERMISSIONS_SCHEMA_MIGRATION_REQUIRED.
-- DO NOT RUN if role_permissions already has a "module" column.
--
-- Run the two statements below in order on your MySQL (e.g. Railway) database.

-- 1. Rename old table (backup)
RENAME TABLE `role_permissions` TO `role_permissions_backup`;

-- 2. Create new table (module-based permissions)
CREATE TABLE `role_permissions` (
  `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `role_id` INT UNSIGNED NOT NULL,
  `module` VARCHAR(100) NOT NULL,
  `can_view` TINYINT(1) DEFAULT 0,
  `can_add` TINYINT(1) DEFAULT 0,
  `can_edit` TINYINT(1) DEFAULT 0,
  `can_delete` TINYINT(1) DEFAULT 0,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE CASCADE,
  UNIQUE KEY `unique_role_module` (`role_id`, `module`),
  INDEX `idx_role_perm_role` (`role_id`),
  INDEX `idx_role_perm_module` (`module`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Done. Old data is in role_permissions_backup. You can drop it after confirming: DROP TABLE role_permissions_backup;
