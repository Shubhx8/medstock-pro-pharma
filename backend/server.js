require('dotenv').config();
const cron = require('node-cron');
const app = require('./src/app');
const pool = require('./src/config/db');
const alertService = require('./src/services/alertService');
const autoInitDatabase = require('./src/config/initDb');

const PORT = process.env.PORT || 5000;

async function startServer() {
  try {
    // 1. Verify DB connection
    const [rows] = await pool.query('SELECT 1 + 1 AS result');
    console.log('[DB] MySQL connection pool established successfully. Test query result:', rows[0].result);

    // 2. Auto-initialize database schema, triggers and seed if table is absent
    await autoInitDatabase(pool);

    // 3. Run alert generation on startup (non-blocking, never throws)

    try {
      console.log('[EXPIRY-SERVICE] Running initial startup alert generation...');
      const alertStats = await alertService.generateAlerts();
      console.log('[EXPIRY-SERVICE] Initial alerts generated:', alertStats);
    } catch (alertErr) {
      console.error('[EXPIRY-SERVICE] Startup alert generation failed (will retry on cron):', alertErr.message);
    }

    // 3. Setup daily cron job at 00:05
    cron.schedule('5 0 * * *', async () => {
      console.log('[CRON] Running daily scheduled alert generation at 00:05...');
      try {
        const stats = await alertService.generateAlerts();
        console.log('[CRON] Scheduled alert generation complete:', stats);
      } catch (err) {
        console.error('[CRON] Alert generation failed:', err.message);
      }
    });

    // 4. Start HTTP Server
    app.listen(PORT, () => {
      console.log(`[SERVER] Pharmacy backend running on http://localhost:${PORT}`);
      console.log(`[SERVER] Health check available at http://localhost:${PORT}/api/health`);
    });
  } catch (err) {
    console.error('[FATAL] Failed to connect to MySQL database on startup:', err.message);
    console.error('Please ensure MySQL service is running and credentials in .env are correct.');
    process.exit(1);
  }
}

startServer();
