# Database Migrations

This directory contains SQL migration files for database schema changes.

## How to Run Migrations

### Option 1: Using MySQL Command Line
```bash
mysql -u root -p worksuite_db < migrations/001_add_package_id_to_companies.sql
```

### Option 2: Using MySQL Workbench or phpMyAdmin
1. Open the migration file
2. Copy the SQL statements
3. Execute them in your database

### Option 3: Using Node.js Script
```bash
node run-migration.js migrations/001_add_package_id_to_companies.sql
```

## Migration Files

### 001_add_package_id_to_companies.sql
- **Date**: 2024
- **Description**: Adds `package_id` column to `companies` table to link companies with company packages
- **Changes**:
  - Adds `package_id` INT UNSIGNED NULL column
  - Adds index `idx_company_package` for performance
  - Adds foreign key constraint (optional)

## Important Notes

- Always backup your database before running migrations
- Run migrations in order (by number)
- Check the verification query at the end of each migration file to confirm changes

