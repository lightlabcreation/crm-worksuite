-- Create contract_templates table for template-based contracts
CREATE TABLE IF NOT EXISTS `contract_templates` (
  `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `company_id` INT UNSIGNED NOT NULL,
  `template_name` VARCHAR(255) NOT NULL,
  `template_type` ENUM('Service', 'Product', 'Employment', 'NDA', 'General', 'Custom') DEFAULT 'General',
  `description` TEXT NULL,
  `content` LONGTEXT NOT NULL,
  `variables` JSON NULL COMMENT 'Available variables for template (e.g., {CLIENT_NAME}, {CONTRACT_DATE})',
  `is_default` TINYINT(1) DEFAULT 0,
  `is_active` TINYINT(1) DEFAULT 1,
  `created_by` INT UNSIGNED NOT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `is_deleted` TINYINT(1) DEFAULT 0,
  FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT,
  INDEX `idx_template_company` (`company_id`),
  INDEX `idx_template_type` (`template_type`),
  INDEX `idx_template_active` (`is_active`, `is_deleted`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Insert default templates
INSERT INTO `contract_templates` (`company_id`, `template_name`, `template_type`, `description`, `content`, `variables`, `is_default`, `is_active`, `created_by`) VALUES
(1, 'Service Agreement Template', 'Service', 'Standard service agreement template', 
'<h1>Service Agreement</h1>
<p><strong>Contract Number:</strong> {CONTRACT_NUMBER}</p>
<p><strong>Date:</strong> {CONTRACT_DATE}</p>
<p><strong>Valid Until:</strong> {VALID_UNTIL}</p>

<h2>Parties</h2>
<p><strong>Service Provider:</strong> {COMPANY_NAME}<br>
{COMPANY_ADDRESS}<br>
{COMPANY_PHONE}<br>
{COMPANY_EMAIL}</p>

<p><strong>Client:</strong> {CLIENT_NAME}<br>
{CLIENT_ADDRESS}</p>

<h2>Services</h2>
{ITEMS_LIST}

<h2>Terms and Conditions</h2>
<p>1. The service provider agrees to deliver the services as described above.</p>
<p>2. The client agrees to pay the total amount of {CONTRACT_AMOUNT} as specified.</p>
<p>3. Payment terms: {PAYMENT_TERMS}</p>
<p>4. This contract is valid from {CONTRACT_DATE} until {VALID_UNTIL}.</p>

<h2>Additional Terms</h2>
{ADDITIONAL_TERMS}

<p><strong>Signature:</strong></p>
<p>Service Provider: ___________________ Date: ___________</p>
<p>Client: ___________________ Date: ___________</p>',
JSON_OBJECT('CONTRACT_NUMBER', 'Contract Number', 'CONTRACT_DATE', 'Contract Date', 'VALID_UNTIL', 'Valid Until Date', 'COMPANY_NAME', 'Company Name', 'CLIENT_NAME', 'Client Name', 'CONTRACT_AMOUNT', 'Total Amount', 'ITEMS_LIST', 'Items List', 'ADDITIONAL_TERMS', 'Additional Terms'),
1, 1, 1),

(1, 'Product Sales Agreement', 'Product', 'Standard product sales contract template',
'<h1>Product Sales Agreement</h1>
<p><strong>Contract Number:</strong> {CONTRACT_NUMBER}</p>
<p><strong>Date:</strong> {CONTRACT_DATE}</p>

<h2>Parties</h2>
<p><strong>Seller:</strong> {COMPANY_NAME}</p>
<p><strong>Buyer:</strong> {CLIENT_NAME}</p>

<h2>Products</h2>
{ITEMS_LIST}

<h2>Payment Terms</h2>
<p>Total Amount: {CONTRACT_AMOUNT}</p>
<p>Payment Terms: {PAYMENT_TERMS}</p>

<h2>Delivery Terms</h2>
<p>{DELIVERY_TERMS}</p>

<h2>Warranty</h2>
<p>{WARRANTY_TERMS}</p>

<p><strong>Signatures:</strong></p>
<p>Seller: ___________________ Date: ___________</p>
<p>Buyer: ___________________ Date: ___________</p>',
JSON_OBJECT('CONTRACT_NUMBER', 'Contract Number', 'CONTRACT_DATE', 'Contract Date', 'COMPANY_NAME', 'Company Name', 'CLIENT_NAME', 'Client Name', 'CONTRACT_AMOUNT', 'Total Amount', 'ITEMS_LIST', 'Items List'),
0, 1, 1),

(1, 'Employment Contract Template', 'Employment', 'Standard employment contract template',
'<h1>Employment Contract</h1>
<p><strong>Contract Number:</strong> {CONTRACT_NUMBER}</p>
<p><strong>Date:</strong> {CONTRACT_DATE}</p>

<h2>Parties</h2>
<p><strong>Employer:</strong> {COMPANY_NAME}</p>
<p><strong>Employee:</strong> {CLIENT_NAME}</p>

<h2>Position and Responsibilities</h2>
<p>{POSITION_DESCRIPTION}</p>

<h2>Compensation</h2>
<p>Salary: {CONTRACT_AMOUNT}</p>
<p>Payment Terms: {PAYMENT_TERMS}</p>

<h2>Term of Employment</h2>
<p>Start Date: {CONTRACT_DATE}</p>
<p>End Date: {VALID_UNTIL}</p>

<h2>Terms and Conditions</h2>
{ADDITIONAL_TERMS}

<p><strong>Signatures:</strong></p>
<p>Employer: ___________________ Date: ___________</p>
<p>Employee: ___________________ Date: ___________</p>',
JSON_OBJECT('CONTRACT_NUMBER', 'Contract Number', 'CONTRACT_DATE', 'Contract Date', 'VALID_UNTIL', 'End Date', 'COMPANY_NAME', 'Company Name', 'CLIENT_NAME', 'Employee Name', 'CONTRACT_AMOUNT', 'Salary', 'POSITION_DESCRIPTION', 'Position Description'),
0, 1, 1);

