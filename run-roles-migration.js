const pool = require('./config/db');

async function migrate() {
    console.log('Starting Roles & Permissions Migration (Respecting Existing Schema)...');

    try {
        // 1. Roles table already exists with role_name.
        // Schema: id, company_id, role_name, description...
        console.log('Using existing roles table.');

        // 2. Create Permission Table (Role-Module Permissions)
        // Note: roles.id is INT UNSIGNED based on previous check
        await pool.execute(`
      CREATE TABLE IF NOT EXISTS role_permissions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        role_id INT UNSIGNED NOT NULL,
        module VARCHAR(50) NOT NULL,
        can_view TINYINT(1) DEFAULT 0,
        can_add TINYINT(1) DEFAULT 0,
        can_edit TINYINT(1) DEFAULT 0,
        can_delete TINYINT(1) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
        UNIQUE KEY unique_role_module (role_id, module)
      )
    `);
        console.log('Role Permissions table created/verified.');

        // 3. Seed Default Roles if empty
        const defaultRoles = ['ADMIN', 'EMPLOYEE', 'CLIENT', 'MANAGER', 'HR'];

        for (const r of defaultRoles) {
            // Check if exists
            const [existing] = await pool.execute('SELECT id FROM roles WHERE role_name = ?', [r]);
            if (existing.length === 0) {
                await pool.execute(
                    'INSERT INTO roles (company_id, role_name) VALUES (?, ?)',
                    [1, r]
                );
                console.log(`Seeded role: ${r}`);
            }
        }

        console.log('Migration completed successfully.');
        process.exit(0);
    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    }
}

migrate();
