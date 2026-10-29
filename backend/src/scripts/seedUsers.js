const bcrypt = require('bcryptjs');
const pool = require('../config/db');

async function seedUsers() {
  console.log('Seeding initial users...');
  try {
    const adminPass = await bcrypt.hash('admin123', 10);
    const staffPass = await bcrypt.hash('staff123', 10);

    const users = [
      { name: 'Dr. Rajesh Sharma (Admin)', email: 'admin@pharmacy.com', password_hash: adminPass, role: 'admin' },
      { name: 'Priya Patel (Pharmacist)', email: 'staff@pharmacy.com', password_hash: staffPass, role: 'pharmacist' },
      { name: 'Vikram Singh (Store Keeper)', email: 'storekeeper@pharmacy.com', password_hash: staffPass, role: 'storekeeper' }
    ];

    for (const u of users) {
      // Check if user already exists
      const [existing] = await pool.query('SELECT user_id FROM users WHERE email = ?', [u.email]);
      if (existing.length === 0) {
        await pool.query(
          'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
          [u.name, u.email, u.password_hash, u.role]
        );
        console.log(`Created user: ${u.email} (${u.role})`);
      } else {
        await pool.query(
          'UPDATE users SET password_hash = ?, role = ?, name = ? WHERE email = ?',
          [u.password_hash, u.role, u.name, u.email]
        );
        console.log(`Updated user: ${u.email} (${u.role})`);
      }
    }

    console.log('User seeding completed successfully.');
    process.exit(0);
  } catch (err) {
    console.error('Error seeding users:', err);
    process.exit(1);
  }
}

seedUsers();
