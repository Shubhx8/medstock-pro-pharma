# NOTES.md: Implementation Notes & Architectural Decisions

## 1. Frontend Inspection & API Alignment
Inspected `frontend/app.js`, `frontend/index.html`, `frontend/style.css`, and `frontend/README.txt`.
The frontend is a vanilla JavaScript single-page application with modular separation:
- `PART 1`: Constants, configuration, units, roles, alert thresholds.
- `PART 2`: Helpers, validators, and date logic (`mm/dd/yy` inputs internally stored as `YYYY-MM-DD`).
- `PART 3`: Data Access Layer (async functions previously using `localStorage`).
- `PART 4`: 11 Application screens (Dashboard, Medicines, Suppliers, Customers, Stock-in, Dispense (FEFO), Batches, Alerts, Disposal, Sales Log, Users).
- `PART 5`: Startup bootstrap, theme management, and user state.

### Key differences between Frontend and Database/API Spec:
1. **Medicine attributes**:
   - Frontend expects: `medicine_name`, `min_stock_level`, `unit_price`, `category_id`, `manufacturer_id`, `unit`.
   - Database schema: `name`, `reorder_level`, `category_id`, `manufacturer_id`, `unit`, `strength`, `generic_name`.
   - Resolution: API returns both schema column names and frontend-friendly aliases (`name` and `medicine_name`, `reorder_level` and `min_stock_level`).
2. **Category / Supplier / Customer attributes**:
   - Category: frontend uses `category_name`, schema uses `name`. Handled via aliasing.
   - Supplier: frontend uses `supplier_name`, `address`, `phone`. Schema uses `name`, `phone`, `street`, `city`, `pin`. Handled via aliasing in API / CRUD factory.
   - Customer: frontend uses `customer_name`, `phone`, `email`. Schema uses `name`, `phone`. Handled via aliasing in API / CRUD factory.
3. **Sales / Dispense**:
   - Frontend calls `dispenseMedicine(medicineId, qty, customerId, userId)` for single-item FEFO sale.
   - API spec provides `POST /api/sales` with `{ customer_id, items: [{ medicine_id, qty }] }`.
   - Resolution: Frontend Part 3 `dispenseMedicine` calls `POST /api/sales` and formats response for UI notification.
4. **Disposal**:
   - Frontend expects `disposeBatch(batchId, quantity, reason, approvingUserId)`.
   - API spec requires `POST /api/disposals` with `{ batch_id, quantity, reason }` and user taken from JWT token.
5. **Alerts**:
   - Frontend has `getAlerts()`, `generateAlerts()`, and `updateAlertStatus(alertId, newStatus)`.
   - API provides `GET /api/alerts`, `POST /api/alerts/generate`, `PATCH /api/alerts/:id/resolve`.
6. **Authentication & Token**:
   - Frontend previously simulated user selection with dropdown.
   - Resolution: Store JWT token on login or auto-authenticate admin/pharmacist session so requests include `Authorization: Bearer <token>`.

---

## 2. Architectural Decisions
- **Raw SQL & Connection Pool**: Built with `mysql2/promise` using `dateStrings: true` to prevent timezone offsets on `DATE` columns.
- **Trigger-Enforced Logic**: Triggers handle batch expiry rejection (<30 days), sale stock deductions, sale validation, and disposal stock deduction. JS does not manually deduct batch quantities.
- **FEFO Implementation**: Uses `SELECT ... FOR UPDATE` inside an ACID transaction on `POST /api/sales`.
- **Central Error Mapping**: MySQL errors (trigger `45000`, `ER_DUP_ENTRY`, `ER_NO_REFERENCED_ROW_2`, `ER_ROW_IS_REFERENCED_2`, `ER_CHECK_CONSTRAINT_VIOLATED`) mapped cleanly to HTTP 400 responses.

---

## 3. Frontend Files Modified
- `frontend/app.js`: Part 3 updated to connect to backend `http://localhost:5000/api` using `fetch` with JWT authorization.
