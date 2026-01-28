-- Fix leads table id column AUTO_INCREMENT and PRIMARY KEY
-- This fixes the "Field 'id' doesn't have a default value" error

SET @dbname = DATABASE();
SET @tablename = 'leads';
SET @columnname = 'id';

-- Step 1: Check if PRIMARY KEY exists, if not add it
SET @hasPrimaryKey = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA = @dbname
    AND TABLE_NAME = @tablename
    AND COLUMN_NAME = @columnname
    AND CONSTRAINT_NAME = 'PRIMARY'
);

-- Step 2: Check if AUTO_INCREMENT exists
SET @hasAutoIncrement = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @dbname
    AND TABLE_NAME = @tablename
    AND COLUMN_NAME = @columnname
    AND EXTRA LIKE '%auto_increment%'
);

-- Step 3: Fix AUTO_INCREMENT (preserve PRIMARY KEY if exists)
SET @preparedStatement = (SELECT IF(
  @hasAutoIncrement = 0,
  CONCAT('ALTER TABLE ', @tablename, ' MODIFY ', @columnname, ' INT UNSIGNED AUTO_INCREMENT', 
    IF(@hasPrimaryKey > 0, '', ' PRIMARY KEY')),
  'SELECT 1'
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- Step 4: Ensure PRIMARY KEY exists (if AUTO_INCREMENT was just added)
SET @preparedStatement2 = (SELECT IF(
  @hasPrimaryKey = 0 AND @hasAutoIncrement = 0,
  CONCAT('ALTER TABLE ', @tablename, ' ADD PRIMARY KEY (', @columnname, ')'),
  'SELECT 1'
));
PREPARE alterIfNoPrimary FROM @preparedStatement2;
EXECUTE alterIfNoPrimary;
DEALLOCATE PREPARE alterIfNoPrimary;

-- Verify the change
SELECT 
  COLUMN_NAME, 
  COLUMN_TYPE, 
  EXTRA,
  COLUMN_KEY
FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_SCHEMA = DATABASE() 
  AND TABLE_NAME = 'leads' 
  AND COLUMN_NAME = 'id';

