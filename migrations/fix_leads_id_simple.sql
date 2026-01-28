-- Simple fix for leads and contacts tables id columns AUTO_INCREMENT
-- This works without needing INFORMATION_SCHEMA access
-- Run this directly in phpMyAdmin SQL tab or Railway database

-- ============================================
-- Fix 1: leads table
-- ============================================
ALTER TABLE leads MODIFY id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY;

-- ============================================
-- Fix 2: contacts table (for lead contacts)
-- ============================================
ALTER TABLE contacts MODIFY id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY;

-- ============================================
-- Verify both fixes worked:
-- ============================================
SHOW COLUMNS FROM leads WHERE Field = 'id';
SHOW COLUMNS FROM contacts WHERE Field = 'id';

-- If above fails due to existing constraints, use this alternative:
-- ALTER TABLE leads DROP PRIMARY KEY;
-- ALTER TABLE leads MODIFY id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY;
-- 
-- ALTER TABLE contacts DROP PRIMARY KEY;
-- ALTER TABLE contacts MODIFY id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY;

