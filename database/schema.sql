-- Medicine Expiry and Stock Alert System
-- MySQL 8.0.16+ (CHECK constraints are enforced from 8.0.16)
-- Run with:  mysql -u root -p < database/schema.sql
-- (Use the mysql CLI or Workbench: the file uses DELIMITER for triggers.)

DROP DATABASE IF EXISTS pharmacy_db;
CREATE DATABASE pharmacy_db;
USE pharmacy_db;

-- ---------- Master tables ----------
CREATE TABLE manufacturer (
  manufacturer_id INT AUTO_INCREMENT PRIMARY KEY,
  name            VARCHAR(100) NOT NULL UNIQUE,
  address         VARCHAR(255)
);

CREATE TABLE category (
  category_id INT AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(60) NOT NULL UNIQUE
);

CREATE TABLE supplier (
  supplier_id INT AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(100) NOT NULL,
  phone       VARCHAR(15),
  street      VARCHAR(100),
  city        VARCHAR(50),
  pin         VARCHAR(10)
);

CREATE TABLE customer (
  customer_id INT AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(100) NOT NULL,
  phone       VARCHAR(15)
);

CREATE TABLE users (
  user_id       INT AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(100) NOT NULL,
  email         VARCHAR(120) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role          ENUM('admin','pharmacist') NOT NULL DEFAULT 'pharmacist'
);

CREATE TABLE medicine (
  medicine_id     INT AUTO_INCREMENT PRIMARY KEY,
  name            VARCHAR(100) NOT NULL,
  generic_name    VARCHAR(100),
  strength        VARCHAR(30),
  unit            VARCHAR(20) NOT NULL DEFAULT 'tablet',
  unit_price      DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  category_id     INT NOT NULL,
  manufacturer_id INT NOT NULL,
  reorder_level   INT NOT NULL DEFAULT 50,
  CONSTRAINT chk_med_unit_price CHECK (unit_price >= 0),
  CONSTRAINT chk_med_reorder CHECK (reorder_level >= 0),
  CONSTRAINT fk_med_cat  FOREIGN KEY (category_id)     REFERENCES category(category_id),
  CONSTRAINT fk_med_man  FOREIGN KEY (manufacturer_id) REFERENCES manufacturer(manufacturer_id)
);

-- ---------- Batch-level inventory ----------
CREATE TABLE batch (
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
);
CREATE INDEX idx_batch_expiry   ON batch(expiry_date);
CREATE INDEX idx_batch_medicine ON batch(medicine_id);

-- ---------- Sales ----------
CREATE TABLE sale (
  sale_id      INT AUTO_INCREMENT PRIMARY KEY,
  customer_id  INT NULL,
  sale_date    DATE NOT NULL DEFAULT (CURDATE()),
  total_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  created_by   INT NOT NULL,
  CONSTRAINT fk_sale_cust FOREIGN KEY (customer_id) REFERENCES customer(customer_id),
  CONSTRAINT fk_sale_user FOREIGN KEY (created_by)  REFERENCES users(user_id)
);

CREATE TABLE sold_in (
  sold_in_id INT AUTO_INCREMENT PRIMARY KEY,
  sale_id    INT NOT NULL,
  batch_id   INT NOT NULL,
  qty        INT NOT NULL,
  price      DECIMAL(10,2) NOT NULL,   -- unit price at time of sale
  CONSTRAINT chk_sold_qty CHECK (qty > 0),
  CONSTRAINT fk_sold_sale  FOREIGN KEY (sale_id)  REFERENCES sale(sale_id) ON DELETE CASCADE,
  CONSTRAINT fk_sold_batch FOREIGN KEY (batch_id) REFERENCES batch(batch_id)
);

