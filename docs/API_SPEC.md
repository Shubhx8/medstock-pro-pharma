# API Specification

Base URL: `http://localhost:5000/api`
Auth: `Authorization: Bearer <jwt>` on every route except `POST /auth/login`.
Response shape: `{ "success": true, "data": ..., "message": "optional" }` or `{ "success": false, "message": "..." }`.
Status codes: 200 OK, 201 created, 400 bad input / DB trigger error, 401 no/invalid token, 403 wrong role, 404 not found, 500 server error.

---

## Auth
| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/auth/login` | `{email, password}` | Returns `{token, user:{user_id,name,email,role}}`. Token expires in 1 day. |
| GET | `/auth/me` | | Current user from token |

Seeded users (created by `npm run seed:users`): `admin@pharmacy.com / admin123` (admin), `staff@pharmacy.com / staff123` (pharmacist).

## Simple master tables (same 5 endpoints each)
Resources: `manufacturers`, `categories`, `suppliers`, `customers`
| Method | Path | Notes |
|---|---|---|
| GET | `/<resource>` | list all |
| GET | `/<resource>/:id` | one |
| POST | `/<resource>` | create, returns created row |
| PUT | `/<resource>/:id` | update |
| DELETE | `/<resource>/:id` | admin only. FK violation (ER_ROW_IS_REFERENCED_2) returns 400 "In use, cannot delete" |

Fields:
- manufacturers: `name*`, `address`
- categories: `name*`
- suppliers: `name*`, `phone`, `street`, `city`, `pin`
- customers: `name*`, `phone`

## Medicines
| Method | Path | Notes |
|---|---|---|
| GET | `/medicines` | Query: `search`. Each row includes `category_name`, `manufacturer_name`, `total_stock` (from `v_medicine_stock`) |
| GET | `/medicines/:id` | Includes its `batches` array |
| POST | `/medicines` | `{name*, generic_name, strength, unit, category_id*, manufacturer_id*, reorder_level}` |
| PUT | `/medicines/:id` | same fields |
| DELETE | `/medicines/:id` | admin only |

## Batches
| Method | Path | Notes |
|---|---|---|
| GET | `/batches` | Query: `medicine_id`, `status`, `expiring_within` (days). Joins medicine name + supplier name. Ordered by `expiry_date ASC`. Adds `days_left`. |
| GET | `/batches/expired` | status = EXPIRED and quantity > 0 (quarantine list) |
| GET | `/batches/:id` | one |
| POST | `/batches` | `{medicine_id*, supplier_id*, batch_no*, mfg_date*, expiry_date*, purchase_price*, mrp*, quantity*, purchase_date}`. Trigger rejects expiry < today+30 days (400 with the trigger message). |

No update/delete for batches (stock changes only through sales and disposals).

## Sales
| Method | Path | Notes |
|---|---|---|
| POST | `/sales` | See below |
| GET | `/sales` | List with customer name, total, item count. Newest first |
| GET | `/sales/:id` | Header + items (medicine name, batch_no, expiry_date, qty, price) |

`POST /sales` body:
```json
{
  "customer_id": 2,
  "items": [
    { "medicine_id": 1, "qty": 50 },
    { "medicine_id": 8, "qty": 5, "batch_id": 9 }
  ]
}
```
Rules:
- `customer_id` optional (null = walk-in).
- If `batch_id` is omitted, allocate with **FEFO**: select batches of that medicine with `status='ACTIVE' AND expiry_date >= CURDATE() AND quantity > 0 ORDER BY expiry_date ASC FOR UPDATE`, take from each until qty is satisfied. One `sold_in` row per batch used.
- If `batch_id` is given, use only that batch (the trigger rejects it if expired).
- Unit `price` = batch `mrp`.
- If total sellable stock is less than requested: 400 `"Insufficient stock for <medicine>: requested X, available Y"`, whole sale rolled back.
- Everything inside one transaction. `total_amount` = sum(qty * price). `created_by` = token user.
- Response 201: the sale with its items (same shape as `GET /sales/:id`).

## Alerts
| Method | Path | Notes |
|---|---|---|
| GET | `/alerts` | Query: `status` (default OPEN), `type`. Joins medicine name and batch_no. Newest first |
| POST | `/alerts/generate` | Runs the generation routine (PRD section 9). Returns `{created, resolved, expired_marked}` |
| PATCH | `/alerts/:id/resolve` | Sets status RESOLVED |

## Disposals
| Method | Path | Notes |
|---|---|---|
| POST | `/disposals` | **admin only.** `{batch_id*, quantity*, reason}`. Batch must be status EXPIRED and quantity <= batch.quantity, else 400. `approved_by` = token user. Trigger reduces stock. Response includes medicine name, manufacturer name, batch_no. |
| GET | `/disposals` | List with medicine name, manufacturer, batch_no, quantity, date, approver name |

## Dashboard
| Method | Path | Notes |
|---|---|---|
| GET | `/dashboard/summary` | `{ total_medicines, total_batches, expiring_soon (batches within 90 days), expired (qty>0), low_stock (medicines), out_of_stock (medicines), open_alerts, sales_today, revenue_today }` |

## Health
`GET /health` (no auth) returns `{ "status": "ok" }`.

## Error mapping (errorHandler middleware)
- MySQL `sqlState === '45000'` (trigger SIGNAL): 400 with `err.sqlMessage`.
- `ER_DUP_ENTRY`: 400 "Duplicate entry".
- `ER_NO_REFERENCED_ROW_2`: 400 "Referenced record does not exist".
- `ER_ROW_IS_REFERENCED_2`: 400 "Record is in use and cannot be deleted".
- `ER_CHECK_CONSTRAINT_VIOLATED`: 400 "Invalid value".
- Anything else: 500 "Server error" (log the real error to console).
