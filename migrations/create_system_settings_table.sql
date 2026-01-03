-- Migration: Create system_settings table
-- Date: 2026-01-03

-- Create system_settings table if not exists
CREATE TABLE IF NOT EXISTS `system_settings` (
  `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `company_id` INT UNSIGNED NULL,
  `setting_key` VARCHAR(100) NOT NULL,
  `setting_value` TEXT NULL,
  `setting_type` VARCHAR(50) DEFAULT 'string',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `unique_setting` (`company_id`, `setting_key`),
  INDEX `idx_setting_key` (`setting_key`),
  INDEX `idx_setting_company` (`company_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Insert default settings for company_id = 1
INSERT IGNORE INTO system_settings (company_id, setting_key, setting_value) VALUES
-- General Settings
(1, 'company_name', 'My Company'),
(1, 'company_email', 'info@company.com'),
(1, 'company_phone', ''),
(1, 'company_address', ''),
(1, 'company_website', ''),
(1, 'company_logo', ''),
(1, 'system_name', 'Worksuite CRM'),
(1, 'default_currency', 'USD'),
(1, 'default_timezone', 'UTC'),
(1, 'date_format', 'Y-m-d'),
(1, 'time_format', 'H:i'),
(1, 'fiscal_year_start', '01-01'),
(1, 'session_timeout', '30'),
(1, 'max_file_size', '10'),
(1, 'allowed_file_types', 'pdf,doc,docx,xls,xlsx,jpg,jpeg,png'),

-- Localization
(1, 'default_language', 'en'),
(1, 'currency_symbol_position', 'before'),
(1, 'date_format_localization', 'DD/MM/YYYY'),
(1, 'time_format_localization', '24h'),
(1, 'timezone_localization', 'UTC'),

-- Email Settings
(1, 'email_from', 'noreply@company.com'),
(1, 'email_from_name', 'Worksuite CRM'),
(1, 'smtp_host', ''),
(1, 'smtp_port', '587'),
(1, 'smtp_username', ''),
(1, 'smtp_password', ''),
(1, 'smtp_encryption', 'tls'),
(1, 'email_driver', 'smtp'),

-- UI Options
(1, 'theme_mode', 'light'),
(1, 'font_family', 'Inter, sans-serif'),
(1, 'primary_color', '#217E45'),
(1, 'secondary_color', '#76AF88'),
(1, 'sidebar_style', 'default'),
(1, 'top_menu_style', 'default'),

-- Top Menu
(1, 'top_menu_logo', ''),
(1, 'top_menu_color', '#102D2C'),

-- Footer
(1, 'footer_text', '© 2024 Worksuite CRM. All rights reserved.'),
(1, 'footer_color', '#102D2C'),

-- PWA
(1, 'pwa_enabled', 'false'),
(1, 'pwa_app_name', 'Worksuite CRM'),
(1, 'pwa_app_short_name', 'Worksuite'),
(1, 'pwa_app_description', 'CRM Application'),
(1, 'pwa_app_icon', ''),
(1, 'pwa_app_color', '#217E45'),

-- Modules (all enabled by default)
(1, 'module_leads', 'true'),
(1, 'module_clients', 'true'),
(1, 'module_projects', 'true'),
(1, 'module_tasks', 'true'),
(1, 'module_invoices', 'true'),
(1, 'module_estimates', 'true'),
(1, 'module_proposals', 'true'),
(1, 'module_payments', 'true'),
(1, 'module_expenses', 'true'),
(1, 'module_contracts', 'true'),
(1, 'module_subscriptions', 'true'),
(1, 'module_employees', 'true'),
(1, 'module_attendance', 'true'),
(1, 'module_time_tracking', 'true'),
(1, 'module_events', 'true'),
(1, 'module_departments', 'true'),
(1, 'module_positions', 'true'),
(1, 'module_messages', 'true'),
(1, 'module_tickets', 'true'),
(1, 'module_documents', 'true'),
(1, 'module_reports', 'true'),

-- Left Menu
(1, 'left_menu_style', 'default'),

-- Notifications
(1, 'email_notifications', 'true'),
(1, 'sms_notifications', 'false'),
(1, 'push_notifications', 'true'),
(1, 'notification_sound', 'true'),

-- Integrations
(1, 'google_calendar_enabled', 'false'),
(1, 'google_calendar_client_id', ''),
(1, 'google_calendar_client_secret', ''),
(1, 'slack_enabled', 'false'),
(1, 'slack_webhook_url', ''),
(1, 'zapier_enabled', 'false'),
(1, 'zapier_api_key', ''),

-- Cron Job
(1, 'cron_job_enabled', 'true'),
(1, 'cron_job_frequency', 'daily'),
(1, 'cron_job_last_run', ''),

-- Updates
(1, 'auto_update_enabled', 'false'),
(1, 'update_channel', 'stable'),
(1, 'last_update_check', ''),

-- Access Permission
(1, 'default_role', 'employee'),
(1, 'enable_two_factor', 'false'),

-- Client Portal
(1, 'client_portal_enabled', 'true'),
(1, 'client_portal_url', ''),
(1, 'client_can_view_invoices', 'true'),
(1, 'client_can_view_projects', 'true'),

-- Sales & Prospects
(1, 'auto_convert_lead', 'false'),
(1, 'default_lead_source', 'website'),

-- Plugins
(1, 'auto_update_plugins', 'false');

-- Also insert for other companies (2-10)
INSERT IGNORE INTO system_settings (company_id, setting_key, setting_value)
SELECT c.id, s.setting_key, s.setting_value
FROM companies c
CROSS JOIN system_settings s
WHERE s.company_id = 1 AND c.id != 1;
