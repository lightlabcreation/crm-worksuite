require('dotenv').config();
const mysql = require('mysql2/promise');

const check = async () => {
    let connection;
    try {
        connection = await mysql.createConnection({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASS || '',
            // Connect to MySQL server without selecting DB first to check/create it
            port: parseInt(process.env.DB_PORT) || 3306
        });

        // Check if DB exists
        const [dbs] = await connection.execute("SHOW DATABASES LIKE 'crm_db'");
        if (dbs.length === 0) {
            console.log("Database 'crm_db' does not exist.");
            return;
        }

        // Switch to DB
        await connection.changeUser({ database: 'crm_db' });

        // List tables
        const [tables] = await connection.execute("SHOW TABLES");
        console.log(`Database 'crm_db' has ${tables.length} tables.`);
        if (tables.length > 0) {
            console.log("First 5 tables:", tables.slice(0, 5).map(t => Object.values(t)[0]));
        }

    } catch (error) {
        console.error('ERROR:', error);
    } finally {
        if (connection) await connection.end();
    }
};

check();
