# Medicine Expiry and Stock Alert System - Backend

College DBMS Project Backend built with Node.js, Express, and MySQL 8 (raw SQL via `mysql2/promise`).

## Features
- **11 Relational Tables** with strict primary/foreign keys and CHECK constraints.
- **2 SQL Views**: `v_medicine_stock` (real-time sellable inventory) and `v_expiring_batches` (batches expiring within 90 days).
- **4 SQL Triggers**:
  - `trg_batch_before_insert`: Rejects stock-in if expiry date is `< CURDATE() + 30 days`.
  - `trg_sold_in_before_insert`: Blocks selling expired or inactive batches and checks stock sufficiency.
  - `trg_sold_in_after_insert`: Auto-deducts batch stock upon sale.
  - `trg_disposal_after_insert`: Deducts stock on disposal and marks batch `DISPOSED` when quantity reaches 0.
- **ACID Transaction Sales**: First-Expiry-First-Out (FEFO) stock allocation using row locking (`SELECT ... FOR UPDATE`).
- **Automated Alerts**: Runs on startup, scheduled daily via `node-cron` at 00:05, and on-demand via `POST /api/alerts/generate`.
- **Role-Based Access Control**: JWT authentication with `admin` and `pharmacist` roles.

---

## Setup & Installation

### 1. Database Setup
Ensure MySQL Server 8 is running, then run the database scripts:
```bash
mysql -u root -p < database/schema.sql
mysql -u root -p pharmacy_db < database/seed.sql
```

### 2. Backend Setup
Navigate to the `backend/` directory:
```bash
cd backend
npm install
```

Configure `.env` (copy from `.env.example`):
```env
PORT=5000
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=your_mysql_password
DB_NAME=pharmacy_db
JWT_SECRET=super_secret_pharmacy_college_project_jwt_key_2026
CLIENT_URL=http://localhost:5173
```

Seed the default users (`admin` and `pharmacist`):
```bash
npm run seed:users
```

### 3. Start Server
Development mode:
```bash
npm run dev
```

Production mode:
```bash
npm start
```

---

## Seeded User Credentials
| Role | Email | Password |
|---|---|---|
| Admin | `admin@pharmacy.com` | `admin123` |
| Pharmacist | `staff@pharmacy.com` | `staff123` |

---

## API Endpoints Summary

### Auth
- `POST /api/auth/login` - Authenticate and get JWT token (expires in 1 day)
- `GET /api/auth/me` - Get current authenticated user details
- `GET /api/auth/users` - Get list of users

### Master Tables (Generic CRUD via crudFactory)
- `/api/manufacturers` (`GET`, `GET /:id`, `POST`, `PUT`, `DELETE [admin]`)
- `/api/categories` (`GET`, `GET /:id`, `POST`, `PUT`, `DELETE [admin]`)
- `/api/suppliers` (`GET`, `GET /:id`, `POST`, `PUT`, `DELETE [admin]`)
- `/api/customers` (`GET`, `GET /:id`, `POST`, `PUT`, `DELETE [admin]`)

### Medicines
- `GET /api/medicines` - List with categories, manufacturers, and `total_stock` from view `v_medicine_stock`
- `GET /api/medicines/:id` - Medicine details including related `batches`
- `POST /api/medicines` - Create medicine
- `PUT /api/medicines/:id` - Update medicine
- `DELETE /api/medicines/:id` - Delete medicine (`admin` only)

### Batches
- `GET /api/batches` - List active batches with `days_left` (query filters: `medicine_id`, `status`, `expiring_within`)
- `GET /api/batches/expired` - Quarantined expired batches with stock > 0
- `GET /api/batches/:id` - Single batch details
- `POST /api/batches` - Stock-in new batch (triggers reject if expiry < 30 days)

### Sales (FEFO)
- `POST /api/sales` - Create sale with automatic FEFO batch allocation in single transaction
- `GET /api/sales` - List sales (supports `?details=true` for itemized records)
- `GET /api/sales/:id` - Sale header and line items

### Alerts
- `GET /api/alerts` - List alerts (filtered by `status`, `type`)
- `POST /api/alerts/generate` - Run alert evaluation routine (PRD Section 9)
- `PATCH /api/alerts/:id/resolve` - Mark alert `RESOLVED`

### Disposals
- `POST /api/disposals` - Dispose expired stock (`admin` only)
- `GET /api/disposals` - List disposal records

### Dashboard & Health
- `GET /api/dashboard/summary` - Aggregate stock, batch, and alert counts
- `GET /api/health` - Health check status
