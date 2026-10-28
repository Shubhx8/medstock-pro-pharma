const bcrypt = require('bcryptjs');

/**
 * Automatically initializes database tables, views, triggers, and seed data
 * if the database is fresh (e.g. newly deployed on cloud like Aiven).
 */
async function autoInitDatabase(pool) {
  try {
    // Check if tables already exist
    const [tables] = await pool.query("SHOW TABLES LIKE 'medicine'");
    if (tables.length > 0) {
      return; // Already initialized
    }

    console.log('[AUTO-INIT] Fresh database detected. Creating schema, triggers, and seed data...');

    // 1. Create Master Tables
    await pool.query(`
      CREATE TABLE IF NOT EXISTS manufacturer (
        manufacturer_id INT AUTO_INCREMENT PRIMARY KEY,
        name            VARCHAR(100) NOT NULL UNIQUE,
        address         VARCHAR(255)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS category (
        category_id INT AUTO_INCREMENT PRIMARY KEY,
        name        VARCHAR(60) NOT NULL UNIQUE
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS supplier (
        supplier_id INT AUTO_INCREMENT PRIMARY KEY,
        name        VARCHAR(100) NOT NULL,
        phone       VARCHAR(15),
        street      VARCHAR(100),
        city        VARCHAR(50),
        pin         VARCHAR(10)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS customer (
        customer_id INT AUTO_INCREMENT PRIMARY KEY,
        name        VARCHAR(100) NOT NULL,
        phone       VARCHAR(15)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        user_id       INT AUTO_INCREMENT PRIMARY KEY,
        name          VARCHAR(100) NOT NULL,
        email         VARCHAR(120) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        role          ENUM('admin','pharmacist') NOT NULL DEFAULT 'pharmacist'
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS medicine (
        medicine_id     INT AUTO_INCREMENT PRIMARY KEY,
        name            VARCHAR(100) NOT NULL,
        generic_name    VARCHAR(100),
        strength        VARCHAR(30),
        unit            VARCHAR(20) NOT NULL DEFAULT 'tablet',
        category_id     INT NOT NULL,
        manufacturer_id INT NOT NULL,
        reorder_level   INT NOT NULL DEFAULT 50,
        CONSTRAINT chk_med_reorder CHECK (reorder_level >= 0),
        CONSTRAINT fk_med_cat  FOREIGN KEY (category_id)     REFERENCES category(category_id),
        CONSTRAINT fk_med_man  FOREIGN KEY (manufacturer_id) REFERENCES manufacturer(manufacturer_id)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS batch (
        batch_id       INT AUTO_INCREMENT PRIMARY KEY,
        medicine_id    INT NOT NULL,
        supplier_id    INT NOT NULL,
        batch_no       VARCHAR(30) NOT NULL,
        mfg_date       DATE NOT NULL,
        expiry_date    DATE NOT NULL,
        purchase_price DECIMAL(10,2) NOT NULL,
        mrp            DECIMAL(10,2) NOT NULL,
        quantity       INT NOT NULL,
        purchase_date  DATE NOT NULL DEFAULT (CURDATE()),
        status         ENUM('ACTIVE','EXPIRED','DISPOSED') NOT NULL DEFAULT 'ACTIVE',
        CONSTRAINT uq_batch UNIQUE (medicine_id, batch_no),
        CONSTRAINT chk_batch_qty   CHECK (quantity >= 0),
        CONSTRAINT chk_batch_price CHECK (purchase_price >= 0 AND mrp >= 0),
        CONSTRAINT chk_batch_dates CHECK (expiry_date > mfg_date),
        CONSTRAINT fk_batch_med FOREIGN KEY (medicine_id) REFERENCES medicine(medicine_id),
        CONSTRAINT fk_batch_sup FOREIGN KEY (supplier_id) REFERENCES supplier(supplier_id)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS sale (
        sale_id      INT AUTO_INCREMENT PRIMARY KEY,
        customer_id  INT NULL,
        sale_date    DATE NOT NULL DEFAULT (CURDATE()),
        total_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
        created_by   INT NOT NULL,
        CONSTRAINT fk_sale_cust FOREIGN KEY (customer_id) REFERENCES customer(customer_id),
        CONSTRAINT fk_sale_user FOREIGN KEY (created_by)  REFERENCES users(user_id)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS sold_in (
        sold_in_id INT AUTO_INCREMENT PRIMARY KEY,
        sale_id    INT NOT NULL,
        batch_id   INT NOT NULL,
        qty        INT NOT NULL,
        price      DECIMAL(10,2) NOT NULL,
        CONSTRAINT chk_sold_qty CHECK (qty > 0),
        CONSTRAINT fk_sold_sale  FOREIGN KEY (sale_id)  REFERENCES sale(sale_id) ON DELETE CASCADE,
        CONSTRAINT fk_sold_batch FOREIGN KEY (batch_id) REFERENCES batch(batch_id)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS alert (
        alert_id    INT AUTO_INCREMENT PRIMARY KEY,
        medicine_id INT NOT NULL,
        batch_id    INT NULL,
        alert_type  ENUM('EXPIRING_SOON','EXPIRED','LOW_STOCK','OUT_OF_STOCK') NOT NULL,
        message     VARCHAR(255) NOT NULL,
        alert_date  DATE NOT NULL DEFAULT (CURDATE()),
        status      ENUM('OPEN','RESOLVED') NOT NULL DEFAULT 'OPEN',
        CONSTRAINT fk_alert_med   FOREIGN KEY (medicine_id) REFERENCES medicine(medicine_id),
        CONSTRAINT fk_alert_batch FOREIGN KEY (batch_id)    REFERENCES batch(batch_id)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS disposal (
        disposal_id   INT AUTO_INCREMENT PRIMARY KEY,
        batch_id      INT NOT NULL,
        quantity      INT NOT NULL,
        disposal_date DATE NOT NULL DEFAULT (CURDATE()),
        reason        VARCHAR(255) DEFAULT 'Expired',
        approved_by   INT NOT NULL,
        CONSTRAINT chk_disp_qty CHECK (quantity > 0),
        CONSTRAINT fk_disp_batch FOREIGN KEY (batch_id)    REFERENCES batch(batch_id),
        CONSTRAINT fk_disp_user  FOREIGN KEY (approved_by) REFERENCES users(user_id)
      )
    `);

    // 2. Create Views
    await pool.query(`
      CREATE OR REPLACE VIEW v_medicine_stock AS
      SELECT m.medicine_id, m.name, m.reorder_level,
             COALESCE(SUM(b.quantity), 0) AS total_stock
      FROM medicine m
      LEFT JOIN batch b
        ON b.medicine_id = m.medicine_id
       AND b.status = 'ACTIVE'
       AND b.expiry_date >= CURDATE()
      GROUP BY m.medicine_id, m.name, m.reorder_level
    `);

    await pool.query(`
      CREATE OR REPLACE VIEW v_expiring_batches AS
      SELECT b.batch_id, b.batch_no, m.medicine_id, m.name AS medicine_name,
             b.quantity, b.expiry_date,
             DATEDIFF(b.expiry_date, CURDATE()) AS days_left
      FROM batch b
      JOIN medicine m ON m.medicine_id = b.medicine_id
      WHERE b.status = 'ACTIVE'
        AND b.quantity > 0
        AND b.expiry_date >= CURDATE()
        AND b.expiry_date <= DATE_ADD(CURDATE(), INTERVAL 90 DAY)
    `);

    // 3. Create Triggers (Drop first to avoid duplication errors)
    await pool.query('DROP TRIGGER IF EXISTS trg_batch_before_insert');
    await pool.query(`
      CREATE TRIGGER trg_batch_before_insert
      BEFORE INSERT ON batch
      FOR EACH ROW
      BEGIN
        IF @skip_expiry_check IS NULL
           AND NEW.expiry_date < DATE_ADD(CURDATE(), INTERVAL 30 DAY) THEN
          SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Expiry date is already past or too close (minimum 30 days)';
        END IF;
      END
    `);

    await pool.query('DROP TRIGGER IF EXISTS trg_sold_in_before_insert');
    await pool.query(`
      CREATE TRIGGER trg_sold_in_before_insert
      BEFORE INSERT ON sold_in
      FOR EACH ROW
      BEGIN
        DECLARE v_exp DATE;
        DECLARE v_qty INT;
        DECLARE v_status VARCHAR(10);
        SELECT expiry_date, quantity, status INTO v_exp, v_qty, v_status
          FROM batch WHERE batch_id = NEW.batch_id;
        IF v_exp < CURDATE() OR v_status <> 'ACTIVE' THEN
          SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Cannot sell from an expired or inactive batch';
        END IF;
        IF v_qty < NEW.qty THEN
          SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Insufficient stock in batch';
        END IF;
      END
    `);

    await pool.query('DROP TRIGGER IF EXISTS trg_sold_in_after_insert');
    await pool.query(`
      CREATE TRIGGER trg_sold_in_after_insert
      AFTER INSERT ON sold_in
      FOR EACH ROW
      BEGIN
        UPDATE batch SET quantity = quantity - NEW.qty WHERE batch_id = NEW.batch_id;
      END
    `);

    await pool.query('DROP TRIGGER IF EXISTS trg_disposal_after_insert');
    await pool.query(`
      CREATE TRIGGER trg_disposal_after_insert
      AFTER INSERT ON disposal
      FOR EACH ROW
      BEGIN
        UPDATE batch
           SET status   = IF(quantity - NEW.quantity = 0, 'DISPOSED', status),
               quantity = quantity - NEW.quantity
         WHERE batch_id = NEW.batch_id;
      END
    `);

    // 4. Seed Seed Data
    await pool.query('SET @skip_expiry_check = 1');

    await pool.query(`
      INSERT INTO manufacturer (manufacturer_id, name, address) VALUES
      (1,'Cipla Ltd','Mumbai, Maharashtra'),
      (2,'Sun Pharma','Mumbai, Maharashtra'),
      (3,'Dr. Reddy\\'s Laboratories','Hyderabad, Telangana'),
      (4,'Lupin Ltd','Mumbai, Maharashtra'),
      (5,'Zydus Lifesciences','Ahmedabad, Gujarat')
      ON DUPLICATE KEY UPDATE name=VALUES(name)
    `);

    await pool.query(`
      INSERT INTO category (category_id, name) VALUES
      (1,'Analgesic'),(2,'Antibiotic'),(3,'Antihistamine'),(4,'Antidiabetic'),
      (5,'Antacid'),(6,'Antihypertensive'),(7,'Cough & Cold'),(8,'Statin'),(9,'Supplement')
      ON DUPLICATE KEY UPDATE name=VALUES(name)
    `);

    await pool.query(`
      INSERT INTO supplier (supplier_id, name, phone, street, city, pin) VALUES
      (1,'MediLink Distributors','9820011122','12 MG Road','Pune','411001'),
      (2,'HealthFirst Agencies','9890055566','45 Link Rd','Mumbai','400050'),
      (3,'Apex Pharma Traders','9811122233','7 Nehru Place','Delhi','110019'),
      (4,'CareLine Supplies','9988776655','22 Ring Rd','Nagpur','440001'),
      (5,'Sai Pharma Distributors','9822033344','18 FC Road','Pune','411004'),
      (6,'Metro Medico Supplies','9833044455','9 Dadar West','Mumbai','400028'),
      (7,'Southern Drug Agency','9845055566','31 Anna Salai','Chennai','600002'),
      (8,'Eastern Health Traders','9830066677','5 Park Street','Kolkata','700016'),
      (9,'Gujarat Medi Hub','9825077788','14 CG Road','Ahmedabad','380009'),
      (10,'Deccan Pharma Wholesale','9848088899','26 Begum Pet','Hyderabad','500016')
      ON DUPLICATE KEY UPDATE name=VALUES(name)
    `);

    await pool.query(`
      INSERT INTO customer (customer_id, name, phone) VALUES
      (1,'Walk-in Customer',NULL),
      (2,'Ramesh Patil','9000000001'),
      (3,'Sunita Deshmukh','9000000002'),
      (4,'Amit Verma','9000000003')
      ON DUPLICATE KEY UPDATE name=VALUES(name)
    `);

    await pool.query(`
      INSERT INTO medicine (medicine_id, name, generic_name, strength, unit, category_id, manufacturer_id, reorder_level) VALUES
      (1,'Paracetamol 500','Paracetamol','500mg','tablet',1,1,100),
      (2,'Amoxicillin 250','Amoxicillin','250mg','capsule',2,2,80),
      (3,'Azithromycin 500','Azithromycin','500mg','tablet',2,1,60),
      (4,'Cetirizine 10','Cetirizine','10mg','tablet',3,3,80),
      (5,'Metformin 500','Metformin','500mg','tablet',4,4,120),
      (6,'Omeprazole 20','Omeprazole','20mg','capsule',5,3,70),
      (7,'Amlodipine 5','Amlodipine','5mg','tablet',6,5,90),
      (8,'Ibuprofen 400','Ibuprofen','400mg','tablet',1,2,80),
      (9,'Pantoprazole 40','Pantoprazole','40mg','tablet',5,4,70),
      (10,'Cough Syrup 100ml','Dextromethorphan','100ml','bottle',7,5,30),
      (11,'Atorvastatin 10','Atorvastatin','10mg','tablet',8,1,60),
      (12,'Vitamin D3 60K','Cholecalciferol','60000 IU','sachet',9,3,50)
      ON DUPLICATE KEY UPDATE name=VALUES(name)
    `);

    await pool.query(`
      INSERT INTO batch (batch_id, medicine_id, supplier_id, batch_no, mfg_date, expiry_date, purchase_price, mrp, quantity, purchase_date) VALUES
      (1, 1, 1, 'B2301','2025-01-01','2026-12-31',19.60, 28.00, 40,'2026-08-05'),
      (2, 1, 5, 'B2302','2025-07-01','2027-06-30',19.60, 28.00,120,'2026-09-12'),
      (3, 2, 1, 'B1877','2025-03-10','2028-03-09',60.00, 85.50,300,'2026-07-20'),
      (4, 3, 3, 'B3320','2025-12-15','2027-12-14',78.00,112.00,120,'2026-08-18'),
      (5, 4, 2, 'B4410','2025-12-01','2026-11-30',22.00, 32.00, 25,'2026-09-02'),
      (6, 5, 4, 'B5521','2026-01-20','2028-01-19',31.50, 45.00,500,'2026-07-30'),
      (7, 6, 3, 'B6032','2025-09-10','2027-09-09',45.00, 64.00, 90,'2026-08-25'),
      (8, 7, 1, 'B7145','2026-02-05','2028-02-04',40.00, 58.00,210,'2026-08-11'),
      (9, 8, 9, 'B8203','2025-01-20','2027-01-19',25.00, 36.00, 60,'2026-08-29'),
      (10,9, 1, 'B9317','2026-04-12','2028-04-11',64.00, 92.00,340,'2026-09-05'),
      (11,10,8, 'B1054','2024-11-16','2026-11-15',54.00, 78.00, 15,'2026-06-18'),
      (12,11,3, 'B1189','2026-05-08','2028-05-07',68.00, 98.00,260,'2026-09-10'),
      (13,12,10,'B1296','2025-12-01','2027-11-30',84.00,120.00, 75,'2026-08-08'),
      (14,6, 6, 'B6033','2025-10-21','2027-10-20',45.00, 64.00,140,'2026-09-15'),
      (15,12,7, 'B1297','2025-12-21','2027-12-20',84.00,120.00,110,'2026-09-25'),
      (16,8, 9, 'B8199','2024-10-11','2026-10-10',25.00, 36.00, 20,'2026-03-01')
      ON DUPLICATE KEY UPDATE quantity=VALUES(quantity)
    `);

    await pool.query('SET @skip_expiry_check = NULL');

    // 5. Seed Users
    const adminPass = await bcrypt.hash('admin123', 10);
    const staffPass = await bcrypt.hash('staff123', 10);
    await pool.query(`
      INSERT INTO users (name, email, password_hash, role) VALUES
      ('Dr. Rajesh Sharma (Admin)', 'admin@pharmacy.com', ?, 'admin'),
      ('Priya Patel (Pharmacist)', 'staff@pharmacy.com', ?, 'pharmacist')
      ON DUPLICATE KEY UPDATE password_hash=VALUES(password_hash)
    `, [adminPass, staffPass]);

    console.log('[AUTO-INIT] Database schema, triggers, views, seed data, and users initialized successfully!');
  } catch (err) {
    console.error('[AUTO-INIT ERROR]:', err.message);
  }
}

module.exports = autoInitDatabase;
