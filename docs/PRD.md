# PRD: Medicine Expiry and Stock Alert System (Backend)

**Type:** College DBMS project | **Scope:** Backend + MySQL database, connected to an existing React frontend
**Build time budget:** one night. Keep everything simple. No over-engineering.

---

## 1. Overview

A pharmacy / hospital store / clinic needs to track medicine stock **batch by batch** so that:
- expired or near-expiry stock is never sold,
- low stock is flagged before it runs out,
- disposal of expired stock is recorded and approved by a user.

The backend exposes a REST API (Node.js + Express) over a MySQL database. The React frontend (already built) consumes it.

## 2. Goals and Non-Goals

**Goals**
1. Correct relational design (11 tables, PK/FK, constraints) that can be explained in a DBMS viva.
2. Working API for: master data, batches, sales (FEFO), alerts, disposal, dashboard.
3. Database-level safety using constraints, triggers and views (this is the DBMS showpiece).
4. Seed data so the demo works immediately.

**Non-goals (do NOT build)**
Payments, invoices/PDF, email/SMS notifications, multi-store, barcode scanning, file uploads, refresh tokens, rate limiting, Docker, CI/CD, unit-test suites, ORMs, TypeScript, Swagger.

## 3. Users and Roles

| Role | Can do |
|---|---|
| `admin` | Everything, including approving disposals |
| `pharmacist` | View data, add medicines/batches, make sales, resolve alerts. Cannot dispose stock |

Only 2 seeded users. No registration, no user-management screens.

## 4. Tech Stack

- **Node.js 18+**, **Express 4**
- **MySQL 8** with `mysql2` (promise API) and **raw SQL** (no ORM, because this is a DBMS project and SQL should be visible)
- `jsonwebtoken` + `bcryptjs` for simple login
- `node-cron` for the daily alert job
- `cors`, `dotenv`, `morgan`, `nodemon` (dev)
- Frontend: existing React app (do not rewrite it)

## 5. Database (11 tables)

Full DDL is in `database/schema.sql`. Summary:

| Table | Purpose | Key columns |
|---|---|---|
| `manufacturer` | Who makes the medicine | manufacturer_id PK, name, address |
| `category` | Medicine category | category_id PK, name |
| `supplier` | Who supplies batches | supplier_id PK, name, phone, street, city, pin |
| `customer` | Buyers | customer_id PK, name, phone |
| `users` | Login + roles | user_id PK, name, email, password_hash, role |
| `medicine` | Medicine master | medicine_id PK, name, generic_name, strength, unit, category_id FK, manufacturer_id FK, reorder_level |
| `batch` | One row per stock entry | batch_id PK, medicine_id FK, supplier_id FK, batch_no, mfg_date, expiry_date, purchase_price, mrp, quantity, purchase_date, status |
| `alert` | Generated alerts | alert_id PK, medicine_id FK, batch_id FK (nullable), alert_type, message, alert_date, status |
| `sale` | Sale header | sale_id PK, customer_id FK, sale_date, total_amount, created_by FK |
| `sold_in` | Sale line items (links sale to batch) | sold_in_id PK, sale_id FK, batch_id FK, qty, price |
| `disposal` | Disposed expired stock | disposal_id PK, batch_id FK, quantity, disposal_date, reason, approved_by FK |

**Relationships:** Manufacturer 1:N Medicine, Category 1:N Medicine, Medicine 1:N Batch, Supplier 1:N Batch, Sale 1:N Sold_In, Batch 1:N Sold_In, Batch 1:N Alert, Batch 1:N Disposal, User 1:N Disposal (approver).

**DBMS features to include (for viva marks):**
- PRIMARY KEY, FOREIGN KEY, NOT NULL, UNIQUE, CHECK constraints
- Indexes on `batch(expiry_date)`, `batch(medicine_id)`
- 2 Views: `v_medicine_stock`, `v_expiring_batches`
- 4 Triggers: batch expiry validation, sale validation, stock deduction on sale, stock deduction on disposal
- Transactions with row locking in the sale flow
- JOINs, GROUP BY, aggregate functions in reports

## 6. Business Rules

