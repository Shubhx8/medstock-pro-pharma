const mysql = require('mysql2/promise');
require('dotenv').config();

// MySQL connection pool supporting both separate credentials and single DATABASE_URL
const isAiven = (process.env.DB_HOST && process.env.DB_HOST.includes('aivencloud.com'));
const useSSL = process.env.DB_SSL === 'true' || process.env.DB_SSL === '1' || isAiven;

const poolConfig = (process.env.DATABASE_URL || process.env.MYSQL_URL)
  ? {
      uri: process.env.DATABASE_URL || process.env.MYSQL_URL,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      dateStrings: true,
      ssl: { rejectUnauthorized: false }
    }
  : {
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'defaultdb',
      port: Number(process.env.DB_PORT) || 3306,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      dateStrings: true,
      ssl: useSSL ? { rejectUnauthorized: false } : undefined
    };

const pool = mysql.createPool(poolConfig);



module.exports = pool;
