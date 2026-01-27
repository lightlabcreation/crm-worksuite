-- Add is_system_role column to roles table if it doesn't exist
-- This fixes the "Unknown column 'is_system_role'" error

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

-- Update existing roles to set is_system_role = 0 (custom roles) by default
-- System roles (ADMIN, EMPLOYEE, CLIENT) will be set by the roleInitializer
UPDATE `roles` SET `is_system_role` = 0 WHERE `is_system_role` IS NULL;