| # | Rule |
|---|---|
| BR1 | A batch can only be added if `expiry_date >= today + 30 days` (constant `MIN_EXPIRY_DAYS = 30`). Enforced by trigger. |
| BR2 | Same medicine can have many batches with different expiry dates. `(medicine_id, batch_no)` is unique. |
| BR3 | A batch with `expiry_date < today` is **expired** and can never be sold. Enforced by trigger. |
| BR4 | **FEFO:** when selling a medicine, stock is taken from the earliest-expiring non-expired batch first, spilling into the next batch if needed. |
| BR5 | Stock is deducted automatically on sale (trigger on `sold_in`). Quantity can never go below 0 (CHECK). |
| BR6 | Alert for expiry at thresholds 90 / 60 / 30 / 7 days. Message shows the tightest threshold crossed. |
| BR7 | `EXPIRED` alert for any batch with quantity > 0 and past expiry; its status becomes `EXPIRED` (quarantined). |
| BR8 | `LOW_STOCK` when total sellable quantity of a medicine is `<= reorder_level` and `> 0`. `OUT_OF_STOCK` when it is `0`. |
| BR9 | "Sellable quantity" = sum of quantity over batches with status `ACTIVE` and expiry not past. |
| BR10 | Disposal is allowed only for batches with status `EXPIRED`, by an `admin`, and records the approver. Disposal reduces batch quantity; at 0 the batch status becomes `DISPOSED`. |
| BR11 | Only one `OPEN` alert per (batch, type) or (medicine, type). Alerts whose condition clears are auto-resolved. |

## 7. Features and Priorities

**P0 (must have tonight)**
- F1 Login (JWT), 2 roles
- F2 CRUD: manufacturers, categories, suppliers, customers, medicines
- F3 Batches: add (with BR1), list with filters, list expired
- F4 Sales with FEFO, auto-deduction, list, detail
- F5 Alerts: generate (manual endpoint + cron + on startup), list, resolve
- F6 Disposal: create (admin), list
- F7 Dashboard summary counts
- F8 Seed data + schema

**P1 (only if time remains)**
- Search on medicine name, pagination, a `/api/reports/*` endpoint or two (e.g., stock value, monthly sales)

**P2 (skip)**
Everything in Non-goals.

## 8. API

Full contract is in `API_SPEC.md`. All routes are under `/api`. JSON in, JSON out. Protected routes need `Authorization: Bearer <token>`.

Standard response:
```json
{ "success": true, "data": {}, "message": "optional" }
{ "success": false, "message": "what went wrong" }
```

## 9. Alert Generation Logic

Runs: on server start, daily by cron (00:05), and on `POST /api/alerts/generate`. Steps, in order:

1. Mark batches `ACTIVE -> EXPIRED` where `expiry_date < CURDATE()`.
2. For each `ACTIVE` batch with `quantity > 0` and expiry within 90 days: create/update an `EXPIRING_SOON` alert. Message: `"<Medicine> batch <no> expires in N days (<=T day threshold)"`, T is the smallest of 90/60/30/7 that is >= N.
3. For each `EXPIRED` batch with `quantity > 0`: create an `EXPIRED` alert if none is open.
4. For each medicine using `v_medicine_stock`: create `OUT_OF_STOCK` (total = 0) or `LOW_STOCK` (0 < total <= reorder_level) if none is open.
5. Auto-resolve open alerts whose condition no longer holds (batch disposed or sold out, medicine restocked).

## 10. Project Structure

```
project-root/
├── frontend/              (existing React app, do not restructure)
├── backend/
│   ├── package.json
│   ├── .env.example
│   ├── server.js
│   └── src/
│       ├── app.js
│       ├── config/db.js
│       ├── middleware/    auth.js, errorHandler.js
│       ├── routes/        one file per resource
│       ├── controllers/   one file per resource
│       ├── services/      alertService.js, saleService.js
│       └── scripts/       seedUsers.js
├── database/
│   ├── schema.sql
│   └── seed.sql
└── docs/                  PRD.md, API_SPEC.md, TASKS.md, PROMPTS.md
AGENT.md                   (project root)
```

## 11. Acceptance Criteria (demo checklist)

- [ ] `schema.sql` then `seed.sql` run without errors on a fresh MySQL 8.
- [ ] Login as `admin@pharmacy.com / admin123` returns a JWT.
- [ ] Adding a batch expiring in 10 days is rejected with a clear message.
- [ ] Selling 50 units of a medicine that has 2 batches takes from the earlier-expiring batch first.
- [ ] Selling from an expired batch (direct SQL insert into `sold_in`) fails because of the trigger.
- [ ] `POST /api/alerts/generate` creates EXPIRING_SOON, EXPIRED, LOW_STOCK alerts from the seed data.
- [ ] Disposing an expired batch as `pharmacist` returns 403; as `admin` it works and stores `approved_by`.
- [ ] Dashboard returns counts matching the data.
- [ ] Frontend pages load real data from the API.

## 12. Viva Demo Script (5 minutes)

1. Show ER diagram and the 11 tables.
2. Run `SELECT * FROM v_medicine_stock;` and `SELECT * FROM v_expiring_batches;`.
3. Try an invalid batch insert, show the trigger error.
4. Make a sale in the UI, show `batch.quantity` dropping and FEFO order.
5. Click "Generate alerts", show the alert list.
6. Dispose an expired batch as admin, show the `disposal` row with approver.
