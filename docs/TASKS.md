# TASKS: build order (one night)

Tick each box only after you have **run and tested** it. Time estimates are rough targets.

## Phase 0: Setup (15 min)
- [x] Confirm folder layout: `frontend/`, `backend/`, `database/`, `docs/`, `AGENT.md` at root
- [x] `cd backend && npm init -y`, install: `express mysql2 cors dotenv jsonwebtoken bcryptjs node-cron morgan`, dev: `nodemon`
- [x] Add scripts: `"start": "node server.js"`, `"dev": "nodemon server.js"`, `"seed:users": "node src/scripts/seedUsers.js"`
- [x] Create `.env.example` and a local `.env` (human fills DB password)
- [x] Skim `frontend/` and list in `docs/NOTES.md` which API calls it makes

## Phase 1: Database (20 min)
- [x] Human runs `schema.sql` then `seed.sql` (agent: give the exact commands, do not try to run DELIMITER scripts through Node)
- [x] `src/config/db.js` pool (with `dateStrings: true`) + a test query on startup
- [x] Verify with SQL: `SELECT * FROM v_medicine_stock;` and `SELECT * FROM v_expiring_batches;`

## Phase 2: Server skeleton + auth (30 min)
- [x] `app.js`, `server.js`, `GET /api/health`
- [x] `asyncHandler`, `errorHandler` (with MySQL error mapping from API_SPEC)
- [x] `seedUsers.js` (admin and pharmacist) and run it
- [x] `POST /api/auth/login`, `GET /api/auth/me`, `verifyToken`, `requireRole`
- [x] Test: login with curl, call a protected route with and without token

## Phase 3: Master data CRUD (30 min)
- [x] `crudFactory.js` and mount manufacturers, categories, suppliers, customers
- [x] Medicines: list (with joins and `total_stock`), get one with batches, create, update, delete
- [x] Test each with curl

## Phase 4: Batches and Sales (60 min)
- [x] Batches: list with filters and `days_left`, `/expired`, get one, create
- [x] Test: add batch expiring in 10 days (must fail with trigger message), add valid batch (must work)
- [x] `saleService.createSale()` with FEFO and transaction
- [x] Sales: create, list, get one
- [x] Test: sell 50 Paracetamol (2 batches: should drain batch 1 first, then batch 2). Sell more than total (must fail and change nothing). Sell from expired batch 16 with explicit `batch_id` (must fail)

## Phase 5: Alerts, Disposal, Dashboard (45 min)
- [x] `alertService.generateAlerts()` per PRD section 9
- [x] Alerts: list, generate, resolve. Run on startup (try/catch) and cron
- [x] Test: generate; expect EXPIRING_SOON (batches 1, 5, 11), EXPIRED (batch 16), LOW_STOCK (e.g., Cetirizine, Cough Syrup, Ibuprofen). Run again: no duplicates
- [x] Disposals: create (admin only), list. Test as pharmacist (403) and admin (works, batch 16 becomes DISPOSED)
- [x] Dashboard summary

## Phase 6: Connect frontend (60 min)
- [x] Set frontend API base URL (use `.env` / `VITE_API_URL` or whatever it uses)
- [x] Add login handling if the frontend has none (store token, send header). Keep it minimal
- [x] Align field names between API and frontend: prefer changing the **frontend mapping** if small, otherwise add aliases in the API response
- [x] Verify each page loads real data: dashboard, medicines, batches, sales, alerts, disposal
- [x] List every frontend file you changed in `docs/NOTES.md`

## Phase 7: Wrap up (30 min)
- [x] Walk through every item in PRD "Acceptance Criteria"; fix failures
- [x] Write `backend/README.md`
- [x] Final `docs/NOTES.md`: decisions, skipped items, known issues
- [x] STOP. Do not add extra features.
