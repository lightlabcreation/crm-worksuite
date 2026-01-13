require('dotenv').config();
const mysql = require('mysql2/promise');

const check = async () => {
    let connection;
    try {
        connection = await mysql.createConnection({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASS || '',
            database: process.env.DB_NAME || 'crm_db',
            port: parseInt(process.env.DB_PORT) || 3306
        });

        const [rows] = await connection.execute(`
            SELECT COLUMN_NAME, IS_NULLABLE, COLUMN_TYPE
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = '${process.env.DB_NAME || 'crm_db'}'
            AND TABLE_NAME = 'finance_templates'
            AND COLUMN_NAME = 'company_id'
        `);

        console.log('COLUMN INFO:', rows);

    } catch (error) {
        console.error('ERROR:', error);
    } finally {
        if (connection) await connection.end();
    }
};

check();
