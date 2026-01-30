-- Fix events table id column AUTO_INCREMENT
-- Run this SQL on your LIVE database to fix the "Field 'id' doesn't have a default value" error

-- 1. Modify the id column to be AUTO_INCREMENT
-- This assumes the id column is already a PRIMARY KEY or INT
ALTER TABLE `events` MODIFY `id` INT UNSIGNED NOT NULL AUTO_INCREMENT;

-- 2. Verify the change (Output should show 'auto_increment' in Extra column)
SHOW COLUMNS FROM `events` LIKE 'id';
