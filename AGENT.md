# AGENT.md: Instructions for the AI coding agent

You are building the **backend** for a small college DBMS project: *Medicine Expiry and Stock Alert System*.
The human has one night. **Speed and working code beat polish.** Do not over-engineer.

## 0. Read these first (in order)
1. `docs/PRD.md` (what and why, business rules BR1-BR11)
2. `database/schema.sql` and `database/seed.sql` (the database is already designed; **do not redesign it**)
3. `docs/API_SPEC.md` (the exact API contract)
4. `docs/TASKS.md` (the order to work in)
5. The `frontend/` folder (read only to learn which endpoints and field names it expects)

## 1. Stack (fixed, do not substitute)
Node.js 18+, Express 4, MySQL 8 via `mysql2/promise` with **raw SQL**, `jsonwebtoken`, `bcryptjs`, `node-cron`, `cors`, `dotenv`, `morgan`, `nodemon` (dev).
Plain JavaScript, CommonJS (`require`). No TypeScript, no ORM (no Sequelize/Prisma), no extra frameworks.

## 2. Hard rules
- **Never change the table or column names** in `schema.sql`. If you think the schema needs a change, stop and tell the human instead.
- **Always use parameterized queries** (`?` placeholders). Never concatenate user input into SQL.
- Use a `mysql2` **connection pool** from `src/config/db.js`.
- Sales and anything touching several tables must run inside a **transaction** (`getConnection`, `beginTransaction`, `commit`/`rollback`, `release` in `finally`).
- Business rules live in the DB (triggers, CHECKs). Do **not** duplicate trigger logic in JS except for friendly pre-checks. Surface trigger errors as 400 (see error mapping in `API_SPEC.md`).
- Passwords: `bcryptjs` hash. JWT secret from `.env`.
- Every response uses `{ success, data, message }`.
- Wrap async handlers so errors reach the central `errorHandler` (small `asyncHandler` helper, no extra package).
- Keep each file small and readable. A student must be able to explain every line in a viva. Add a one-line comment above each non-obvious query.
- Do not add features outside the PRD (no pagination libs, no Swagger, no tests framework, no Docker, no validation libraries). Simple `if (!field) return 400` checks are enough.
- Do **not** restructure or restyle the frontend. Only change API base URL / field names / fetch calls if needed, and list every frontend change you make.

## 3. Folder layout to create
```
backend/
  package.json            scripts: start, dev, seed:users
  .env.example            PORT, DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, JWT_SECRET, CLIENT_URL
  server.js               loads env, starts app, runs alert generation once, starts cron
  src/
    app.js                express app, cors, json, morgan, routes, errorHandler
    config/db.js          mysql2 pool
    middleware/auth.js    verifyToken, requireRole(...roles)
    middleware/errorHandler.js
    utils/asyncHandler.js
    utils/crudFactory.js  generic CRUD for the 4 simple master tables
    routes/               index.js + one file per resource
    controllers/          authController, medicineController, batchController,
                          saleController, alertController, disposalController, dashboardController
    services/alertService.js   generateAlerts() per PRD section 9
    services/saleService.js    createSale() with FEFO + transaction
    scripts/seedUsers.js       inserts admin + pharmacist with hashed passwords
```

## 4. Key implementation notes

**FEFO (saleService)**: for each requested item without `batch_id`:
```sql
SELECT batch_id, quantity, mrp FROM batch
WHERE medicine_id = ? AND status = 'ACTIVE' AND expiry_date >= CURDATE() AND quantity > 0
ORDER BY expiry_date ASC FOR UPDATE
```
Take `min(remaining, quantity)` from each batch, insert one `sold_in` row per batch (price = batch.mrp). The `sold_in` triggers validate and deduct stock; **do not manually UPDATE batch.quantity** for sales. If the batches cannot cover the quantity, rollback and return 400 with the message from `API_SPEC.md`. Finally update `sale.total_amount`.

**Disposal**: check batch status = 'EXPIRED' and quantity >= requested, then INSERT into `disposal` (trigger reduces stock). `approved_by` = `req.user.user_id`. Route guarded by `requireRole('admin')`.

**alertService.generateAlerts()**: follow PRD section 9 exactly, in a single function using the pool. Dedupe open alerts. Return `{created, resolved, expired_marked}`. Never throw on startup: wrap the startup call in try/catch and log.

**Cron**: `cron.schedule('5 0 * * *', generateAlerts)`.

**CORS**: allow `process.env.CLIENT_URL` (default `http://localhost:5173`) and `http://localhost:3000`.

**Dates**: set `dateStrings: true` in the mysql2 pool so DATE columns come back as `YYYY-MM-DD` strings (avoids timezone shifts in the frontend).

## 5. Workflow you must follow
1. Work through `docs/TASKS.md` phase by phase. Tick boxes as you finish.
2. After each phase, **run the code and test it** (curl or a quick script) before moving on. Fix errors immediately; don't pile up broken code.
3. If something is ambiguous, pick the simplest option that satisfies `API_SPEC.md`, note it in `docs/NOTES.md`, and continue. Ask the human only if blocked.
4. Keep `docs/NOTES.md` updated with: decisions made, anything skipped, frontend changes, known issues.
5. At the end, write a short `backend/README.md` (install, create DB, run, default logins, list of endpoints).

## 6. Definition of done
All boxes in the PRD "Acceptance Criteria" section pass, the server starts with `npm run dev`, and the frontend loads real data. Then stop. Do not keep adding things.

## 7. Security note (keep it light)
Never commit `.env`. Use `.env.example` with placeholders. Do not print passwords or tokens in logs.
