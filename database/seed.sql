-- Seed data. Run AFTER schema.sql:  mysql -u root -p pharmacy_db < database/seed.sql
-- Users are NOT seeded here (passwords must be hashed): run `npm run seed:users` in /backend.
USE pharmacy_db;

-- Bypass BR1 trigger so we can insert near-expiry / expired demo batches
SET @skip_expiry_check = 1;

INSERT INTO manufacturer (manufacturer_id, name, address) VALUES
(1,'Cipla Ltd','Mumbai, Maharashtra'),
(2,'Sun Pharma','Mumbai, Maharashtra'),
(3,'Dr. Reddy''s Laboratories','Hyderabad, Telangana'),
(4,'Lupin Ltd','Mumbai, Maharashtra'),
(5,'Zydus Lifesciences','Ahmedabad, Gujarat');

INSERT INTO category (category_id, name) VALUES
(1,'Analgesic'),(2,'Antibiotic'),(3,'Antihistamine'),(4,'Antidiabetic'),
(5,'Antacid'),(6,'Antihypertensive'),(7,'Cough & Cold'),(8,'Statin'),(9,'Supplement');

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
(10,'Deccan Pharma Wholesale','9848088899','26 Begum Pet','Hyderabad','500016');

INSERT INTO customer (customer_id, name, phone) VALUES
(1,'Walk-in Customer',NULL),
(2,'Ramesh Patil','9000000001'),
(3,'Sunita Deshmukh','9000000002'),
(4,'Amit Verma','9000000003');

INSERT INTO medicine (medicine_id, name, generic_name, strength, unit, unit_price, category_id, manufacturer_id, reorder_level) VALUES
(1,'Paracetamol 500','Paracetamol','500mg','tablet',28.00,1,1,100),
(2,'Amoxicillin 250','Amoxicillin','250mg','capsule',85.50,2,2,80),
(3,'Azithromycin 500','Azithromycin','500mg','tablet',112.00,2,1,60),
(4,'Cetirizine 10','Cetirizine','10mg','tablet',32.00,3,3,80),
(5,'Metformin 500','Metformin','500mg','tablet',45.00,4,4,120),
(6,'Omeprazole 20','Omeprazole','20mg','capsule',64.00,5,3,70),
(7,'Amlodipine 5','Amlodipine','5mg','tablet',58.00,6,5,90),
(8,'Ibuprofen 400','Ibuprofen','400mg','tablet',36.00,1,2,80),
(9,'Pantoprazole 40','Pantoprazole','40mg','tablet',92.00,5,4,70),
(10,'Cough Syrup 100ml','Dextromethorphan','100ml','bottle',78.00,7,5,30),
(11,'Atorvastatin 10','Atorvastatin','10mg','tablet',98.00,8,1,60),
(12,'Vitamin D3 60K','Cholecalciferol','60000 IU','sachet',120.00,9,3,50);

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
-- Already expired demo batch (will be quarantined, can be disposed)
(16,8, 9, 'B8199','2024-10-11','2026-10-10',25.00, 36.00, 20,'2026-03-01');

SET @skip_expiry_check = NULL;
