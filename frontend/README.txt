Medicine Expiry & Stock Alert System (Front End)
A modern, responsive web application for pharmacy, hospital store or clinic inventory management.

HOW TO RUN
  Double-click index.html (or open it directly in Google Chrome, Microsoft Edge, Firefox, or Safari).
  No installation, build tools, or web server required!

FILES
  index.html  Main semantic layout, collapsible sidebar, top bar with user picker and theme toggle
  style.css   Comprehensive dark mode & light mode healthcare UI with CSS variables, animations, and responsive tables
  app.js      Plain vanilla JavaScript (ES6+):
              - PART 1: Constants, thresholds, 60+ medicine autocomplete list
              - PART 2: Strict validators, date masks (mm/dd/yy), calendar checks, FEFO & expiry logic
              - PART 3: Data access layer (async functions, localStorage, ready for MySQL/Flask)
              - PART 4: 11 full screens (Dashboard with SVG donut chart, Medicines, Suppliers, Customers,
                        Stock-in, Dispense, Batches, Alerts, Disposal, Sales log, Users)
              - PART 5: Startup bootstrap, navigation, theme manager, user switcher

DATA MODEL (11 Mirror Tables)
  - Manufacturer(manufacturer_id, name, address)
  - Category(category_id, category_name)
  - Supplier(supplier_id, supplier_name, phone, address)
  - Customer(customer_id, customer_name, phone, email)  email is optional but UNIQUE when given
  - User(user_id, user_name, role)  roles: Admin, Pharmacist, Store Keeper
  - Medicine(medicine_id, medicine_name, category_id, manufacturer_id, unit, unit_price, min_stock_level)
  - Batch(batch_id, medicine_id, supplier_id, batch_no, mfg_date, expiry_date, purchase_date, purchase_price, mrp, quantity)
  - Alert(alert_id, batch_id, alert_type, alert_date, status)
  - Sale(sale_id, sale_date, customer_id, user_id)
  - Sold_In(sold_in_id, sale_id, batch_id, qty_sold, price)
  - Disposal(disposal_id, batch_id, disposal_date, quantity, reason, approved_by_user_id)

VALIDATION RULES (Enforced both live in forms and inside data access layer)
  - Dates: mm/dd/yy text inputs with auto-slashing, real calendar date validation, two-digit year (20yy).
    Expiry must be after manufacture date; mfg and purchase cannot be in the future. Displayed as mm/dd/yy everywhere.
  - Phones: Exactly 10 digits starting with 6, 7, 8, or 9 (non-digits blocked live).
  - Names: 2 to 60 characters, letters/digits/spaces and . - ' + & only, at least one vowel (y counts),
    no run of 5+ consonants (y excluded), no letter repeated 3+ times in a row (digits like 000 are allowed).
  - Email (customers): optional; valid format required if given; must be unique across customers.
  - Batch Number: 3 to 20 letters/digits/hyphens with at least one digit; unique per medicine.
  - Prices & Numbers: MRP >= purchase price; whole numbers for quantities and minimum stock levels.
    All prices are shown in Indian Rupees (₹).
  - Stock-in: Rejects expired batches and batches expiring within 30 days (MIN_DAYS_TO_ACCEPT).
    Purchase date cannot be before manufacture date.
  - FEFO Dispensing: Earliest expiry batch consumed first; expired stock strictly quarantined from sale.
  - Disposal: Only allowed for expired stock with stock > 0; requires Admin or Pharmacist approval.
  - Alerts: "Generate alerts" scans stock and raises EXPIRED, EXPIRING_SOON, LOW_STOCK, and OUT_OF_STOCK alerts.
    Expiry windows come from CONFIG.ALERT_THRESHOLDS in app.js (single source of truth).

CONNECTING MYSQL & BACKEND LATER
  Only PART 3 of app.js needs modification. Replace each function body with a fetch() call
  to your Flask / Node API (CONFIG.API_BASE). The screens and UI never touch storage directly.

KNOWN LIMITATIONS
  See LIMITATIONS.md (also summarised at the top of app.js).
