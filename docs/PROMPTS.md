# PROMPTS: copy-paste these into the Antigravity agent, one at a time

## Before you start (5 min, you do this)

1. Make one project folder and arrange it like this:
```
medicine-expiry-system/
├── AGENT.md               <- from this kit
├── frontend/              <- your existing React app
├── database/              <- schema.sql, seed.sql
└── docs/                  <- PRD.md, API_SPEC.md, TASKS.md, PROMPTS.md
```
2. Open `medicine-expiry-system/` as the workspace in Antigravity.
3. Install MySQL 8 and have the root password ready. Run the database yourself (the agent should not do this):
```
mysql -u root -p < database/schema.sql
mysql -u root -p pharmacy_db < database/seed.sql
```
4. If your Antigravity version has a "Rules" section for the workspace, you can paste `AGENT.md` there too. Otherwise Prompt 0 below makes the agent read it.
5. Use **Planning** mode for Prompts 0 and 6, **Fast** mode for the rest if you are short on time. Review the plan quickly and approve.

---

## Prompt 0: Kickoff and setup (Phase 0)

```
You are the backend engineer for my college DBMS project. First read, in this order:
AGENT.md, docs/PRD.md, database/schema.sql, database/seed.sql, docs/API_SPEC.md, docs/TASKS.md.
Then skim the frontend/ folder and write docs/NOTES.md listing every API call the frontend makes
(method, path, expected fields) and anything that differs from docs/API_SPEC.md.

Then do Phase 0 of docs/TASKS.md: create backend/ with package.json, install the dependencies listed
in AGENT.md, add the npm scripts, and create .env.example plus .env (DB_NAME=pharmacy_db, PORT=5000,
JWT_SECRET=any long random string, leave DB_PASSWORD for me to fill).

Follow AGENT.md strictly: do NOT change the database schema, do NOT add features outside the PRD.
When done, summarize what you did in 5 lines and wait.
```

## Prompt 1: Database connection and server skeleton (Phases 1 and 2)

```
Do Phase 1 and Phase 2 of docs/TASKS.md. I have already run schema.sql and seed.sql in MySQL.
Build: src/config/db.js (pool, dateStrings true), app.js, server.js, GET /api/health,
asyncHandler, errorHandler with the MySQL error mapping from docs/API_SPEC.md,
auth (login, me, verifyToken, requireRole), and scripts/seedUsers.js. Run the seed:users script.
Start the server and test /api/health and login with curl. Show me the curl output.
Fix any error before finishing.
```

## Prompt 2: Master data and medicines (Phase 3)

```
Do Phase 3 of docs/TASKS.md. Create crudFactory.js and use it for manufacturers, categories,
suppliers and customers. Then build the medicines endpoints exactly as in docs/API_SPEC.md
(list with category_name, manufacturer_name and total_stock from the v_medicine_stock view;
get one with its batches). Protect all routes with verifyToken, and DELETE with requireRole('admin').
Test each endpoint with curl and show a short summary of results.
```

## Prompt 3: Batches and sales with FEFO (Phase 4)

```
Do Phase 4 of docs/TASKS.md. Build the batches endpoints and the sales endpoints exactly as in
docs/API_SPEC.md. Sales must go through services/saleService.js, use a transaction, allocate with
FEFO using SELECT ... FOR UPDATE, and rely on the database triggers for validation and stock deduction
(do not manually update batch.quantity for sales). Surface trigger errors (sqlState 45000) as 400 with the message.
Run all the tests listed in Phase 4 (including the failure cases) and show me the results,
including the batch quantities before and after the 50-unit Paracetamol sale.
```

## Prompt 4: Alerts, disposal, dashboard (Phase 5)

```
Do Phase 5 of docs/TASKS.md. Implement services/alertService.js following section 9 of docs/PRD.md exactly,
then the alerts, disposals and dashboard endpoints from docs/API_SPEC.md. Run generateAlerts once on server
start (inside try/catch) and schedule it daily at 00:05 with node-cron.
Run the Phase 5 tests: generate alerts twice (no duplicates the second time), disposal as pharmacist (403),
disposal of expired batch 16 as admin (works, batch becomes DISPOSED), and the dashboard summary.
Show me the results.
```

## Prompt 5: Quick review of the backend (optional, 10 min)

```
Review the backend code against AGENT.md and docs/API_SPEC.md. Check only these things and fix problems you find:
1) every SQL query is parameterized, 2) every route that needs auth has it, 3) response format is always
{ success, data, message }, 4) no endpoint in API_SPEC.md is missing, 5) the sale flow always releases its connection.
Do not refactor anything else. Report what you changed in 5 lines or fewer.
```

## Prompt 6: Connect the frontend (Phase 6)

```
Do Phase 6 of docs/TASKS.md. Use docs/NOTES.md (the frontend's API calls) to connect the existing frontend
to the backend running on port 5000. Rules: do not redesign or restyle the frontend; make the smallest changes
possible; if field names differ, prefer a small mapping in the frontend. Add a minimal login (store the JWT,
send it in the Authorization header) only if the frontend has none. Then start both apps and check each page
loads real data (dashboard, medicines, batches, sales, alerts, disposal). List every frontend file you changed in docs/NOTES.md.
If you can open the browser, verify the pages visually and report any page that fails.
```

## Prompt 7: Final checks and README (Phase 7)

```
Do Phase 7 of docs/TASKS.md. Go through every item in the Acceptance Criteria section of docs/PRD.md
and test it. Fix failures. Then write backend/README.md (install, DB setup commands, how to run, default logins,
list of endpoints) and finish docs/NOTES.md. Do not add any new features. Give me a final pass/fail checklist.
```

---

## Emergency prompts (use when something breaks)

**Error you don't understand**
```
The server/endpoint is failing. Here is the exact error: <paste error>.
Find the root cause, fix it with the smallest change, re-run the failing test, and show me it passes.
Don't change the database schema.
```

**Agent is going off track / adding too much**
```
Stop. Re-read AGENT.md sections 2 and 6. You are adding things outside the PRD. Revert anything not required
by docs/API_SPEC.md and continue with the next unchecked item in docs/TASKS.md.
```

**MySQL connection problems**
```
The backend cannot connect to MySQL. Check .env values, that the DB name is pharmacy_db, and that the mysql2 pool config is correct.
Write a 10-line script that runs "SELECT 1" and prints the result, run it, and tell me what is wrong.
(If it is an auth plugin error, tell me the exact ALTER USER command to run myself.)
```

**CORS or 401 from the frontend**
```
The frontend gets a CORS error / 401. Check CORS config in app.js (allow the frontend's origin and the Authorization header)
and how the frontend sends the token. Fix with the smallest change and show me the request/response that now works.
```

**Frontend field mismatch**
```
Page <name> shows empty or broken data. Compare the API response for <endpoint> with what the frontend expects,
and fix the mismatch with the smallest change (prefer a mapping in the frontend). Show me before/after.
```
