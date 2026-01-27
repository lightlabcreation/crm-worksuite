-- Create contract_items table if it doesn't exist
CREATE TABLE IF NOT EXISTS `contract_items` (
  `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `contract_id` INT UNSIGNED NOT NULL,
  `item_name` VARCHAR(255) NOT NULL,
  `description` TEXT NULL,
  `quantity` DECIMAL(10,2) DEFAULT 1.00,
  `unit` ENUM('Pcs', 'Kg', 'Hours', 'Days') DEFAULT 'Pcs',
  `unit_price` DECIMAL(15,2) NOT NULL,
  `tax` VARCHAR(50) NULL,
  `tax_rate` DECIMAL(5,2) DEFAULT 0.00,
  `amount` DECIMAL(15,2) NOT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (`contract_id`) REFERENCES `contracts`(`id`) ON DELETE CASCADE,
  INDEX `idx_contract_item_contract` (`contract_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

