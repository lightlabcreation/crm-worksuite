// =====================================================
// MySQL Database Configuration
// =====================================================

const mysql = require('mysql2/promise');

// Create connection pool
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASS || '',
  database: process.env.DB_NAME || 'crm_db',
  port: parseInt(process.env.DB_PORT) || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0
});

// Auto-migration function
const runAutoMigrations = async () => {
  try {
    // Check if lead_id column exists in estimates table
    const [columns] = await pool.execute(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'estimates' AND COLUMN_NAME = 'lead_id'`
    );

    if (columns.length === 0) {
      console.log('📦 Running migration: Adding lead_id to estimates table...');
      await pool.execute('ALTER TABLE estimates ADD COLUMN lead_id INT UNSIGNED NULL AFTER project_id');
      console.log('✅ Migration completed: lead_id column added to estimates');
    }

    // Make valid_till nullable in estimates
    const [validTillInfo] = await pool.execute(
      `SELECT IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS 
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'estimates' AND COLUMN_NAME = 'valid_till'`
    );

    if (validTillInfo.length > 0 && validTillInfo[0].IS_NULLABLE === 'NO') {
      console.log('📦 Running migration: Making valid_till nullable in estimates...');
      await pool.execute('ALTER TABLE estimates MODIFY COLUMN valid_till DATE NULL');
      console.log('✅ Migration completed: valid_till is now nullable');
    }

    // Make client_id nullable in estimates
    const [clientIdInfo] = await pool.execute(
      `SELECT IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS 
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'estimates' AND COLUMN_NAME = 'client_id'`
    );

    if (clientIdInfo.length > 0 && clientIdInfo[0].IS_NULLABLE === 'NO') {
      console.log('📦 Running migration: Making client_id nullable in estimates...');
      await pool.execute('ALTER TABLE estimates MODIFY COLUMN client_id INT UNSIGNED NULL');
      console.log('✅ Migration completed: client_id is now nullable');
    }

    // Check if client_id column exists in tasks table
    const [taskClientIdColumns] = await pool.execute(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tasks' AND COLUMN_NAME = 'client_id'`
    );

    if (taskClientIdColumns.length === 0) {
      console.log('📦 Running migration: Adding client_id to tasks table...');
      await pool.execute('ALTER TABLE tasks ADD COLUMN client_id INT UNSIGNED NULL AFTER project_id');
      console.log('✅ Migration completed: client_id column added to tasks');
    }

    // Check if lead_id column exists in tasks table
    const [taskLeadIdColumns] = await pool.execute(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tasks' AND COLUMN_NAME = 'lead_id'`
    );

    if (taskLeadIdColumns.length === 0) {
      console.log('📦 Running migration: Adding lead_id to tasks table...');
      await pool.execute('ALTER TABLE tasks ADD COLUMN lead_id INT UNSIGNED NULL AFTER client_id');
      console.log('✅ Migration completed: lead_id column added to tasks');
    }

    // Make invoice_id nullable in credit_notes
    const [creditNoteInvoiceIdInfo] = await pool.execute(
      `SELECT IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS 
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'credit_notes' AND COLUMN_NAME = 'invoice_id'`
    );

    if (creditNoteInvoiceIdInfo.length > 0 && creditNoteInvoiceIdInfo[0].IS_NULLABLE === 'NO') {
      console.log('📦 Running migration: Making invoice_id nullable in credit_notes...');
      // First, drop the foreign key constraint if it exists
      try {
        await pool.execute(`ALTER TABLE credit_notes DROP FOREIGN KEY credit_notes_ibfk_2`);
      } catch (err) {
        // Foreign key might have a different name or not exist
        console.log('Note: Could not drop foreign key (might not exist or have different name)');
      }
      await pool.execute('ALTER TABLE credit_notes MODIFY COLUMN invoice_id INT UNSIGNED NULL');
      // Re-add foreign key constraint with ON DELETE SET NULL
      try {
        await pool.execute(`ALTER TABLE credit_notes ADD CONSTRAINT credit_notes_ibfk_2 FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE SET NULL`);
      } catch (err) {
        console.log('Note: Could not re-add foreign key constraint');
      }
      console.log('✅ Migration completed: invoice_id is now nullable');
    }

    // Make amount nullable in credit_notes
    const [creditNoteAmountInfo] = await pool.execute(
      `SELECT IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS 
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'credit_notes' AND COLUMN_NAME = 'amount'`
    );

    if (creditNoteAmountInfo.length > 0 && creditNoteAmountInfo[0].IS_NULLABLE === 'NO') {
      console.log('📦 Running migration: Making amount nullable in credit_notes...');
      await pool.execute('ALTER TABLE credit_notes MODIFY COLUMN amount DECIMAL(15, 2) NULL');
      console.log('✅ Migration completed: amount is now nullable');
    }

    // Make date nullable in credit_notes
    const [creditNoteDateInfo] = await pool.execute(
      `SELECT IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS 
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'credit_notes' AND COLUMN_NAME = 'date'`
    );

    if (creditNoteDateInfo.length > 0 && creditNoteDateInfo[0].IS_NULLABLE === 'NO') {
      console.log('📦 Running migration: Making date nullable in credit_notes...');
      await pool.execute('ALTER TABLE credit_notes MODIFY COLUMN date DATE NULL');
      console.log('✅ Migration completed: date is now nullable');
    }

    // Check if client_id column exists in credit_notes table
    const [creditNoteClientIdColumns] = await pool.execute(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'credit_notes' AND COLUMN_NAME = 'client_id'`
    );

    if (creditNoteClientIdColumns.length === 0) {
      console.log('📦 Running migration: Adding client_id to credit_notes table...');
      await pool.execute('ALTER TABLE credit_notes ADD COLUMN client_id INT UNSIGNED NULL AFTER invoice_id');
      // Add foreign key if clients table exists
      try {
        await pool.execute(`ALTER TABLE credit_notes ADD CONSTRAINT credit_notes_ibfk_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL`);
      } catch (err) {
        console.log('Note: Could not add foreign key constraint for client_id');
      }
      console.log('✅ Migration completed: client_id column added to credit_notes');
    }

    // Check if bank_accounts table exists, create if not
    const [tables] = await pool.execute(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES 
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bank_accounts'`
    );

    if (tables.length === 0) {
      console.log('📦 Running migration: Creating bank_accounts table...');
      try {
        const createTableSQL = `CREATE TABLE IF NOT EXISTS bank_accounts (
          id INT PRIMARY KEY AUTO_INCREMENT,
          company_id INT NOT NULL DEFAULT 1,
          account_name VARCHAR(255) NULL,
          account_number VARCHAR(100) NULL,
          bank_name VARCHAR(255) NULL,
          bank_code VARCHAR(50) NULL,
          branch_name VARCHAR(255) NULL,
          branch_code VARCHAR(50) NULL,
          swift_code VARCHAR(50) NULL,
          iban VARCHAR(100) NULL,
          account_type VARCHAR(50) NULL,
          routing_number VARCHAR(50) NULL,
          currency VARCHAR(10) DEFAULT 'USD',
          opening_balance DECIMAL(15,2) DEFAULT 0,
          current_balance DECIMAL(15,2) DEFAULT 0,
          address TEXT NULL,
          city VARCHAR(100) NULL,
          state VARCHAR(100) NULL,
          zip VARCHAR(20) NULL,
          country VARCHAR(100) NULL,
          contact_person VARCHAR(255) NULL,
          phone VARCHAR(50) NULL,
          email VARCHAR(255) NULL,
          notes TEXT NULL,
          status VARCHAR(50) DEFAULT 'Active',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          is_deleted TINYINT(1) DEFAULT 0,
          INDEX idx_company_id (company_id),
          INDEX idx_is_deleted (is_deleted)
        )`;

        await pool.query(createTableSQL);
        console.log('✅ Migration completed: bank_accounts table created');

        // Verify table was created
        const [verifyTables] = await pool.execute(
          `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES 
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bank_accounts'`
        );
        if (verifyTables.length > 0) {
          console.log('✅ Verified: bank_accounts table exists');
        } else {
          console.error('❌ Warning: bank_accounts table creation may have failed');
        }
      } catch (err) {
        console.error('⚠️ Could not create bank_accounts table:', err.message);
        console.error('Error stack:', err.stack);
        // Don't throw - allow server to continue
      }
    } else {
      console.log('✅ bank_accounts table already exists');
      // Table exists, add missing columns if they don't exist
      const bankAccountColumns = [
        { name: 'account_type', type: 'VARCHAR(50) NULL' },
        { name: 'routing_number', type: 'VARCHAR(50) NULL' },
        { name: 'address', type: 'TEXT NULL' },
        { name: 'city', type: 'VARCHAR(100) NULL' },
        { name: 'state', type: 'VARCHAR(100) NULL' },
        { name: 'zip', type: 'VARCHAR(20) NULL' },
        { name: 'country', type: 'VARCHAR(100) NULL' },
        { name: 'contact_person', type: 'VARCHAR(255) NULL' },
        { name: 'phone', type: 'VARCHAR(50) NULL' },
        { name: 'email', type: 'VARCHAR(255) NULL' },
        { name: 'status', type: 'VARCHAR(50) NULL DEFAULT "Active"' }
      ];

      for (const col of bankAccountColumns) {
        try {
          const [colCheck] = await pool.execute(
            `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bank_accounts' AND COLUMN_NAME = ?`,
            [col.name]
          );

          if (colCheck.length === 0) {
            console.log(`📦 Running migration: Adding ${col.name} to bank_accounts table...`);
            await pool.execute(`ALTER TABLE bank_accounts ADD COLUMN ${col.name} ${col.type}`);
            console.log(`✅ Migration completed: ${col.name} column added to bank_accounts`);
          }
        } catch (err) {
          console.log(`⚠️ Could not add ${col.name}:`, err.message);
          // Continue with next column
        }
      }

      // Make tickets.client_id nullable (drop/re-add FK)
      try {
        const [clientColInfo] = await pool.execute(
          `SELECT IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS 
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tickets' AND COLUMN_NAME = 'client_id'`
        );
        if (clientColInfo.length > 0 && clientColInfo[0].IS_NULLABLE === 'NO') {
          console.log('📦 Running migration: Making client_id nullable in tickets table...');
          try {
            const [fkCheck] = await pool.execute(
              `SELECT CONSTRAINT_NAME FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE 
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tickets' 
             AND COLUMN_NAME = 'client_id' AND REFERENCED_TABLE_NAME IS NOT NULL`
            );
            if (fkCheck.length > 0) {
              const fkName = fkCheck[0].CONSTRAINT_NAME;
              await pool.execute(`ALTER TABLE tickets DROP FOREIGN KEY ${fkName}`);
              console.log(`   Dropped foreign key constraint: ${fkName}`);
            }
          } catch (fkErr) {
            console.log('   Note: Could not drop foreign key for client_id:', fkErr.message);
          }

          await pool.execute(`ALTER TABLE tickets MODIFY COLUMN client_id INT NULL`);
          console.log('✅ Migration completed: client_id is now nullable');

          // Re-add FK allowing NULL
          try {
            await pool.execute(
              `ALTER TABLE tickets ADD CONSTRAINT tickets_client_id_fk 
             FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL`
            );
            console.log('   Re-added foreign key constraint for client_id (nullable)');
          } catch (fkErr) {
            console.log('   Note: Could not re-add foreign key for client_id:', fkErr.message);
          }
        }
      } catch (err) {
        console.log('⚠️ Could not modify client_id in tickets:', err.message);
      }

      // Make projects.client_id nullable (drop/re-add FK)
      try {
        const [projClientColInfo] = await pool.execute(
          `SELECT IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS 
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'projects' AND COLUMN_NAME = 'client_id'`
        );
        if (projClientColInfo.length > 0 && projClientColInfo[0].IS_NULLABLE === 'NO') {
          console.log('📦 Running migration: Making client_id nullable in projects table...');
          try {
            const [fkCheck] = await pool.execute(
              `SELECT CONSTRAINT_NAME FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE 
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'projects' 
             AND COLUMN_NAME = 'client_id' AND REFERENCED_TABLE_NAME IS NOT NULL`
            );
            if (fkCheck.length > 0) {
              const fkName = fkCheck[0].CONSTRAINT_NAME;
              await pool.execute(`ALTER TABLE projects DROP FOREIGN KEY ${fkName}`);
              console.log(`   Dropped foreign key constraint: ${fkName}`);
            }
          } catch (fkErr) {
            console.log('   Note: Could not drop foreign key for projects.client_id:', fkErr.message);
          }

          await pool.execute(`ALTER TABLE projects MODIFY COLUMN client_id INT NULL`);
          console.log('✅ Migration completed: projects.client_id is now nullable');

          // Re-add FK allowing NULL
          try {
            await pool.execute(
              `ALTER TABLE projects ADD CONSTRAINT projects_client_id_fk 
             FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL`
            );
            console.log('   Re-added foreign key constraint for projects.client_id (nullable)');
          } catch (fkErr) {
            console.log('   Note: Could not re-add foreign key for projects.client_id:', fkErr.message);
          }
        }
      } catch (err) {
        console.log('⚠️ Could not modify client_id in projects:', err.message);
      }

      // Check if contract_items table exists
      const [contractItemsTable] = await pool.execute(
        `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES 
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'contract_items'`
      );

      if (contractItemsTable.length === 0) {
        console.log('📦 Running migration: Creating contract_items table...');
        await pool.query(`
          CREATE TABLE contract_items (
            id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            contract_id INT UNSIGNED NOT NULL,
            item_name VARCHAR(255) NOT NULL,
            description TEXT NULL,
            quantity DECIMAL(10, 2) DEFAULT 1.00,
            unit ENUM('Pcs', 'Kg', 'Hours', 'Days') DEFAULT 'Pcs',
            unit_price DECIMAL(15, 2) NOT NULL,
            tax VARCHAR(50) NULL,
            tax_rate DECIMAL(5, 2) DEFAULT 0.00,
            amount DECIMAL(15, 2) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            FOREIGN KEY (contract_id) REFERENCES contracts(id) ON DELETE CASCADE,
            INDEX idx_contract_item_contract (contract_id)
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);
        console.log('✅ Migration completed: contract_items table created');
      }

    }

    // Check if orders table exists, create if not
    const [ordersTables] = await pool.execute(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES 
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders'`
    );

    if (ordersTables.length === 0) {
      console.log('📦 Running migration: Creating orders table...');
      try {
        const createOrdersTableSQL = `CREATE TABLE IF NOT EXISTS orders (
          id INT UNSIGNED NOT NULL AUTO_INCREMENT,
          company_id INT UNSIGNED NOT NULL,
          client_id INT UNSIGNED NULL,
          invoice_id INT UNSIGNED NULL,
          title VARCHAR(255) NULL,
          description TEXT NULL,
          amount DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
          status ENUM('New', 'Pending', 'Processing', 'Completed', 'Cancelled', 'Shipped', 'Delivered') NOT NULL DEFAULT 'New',
          order_date DATE NULL DEFAULT (CURRENT_DATE),
          is_deleted TINYINT(1) NOT NULL DEFAULT 0,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          INDEX idx_company_id (company_id),
          INDEX idx_client_id (client_id),
          INDEX idx_invoice_id (invoice_id),
          INDEX idx_status (status),
          INDEX idx_is_deleted (is_deleted),
          INDEX idx_order_date (order_date),
          FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
          FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL,
          FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE SET NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

        await pool.query(createOrdersTableSQL);
        console.log('✅ Migration completed: orders table created');
      } catch (err) {
        console.error('⚠️ Could not create orders table:', err.message);
        // Don't throw - allow server to continue
      }
    } else {
      console.log('✅ orders table already exists');
    }

    // Check if order_items table exists, create if not
    const [orderItemsTables] = await pool.execute(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES 
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'order_items'`
    );

    if (orderItemsTables.length === 0) {
      console.log('📦 Running migration: Creating order_items table...');
      try {
        const createOrderItemsTableSQL = `CREATE TABLE IF NOT EXISTS order_items (
          id INT UNSIGNED NOT NULL AUTO_INCREMENT,
          order_id INT UNSIGNED NOT NULL,
          item_id INT UNSIGNED NULL,
          item_name VARCHAR(255) NULL,
          description TEXT NULL,
          quantity DECIMAL(10, 2) NOT NULL DEFAULT 1.00,
          unit VARCHAR(50) NULL DEFAULT 'PC',
          unit_price DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
          amount DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          INDEX idx_order_id (order_id),
          INDEX idx_item_id (item_id),
          FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
          FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE SET NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

        await pool.query(createOrderItemsTableSQL);
        console.log('✅ Migration completed: order_items table created');
      } catch (err) {
        console.error('⚠️ Could not create order_items table:', err.message);
        // Don't throw - allow server to continue
      }
    } else {
      console.log('✅ order_items table already exists');
    }

    // Make leads table columns nullable
    const leadsNullableColumns = [
      { name: 'person_name', type: 'VARCHAR(255) NULL' },
      { name: 'email', type: 'VARCHAR(255) NULL' },
      { name: 'phone', type: 'VARCHAR(50) NULL' },
      { name: 'owner_id', type: 'INT UNSIGNED NULL' },
      { name: 'created_by', type: 'INT UNSIGNED NULL' }
    ];

    for (const col of leadsNullableColumns) {
      try {
        const [colInfo] = await pool.execute(
          `SELECT IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS 
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'leads' AND COLUMN_NAME = ?`,
          [col.name]
        );

        if (colInfo.length > 0 && colInfo[0].IS_NULLABLE === 'NO') {
          console.log(`📦 Running migration: Making ${col.name} nullable in leads table...`);
          // For owner_id and created_by, we need to handle foreign keys carefully
          if (col.name === 'owner_id' || col.name === 'created_by') {
            // First, drop the foreign key constraint if it exists
            try {
              const [fkCheck] = await pool.execute(
                `SELECT CONSTRAINT_NAME FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE 
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'leads' 
                 AND COLUMN_NAME = ? AND REFERENCED_TABLE_NAME IS NOT NULL`,
                [col.name]
              );
              if (fkCheck.length > 0) {
                const fkName = fkCheck[0].CONSTRAINT_NAME;
                await pool.execute(`ALTER TABLE leads DROP FOREIGN KEY ${fkName}`);
                console.log(`   Dropped foreign key constraint: ${fkName}`);
              }
            } catch (fkErr) {
              console.log(`   Note: Could not drop foreign key for ${col.name}:`, fkErr.message);
            }
          }

          await pool.execute(`ALTER TABLE leads MODIFY COLUMN ${col.name} ${col.type}`);
          console.log(`✅ Migration completed: ${col.name} is now nullable`);

          // Re-add foreign key for owner_id and created_by if needed (but allow NULL)
          if (col.name === 'owner_id' || col.name === 'created_by') {
            try {
              await pool.execute(
                `ALTER TABLE leads ADD CONSTRAINT leads_${col.name}_fk 
                 FOREIGN KEY (${col.name}) REFERENCES users(id) ON DELETE SET NULL`
              );
              console.log(`   Re-added foreign key constraint for ${col.name}`);
            } catch (fkErr) {
              console.log(`   Note: Could not re-add foreign key for ${col.name}:`, fkErr.message);
            }
          }
        }
      } catch (err) {
        console.log(`⚠️ Could not modify ${col.name}:`, err.message);
        // Continue with next column
      }
    }

    // Check if color column exists in client_labels table
    const [clientLabelColorColumns] = await pool.execute(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_labels' AND COLUMN_NAME = 'color'`
    );

    if (clientLabelColorColumns.length === 0) {
      console.log('📦 Running migration: Adding color to client_labels table...');
      await pool.execute('ALTER TABLE client_labels ADD COLUMN color VARCHAR(20) DEFAULT "#3b82f6" AFTER label');
      console.log('✅ Migration completed: color column added to client_labels');
    }

    // Check if project_labels table exists, create if not
    const [projectLabelTables] = await pool.execute(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES 
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'project_labels'`
    );

    if (projectLabelTables.length === 0) {
      console.log('📦 Running migration: Creating project_labels table...');
      await pool.execute(`
        CREATE TABLE IF NOT EXISTS project_labels (
          id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          company_id INT UNSIGNED NOT NULL,
          name VARCHAR(100) NOT NULL,
          color VARCHAR(20) DEFAULT '#3b82f6',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          is_deleted TINYINT(1) DEFAULT 0,
          INDEX (company_id),
          FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
        )
      `);
      console.log('✅ Migration completed: project_labels table created');

      // Seed some default project labels
      console.log('📦 Seeding default project labels...');
      const defaults = [
        ['High Priority', '#ef4444'],
        ['On track', '#22c55e'],
        ['Urgent', '#f59e0b'],
        ['At risk', '#dc2626'],
        ['Complete', '#3b82f6']
      ];
      // Note: company_id 1 is usually the default. In a real scenario we might need to seed for all companies.
      for (const [name, color] of defaults) {
        await pool.execute('INSERT INTO project_labels (company_id, name, color) VALUES (1, ?, ?)', [name, color]);
      }
    }

    try {
      const [clientLabelColorCol] = await pool.execute(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_labels' AND COLUMN_NAME = 'color'`
      );

      if (clientLabelColorCol.length === 0) {
        console.log('📦 Running migration: Adding color to client_labels table...');
        await pool.execute(`ALTER TABLE client_labels ADD COLUMN color VARCHAR(20) NULL AFTER label`);
        console.log('✅ Migration completed: color column added to client_labels');
      }
    } catch (err) {
      console.log('⚠️ Could not add color to client_labels:', err.message);
    }

    try {
      const [projectLabelsTables] = await pool.execute(
        `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES 
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'project_labels'`
      );

      if (projectLabelsTables.length === 0) {
        console.log('📦 Running migration: Creating project_labels table...');
        await pool.query(
          `CREATE TABLE IF NOT EXISTS project_labels (
            id INT UNSIGNED NOT NULL AUTO_INCREMENT,
            company_id INT UNSIGNED NOT NULL,
            label VARCHAR(100) NOT NULL,
            color VARCHAR(20) NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            is_deleted TINYINT(1) NOT NULL DEFAULT 0,
            PRIMARY KEY (id),
            UNIQUE KEY unique_company_label (company_id, label),
            INDEX idx_company_id (company_id),
            INDEX idx_label (label),
            INDEX idx_is_deleted (is_deleted),
            FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
        );
        console.log('✅ Migration completed: project_labels table created');
      }
    } catch (err) {
      console.log('⚠️ Could not create project_labels table:', err.message);
    }

    // Attendance table migration
    try {
      const [attendanceTable] = await pool.execute(
        `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES 
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'attendance'`
      );

      if (attendanceTable.length === 0) {
        console.log('📦 Running migration: Creating attendance table...');
        await pool.query(`
          CREATE TABLE IF NOT EXISTS attendance (
            id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            company_id INT UNSIGNED NOT NULL,
            employee_id INT UNSIGNED NOT NULL,
            user_id INT UNSIGNED NOT NULL,
            date DATE NOT NULL,
            status ENUM('present', 'absent', 'half_day', 'late', 'on_leave', 'holiday', 'day_off') DEFAULT 'present',
            clock_in TIME NULL,
            clock_out TIME NULL,
            late_reason TEXT NULL,
            work_from ENUM('office', 'home', 'other') DEFAULT 'office',
            notes TEXT NULL,
            marked_by INT UNSIGNED NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            is_deleted TINYINT(1) DEFAULT 0,
            UNIQUE KEY unique_employee_date (employee_id, date),
            INDEX idx_attendance_company (company_id),
            INDEX idx_attendance_employee (employee_id),
            INDEX idx_attendance_date (date),
            INDEX idx_attendance_status (status),
            INDEX idx_attendance_deleted (is_deleted)
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('✅ Migration completed: attendance table created');
      }
    } catch (err) {
      console.log('⚠️ Could not create attendance table:', err.message);
    }

  } catch (error) {
    console.error('⚠️ Migration error (non-fatal):', error.message);
    console.error('Error stack:', error.stack);
    // Don't throw - allow server to continue even if migrations fail
  }
};

// Test connection and run migrations
pool.getConnection()
  .then(async connection => {
    console.log('✅ Database connected successfully');
    connection.release();
    // Run auto-migrations after successful connection
    try {
      await runAutoMigrations();
    } catch (migrationError) {
      console.error('⚠️ Migration error (non-fatal, server will continue):', migrationError.message);
      console.error('Migration error stack:', migrationError.stack);
      // Don't throw - allow server to start even if migrations fail
    }

    try {
      // ---------------------------------------------------------
      // Migration: Add new fields to employees and users tables
      // ---------------------------------------------------------

      // 1. users table
      const usersColumns = [
        { name: 'country', type: 'VARCHAR(100) NULL' },
        { name: 'email_notifications', type: 'TINYINT(1) DEFAULT 1' },
      ];

      for (const col of usersColumns) {
        const [check] = await pool.execute(
          `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = ?`,
          [col.name]
        );
        if (check.length === 0) {
          console.log(`📦 Running migration: Adding ${col.name} to users table...`);
          await pool.execute(`ALTER TABLE users ADD COLUMN ${col.name} ${col.type}`);
          console.log(`✅ Migration completed: ${col.name} added to users`);
        }
      }

      // 2. employees table
      const employeesColumns = [
        { name: 'salutation', type: 'VARCHAR(20) NULL' },
        { name: 'date_of_birth', type: 'DATE NULL' },
        { name: 'gender', type: "ENUM('Male', 'Female', 'Other') DEFAULT 'Male'" },
        { name: 'reporting_to', type: 'INT UNSIGNED NULL' },
        { name: 'language', type: "VARCHAR(50) DEFAULT 'en'" },
        { name: 'about', type: 'TEXT NULL' },
        { name: 'hourly_rate', type: 'DECIMAL(10, 2) NULL' },
        { name: 'slack_member_id', type: 'VARCHAR(100) NULL' },
        { name: 'skills', type: 'TEXT NULL' },
        { name: 'probation_end_date', type: 'DATE NULL' },
        { name: 'notice_period_start_date', type: 'DATE NULL' },
        { name: 'notice_period_end_date', type: 'DATE NULL' },
        { name: 'employment_type', type: "ENUM('Full Time', 'Part Time', 'Contract', 'Internship', 'Trainee') DEFAULT 'Full Time'" },
        { name: 'marital_status', type: "ENUM('Single', 'Married', 'Widowed', 'Divorced', 'Separated') DEFAULT 'Single'" },
        { name: 'business_address', type: 'TEXT NULL' },
      ];

      for (const col of employeesColumns) {
        const [check] = await pool.execute(
          `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employees' AND COLUMN_NAME = ?`,
          [col.name]
        );
        if (check.length === 0) {
          console.log(`📦 Running migration: Adding ${col.name} to employees table...`);
          await pool.execute(`ALTER TABLE employees ADD COLUMN ${col.name} ${col.type}`);
          console.log(`✅ Migration completed: ${col.name} added to employees`);

          if (col.name === 'reporting_to') {
            // Add FK
            try {
              await pool.execute(
                `ALTER TABLE employees ADD CONSTRAINT employees_reporting_to_fk 
                 FOREIGN KEY (reporting_to) REFERENCES users(id) ON DELETE SET NULL`
              );
              console.log('   Added foreign key constraint for reporting_to');
            } catch (fkErr) {
              console.log('   Note: Could not add foreign key for reporting_to:', fkErr.message);
            }
          }
        }
      }

      // Attendance table migration
      try {
        const [attendanceTable] = await pool.execute(
          `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES 
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'attendance'`
        );

        if (attendanceTable.length === 0) {
          console.log('📦 Running migration: Creating attendance table...');
          await pool.query(`
            CREATE TABLE IF NOT EXISTS attendance (
              id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
              company_id INT UNSIGNED NOT NULL,
              employee_id INT UNSIGNED NOT NULL,
              user_id INT UNSIGNED NOT NULL,
              date DATE NOT NULL,
              status ENUM('present', 'absent', 'half_day', 'late', 'on_leave', 'holiday', 'day_off') DEFAULT 'present',
              clock_in TIME NULL,
              clock_out TIME NULL,
              late_reason TEXT NULL,
              work_from ENUM('office', 'home', 'other') DEFAULT 'office',
              notes TEXT NULL,
              marked_by INT UNSIGNED NULL,
              created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
              is_deleted TINYINT(1) DEFAULT 0,
              UNIQUE KEY unique_employee_date (employee_id, date),
              INDEX idx_attendance_company (company_id),
              INDEX idx_attendance_employee (employee_id),
              INDEX idx_attendance_date (date),
              INDEX idx_attendance_status (status),
              INDEX idx_attendance_deleted (is_deleted)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
          `);
          console.log('✅ Migration completed: attendance table created');
        } else {
          console.log('✅ attendance table already exists');

          // Check and add missing columns
          const attendanceColumns = [
            { name: 'company_id', type: 'INT UNSIGNED NOT NULL' },
            { name: 'employee_id', type: 'INT UNSIGNED NOT NULL' },
            { name: 'user_id', type: 'INT UNSIGNED NOT NULL' },
            { name: 'date', type: 'DATE NOT NULL' },
            { name: 'status', type: "ENUM('present', 'absent', 'half_day', 'late', 'on_leave', 'holiday', 'day_off') DEFAULT 'present'" },
            { name: 'clock_in', type: 'TIME NULL' },
            { name: 'clock_out', type: 'TIME NULL' },
            { name: 'late_reason', type: 'TEXT NULL' },
            { name: 'work_from', type: "ENUM('office', 'home', 'other') DEFAULT 'office'" },
            { name: 'notes', type: 'TEXT NULL' },
            { name: 'marked_by', type: 'INT UNSIGNED NULL' },
            { name: 'is_deleted', type: 'TINYINT(1) DEFAULT 0' }
          ];

          for (const col of attendanceColumns) {
            try {
              const [colCheck] = await pool.execute(
                `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'attendance' AND COLUMN_NAME = ?`,
                [col.name]
              );

              if (colCheck.length === 0) {
                console.log(`📦 Adding column ${col.name} to attendance table...`);
                await pool.execute(`ALTER TABLE attendance ADD COLUMN ${col.name} ${col.type}`);
                console.log(`✅ Column ${col.name} added to attendance table`);
              }
            } catch (colErr) {
              console.log(`⚠️ Could not add column ${col.name} to attendance:`, colErr.message);
            }
          }
        }
      } catch (attErr) {
        console.log('⚠️ Could not create attendance table:', attErr.message);
      }

    } catch (migErr) {
      console.error('⚠️ Detailed migration error:', migErr);
    }

    try {
      // Check if type column exists in clients table
      const [clientTypeCol] = await pool.execute(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'clients' AND COLUMN_NAME = 'type'`
      );
      if (clientTypeCol.length === 0) {
        console.log('📦 Running migration: Adding type to clients table...');
        await pool.execute("ALTER TABLE clients ADD COLUMN type ENUM('Organization', 'Person') DEFAULT 'Organization' AFTER company_name");
        console.log('✅ Migration completed: type column added to clients');
      }

      // Check if client_groups table exists
      const [clientGroupsTable] = await pool.execute(
        `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES 
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_groups'`
      );
      if (clientGroupsTable.length === 0) {
        console.log('📦 Running migration: Creating client_groups table...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS client_groups (
            id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            client_id INT UNSIGNED NOT NULL,
            group_name VARCHAR(100) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_client_id (client_id),
            FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('✅ Migration completed: client_groups table created');
      }

      // Check if client_managers table exists
      const [clientManagersTable] = await pool.execute(
        `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES 
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_managers'`
      );
      if (clientManagersTable.length === 0) {
        console.log('📦 Running migration: Creating client_managers table...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS client_managers (
            id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            client_id INT UNSIGNED NOT NULL,
            user_id INT UNSIGNED NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_client_id (client_id),
            INDEX idx_user_id (user_id),
            FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('✅ Migration completed: client_managers table created');
      }

      // Groups migration
      try {
        // Check if groups table exists
        const [groupsTable] = await pool.execute(
          `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES 
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'groups'`
        );
        if (groupsTable.length === 0) {
          console.log('📦 Running migration: Creating groups table...');
          await pool.execute(`
            CREATE TABLE IF NOT EXISTS \`groups\` (
              id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
              company_id INT UNSIGNED NOT NULL,
              name VARCHAR(255) NOT NULL,
              description TEXT NULL,
              created_by INT UNSIGNED NOT NULL,
              created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
              is_deleted TINYINT(1) DEFAULT 0,
              FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
              FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE,
              INDEX idx_group_company (company_id),
              INDEX idx_group_created_by (created_by),
              INDEX idx_group_deleted (is_deleted)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
          `);
          console.log('✅ Migration completed: groups table created');
        }

        // Check if group_members table exists
        const [groupMembersTable] = await pool.execute(
          `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES 
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'group_members'`
        );
        if (groupMembersTable.length === 0) {
          console.log('📦 Running migration: Creating group_members table...');
          await pool.execute(`
            CREATE TABLE IF NOT EXISTS group_members (
              id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
              group_id INT UNSIGNED NOT NULL,
              user_id INT UNSIGNED NOT NULL,
              joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              is_deleted TINYINT(1) DEFAULT 0,
              FOREIGN KEY (group_id) REFERENCES \`groups\`(id) ON DELETE CASCADE,
              FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
              UNIQUE KEY unique_group_user (group_id, user_id),
              INDEX idx_group_member_group (group_id),
              INDEX idx_group_member_user (user_id),
              INDEX idx_group_member_deleted (is_deleted)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
          `);
          console.log('✅ Migration completed: group_members table created');
        }

        // Check if group_id column exists in messages table
        const [groupIdCol] = await pool.execute(
          `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'messages' AND COLUMN_NAME = 'group_id'`
        );
        if (groupIdCol.length === 0) {
          console.log('📦 Running migration: Adding group_id to messages table...');
          await pool.execute('ALTER TABLE messages ADD COLUMN group_id INT UNSIGNED NULL AFTER to_user_id');
          await pool.execute('ALTER TABLE messages ADD INDEX idx_message_group (group_id)');
          // Add foreign key constraint
          try {
            await pool.execute('ALTER TABLE messages ADD CONSTRAINT fk_message_group FOREIGN KEY (group_id) REFERENCES `groups`(id) ON DELETE CASCADE');
          } catch (fkErr) {
            // Foreign key might already exist or groups table doesn't exist yet
            console.log('⚠️ Note: Could not add foreign key constraint (might already exist)');
          }
          console.log('✅ Migration completed: group_id column added to messages');
        }
      } catch (groupsErr) {
        console.error('⚠️ Groups migration error:', groupsErr.message);
      }
    } catch (clientMigErr) {
      console.error('⚠️ Client migration error:', clientMigErr);
    }
  })
  .catch(err => {
    console.error('❌ Database connection error:', err.message);
    console.error('Please ensure MySQL is running and database exists');
    console.error('Server cannot start without database connection');
    // Exit with error code - server should not run without database
    process.exit(1);
  });

module.exports = pool;

