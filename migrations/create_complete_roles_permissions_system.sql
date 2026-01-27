-- Complete Roles & Permissions System Migration
-- This creates all necessary tables for a full-featured roles and permissions system

-- =====================================================
-- 1. ROLES TABLE (Already exists, but ensuring structure)
-- =====================================================
CREATE TABLE IF NOT EXISTS `roles` (
  `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `company_id` INT UNSIGNED NOT NULL,
  `role_name` VARCHAR(100) NOT NULL,
  `description` TEXT NULL,
  `is_system_role` TINYINT(1) DEFAULT 0,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `is_deleted` TINYINT(1) DEFAULT 0,
  FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE CASCADE,
  INDEX `idx_role_company` (`company_id`),
  INDEX `idx_role_deleted` (`is_deleted`),
  UNIQUE KEY `unique_role_company` (`company_id`, `role_name`, `is_deleted`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Add is_system_role column if it doesn't exist
SET @dbname = DATABASE();
SET @tablename = 'roles';
SET @columnname = 'is_system_role';
SET @preparedStatement = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE
      (TABLE_SCHEMA = @dbname)
      AND (TABLE_NAME = @tablename)
      AND (COLUMN_NAME = @columnname)
  ) > 0,
  'SELECT 1',
  CONCAT('ALTER TABLE ', @tablename, ' ADD COLUMN ', @columnname, ' TINYINT(1) DEFAULT 0 AFTER description')
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- =====================================================
-- 2. ROLE PERMISSIONS TABLE (Module-based permissions)
-- =====================================================
CREATE TABLE IF NOT EXISTS `role_permissions` (
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

-- =====================================================
-- 3. USER ROLES TABLE (Link users to roles)
-- =====================================================
CREATE TABLE IF NOT EXISTS `user_roles` (
  `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `user_id` INT UNSIGNED NOT NULL,
  `role_id` INT UNSIGNED NOT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE CASCADE,
  UNIQUE KEY `unique_user_role` (`user_id`, `role_id`),
  INDEX `idx_user_role_user` (`user_id`),
  INDEX `idx_user_role_role` (`role_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- 4. MODULES TABLE (Dynamic module definitions)
-- =====================================================
CREATE TABLE IF NOT EXISTS `modules` (
  `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `module_key` VARCHAR(100) NOT NULL UNIQUE,
  `module_name` VARCHAR(255) NOT NULL,
  `module_type` ENUM('ADMIN', 'EMPLOYEE', 'CLIENT', 'ALL') DEFAULT 'ALL',
  `description` TEXT NULL,
  `icon` VARCHAR(100) NULL,
  `is_active` TINYINT(1) DEFAULT 1,
  `sort_order` INT DEFAULT 0,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_module_type` (`module_type`),
  INDEX `idx_module_active` (`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- 5. INSERT DEFAULT MODULES (Dynamic data)
-- =====================================================
INSERT IGNORE INTO `modules` (`module_key`, `module_name`, `module_type`, `description`, `icon`, `sort_order`) VALUES
-- Admin Modules
('dashboard', 'Dashboard', 'ALL', 'Main dashboard overview', 'IoHome', 1),
('clients', 'Clients', 'ADMIN', 'Manage clients', 'IoPeople', 2),
('leads', 'Leads', 'ADMIN', 'Manage leads', 'IoPerson', 3),
('projects', 'Projects', 'ALL', 'Manage projects', 'IoFolderOpen', 4),
('tasks', 'Tasks', 'ALL', 'Manage tasks', 'IoCheckbox', 5),
('invoices', 'Invoices', 'ADMIN', 'Manage invoices', 'IoReceipt', 6),
('payments', 'Payments', 'ALL', 'Manage payments', 'IoCash', 7),
('estimates', 'Estimates', 'ADMIN', 'Manage estimates', 'IoDocumentText', 8),
('proposals', 'Proposals', 'ALL', 'Manage proposals', 'IoDocumentText', 9),
('contracts', 'Contracts', 'ALL', 'Manage contracts', 'IoDocumentText', 10),
('employees', 'Employees', 'ADMIN', 'Manage employees', 'IoPerson', 11),
('attendance', 'Attendance', 'ADMIN', 'Manage attendance', 'IoTime', 12),
('leaves', 'Leave Requests', 'ADMIN', 'Manage leave requests', 'IoTime', 13),
('timesheets', 'Timesheets', 'ADMIN', 'Manage timesheets', 'IoStopwatch', 14),
('expenses', 'Expenses', 'ADMIN', 'Manage expenses', 'IoReceipt', 15),
('reports', 'Reports', 'ADMIN', 'View reports', 'IoBarChart', 16),
('documents', 'Documents', 'ALL', 'Manage documents', 'IoFileTray', 17),
('events', 'Events', 'ALL', 'Manage events', 'IoCalendar', 18),
('messages', 'Messages', 'ALL', 'Chat messages', 'IoChatbubbles', 19),
('tickets', 'Tickets', 'ALL', 'Support tickets', 'IoTicket', 20),
('store', 'Store', 'ALL', 'Browse store items', 'IoStorefront', 21),
('orders', 'Orders', 'ALL', 'View orders', 'IoCard', 22),
('subscriptions', 'Subscriptions', 'ALL', 'Manage subscriptions', 'IoCard', 23),
('notes', 'Notes', 'ALL', 'Personal notes', 'IoReader', 24),
('settings', 'Settings', 'ADMIN', 'System settings', 'IoSettings', 25),
-- Employee Modules
('myTasks', 'My Tasks', 'EMPLOYEE', 'Assigned tasks', 'IoCheckbox', 26),
('myProjects', 'My Projects', 'EMPLOYEE', 'Assigned projects', 'IoFolderOpen', 27),
('timeTracking', 'Time Tracking', 'EMPLOYEE', 'Log work hours', 'IoStopwatch', 28),
('myProfile', 'My Profile', 'EMPLOYEE', 'Personal profile', 'IoPerson', 29),
('leaveRequests', 'Leave Requests', 'EMPLOYEE', 'Request time off', 'IoTime', 30),
-- Client Modules
('billing', 'Billing', 'CLIENT', 'Billing parent menu', 'IoWallet', 31);

-- =====================================================
-- 6. INSERT DEFAULT ROLES (if not exists)
-- =====================================================
-- Note: These will be created per company, so we'll handle this in the controller

-- =====================================================
-- 7. ADD role_id COLUMN TO USERS TABLE (if not exists)
-- =====================================================
-- Check if column exists before adding
SET @dbname = DATABASE();
SET @tablename = 'users';
SET @columnname = 'role_id';
SET @preparedStatement = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE
      (TABLE_SCHEMA = @dbname)
      AND (TABLE_NAME = @tablename)
      AND (COLUMN_NAME = @columnname)
  ) > 0,
  'SELECT 1',
  CONCAT('ALTER TABLE ', @tablename, ' ADD COLUMN ', @columnname, ' INT UNSIGNED NULL AFTER role, ADD INDEX idx_user_role_id (', @columnname, '), ADD FOREIGN KEY (', @columnname, ') REFERENCES roles(id) ON DELETE SET NULL')
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