-- ---------- Alerts ----------
CREATE TABLE alert (
  alert_id    INT AUTO_INCREMENT PRIMARY KEY,
  medicine_id INT NOT NULL,
  batch_id    INT NULL,                -- NULL for medicine-level alerts (LOW_STOCK / OUT_OF_STOCK)
  alert_type  ENUM('EXPIRING_SOON','EXPIRED','LOW_STOCK','OUT_OF_STOCK') NOT NULL,
  message     VARCHAR(255) NOT NULL,
  alert_date  DATE NOT NULL DEFAULT (CURDATE()),
  status      ENUM('OPEN','RESOLVED') NOT NULL DEFAULT 'OPEN',
  CONSTRAINT fk_alert_med   FOREIGN KEY (medicine_id) REFERENCES medicine(medicine_id),
  CONSTRAINT fk_alert_batch FOREIGN KEY (batch_id)    REFERENCES batch(batch_id)
);
CREATE INDEX idx_alert_status ON alert(status, alert_type);

-- ---------- Disposal ----------
CREATE TABLE disposal (
  disposal_id   INT AUTO_INCREMENT PRIMARY KEY,
  batch_id      INT NOT NULL,
  quantity      INT NOT NULL,
  disposal_date DATE NOT NULL DEFAULT (CURDATE()),
  reason        VARCHAR(255) DEFAULT 'Expired',
  approved_by   INT NOT NULL,
  CONSTRAINT chk_disp_qty CHECK (quantity > 0),
  CONSTRAINT fk_disp_batch FOREIGN KEY (batch_id)    REFERENCES batch(batch_id),
  CONSTRAINT fk_disp_user  FOREIGN KEY (approved_by) REFERENCES users(user_id)
);

-- ---------- Views ----------
-- Sellable stock per medicine (ACTIVE and not past expiry)
CREATE VIEW v_medicine_stock AS
SELECT m.medicine_id, m.name, m.reorder_level,
       COALESCE(SUM(b.quantity), 0) AS total_stock
FROM medicine m
LEFT JOIN batch b
  ON b.medicine_id = m.medicine_id
 AND b.status = 'ACTIVE'
 AND b.expiry_date >= CURDATE()
GROUP BY m.medicine_id, m.name, m.reorder_level;

-- Batches expiring within 90 days (not yet expired)
CREATE VIEW v_expiring_batches AS
SELECT b.batch_id, b.batch_no, m.medicine_id, m.name AS medicine_name,
       b.quantity, b.expiry_date,
       DATEDIFF(b.expiry_date, CURDATE()) AS days_left
FROM batch b
JOIN medicine m ON m.medicine_id = b.medicine_id
WHERE b.status = 'ACTIVE'
  AND b.quantity > 0
  AND b.expiry_date >= CURDATE()
  AND b.expiry_date <= DATE_ADD(CURDATE(), INTERVAL 90 DAY);

-- ---------- Triggers ----------
DELIMITER $$

-- BR1: reject batches whose expiry is past or too close (< 30 days).
-- Seeding bypass: SET @skip_expiry_check = 1; in the same session.
CREATE TRIGGER trg_batch_before_insert
BEFORE INSERT ON batch
FOR EACH ROW
BEGIN
  IF @skip_expiry_check IS NULL
     AND NEW.expiry_date < DATE_ADD(CURDATE(), INTERVAL 30 DAY) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Expiry date is already past or too close (minimum 30 days)';
  END IF;
END$$

-- BR3: block sale from expired / inactive batch or when stock is insufficient
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
END$$

-- BR5: auto-deduct stock on sale
CREATE TRIGGER trg_sold_in_after_insert
AFTER INSERT ON sold_in
FOR EACH ROW
BEGIN
  UPDATE batch SET quantity = quantity - NEW.qty WHERE batch_id = NEW.batch_id;
END$$

-- BR10: deduct stock on disposal; mark DISPOSED when it reaches 0
CREATE TRIGGER trg_disposal_after_insert
AFTER INSERT ON disposal
FOR EACH ROW
BEGIN
  -- status is evaluated first, using the old quantity (MySQL assigns left to right)
  UPDATE batch
     SET status   = IF(quantity - NEW.quantity = 0, 'DISPOSED', status),
         quantity = quantity - NEW.quantity
   WHERE batch_id = NEW.batch_id;
END$$

DELIMITER ;
