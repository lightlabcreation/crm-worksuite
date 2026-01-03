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
  })
  .catch(err => {
    console.error('❌ Database connection error:', err.message);
    console.error('Please ensure MySQL is running and database exists');
    console.error('Server cannot start without database connection');
    // Exit with error code - server should not run without database
    process.exit(1);
  });

module.exports = pool;

