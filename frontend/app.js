/* =====================================================================
   Medicine Expiry & Stock Alert System - app.js
   Front-End Pharmacy, Clinic & Hospital Store Inventory System

   PART 1: CONFIG & CONSTANTS
   PART 2: HELPERS, VALIDATORS & BUSINESS LOGIC
   PART 3: DATA ACCESS LAYER (Async, localStorage, ready for MySQL REST API)
   PART 4: 11 APPLICATION SCREENS
   PART 5: STARTUP, NAVIGATION, THEME & USER STATE

   KNOWN LIMITATIONS (prototype scope; see also LIMITATIONS.md)
   - Low-stock / out-of-stock alerts are stored against the medicine's first batch
     (which may be an expired one) because the Alert table only has batch_id.
     This is a schema limitation, not a UI bug.
   - The UI creates single-medicine sales only, although the schema (Sale + Sold_In)
     and the seed data support multi-line sales. There is no cart in this prototype.
   - No real authentication. The "Logged in as" picker is simulated, and roles are
     enforced only for disposal approval.
   - Dates are shown/entered as mm/dd/yy by design choice. This can be ambiguous
     for Indian users (dd/mm/yy is common); it is a known trade-off.
   ===================================================================== */

/* =====================================================================
   PART 1: CONFIG & CONSTANTS
   ===================================================================== */
const CONFIG = {
  API_BASE: (typeof window !== 'undefined' && (window.location.protocol === 'file:' || ['5500', '3000', '8080'].includes(window.location.port))) ? "http://localhost:5000/api" : "/api",
  STORAGE_KEY: "medstock_pharma_db_v4",

  MIN_DAYS_TO_ACCEPT: 30,                // Stock-in rejects batch expiring within 30 days
  ALERT_THRESHOLDS: [90, 60, 30, 7],     // Thresholds in days to expiry

  // Common medicine master list for autocomplete (~60 entries including the 12 PDF medicines)
  COMMON_MEDICINES: [
    "Paracetamol 500", "Amoxicillin 250", "Azithromycin 500", "Cetirizine 10",
    "Metformin 500", "Omeprazole 20", "Amlodipine 5", "Ibuprofen 400",
    "Pantoprazole 40", "Cough Syrup 100ml", "Atorvastatin 10", "Vitamin D3 60K",
    "Ciprofloxacin 500", "Losartan 50", "Levothyroxine 50", "Metoprolol 50",
    "Gabapentin 300", "Doxycycline 100", "Lisinopril 10", "Prednisone 20",
    "Fluoxetine 20", "Montelukast 10", "Sertraline 50", "Simvastatin 20",
    "Escitalopram 10", "Rosuvastatin 10", "Tramadol 50", "Clopidogrel 75",
    "Furosemide 40", "Ranitidine 150", "Diazepam 5", "Alprazolam 0.5",
    "Diclofenac 50", "Telmisartan 40", "Domperidone 10", "Glimepiride 2",
    "Hydrochlorothiazide 25", "Salbutamol Inhaler", "Budesonide Respules",
    "Ondansetron 4", "Duloxetine 30", "B-Complex Syrup", "Calcium 500 + D3",
    "Iron Folic Acid", "Zincovit 50", "Ceftriaxone 1g", "Meropenem 1g",
    "Piperacillin Tazobactam", "Insulin Glargine", "Heparin 5000 IU", "Enoxaparin 40",
    "Paracetamol Syrup 60ml", "Cefixime 200", "Ofloxacin 200", "Dextromethorphan Syrup",
    "Betamethasone 0.5", "Methylprednisolone 16", "Loratadine 10", "Levocetirizine 5",
    "Spironolactone 25", "Atenolol 50", "Clotrimazole Cream"
  ],

  UNITS: ["Tablet", "Capsule", "Syrup", "Injection", "Strip", "Bottle"],
  ROLES: ["Admin", "Pharmacist", "Store Keeper"],
  ALERT_TYPES: ["EXPIRING_SOON", "EXPIRED", "LOW_STOCK", "OUT_OF_STOCK"],
  ALERT_STATUSES: ["Open", "Acknowledged", "Resolved"]
};

/* Widest "expiring soon" window = largest alert threshold (single source of truth: CONFIG.ALERT_THRESHOLDS) */
const NEAR_EXPIRY_DAYS = Math.max(...CONFIG.ALERT_THRESHOLDS);

/* =====================================================================
   PART 2: HELPERS, VALIDATORS & BUSINESS LOGIC
   ===================================================================== */

/** DOM query selector shortcuts */
const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

/** Escape HTML characters */
function esc(str) {
  if (str === null || str === undefined) return "";
  return String(str).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

/** Format currency with 2 decimals */
function money(val) {
  const n = Number(val);
  return isNaN(n) ? "0.00" : n.toFixed(2);
}

/** Date calculations & ISO conversion (internal storage is YYYY-MM-DD) */
function getTodayIso() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseIsoToDate(iso) {
  if (!iso) return new Date();
  const clean = String(iso).split("T")[0];
  const parts = clean.split("-");
  if (parts.length < 3) return new Date(iso);
  return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
}

function daysLeft(expiryIso) {
  if (!expiryIso) return 0;
  const exp = parseIsoToDate(expiryIso);
  const now = parseIsoToDate(getTodayIso());
  return Math.round((exp - now) / 86400000);
}

/** Display date format: ALWAYS mm/dd/yy everywhere in the UI */
function formatDisplayDate(isoStr) {
  if (!isoStr) return "";
  const clean = String(isoStr).split("T")[0];
  const parts = clean.split("-");
  if (parts.length !== 3) return clean;
  const mm = parts[1];
  const dd = parts[2];
  const yy = parts[0].slice(-2);
  return `${mm}/${dd}/${yy}`;
}

/** Parse and strictly validate calendar date from mm/dd/yy (2-digit year = 20yy) or ISO YYYY-MM-DD */
function parseDateInput(str) {
  if (!str) return { valid: false, msg: "Date is required (mm/dd/yy)." };
  const s = String(str).trim();
  let mm, dd, fullYear;

  if (s.includes("-")) {
    const parts = s.split("-");
    if (parts.length === 3) {
      fullYear = parseInt(parts[0], 10);
      mm = parseInt(parts[1], 10);
      dd = parseInt(parts[2], 10);
    }
  } else if (s.includes("/")) {
    const parts = s.split("/");
    if (parts.length === 3) {
      mm = parseInt(parts[0], 10);
      dd = parseInt(parts[1], 10);
      let yy = parseInt(parts[2], 10);
      fullYear = yy < 100 ? (2000 + yy) : yy;
    }
  }

  if (!mm || !dd || !fullYear || isNaN(mm) || isNaN(dd) || isNaN(fullYear)) {
    return { valid: false, msg: "Use mm/dd/yy format (e.g. 08/15/27)." };
  }
  if (mm < 1 || mm > 12) return { valid: false, msg: "Month must be 01 to 12." };

  const daysInMonth = new Date(fullYear, mm, 0).getDate();
  if (dd < 1 || dd > daysInMonth) {
    return { valid: false, msg: `Invalid day ${dd} for month ${mm} (max ${daysInMonth}).` };
  }

  const mmStr = String(mm).padStart(2, "0");
  const ddStr = String(dd).padStart(2, "0");
  const iso = `${fullYear}-${mmStr}-${ddStr}`;
  return { valid: true, iso, fullYear, mm, dd, msg: "" };
}

/** Attach auto-slashing input mask for mm/dd/yy text fields */
function attachDateInputMask(input) {
  input.placeholder = "mm/dd/yy";
  input.maxLength = 8;
  input.autocomplete = "off";

  input.addEventListener("keydown", e => {
    if (e.key.length === 1 && !/[0-9\/]/.test(e.key) && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      return;
    }
  });

  input.addEventListener("input", e => {
    if (e.inputType && e.inputType.startsWith("delete")) {
      return;
    }
    const digits = input.value.replace(/[^\d]/g, "").slice(0, 6);
    let formatted = "";
    if (digits.length <= 2) {
      formatted = digits;
      if (digits.length === 2 && e.inputType !== "deleteContentBackward") formatted += "/";
    } else if (digits.length <= 4) {
      formatted = digits.slice(0, 2) + "/" + digits.slice(2);
      if (digits.length === 4 && e.inputType !== "deleteContentBackward") formatted += "/";
    } else {
      formatted = digits.slice(0, 2) + "/" + digits.slice(2, 4) + "/" + digits.slice(4, 6);
    }
    input.value = formatted;
  });
}

/** Attach 10-digit mask for phone fields (starts with 6,7,8,9; digits only) */
function attachPhoneMask(input) {
  input.placeholder = "10 digits (6-9...)";
  input.maxLength = 10;
  input.addEventListener("input", () => {
    input.value = input.value.replace(/[^\d]/g, "").slice(0, 10);
  });
}

/* ---------------------------------------------------------------------
   VALIDATORS (Enforced BOTH in UI forms and in Data Access Layer)
   --------------------------------------------------------------------- */
const Validators = {
  name(val, fieldLabel = "Name") {
    if (!val || typeof val !== "string") return { valid: false, msg: `${fieldLabel} is required.` };
    const s = val.trim();
    if (s.length < 2 || s.length > 80) return { valid: false, msg: `${fieldLabel} must be between 2 and 80 characters.` };
    if (!/^[a-zA-Z0-9\s.\-'+&/()#:,]+$/.test(s)) return { valid: false, msg: "Contains invalid characters." };
    return { valid: true, msg: "" };
  },

  /** Email is optional; if given it must look valid (uniqueness is checked against existing customers). */
  email(val) {
    const s = (val || "").trim();
    if (!s) return { valid: true, msg: "", value: "" };
    if (s.length > 80) return { valid: false, msg: "Email must be at most 80 characters." };
    if (!/^[A-Za-z0-9._%+\-]+@[A-Za-z0-9\-]+(\.[A-Za-z0-9\-]+)*\.[A-Za-z]{2,}$/.test(s)) {
      return { valid: false, msg: "Enter a valid email address (e.g. name@example.com)." };
    }
    return { valid: true, msg: "", value: s };
  },

  phone(val) {
    if (!val || typeof val !== "string") return { valid: false, msg: "Phone number is required." };
    const s = val.trim();
    if (!/^\d{10}$/.test(s)) return { valid: false, msg: "Must be exactly 10 digits." };
    if (!/^[6-9]/.test(s)) return { valid: false, msg: "Must start with 6, 7, 8, or 9." };
    return { valid: true, msg: "" };
  },

  address(val) {
    if (!val || typeof val !== "string") return { valid: false, msg: "Address is required." };
    const s = val.trim();
    if (s.length < 5 || s.length > 100) return { valid: false, msg: "Address must be between 5 and 100 characters." };
    return { valid: true, msg: "" };
  },

  batchNo(val) {
    if (!val || typeof val !== "string") return { valid: false, msg: "Batch number is required." };
    const s = val.trim();
    if (!/^[a-zA-Z0-9\-]{3,20}$/.test(s)) return { valid: false, msg: "Must be 3 to 20 letters, digits or hyphens." };
    if (!/\d/.test(s)) return { valid: false, msg: "Batch number must contain at least one digit." };
    return { valid: true, msg: "" };
  },

  integer(val, min = 0, label = "Value") {
    if (val === undefined || val === null || String(val).trim() === "") return { valid: false, msg: `${label} is required.` };
    const s = String(val).trim();
    if (!/^\d+$/.test(s)) return { valid: false, msg: `${label} must be a whole non-negative number.` };
    const n = parseInt(s, 10);
    if (n < min) return { valid: false, msg: `${label} must be at least ${min}.` };
    return { valid: true, msg: "", value: n };
  },

  price(val, min = 0, label = "Price") {
    if (val === undefined || val === null || String(val).trim() === "") return { valid: false, msg: `${label} is required.` };
    const s = String(val).trim();
    if (!/^\d+(\.\d{1,2})?$/.test(s)) return { valid: false, msg: `${label} must have at most 2 decimal places.` };
    const n = parseFloat(s);
    if (isNaN(n) || n < 0) return { valid: false, msg: `${label} cannot be negative.` };
    if (n < min) return { valid: false, msg: `${label} cannot be less than ${min.toFixed(2)}.` };
    return { valid: true, msg: "", value: n };
  }
};

/** Form validation UX tracker to prevent premature red borders and error messages */
function createFormTracker(formEl) {
  const touched = new Set();
  let submitted = false;

  formEl.querySelectorAll("input, select, textarea").forEach(el => {
    const markTouched = () => {
      const key = el.name || el.id;
      if (key) touched.add(key);
    };
    el.addEventListener("blur", markTouched);
    el.addEventListener("input", markTouched);
    el.addEventListener("change", markTouched);
  });

  return {
    isTouched(key) {
      return submitted || touched.has(key);
    },
    markSubmitted() {
      submitted = true;
    },
    reset() {
      touched.clear();
      submitted = false;
    },
    showError(key, errEl, inputEl, errMsg) {
      const shouldDisplay = (submitted || touched.has(key)) && Boolean(errMsg);
      if (errEl) errEl.textContent = shouldDisplay ? errMsg : "";
      if (inputEl) inputEl.classList.toggle("is-invalid", shouldDisplay);
    }
  };
}

/* ---------------------------------------------------------------------
   SHARED BUSINESS STATUS RULES
   --------------------------------------------------------------------- */

/**
 * Expiry status rule used on every screen:
 * - Expired: expiry before today (red, quarantined: never sellable)
 * - Expiring soon: within the largest CONFIG.ALERT_THRESHOLDS value (amber)
 * - OK: otherwise (green)
 * Thresholds are read from CONFIG.ALERT_THRESHOLDS
 */
function statusOf(batch) {
  const d = daysLeft(batch.expiry_date);
  if (d < 0) {
    return {
      key: "expired",
      label: "Expired (" + Math.abs(d) + "d ago)",
      badgeClass: "expired",
      thresholdText: "Expired (Quarantined)",
      isQuarantined: true,
      daysLeft: d
    };
  }
  // Tightest matching threshold wins (thresholds come from CONFIG.ALERT_THRESHOLDS, e.g. 7, 30, 60, 90)
  const tiers = CONFIG.ALERT_THRESHOLDS.slice().sort((a, b) => a - b);
  for (const t of tiers) {
    if (d <= t) {
      return {
        key: "near",
        label: "Expires in " + d + "d",
        badgeClass: "near",
        thresholdText: "Expires within " + t + " days",
        isQuarantined: false,
        daysLeft: d
      };
    }
  }
  return {
    key: "ok",
    label: "OK (" + d + "d left)",
    badgeClass: "ok",
    thresholdText: "Adequate Shelf Life",
    isQuarantined: false,
    daysLeft: d
  };
}

/** Render HTML tag badge for batch */
function tag(batch) {
  const s = statusOf(batch);
  return `<span class="tag ${s.badgeClass}">${esc(s.label)}</span>`;
}

/** Usable stock of a medicine = total quantity of its non-expired batches */
function usableStock(medId, batches) {
  return batches
    .filter(b => b.medicine_id === medId && daysLeft(b.expiry_date) >= 0 && b.quantity > 0)
    .reduce((sum, b) => sum + b.quantity, 0);
}

/** Medicine stock status helper (usable <= min_stock_level, or 0) */
function stockStatusOf(med, batches) {
  const usable = usableStock(med.medicine_id, batches);
  if (usable === 0) {
    return { key: "out", label: "Out of Stock", badgeClass: "expired", usable };
  }
  if (usable <= med.min_stock_level) {
    return { key: "low", label: "Low Stock", badgeClass: "near", usable };
  }
  return { key: "ok", label: "In Stock", badgeClass: "ok", usable };
}

/* ---------------------------------------------------------------------
   UI UTILITY FUNCTIONS
   --------------------------------------------------------------------- */

/** Toast notification with auto-dismiss */
function toast(msg, isErr = false) {
  const t = $("#toast");
  if (!t) return;
  t.textContent = msg;
  t.className = isErr ? "err" : "ok";
  t.style.display = "block";
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => {
    t.style.display = "none";
  }, 4000);
}

/** Responsive table generator */
function table(headers, rows) {
  if (!rows || !rows.length) {
    return `
      <div class="empty">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6M9 9l6 6"/></svg>
        <span>No records found matching criteria.</span>
      </div>`;
  }
  return `
    <div class="tw">
      <table>
        <thead>
          <tr>${headers.map(h => `<th>${h}</th>`).join("")}</tr>
        </thead>
        <tbody>
          ${rows.map(r => `
            <tr${r.cls ? ` class="${r.cls}"` : ""}>
              ${r.cells.map(c => `<td>${c}</td>`).join("")}
            </tr>`).join("")}
        </tbody>
      </table>
    </div>`;
}

/** Helper to render dropdown options */
function options(list, idKey, labelFn, selectedId) {
  return list.map(item => {
    const val = item[idKey];
    const isSel = String(val) === String(selectedId);
    return `<option value="${esc(val)}"${isSel ? " selected" : ""}>${esc(labelFn(item))}</option>`;
  }).join("");
}

/** View header generator */
function header(title, sub, rightHtml = "") {
  return `
    <div class="view-header">
      <div class="header-text">
        <h1>${esc(title)}</h1>
        <p class="sub">${esc(sub)}</p>
      </div>
      ${rightHtml ? `<div class="header-actions">${rightHtml}</div>` : ""}
    </div>`;
}

/** Render HTML into main view */
function show(html) {
  const v = $("#view");
  if (v) v.innerHTML = html;
}

/* =====================================================================
   PART 3: DATA ACCESS LAYER
   Encapsulates all database operations. All operations are ASYNC.
   Screens NEVER access localStorage directly.
   To connect to MySQL/Flask API later, replace function bodies with fetch().
   ===================================================================== */

/** Initial sample data seeded from the PDF specifications */
function seedData() {
  return {
    nextId: 100,

    // Manufacturer(manufacturer_id, name, address)
    manufacturers: [
      { manufacturer_id: 1, name: "Cipla Ltd", address: "Cipla House, Lower Parel, Mumbai, Maharashtra" },
      { manufacturer_id: 2, name: "Sun Pharma", address: "Sun House, Goregaon East, Mumbai, Maharashtra" },
      { manufacturer_id: 3, name: "Dr. Reddys Laboratories", address: "7-1-27 Ameerpet, Hyderabad, Telangana" },
      { manufacturer_id: 4, name: "Lupin Ltd", address: "Kalpataru Inspire, Santacruz East, Mumbai, Maharashtra" },
      { manufacturer_id: 5, name: "Zydus Lifesciences", address: "Zydus Corporate Park, SG Highway, Ahmedabad, Gujarat" }
    ],

    // Category(category_id, category_name)
    categories: [
      { category_id: 1, category_name: "Analgesic" },
      { category_id: 2, category_name: "Antibiotic" },
      { category_id: 3, category_name: "Antihistamine" },
      { category_id: 4, category_name: "Antidiabetic" },
      { category_id: 5, category_name: "Antacid" },
      { category_id: 6, category_name: "Antihypertensive" },
      { category_id: 7, category_name: "Cough & Cold" },
      { category_id: 8, category_name: "Statin" },
      { category_id: 9, category_name: "Supplement" }
    ],

    // Supplier(supplier_id, supplier_name, phone, address) - PDF Page 5
    suppliers: [
      { supplier_id: 1, supplier_name: "MediLink Distributors", phone: "9820011122", address: "12 MG Road, Pune, 411001" },
      { supplier_id: 2, supplier_name: "HealthFirst Agencies", phone: "9890055566", address: "45 Link Rd, Mumbai, 400050" },
      { supplier_id: 3, supplier_name: "Apex Pharma Traders", phone: "9811122233", address: "7 Nehru Place, Delhi, 110019" },
      { supplier_id: 4, supplier_name: "CareLine Supplies", phone: "9988776655", address: "22 Ring Rd, Nagpur, 440001" },
      { supplier_id: 5, supplier_name: "Sai Pharma Distributors", phone: "9822033344", address: "18 FC Road, Pune, 411004" },
      { supplier_id: 6, supplier_name: "Metro Medico Supplies", phone: "9833044455", address: "9 Dadar West, Mumbai, 400028" },
      { supplier_id: 7, supplier_name: "Southern Drug Agency", phone: "9845055566", address: "31 Anna Salai, Chennai, 600002" },
      { supplier_id: 8, supplier_name: "Eastern Health Traders", phone: "9830066677", address: "5 Park Street, Kolkata, 700016" },
      { supplier_id: 9, supplier_name: "Gujarat Medi Hub", phone: "9825077788", address: "14 CG Road, Ahmedabad, 380009" },
      { supplier_id: 10, supplier_name: "Deccan Pharma Wholesale", phone: "9848088899", address: "26 Begum Pet, Hyderabad, 500016" }
    ],

    // Customer(customer_id, customer_name, phone, email[UNIQUE]) - PDF Page 7
    customers: [
      { customer_id: 1, customer_name: "Ramesh Patil", phone: "9820123456", email: "ramesh.patil@example.com" },
      { customer_id: 2, customer_name: "Sunita Deshmukh", phone: "9821234567", email: "sunita.deshmukh@example.com" },
      { customer_id: 3, customer_name: "Amit Verma", phone: "9822345678", email: "amit.verma@example.com" },
      { customer_id: 4, customer_name: "Neha Kulkarni", phone: "9823456789", email: "neha.kulkarni@example.com" },
      { customer_id: 5, customer_name: "Farhan Sheikh", phone: "9824567890", email: "farhan.sheikh@example.com" },
      { customer_id: 6, customer_name: "Priya Nair", phone: "9825678901", email: "priya.nair@example.com" },
      { customer_id: 7, customer_name: "Walk-in Customer", phone: "9826789012", email: "walkin@medstock.example.com" },
      { customer_id: 8, customer_name: "Rohan Mehta", phone: "9827890123", email: "rohan.mehta@example.com" },
      { customer_id: 9, customer_name: "Kavita Joshi", phone: "9828901234", email: "kavita.joshi@example.com" },
      { customer_id: 10, customer_name: "Suresh Iyer", phone: "9829012345", email: "suresh.iyer@example.com" },
      { customer_id: 11, customer_name: "Anita Rao", phone: "9830123456", email: "anita.rao@example.com" },
      { customer_id: 12, customer_name: "Imran Qureshi", phone: "9831234567", email: "imran.qureshi@example.com" }
    ],

    // User(user_id, user_name, role) - roles: Admin, Pharmacist, Store Keeper
    users: [
      { user_id: 1, user_name: "Dr. Rajesh Sharma", role: "Admin" },
      { user_id: 2, user_name: "Priya Patel", role: "Pharmacist" },
      { user_id: 3, user_name: "Vikram Singh", role: "Store Keeper" }
    ],

    // Medicine(medicine_id, medicine_name, category_id, manufacturer_id, unit, unit_price, min_stock_level) - PDF Page 4
    medicines: [
      { medicine_id: 1, medicine_name: "Paracetamol 500", category_id: 1, manufacturer_id: 1, unit: "Tablet", unit_price: 28.00, min_stock_level: 100 },
      { medicine_id: 2, medicine_name: "Amoxicillin 250", category_id: 2, manufacturer_id: 2, unit: "Capsule", unit_price: 85.50, min_stock_level: 80 },
      { medicine_id: 3, medicine_name: "Azithromycin 500", category_id: 2, manufacturer_id: 1, unit: "Tablet", unit_price: 112.00, min_stock_level: 60 },
      { medicine_id: 4, medicine_name: "Cetirizine 10", category_id: 3, manufacturer_id: 3, unit: "Tablet", unit_price: 32.00, min_stock_level: 80 },
      { medicine_id: 5, medicine_name: "Metformin 500", category_id: 4, manufacturer_id: 4, unit: "Tablet", unit_price: 45.00, min_stock_level: 120 },
      { medicine_id: 6, medicine_name: "Omeprazole 20", category_id: 5, manufacturer_id: 3, unit: "Capsule", unit_price: 64.00, min_stock_level: 70 },
      { medicine_id: 7, medicine_name: "Amlodipine 5", category_id: 6, manufacturer_id: 5, unit: "Tablet", unit_price: 58.00, min_stock_level: 90 },
      { medicine_id: 8, medicine_name: "Ibuprofen 400", category_id: 1, manufacturer_id: 2, unit: "Tablet", unit_price: 36.00, min_stock_level: 80 },
      { medicine_id: 9, medicine_name: "Pantoprazole 40", category_id: 5, manufacturer_id: 4, unit: "Tablet", unit_price: 92.00, min_stock_level: 70 },
      { medicine_id: 10, medicine_name: "Cough Syrup 100ml", category_id: 7, manufacturer_id: 5, unit: "Bottle", unit_price: 78.00, min_stock_level: 30 },
      { medicine_id: 11, medicine_name: "Atorvastatin 10", category_id: 8, manufacturer_id: 1, unit: "Tablet", unit_price: 98.00, min_stock_level: 60 },
      { medicine_id: 12, medicine_name: "Vitamin D3 60K", category_id: 9, manufacturer_id: 3, unit: "Capsule", unit_price: 120.00, min_stock_level: 50 }
    ],

    // Batch(batch_id, medicine_id, supplier_id, batch_no, mfg_date, expiry_date, purchase_date, purchase_price, mrp, quantity)
    // PDF Page 6 + 2 extra expired batches with stock for disposal demo
    batches: [
      { batch_id: 1, medicine_id: 1, supplier_id: 1, batch_no: "B2301", mfg_date: "2025-01-15", expiry_date: "2026-12-31", purchase_date: "2026-08-05", purchase_price: 19.60, mrp: 28.00, quantity: 40 },
      { batch_id: 2, medicine_id: 1, supplier_id: 5, batch_no: "B2302", mfg_date: "2025-06-15", expiry_date: "2027-06-30", purchase_date: "2026-09-12", purchase_price: 19.60, mrp: 28.00, quantity: 120 },
      { batch_id: 3, medicine_id: 2, supplier_id: 1, batch_no: "B1877", mfg_date: "2026-03-01", expiry_date: "2028-03-09", purchase_date: "2026-07-20", purchase_price: 59.85, mrp: 85.50, quantity: 300 },
      { batch_id: 4, medicine_id: 3, supplier_id: 3, batch_no: "B3320", mfg_date: "2025-12-10", expiry_date: "2027-12-14", purchase_date: "2026-08-18", purchase_price: 78.40, mrp: 112.00, quantity: 120 },
      { batch_id: 5, medicine_id: 4, supplier_id: 2, batch_no: "B4410", mfg_date: "2025-05-15", expiry_date: "2026-11-30", purchase_date: "2026-09-02", purchase_price: 22.40, mrp: 32.00, quantity: 25 },
      { batch_id: 6, medicine_id: 5, supplier_id: 4, batch_no: "B5521", mfg_date: "2026-01-15", expiry_date: "2028-01-19", purchase_date: "2026-07-30", purchase_price: 31.50, mrp: 45.00, quantity: 500 },
      { batch_id: 7, medicine_id: 6, supplier_id: 3, batch_no: "B6032", mfg_date: "2025-09-01", expiry_date: "2027-09-09", purchase_date: "2026-08-25", purchase_price: 44.80, mrp: 64.00, quantity: 90 },
      { batch_id: 8, medicine_id: 7, supplier_id: 1, batch_no: "B7145", mfg_date: "2026-02-01", expiry_date: "2028-02-04", purchase_date: "2026-08-11", purchase_price: 40.60, mrp: 58.00, quantity: 210 },
      { batch_id: 9, medicine_id: 8, supplier_id: 9, batch_no: "B8203", mfg_date: "2025-07-15", expiry_date: "2027-01-19", purchase_date: "2026-08-29", purchase_price: 25.20, mrp: 36.00, quantity: 60 },
      { batch_id: 10, medicine_id: 9, supplier_id: 1, batch_no: "B9317", mfg_date: "2026-04-01", expiry_date: "2028-04-11", purchase_date: "2026-09-05", purchase_price: 64.40, mrp: 92.00, quantity: 340 },
      { batch_id: 11, medicine_id: 10, supplier_id: 8, batch_no: "B1054", mfg_date: "2025-05-10", expiry_date: "2026-11-15", purchase_date: "2026-06-18", purchase_price: 54.60, mrp: 78.00, quantity: 15 },
      { batch_id: 12, medicine_id: 11, supplier_id: 3, batch_no: "B1189", mfg_date: "2026-05-01", expiry_date: "2028-05-07", purchase_date: "2026-09-10", purchase_price: 68.60, mrp: 98.00, quantity: 260 },
      { batch_id: 13, medicine_id: 12, supplier_id: 10, batch_no: "B1296", mfg_date: "2025-11-20", expiry_date: "2027-11-30", purchase_date: "2026-08-08", purchase_price: 84.00, mrp: 120.00, quantity: 75 },
      { batch_id: 14, medicine_id: 6, supplier_id: 6, batch_no: "B6033", mfg_date: "2025-10-15", expiry_date: "2027-10-20", purchase_date: "2026-09-15", purchase_price: 44.80, mrp: 64.00, quantity: 140 },
      { batch_id: 15, medicine_id: 12, supplier_id: 7, batch_no: "B1297", mfg_date: "2025-12-15", expiry_date: "2027-12-20", purchase_date: "2026-09-25", purchase_price: 84.00, mrp: 120.00, quantity: 110 },
      // 2 extra expired batches with stock (expired ~10-12 days ago) for Quarantined & Disposal testing:
      { batch_id: 16, medicine_id: 1, supplier_id: 1, batch_no: "B2290", mfg_date: "2024-10-10", expiry_date: "2026-10-17", purchase_date: "2025-01-10", purchase_price: 19.60, mrp: 28.00, quantity: 25 },
      { batch_id: 17, medicine_id: 4, supplier_id: 2, batch_no: "B4390", mfg_date: "2024-10-05", expiry_date: "2026-10-15", purchase_date: "2025-02-15", purchase_price: 22.40, mrp: 32.00, quantity: 18 }
    ],

    // Alert(alert_id, batch_id, alert_type, alert_date, status) - PDF Page 9
    // alert_type: EXPIRING_SOON, EXPIRED, LOW_STOCK, OUT_OF_STOCK; status: Open, Acknowledged, Resolved
    alerts: [
      { alert_id: 1, batch_id: 11, alert_type: "EXPIRING_SOON", alert_date: "2026-08-17", status: "Open" },
      { alert_id: 2, batch_id: 5, alert_type: "EXPIRING_SOON", alert_date: "2026-09-01", status: "Open" },
      { alert_id: 3, batch_id: 11, alert_type: "LOW_STOCK", alert_date: "2026-09-20", status: "Open" },
      { alert_id: 4, batch_id: 5, alert_type: "LOW_STOCK", alert_date: "2026-09-22", status: "Open" },
      { alert_id: 5, batch_id: 1, alert_type: "EXPIRING_SOON", alert_date: "2026-10-02", status: "Open" },
      { alert_id: 6, batch_id: 1, alert_type: "LOW_STOCK", alert_date: "2026-10-05", status: "Open" },
      { alert_id: 7, batch_id: 9, alert_type: "LOW_STOCK", alert_date: "2026-10-12", status: "Open" },
      { alert_id: 8, batch_id: 9, alert_type: "EXPIRING_SOON", alert_date: "2026-10-21", status: "Open" },
      { alert_id: 9, batch_id: 1, alert_type: "EXPIRING_SOON", alert_date: "2026-10-23", status: "Open" },
      { alert_id: 10, batch_id: 11, alert_type: "EXPIRING_SOON", alert_date: "2026-10-24", status: "Open" },
      { alert_id: 11, batch_id: 16, alert_type: "EXPIRED", alert_date: "2026-10-18", status: "Open" },
      { alert_id: 12, batch_id: 17, alert_type: "EXPIRED", alert_date: "2026-10-16", status: "Open" }
    ],

    // Sale(sale_id, sale_date, customer_id, user_id) - PDF Page 7
    sales: [
      { sale_id: 1, sale_date: "2026-10-12", customer_id: 1, user_id: 2 },
      { sale_id: 2, sale_date: "2026-10-13", customer_id: 2, user_id: 2 },
      { sale_id: 3, sale_date: "2026-10-14", customer_id: 3, user_id: 2 },
      { sale_id: 4, sale_date: "2026-10-15", customer_id: 4, user_id: 2 },
      { sale_id: 5, sale_date: "2026-10-16", customer_id: 5, user_id: 2 },
      { sale_id: 6, sale_date: "2026-10-17", customer_id: 6, user_id: 2 },
      { sale_id: 7, sale_date: "2026-10-18", customer_id: 7, user_id: 2 },
      { sale_id: 8, sale_date: "2026-10-19", customer_id: 8, user_id: 2 },
      { sale_id: 9, sale_date: "2026-10-20", customer_id: 9, user_id: 2 },
      { sale_id: 10, sale_date: "2026-10-21", customer_id: 10, user_id: 2 },
      { sale_id: 11, sale_date: "2026-10-22", customer_id: 11, user_id: 2 },
      { sale_id: 12, sale_date: "2026-10-23", customer_id: 12, user_id: 2 }
    ],

    // Sold_In(sold_in_id, sale_id, batch_id, qty_sold, price) - PDF Page 8
    soldIn: [
      { sold_in_id: 1, sale_id: 1, batch_id: 1, qty_sold: 2, price: 28.00 },
      { sold_in_id: 2, sale_id: 1, batch_id: 3, qty_sold: 1, price: 85.50 },
      { sold_in_id: 3, sale_id: 2, batch_id: 6, qty_sold: 3, price: 45.00 },
      { sold_in_id: 4, sale_id: 3, batch_id: 5, qty_sold: 2, price: 32.00 },
      { sold_in_id: 5, sale_id: 3, batch_id: 9, qty_sold: 1, price: 36.00 },
      { sold_in_id: 6, sale_id: 4, batch_id: 10, qty_sold: 1, price: 92.00 },
      { sold_in_id: 7, sale_id: 5, batch_id: 8, qty_sold: 2, price: 58.00 },
      { sold_in_id: 8, sale_id: 6, batch_id: 13, qty_sold: 1, price: 120.00 },
      { sold_in_id: 9, sale_id: 7, batch_id: 11, qty_sold: 1, price: 78.00 },
      { sold_in_id: 10, sale_id: 8, batch_id: 4, qty_sold: 1, price: 112.00 },
      { sold_in_id: 11, sale_id: 9, batch_id: 7, qty_sold: 2, price: 64.00 },
      { sold_in_id: 12, sale_id: 10, batch_id: 12, qty_sold: 1, price: 98.00 },
      { sold_in_id: 13, sale_id: 11, batch_id: 2, qty_sold: 3, price: 28.00 },
      { sold_in_id: 14, sale_id: 12, batch_id: 14, qty_sold: 2, price: 64.00 },
      { sold_in_id: 15, sale_id: 12, batch_id: 15, qty_sold: 1, price: 120.00 }
    ],

    // Disposal(disposal_id, batch_id, disposal_date, quantity, reason, approved_by_user_id)
    disposals: [
      { disposal_id: 1, batch_id: 16, disposal_date: "2026-10-20", quantity: 5, reason: "Expired tablet packaging broken during transit", approved_by_user_id: 1 }
    ]
  };
}

/** Low-level storage handlers (PRIVATE to Part 3) */
function loadDB() {
  try {
    const raw = localStorage.getItem(CONFIG.STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (err) {
    console.error("Failed to load local DB:", err);
  }
  const fresh = seedData();
  saveDB(fresh);
  return fresh;
}

function saveDB(db) {
  try {
    localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(db));
  } catch (err) {
    console.error("Failed to persist local DB:", err);
  }
}

function newId(db) {
  return db.nextId++;
}

/* ---------------------------------------------------------------------
   ASYNC DATA ACCESS FUNCTIONS (Connected to Backend REST API)
   --------------------------------------------------------------------- */

let cachedAuthToken = localStorage.getItem("medstock_auth_token") || null;
let currentLoggedInUserId = Number(localStorage.getItem("medstock_active_user")) || 1;

/** Ensure valid JWT token for active session */
async function getAuthToken() {
  if (cachedAuthToken) {
    return cachedAuthToken;
  }
  try {
    const savedUserId = Number(localStorage.getItem("medstock_active_user")) || 1;
    const pwd = savedUserId === 1 ? "admin123" : "staff123";
    const res = await fetch(`${CONFIG.API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: savedUserId, password: pwd })
    });
    const json = await res.json();
    if (json.success && json.data && json.data.token) {
      cachedAuthToken = json.data.token;
      currentLoggedInUserId = json.data.user.user_id;
      localStorage.setItem("medstock_auth_token", cachedAuthToken);
      localStorage.setItem("medstock_active_user", currentLoggedInUserId);
      return cachedAuthToken;
    }
  } catch (err) {
    console.warn("Backend auth failed, using local storage mode:", err.message);
  }
  return null;
}

/** Authenticate user switch with password */
async function authenticateUserSwitch(userId, password) {
  try {
    const res = await fetch(`${CONFIG.API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: Number(userId), password: password.trim() })
    });
    const json = await res.json();
    if (json.success && json.data && json.data.token) {
      cachedAuthToken = json.data.token;
      currentLoggedInUserId = json.data.user.user_id;
      localStorage.setItem("medstock_auth_token", cachedAuthToken);
      localStorage.setItem("medstock_active_user", currentLoggedInUserId);
      return { success: true, user: json.data.user };
    }
    return { success: false, message: json.message || "Incorrect password." };
  } catch (err) {
    return { success: false, message: err.message || "Network error during authentication." };
  }
}

/** Central API caller with JWT header and error handling */
async function apiRequest(endpoint, options = {}) {
  let token = await getAuthToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    ...(options.headers || {})
  };

  let res = await fetch(`${CONFIG.API_BASE}${endpoint}`, {
    ...options,
    headers
  });

  // If token is expired or rejected, refresh and retry once
  if (res.status === 401 && token) {
    cachedAuthToken = null;
    localStorage.removeItem("medstock_auth_token");
    token = await getAuthToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
      res = await fetch(`${CONFIG.API_BASE}${endpoint}`, {
        ...options,
        headers
      });
    }
  }

  const json = await res.json();
  if (!res.ok || json.success === false) {
    throw new Error(json.message || `Request failed with status ${res.status}`);
  }
  return json.data !== undefined ? json.data : json;
}

/** Medicines */
async function getMedicines() {
  try {
    const data = await apiRequest('/medicines');
    return data.map(m => ({
      ...m,
      medicine_name: m.name || m.medicine_name,
      unit_price: Number(m.unit_price) || 0,
      min_stock_level: m.reorder_level !== undefined ? (Number(m.reorder_level) || 0) : (Number(m.min_stock_level) || 0)
    }));
  } catch (err) {
    return (loadDB().medicines || []).map(m => ({
      ...m,
      unit_price: Number(m.unit_price) || 0,
      min_stock_level: Number(m.min_stock_level) || 0
    }));
  }
}

async function addMedicine(m) {
  try {
    const created = await apiRequest('/medicines', {
      method: 'POST',
      body: JSON.stringify({
        name: m.medicine_name,
        category_id: Number(m.category_id),
        manufacturer_id: Number(m.manufacturer_id),
        unit: m.unit || 'tablet',
        unit_price: Number(m.unit_price) || 0,
        reorder_level: Number(m.min_stock_level) || 50
      })
    });
    return {
      ...created,
      medicine_name: created.name || created.medicine_name,
      min_stock_level: created.reorder_level !== undefined ? created.reorder_level : created.min_stock_level
    };
  } catch (err) {
    const db = loadDB();
    const med = {
      medicine_id: newId(db),
      medicine_name: m.medicine_name.trim(),
      category_id: Number(m.category_id),
      manufacturer_id: Number(m.manufacturer_id),
      unit: m.unit,
      unit_price: Number(m.unit_price) || 0,
      min_stock_level: Number(m.min_stock_level) || 50
    };
    db.medicines.push(med);
    saveDB(db);
    return med;
  }
}

async function updateMedicine(id, m) {
  const payload = {
    name: m.medicine_name ? m.medicine_name.trim() : undefined,
    category_id: Number(m.category_id),
    manufacturer_id: Number(m.manufacturer_id),
    unit: m.unit,
    unit_price: Number(m.unit_price) || 0,
    reorder_level: Number(m.min_stock_level)
  };
  const res = await apiRequest(`/medicines/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload)
  });
  const db = loadDB();
  const med = db.medicines.find(x => x.medicine_id === Number(id));
  if (med) {
    Object.assign(med, {
      medicine_name: payload.name || med.medicine_name,
      category_id: payload.category_id,
      manufacturer_id: payload.manufacturer_id,
      unit: payload.unit,
      unit_price: payload.unit_price,
      min_stock_level: payload.reorder_level
    });
    saveDB(db);
  }
  return res;
}

async function deleteMedicine(id) {
  const res = await apiRequest(`/medicines/${id}`, { method: 'DELETE' });
  const db = loadDB();
  db.medicines = db.medicines.filter(x => x.medicine_id !== Number(id));
  saveDB(db);
  return res;
}

/** Manufacturers */
async function getManufacturers() {
  try {
    return await apiRequest('/manufacturers');
  } catch (err) {
    return loadDB().manufacturers;
  }
}

async function addManufacturer(m) {
  const payload = { name: m.name.trim(), address: (m.address || '').trim() };
  const created = await apiRequest('/manufacturers', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  const db = loadDB();
  db.manufacturers.push(created);
  saveDB(db);
  return created;
}

async function updateManufacturer(id, m) {
  const payload = { name: m.name.trim(), address: (m.address || '').trim() };
  const res = await apiRequest(`/manufacturers/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload)
  });
  const db = loadDB();
  const mfr = db.manufacturers.find(x => x.manufacturer_id === Number(id));
  if (mfr) {
    mfr.name = payload.name;
    mfr.address = payload.address;
    saveDB(db);
  }
  return res;
}

async function deleteManufacturer(id) {
  const res = await apiRequest(`/manufacturers/${id}`, { method: 'DELETE' });
  const db = loadDB();
  db.manufacturers = db.manufacturers.filter(x => x.manufacturer_id !== Number(id));
  saveDB(db);
  return res;
}

/** Categories */
async function getCategories() {
  try {
    const data = await apiRequest('/categories');
    return data.map(c => ({ ...c, category_name: c.name || c.category_name }));
  } catch (err) {
    return loadDB().categories;
  }
}

async function addCategory(c) {
  const payload = { name: (c.category_name || c.name || '').trim() };
  const created = await apiRequest('/categories', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  const formatted = { ...created, category_name: created.name || created.category_name };
  const db = loadDB();
  db.categories.push(formatted);
  saveDB(db);
  return formatted;
}

async function updateCategory(id, c) {
  const payload = { name: (c.category_name || c.name || '').trim() };
  const res = await apiRequest(`/categories/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload)
  });
  const db = loadDB();
  const cat = db.categories.find(x => x.category_id === Number(id));
  if (cat) {
    cat.category_name = payload.name;
    saveDB(db);
  }
  return res;
}

async function deleteCategory(id) {
  const res = await apiRequest(`/categories/${id}`, { method: 'DELETE' });
  const db = loadDB();
  db.categories = db.categories.filter(x => x.category_id !== Number(id));
  saveDB(db);
  return res;
}

/** Suppliers */
async function getSuppliers() {
  try {
    const data = await apiRequest('/suppliers');
    return data.map(s => ({
      ...s,
      supplier_name: s.name || s.supplier_name,
      address: s.address || [s.street, s.city, s.pin].filter(Boolean).join(', ')
    }));
  } catch (err) {
    return loadDB().suppliers;
  }
}

async function addSupplier(s) {
  const payload = {
    name: (s.supplier_name || s.name || '').trim(),
    phone: (s.phone || '').trim(),
    address: (s.address || '').trim()
  };
  const created = await apiRequest('/suppliers', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  const formatted = {
    ...created,
    supplier_name: created.name || created.supplier_name,
    address: created.address || payload.address
  };
  const db = loadDB();
  db.suppliers.push(formatted);
  saveDB(db);
  return formatted;
}

async function updateSupplier(id, s) {
  const payload = {
    name: (s.supplier_name || s.name || '').trim(),
    phone: (s.phone || '').trim(),
    address: (s.address || '').trim()
  };
  const res = await apiRequest(`/suppliers/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload)
  });
  const db = loadDB();
  const sup = db.suppliers.find(x => x.supplier_id === Number(id));
  if (sup) {
    sup.supplier_name = payload.name;
    sup.phone = payload.phone;
    sup.address = payload.address;
    saveDB(db);
  }
  return res;
}

async function deleteSupplier(id) {
  const res = await apiRequest(`/suppliers/${id}`, { method: 'DELETE' });
  const db = loadDB();
  db.suppliers = db.suppliers.filter(x => x.supplier_id !== Number(id));
  saveDB(db);
  return res;
}

/** Customers */
async function getCustomers() {
  try {
    const data = await apiRequest('/customers');
    return data.map(c => ({
      ...c,
      customer_name: c.name || c.customer_name,
      email: c.email || ''
    }));
  } catch (err) {
    return loadDB().customers;
  }
}

async function addCustomer(c) {
  const payload = {
    name: (c.customer_name || c.name || '').trim(),
    phone: (c.phone || '').trim(),
    email: (c.email || '').trim() || null
  };
  const created = await apiRequest('/customers', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  const formatted = {
    ...created,
    customer_name: created.name || created.customer_name,
    email: created.email || payload.email || ''
  };
  const db = loadDB();
  db.customers.push(formatted);
  saveDB(db);
  return formatted;
}

async function updateCustomer(id, c) {
  const payload = {
    name: (c.customer_name || c.name || '').trim(),
    phone: (c.phone || '').trim(),
    email: (c.email || '').trim() || null
  };
  const res = await apiRequest(`/customers/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload)
  });
  const db = loadDB();
  const cust = db.customers.find(x => x.customer_id === Number(id));
  if (cust) {
    cust.customer_name = payload.name;
    cust.phone = payload.phone;
    cust.email = payload.email || '';
    saveDB(db);
  }
  return res;
}

async function deleteCustomer(id) {
  const res = await apiRequest(`/customers/${id}`, { method: 'DELETE' });
  const db = loadDB();
  db.customers = db.customers.filter(x => x.customer_id !== Number(id));
  saveDB(db);
  return res;
}

/** Customer aggregated stats */
async function getCustomerSalesSummary() {
  const [customers, sales] = await Promise.all([getCustomers(), getSales()]);
  const summary = new Map();
  for (const c of customers) {
    summary.set(c.customer_id, { orderCount: 0, totalSpend: 0 });
  }
  for (const s of sales) {
    const entry = summary.get(s.customer_id) || { orderCount: 0, totalSpend: 0 };
    entry.orderCount++;
    entry.totalSpend += Number(s.amount || (s.qty_sold * s.price) || 0);
    summary.set(s.customer_id, entry);
  }
  return summary;
}

/** Users */
async function getUsers() {
  try {
    const data = await apiRequest('/auth/users');
    return data.map(u => ({ ...u, user_name: u.name || u.user_name }));
  } catch (err) {
    return loadDB().users;
  }
}

async function addUser(u) {
  const payload = {
    user_name: u.user_name.trim(),
    name: u.user_name.trim(),
    role: (u.role || 'pharmacist').toLowerCase(),
    ...(u.password ? { password: u.password.trim() } : {})
  };
  try {
    const res = await apiRequest('/auth/users', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    const db = loadDB();
    const user = {
      user_id: res.user_id,
      user_name: res.name || res.user_name || payload.name,
      role: res.role || payload.role,
      email: res.email || ''
    };
    db.users = db.users.filter(x => x.user_id !== user.user_id);
    db.users.push(user);
    saveDB(db);
    return user;
  } catch (err) {
    console.warn("Backend user creation failed, falling back to local storage:", err.message);
    const db = loadDB();
    const user = { user_id: newId(db), user_name: payload.name, role: payload.role, email: '' };
    db.users.push(user);
    saveDB(db);
    return user;
  }
}

async function updateUser(id, u) {
  const payload = {
    user_name: u.user_name.trim(),
    name: u.user_name.trim(),
    role: (u.role || 'pharmacist').toLowerCase(),
    ...(u.password ? { password: u.password.trim() } : {})
  };
  try {
    const res = await apiRequest(`/auth/users/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload)
    });
    const db = loadDB();
    const user = db.users.find(x => x.user_id === Number(id));
    if (user) {
      user.user_name = payload.name;
      user.role = payload.role;
      saveDB(db);
    }
    return res;
  } catch (err) {
    const db = loadDB();
    const user = db.users.find(x => x.user_id === Number(id));
    if (user) {
      user.user_name = payload.name;
      user.role = payload.role;
      saveDB(db);
      return user;
    }
    throw err;
  }
}

async function deleteUser(id) {
  const res = await apiRequest(`/auth/users/${id}`, {
    method: 'DELETE'
  });
  const db = loadDB();
  db.users = db.users.filter(x => x.user_id !== Number(id));
  saveDB(db);
  return res;
}

/** Batches */
async function getBatches() {
  try {
    const list = await apiRequest('/batches');
    return list.map(b => ({
      ...b,
      purchase_price: Number(b.purchase_price) || 0,
      mrp: Number(b.mrp) || 0,
      quantity: Number(b.quantity) || 0
    }));
  } catch (err) {
    return (loadDB().batches || []).map(b => ({
      ...b,
      purchase_price: Number(b.purchase_price) || 0,
      mrp: Number(b.mrp) || 0,
      quantity: Number(b.quantity) || 0
    }));
  }
}

async function addBatch(b) {
  const mfg = parseDateInput(b.mfg_date);
  const exp = parseDateInput(b.expiry_date);
  const pur = parseDateInput(b.purchase_date);

  try {
    return await apiRequest('/batches', {
      method: 'POST',
      body: JSON.stringify({
        medicine_id: Number(b.medicine_id),
        supplier_id: Number(b.supplier_id),
        batch_no: b.batch_no.trim(),
        mfg_date: mfg.iso || b.mfg_date,
        expiry_date: exp.iso || b.expiry_date,
        purchase_date: pur.iso || b.purchase_date,
        purchase_price: Number(b.purchase_price),
        mrp: Number(b.mrp),
        quantity: Number(b.quantity)
      })
    });
  } catch (err) {
    // Surface backend trigger error or validation
    throw err;
  }
}

/** Alerts */
async function getAlerts() {
  try {
    return await apiRequest('/alerts?status=ALL');
  } catch (err) {
    return loadDB().alerts;
  }
}

async function updateAlertStatus(alertId, newStatus) {
  try {
    if (newStatus === 'Resolved' || newStatus === 'RESOLVED') {
      return await apiRequest(`/alerts/${alertId}/resolve`, { method: 'PATCH' });
    }
  } catch (err) {
    console.warn("Resolve alert API error:", err);
  }
  const db = loadDB();
  const alert = db.alerts.find(a => a.alert_id === Number(alertId));
  if (alert) {
    alert.status = newStatus;
    saveDB(db);
    return alert;
  }
}

async function generateAlerts() {
  try {
    const res = await apiRequest('/alerts/generate', { method: 'POST' });
    return res.created;
  } catch (err) {
    return 0;
  }
}

/**
 * FEFO Dispensing:
 * Sends sale request to backend API which executes FEFO inside an ACID transaction.
 */
async function dispenseMedicine(medicineId, qty, customerId, userId) {
  const res = await apiRequest('/sales', {
    method: 'POST',
    body: JSON.stringify({
      customer_id: customerId ? Number(customerId) : null,
      items: [{ medicine_id: Number(medicineId), qty: Number(qty) }]
    })
  });

  const used = (res.items || []).map(i => ({
    batch_id: i.batch_id,
    batch_no: i.batch_no,
    expiry_date: i.expiry_date,
    quantity: Number(i.qty) || 0,
    unit_price: Number(i.price) || 0,
    subtotal: (Number(i.qty) || 0) * (Number(i.price) || 0)
  }));

  const allBatches = await getBatches();
  const remainingStock = usableStock(Number(medicineId), allBatches);

  return {
    sale_id: res.sale_id,
    sale_date: res.sale_date,
    customer_name: res.customer_name || 'Walk-in Customer',
    user_name: res.dispensed_by || 'Pharmacist',
    medicine_name: res.items && res.items[0] ? res.items[0].medicine_name : 'Medicine',
    used,
    total: Number(res.total_amount) || 0,
    remainingStock,
    min_stock_level: 50,
    isLow: remainingStock <= 50
  };
}

/** Sales log */
async function getSales() {
  try {
    const list = await apiRequest('/sales?details=true');
    return list.map(s => ({
      ...s,
      qty_sold: Number(s.qty_sold) || 0,
      price: Number(s.price) || 0,
      amount: Number(s.amount) || ((Number(s.qty_sold) || 0) * (Number(s.price) || 0))
    }));
  } catch (err) {
    return loadDB().soldIn.map(si => ({
      sold_in_id: si.sold_in_id,
      sale_id: si.sale_id,
      sale_date: getTodayIso(),
      customer_name: "Walk-in Customer",
      medicine_name: "Medicine",
      batch_no: "N/A",
      qty_sold: Number(si.qty_sold) || 0,
      price: Number(si.price) || 0,
      amount: (Number(si.qty_sold) || 0) * (Number(si.price) || 0),
      dispensed_by: "System"
    }));
  }
}

/** Disposal of quarantined stock */
async function disposeBatch(batchId, quantity, reason, approvingUserId) {
  return await apiRequest('/disposals', {
    method: 'POST',
    body: JSON.stringify({
      batch_id: Number(batchId),
      quantity: Number(quantity),
      reason: reason ? reason.trim() : 'Expired',
      approved_by: approvingUserId ? Number(approvingUserId) : undefined
    })
  });
}

async function getDisposals() {
  try {
    return await apiRequest('/disposals');
  } catch (err) {
    return loadDB().disposals.map(d => ({
      disposal_id: d.disposal_id,
      batch_id: d.batch_id,
      batch_no: "B8199",
      disposal_date: d.disposal_date,
      quantity: d.quantity,
      reason: d.reason,
      medicine_name: "Expired Stock",
      manufacturer_name: "Pharma",
      approved_by_name: "Dr. Rajesh Sharma (Admin)"
    }));
  }
}

/** Reset database to default seed data */
async function resetData() {
  saveDB(seedData());
}


/* =====================================================================
   PART 4: 11 APPLICATION SCREENS
   ===================================================================== */

const SCREENS = [
  { id: "Dashboard", label: "Dashboard", icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/></svg>' },
  { id: "Medicines", label: "Medicines", icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z"/><path d="m8.5 8.5 7 7"/></svg>' },
  { id: "Suppliers", label: "Suppliers", icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/></svg>' },
  { id: "Customers", label: "Customers", icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>' },
  { id: "Stock-in", label: "Stock-in", icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/><path d="m16 12 3 3-3 3"/><path d="M19 15H9"/></svg>' },
  { id: "Dispense", label: "Dispense (FEFO)", icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/><path d="m13 7-2 4h4l-2 4"/></svg>' },
  { id: "Batches", label: "Batches", icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/></svg>' },
  { id: "Alerts", label: "Alerts", icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>' },
  { id: "Disposal", label: "Disposal", icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>' },
  { id: "Sales log", label: "Sales Log", icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>' },
  { id: "Users", label: "Users & Roles", icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><circle cx="12" cy="11" r="3"/></svg>' }
];

let currentScreen = "Dashboard";

/* ---------------------------------------------------------------------
   1. SCREEN: DASHBOARD
   --------------------------------------------------------------------- */
async function vDashboard() {
  const [meds, sups, bats, alerts, cats] = await Promise.all([
    getMedicines(), getSuppliers(), getBatches(), getAlerts(), getCategories()
  ]);

  const supName = id => (sups.find(s => s.supplier_id === id) || {}).supplier_name || "N/A";
  const medName = id => (meds.find(m => m.medicine_id === id) || {}).medicine_name || "N/A";
  const catMap = new Map(cats.map(c => [c.category_id, c.category_name]));

  // Batches breakdown
  const activeBatches = bats.filter(b => b.quantity > 0);
  const expiredBatches = activeBatches.filter(b => daysLeft(b.expiry_date) < 0);
  const nearExpiryBatches = activeBatches.filter(b => {
    const d = daysLeft(b.expiry_date);
    return d >= 0 && d <= NEAR_EXPIRY_DAYS;
  });
  const okBatches = activeBatches.filter(b => daysLeft(b.expiry_date) > NEAR_EXPIRY_DAYS);

  // Stock breakdown
  const lowStockMeds = meds.filter(m => {
    const u = usableStock(m.medicine_id, bats);
    return u > 0 && u <= m.min_stock_level;
  });
  const outOfStockMeds = meds.filter(m => usableStock(m.medicine_id, bats) === 0);
  const openAlerts = alerts.filter(a => (a.status || "").toUpperCase() === "OPEN");

  // Sorted list for near-expiry alert table
  const expiringAlertList = nearExpiryBatches
    .slice()
    .sort((a, b) => (a.expiry_date < b.expiry_date ? -1 : 1));

  // Build Plain SVG Donut Chart
  const totalB = activeBatches.length;
  const cExp = expiredBatches.length;
  const cNear = nearExpiryBatches.length;
  const cOk = okBatches.length;

  const pctExp = totalB ? Math.round((cExp / totalB) * 100) : 0;
  const pctNear = totalB ? Math.round((cNear / totalB) * 100) : 0;
  const pctOk = totalB ? 100 - pctExp - pctNear : 0;

  // SVG Circumference for r=68
  const C = 2 * Math.PI * 68; // ~427.25
  let offset = 0;

  const strokeExp = totalB ? (cExp / totalB) * C : 0;
  const dashExp = `${strokeExp} ${C - strokeExp}`;
  const offExp = -offset;
  offset += strokeExp;

  const strokeNear = totalB ? (cNear / totalB) * C : 0;
  const dashNear = `${strokeNear} ${C - strokeNear}`;
  const offNear = -offset;
  offset += strokeNear;

  const strokeOk = totalB ? (cOk / totalB) * C : 0;
  const dashOk = `${strokeOk} ${C - strokeOk}`;
  const offOk = -offset;

  const svgChart = `
    <svg width="190" height="190" viewBox="0 0 190 190">
      <circle cx="95" cy="95" r="68" fill="transparent" stroke="var(--border)" stroke-width="22"/>
      ${totalB > 0 ? `
        <circle cx="95" cy="95" r="68" fill="transparent" stroke="#ef4444" stroke-width="22" stroke-dasharray="${dashExp}" stroke-dashoffset="${offExp}" transform="rotate(-90 95 95)"/>
        <circle cx="95" cy="95" r="68" fill="transparent" stroke="#f59e0b" stroke-width="22" stroke-dasharray="${dashNear}" stroke-dashoffset="${offNear}" transform="rotate(-90 95 95)"/>
        <circle cx="95" cy="95" r="68" fill="transparent" stroke="#10b981" stroke-width="22" stroke-dasharray="${dashOk}" stroke-dashoffset="${offOk}" transform="rotate(-90 95 95)"/>
      ` : ""}
      <text x="95" y="90" text-anchor="middle" font-size="28" font-weight="800" fill="var(--tx-white)">${totalB}</text>
      <text x="95" y="110" text-anchor="middle" font-size="11" font-weight="600" fill="var(--tx-muted)">BATCHES</text>
    </svg>`;

  show(
    header("Dashboard", "Real-time medicine expiry & stock levels") +
    `<div class="cards">
      <div class="stat stat-primary">
        <div class="stat-header">
          <div class="stat-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z"/></svg></div>
          <span class="stat-pill">Master</span>
        </div>
        <b>${meds.length}</b>
        <span>Registered Medicines</span>
      </div>

      <div class="stat stat-danger">
        <div class="stat-header">
          <div class="stat-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M3.6 15h16.8L12 3z"/></svg></div>
          <span class="stat-pill">Quarantined</span>
        </div>
        <b style="color:var(--red)">${cExp}</b>
        <span>Expired Batches in Stock</span>
      </div>

      <div class="stat stat-warning">
        <div class="stat-header">
          <div class="stat-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></div>
          <span class="stat-pill">&le; ${NEAR_EXPIRY_DAYS} Days</span>
        </div>
        <b style="color:var(--amb)">${cNear}</b>
        <span>Expiring Soon Batches</span>
      </div>

      <div class="stat stat-stock">
        <div class="stat-header">
          <div class="stat-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg></div>
          <span class="stat-pill">&le; Reorder</span>
        </div>
        <b style="color:var(--purple)">${lowStockMeds.length}</b>
        <span>Low-Stock Medicines</span>
      </div>

      <div class="stat stat-danger">
        <div class="stat-header">
          <div class="stat-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg></div>
          <span class="stat-pill">Empty</span>
        </div>
        <b style="color:var(--red)">${outOfStockMeds.length}</b>
        <span>Out of Stock Medicines</span>
      </div>

      <div class="stat stat-cyan">
        <div class="stat-header">
          <div class="stat-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg></div>
          <span class="stat-pill">Action Req</span>
        </div>
        <b style="color:var(--cyan)">${openAlerts.length}</b>
        <span>Open System Alerts</span>
      </div>
    </div>

    <!-- Plain SVG Donut Chart Section -->
    <div class="panel">
      <div class="panel-header">
        <div>
          <h2><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 2a10 10 0 0 1 10 10h-10z"/></svg> Batch Inventory Shelf-Life Breakdown</h2>
          <p class="panel-subtitle">Proportional breakdown of in-stock batches by expiry compliance</p>
        </div>
      </div>
      <div class="charts-grid">
        <div class="chart-container">
          ${svgChart}
        </div>
        <div class="chart-legend-grid">
          <div class="legend-card">
            <div class="legend-left">
              <span class="legend-indicator" style="background:#ef4444"></span>
              <div>
                <span class="legend-label">Expired (Quarantined)</span>
                <span class="legend-desc">Past expiry date &bull; blocked from dispensing</span>
              </div>
            </div>
            <div class="legend-values">
              <span class="legend-count" style="color:#ef4444">${cExp}</span>
              <span class="legend-pct">${pctExp}% of total</span>
            </div>
          </div>

          <div class="legend-card">
            <div class="legend-left">
              <span class="legend-indicator" style="background:#f59e0b"></span>
              <div>
                <span class="legend-label">Expiring Soon</span>
                <span class="legend-desc">Expires within ${NEAR_EXPIRY_DAYS} days &bull; FEFO prioritize</span>
              </div>
            </div>
            <div class="legend-values">
              <span class="legend-count" style="color:#f59e0b">${cNear}</span>
              <span class="legend-pct">${pctNear}% of total</span>
            </div>
          </div>

          <div class="legend-card">
            <div class="legend-left">
              <span class="legend-indicator" style="background:#10b981"></span>
              <div>
                <span class="legend-label">Healthy Shelf-Life</span>
                <span class="legend-desc">Beyond ${NEAR_EXPIRY_DAYS} days safe operational stock</span>
              </div>
            </div>
            <div class="legend-values">
              <span class="legend-count" style="color:#10b981">${cOk}</span>
              <span class="legend-pct">${pctOk}% of total</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Expiring Soon Table -->
    <div class="panel">
      <div class="panel-header">
        <div>
          <h2><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 8v4l3 3"/><circle cx="12" cy="12" r="10"/></svg> Batches Expiring Within ${NEAR_EXPIRY_DAYS} Days</h2>
          <p class="panel-subtitle">Sorted by earliest expiry date &bull; prioritize dispensing via FEFO</p>
        </div>
      </div>
      ${table(
        ["Medicine", "Batch No", "Supplier", "Expiry Date", "Tightest Threshold", "Days Left", "In Stock", "Status"],
        expiringAlertList.map(b => {
          const st = statusOf(b);
          return {
            cls: st.badgeClass === "expired" ? "expired" : "",
            cells: [
              `<b>${esc(medName(b.medicine_id))}</b>`,
              `<span class="code">${esc(b.batch_no)}</span>`,
              esc(supName(b.supplier_id)),
              formatDisplayDate(b.expiry_date),
              `<span style="color:var(--amb);font-weight:600">${esc(st.thresholdText)}</span>`,
              `<b>${st.daysLeft}d</b>`,
              `<b>${b.quantity}</b>`,
              tag(b)
            ]
          };
        })
      )}
    </div>

    <!-- Low-Stock Alerts Table -->
    <div class="panel">
      <div class="panel-header">
        <div>
          <h2><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg> Low-Stock &amp; Depleted Medicines</h2>
          <p class="panel-subtitle">Usable (unexpired) quantity at or below minimum required stock level</p>
        </div>
      </div>
      ${table(
        ["Medicine", "Category", "Usable Stock", "Min Level", "Shortfall", "Alert Badge", "Quick Action"],
        lowStockMeds.concat(outOfStockMeds).map(m => {
          const u = usableStock(m.medicine_id, bats);
          const shortfall = Math.max(0, m.min_stock_level - u);
          const isOut = u === 0;
          return {
            cls: isOut ? "expired" : "",
            cells: [
              `<b>${esc(m.medicine_name)}</b>`,
              esc(catMap.get(m.category_id) || "N/A"),
              `<b>${u}</b> ${esc(m.unit)}s`,
              `${m.min_stock_level}`,
              `<span style="color:var(--red);font-weight:700">-${shortfall}</span>`,
              isOut ? '<span class="tag expired">Out of Stock</span>' : '<span class="tag near">Low Stock</span>',
              `<button class="btn sm secondary" onclick="go('Stock-in')">+ Stock In</button>`
            ]
          };
        })
      )}
    </div>`
  );
}

/* ---------------------------------------------------------------------
   2. SCREEN: MEDICINES (with Manufacturers and Categories tabs)
   --------------------------------------------------------------------- */
let activeMedTab = "medicines"; // 'medicines' | 'manufacturers' | 'categories'

async function vMedicines() {
  const [meds, mfrs, cats, bats] = await Promise.all([
    getMedicines(), getManufacturers(), getCategories(), getBatches()
  ]);

  const mfrMap = new Map(mfrs.map(mf => [mf.manufacturer_id, mf.name]));
  const catMap = new Map(cats.map(c => [c.category_id, c.category_name]));

  // Populate datalist with ~60 common medicines
  const dl = $("#medicineDatalist");
  if (dl) {
    dl.innerHTML = CONFIG.COMMON_MEDICINES.map(m => `<option value="${esc(m)}"></option>`).join("");
  }

  show(
    header("Medicine Inventory & Master Data", "Manage medicines, manufacturers, and pharmaceutical categories") +
    `<div class="tabs-bar">
      <button class="tab-btn ${activeMedTab === "medicines" ? "active" : ""}" data-tab="medicines">
        Medicines <span class="tab-count">${meds.length}</span>
      </button>
      <button class="tab-btn ${activeMedTab === "manufacturers" ? "active" : ""}" data-tab="manufacturers">
        Manufacturers <span class="tab-count">${mfrs.length}</span>
      </button>
      <button class="tab-btn ${activeMedTab === "categories" ? "active" : ""}" data-tab="categories">
        Categories <span class="tab-count">${cats.length}</span>
      </button>
    </div>
    <div id="tabContent"></div>`
  );

  $$(".tab-btn").forEach(btn => {
    btn.onclick = () => {
      activeMedTab = btn.dataset.tab;
      vMedicines();
    };
  });

  if (activeMedTab === "medicines") {
    renderMedicinesTab(meds, mfrs, cats, bats, mfrMap, catMap);
  } else if (activeMedTab === "manufacturers") {
    renderManufacturersTab(mfrs, meds);
  } else {
    renderCategoriesTab(cats, meds);
  }
}

function renderMedicinesTab(meds, mfrs, cats, bats, mfrMap, catMap) {
  const container = $("#tabContent");
  container.innerHTML = `
    <div class="panel">
      <h2 id="medFormTitle">Add New Medicine</h2>
      <p class="note">Enter medicine details. Name autocomplete supports 60+ common medicines.</p>
      <form class="f" id="medForm" autocomplete="off">
        <input type="hidden" name="medicine_id">

        <div class="form-group">
          <label>Medicine Name <span class="req">*</span>
            <input name="medicine_name" list="medicineDatalist" placeholder="e.g. Paracetamol 500" required>
          </label>
          <div class="field-error" id="err_med_name"></div>
        </div>

        <div class="form-group">
          <label>Category <span class="req">*</span>
            <select name="category_id" required>
              <option value="">-- Select Category --</option>
              ${options(cats, "category_id", c => c.category_name)}
            </select>
          </label>
          <div class="field-error" id="err_med_cat"></div>
        </div>

        <div class="form-group">
          <label>Manufacturer <span class="req">*</span>
            <select name="manufacturer_id" required>
              <option value="">-- Select Manufacturer --</option>
              ${options(mfrs, "manufacturer_id", mf => mf.name)}
            </select>
          </label>
          <div class="field-error" id="err_med_mfr"></div>
        </div>

        <div class="form-group">
          <label>Dosage Unit <span class="req">*</span>
            <select name="unit" required>
              ${CONFIG.UNITS.map(u => `<option value="${esc(u)}">${esc(u)}</option>`).join("")}
            </select>
          </label>
          <div class="field-error" id="err_med_unit"></div>
        </div>

        <div class="form-group">
          <label>Unit Price (₹) <span class="req">*</span>
            <input name="unit_price" type="number" step="0.01" min="0" placeholder="e.g. 28.00" required>
          </label>
          <div class="field-error" id="err_med_price"></div>
        </div>

        <div class="form-group">
          <label>Min Stock Level (Reorder) <span class="req">*</span>
            <input name="min_stock_level" type="number" min="0" step="1" placeholder="e.g. 100" required>
          </label>
          <div class="field-error" id="err_med_min"></div>
        </div>

        <div class="form-actions">
          <button type="submit" class="btn" id="medSaveBtn">Save Medicine</button>
          <button type="button" class="btn ghost" id="medCancelBtn" style="display:none">Cancel</button>
        </div>
      </form>
    </div>

    <div class="panel">
      <div class="panel-header">
        <h2>Registered Medicines</h2>
      </div>
      <div class="filters">
        <input id="medSearch" placeholder="Search medicine name...">
        <select id="medCatFilter">
          <option value="">All Categories</option>
          ${options(cats, "category_id", c => c.category_name)}
        </select>
      </div>
      <div id="medTableWrap"></div>
    </div>`;

  const form = $("#medForm");
  const saveBtn = $("#medSaveBtn");
  const cancelBtn = $("#medCancelBtn");
  const tracker = createFormTracker(form);

  // Live form validation
  function validateMedForm() {
    let valid = true;
    const vName = Validators.name(form.medicine_name.value, "Medicine name");
    tracker.showError("medicine_name", $("#err_med_name"), form.medicine_name, vName.valid ? "" : vName.msg);
    if (!vName.valid) valid = false;

    const catOk = Boolean(form.category_id.value);
    tracker.showError("category_id", $("#err_med_cat"), form.category_id, catOk ? "" : "Category is required.");
    if (!catOk) valid = false;

    const mfrOk = Boolean(form.manufacturer_id.value);
    tracker.showError("manufacturer_id", $("#err_med_mfr"), form.manufacturer_id, mfrOk ? "" : "Manufacturer is required.");
    if (!mfrOk) valid = false;

    const vPrice = Validators.price(form.unit_price.value, 0, "Unit price");
    tracker.showError("unit_price", $("#err_med_price"), form.unit_price, vPrice.valid ? "" : vPrice.msg);
    if (!vPrice.valid) valid = false;

    const vMin = Validators.integer(form.min_stock_level.value, 0, "Min stock level");
    tracker.showError("min_stock_level", $("#err_med_min"), form.min_stock_level, vMin.valid ? "" : vMin.msg);
    if (!vMin.valid) valid = false;

    saveBtn.disabled = !valid;
    return valid;
  }

  form.querySelectorAll("input, select").forEach(el => {
    el.addEventListener("input", validateMedForm);
    el.addEventListener("change", validateMedForm);
  });
  validateMedForm();

  // Draw Table
  function drawMedTable() {
    const q = ($("#medSearch").value || "").toLowerCase().trim();
    const catF = $("#medCatFilter").value;

    const filtered = meds.filter(m => {
      const matchQ = m.medicine_name.toLowerCase().includes(q);
      const matchCat = !catF || String(m.category_id) === String(catF);
      return matchQ && matchCat;
    });

    const rows = filtered.map(m => {
      const st = stockStatusOf(m, bats);
      return {
        cells: [
          `<b>${esc(m.medicine_name)}</b>`,
          esc(catMap.get(m.category_id) || "N/A"),
          esc(mfrMap.get(m.manufacturer_id) || "N/A"),
          `<span class="tag neutral">${esc(m.unit)}</span>`,
          `₹${money(m.unit_price)}`,
          `${m.min_stock_level}`,
          `<b>${st.usable}</b>`,
          `<span class="tag ${st.badgeClass}">${esc(st.label)}</span>`,
          `<button class="btn sm ghost" data-edit-med="${m.medicine_id}">Edit</button> ` +
          `<button class="btn sm del" data-del-med="${m.medicine_id}">Delete</button>`
        ]
      };
    });

    $("#medTableWrap").innerHTML = table(
      ["Medicine Name", "Category", "Manufacturer", "Unit", "Unit Price", "Min Level", "Usable Stock", "Status", "Actions"],
      rows
    );
  }

  drawMedTable();
  $("#medSearch").oninput = drawMedTable;
  $("#medCatFilter").onchange = drawMedTable;

  // Form Submit
  form.onsubmit = async e => {
    e.preventDefault();
    tracker.markSubmitted();
    if (!validateMedForm()) return;
    const medId = form.medicine_id.value;
    const prevText = saveBtn.textContent;
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving...";

    try {
      if (medId) {
        await updateMedicine(medId, {
          medicine_name: form.medicine_name.value,
          category_id: form.category_id.value,
          manufacturer_id: form.manufacturer_id.value,
          unit: form.unit.value,
          unit_price: form.unit_price.value,
          min_stock_level: form.min_stock_level.value
        });
        toast("Medicine updated successfully.");
      } else {
        await addMedicine({
          medicine_name: form.medicine_name.value,
          category_id: form.category_id.value,
          manufacturer_id: form.manufacturer_id.value,
          unit: form.unit.value,
          unit_price: form.unit_price.value,
          min_stock_level: form.min_stock_level.value
        });
        toast("Medicine added successfully.");
      }
      form.reset();
      form.medicine_id.value = "";
      tracker.reset();
      await vMedicines();
    } catch (err) {
      toast(err.message, true);
      saveBtn.disabled = false;
      saveBtn.textContent = prevText;
    }
  };

  // Actions delegate
  $("#medTableWrap").onclick = async e => {
    const editId = e.target.dataset.editMed;
    const delId = e.target.dataset.delMed;

    if (editId) {
      const target = meds.find(m => m.medicine_id === Number(editId));
      if (!target) return;
      $("#medFormTitle").textContent = "Edit Medicine";
      form.medicine_id.value = target.medicine_id;
      form.medicine_name.value = target.medicine_name || target.name;
      form.category_id.value = target.category_id;
      form.manufacturer_id.value = target.manufacturer_id;
      const matchedUnit = CONFIG.UNITS.find(u => u.toLowerCase() === (target.unit || "").toLowerCase()) || target.unit;
      form.unit.value = matchedUnit;
      form.unit_price.value = target.unit_price;
      form.min_stock_level.value = target.min_stock_level !== undefined ? target.min_stock_level : target.reorder_level;
      cancelBtn.style.display = "inline-flex";
      saveBtn.textContent = "Update Medicine";
      tracker.reset();
      validateMedForm();
      form.scrollIntoView({ behavior: "smooth" });
    }

    if (delId) {
      if (confirm("Are you sure you want to delete this medicine?")) {
        try {
          await deleteMedicine(delId);
          toast("Medicine deleted.");
          await vMedicines();
        } catch (err) {
          toast(err.message, true);
        }
      }
    }
  };

  cancelBtn.onclick = () => {
    form.reset();
    form.medicine_id.value = "";
    $("#medFormTitle").textContent = "Add New Medicine";
    cancelBtn.style.display = "none";
    saveBtn.textContent = "Save Medicine";
    tracker.reset();
    validateMedForm();
  };
}

function renderManufacturersTab(mfrs, meds) {
  const container = $("#tabContent");
  container.innerHTML = `
    <div class="panel">
      <h2 id="mfrFormTitle">Add Manufacturer</h2>
      <form class="f" id="mfrForm">
        <input type="hidden" name="manufacturer_id">
        <div class="form-group">
          <label>Manufacturer Name <span class="req">*</span>
            <input name="name" placeholder="e.g. Cipla Ltd" required>
          </label>
          <div class="field-error" id="err_mfr_name"></div>
        </div>
        <div class="form-group">
          <label>Address (5-100 characters) <span class="req">*</span>
            <input name="address" placeholder="e.g. Lower Parel, Mumbai" required>
          </label>
          <div class="field-error" id="err_mfr_addr"></div>
        </div>
        <div class="form-actions">
          <button type="submit" class="btn" id="mfrSaveBtn">Save Manufacturer</button>
          <button type="button" class="btn ghost" id="mfrCancelBtn" style="display:none">Cancel</button>
        </div>
      </form>
    </div>

    <div class="panel">
      <h2>Registered Manufacturers</h2>
      <div id="mfrTableWrap"></div>
    </div>`;

  const form = $("#mfrForm");
  const saveBtn = $("#mfrSaveBtn");
  const cancelBtn = $("#mfrCancelBtn");
  const tracker = createFormTracker(form);

  function validateMfrForm() {
    let valid = true;
    const vName = Validators.name(form.name.value, "Manufacturer name");
    tracker.showError("name", $("#err_mfr_name"), form.name, vName.valid ? "" : vName.msg);
    if (!vName.valid) valid = false;

    const vAddr = Validators.address(form.address.value);
    tracker.showError("address", $("#err_mfr_addr"), form.address, vAddr.valid ? "" : vAddr.msg);
    if (!vAddr.valid) valid = false;

    saveBtn.disabled = !valid;
    return valid;
  }

  form.querySelectorAll("input").forEach(el => el.addEventListener("input", validateMfrForm));
  validateMfrForm();

  function drawMfrTable() {
    const rows = mfrs.map(mf => {
      const assignedCount = meds.filter(m => m.manufacturer_id === mf.manufacturer_id).length;
      return {
        cells: [
          `<b>${esc(mf.name)}</b>`,
          esc(mf.address),
          `<span class="tag neutral">${assignedCount} medicines</span>`,
          `<button class="btn sm ghost" data-edit-mfr="${mf.manufacturer_id}">Edit</button> ` +
          `<button class="btn sm del" data-del-mfr="${mf.manufacturer_id}">Delete</button>`
        ]
      };
    });

    $("#mfrTableWrap").innerHTML = table(["Manufacturer Name", "Address", "Linked Medicines", "Actions"], rows);
  }

  drawMfrTable();

  form.onsubmit = async e => {
    e.preventDefault();
    tracker.markSubmitted();
    if (!validateMfrForm()) return;
    const mId = form.manufacturer_id.value;
    const prevText = saveBtn.textContent;
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving...";

    try {
      if (mId) {
        await updateManufacturer(mId, { name: form.name.value, address: form.address.value });
        toast("Manufacturer updated.");
      } else {
        await addManufacturer({ name: form.name.value, address: form.address.value });
        toast("Manufacturer added.");
      }
      form.reset();
      form.manufacturer_id.value = "";
      tracker.reset();
      await vMedicines();
    } catch (err) {
      toast(err.message, true);
      saveBtn.disabled = false;
      saveBtn.textContent = prevText;
    }
  };

  $("#mfrTableWrap").onclick = async e => {
    const editId = e.target.dataset.editMfr;
    const delId = e.target.dataset.delMfr;
    if (editId) {
      const mf = mfrs.find(x => x.manufacturer_id === Number(editId));
      if (!mf) return;
      $("#mfrFormTitle").textContent = "Edit Manufacturer";
      form.manufacturer_id.value = mf.manufacturer_id;
      form.name.value = mf.name;
      form.address.value = mf.address;
      cancelBtn.style.display = "inline-flex";
      saveBtn.textContent = "Update Manufacturer";
      tracker.reset();
      validateMfrForm();
      form.scrollIntoView({ behavior: "smooth" });
    }
    if (delId) {
      if (confirm("Delete this manufacturer?")) {
        try {
          await deleteManufacturer(delId);
          toast("Manufacturer deleted.");
          await vMedicines();
        } catch (err) {
          toast(err.message, true);
        }
      }
    }
  };

  cancelBtn.onclick = () => {
    form.reset();
    form.manufacturer_id.value = "";
    $("#mfrFormTitle").textContent = "Add Manufacturer";
    cancelBtn.style.display = "none";
    saveBtn.textContent = "Save Manufacturer";
    tracker.reset();
    validateMfrForm();
  };
}

function renderCategoriesTab(cats, meds) {
  const container = $("#tabContent");
  container.innerHTML = `
    <div class="panel">
      <h2 id="catFormTitle">Add Category</h2>
      <form class="f" id="catForm">
        <input type="hidden" name="category_id">
        <div class="form-group">
          <label>Category Name <span class="req">*</span>
            <input name="category_name" placeholder="e.g. Analgesic" required>
          </label>
          <div class="field-error" id="err_cat_name"></div>
        </div>
        <div class="form-actions">
          <button type="submit" class="btn" id="catSaveBtn">Save Category</button>
          <button type="button" class="btn ghost" id="catCancelBtn" style="display:none">Cancel</button>
        </div>
      </form>
    </div>

    <div class="panel">
      <h2>Registered Categories</h2>
      <div id="catTableWrap"></div>
    </div>`;

  const form = $("#catForm");
  const saveBtn = $("#catSaveBtn");
  const cancelBtn = $("#catCancelBtn");
  const tracker = createFormTracker(form);

  function validateCatForm() {
    const vName = Validators.name(form.category_name.value, "Category name");
    tracker.showError("category_name", $("#err_cat_name"), form.category_name, vName.valid ? "" : vName.msg);
    saveBtn.disabled = !vName.valid;
    return vName.valid;
  }

  form.category_name.addEventListener("input", validateCatForm);
  validateCatForm();

  function drawCatTable() {
    const rows = cats.map(c => {
      const assignedCount = meds.filter(m => m.category_id === c.category_id).length;
      return {
        cells: [
          `<b>${esc(c.category_name)}</b>`,
          `<span class="tag neutral">${assignedCount} medicines</span>`,
          `<button class="btn sm ghost" data-edit-cat="${c.category_id}">Edit</button> ` +
          `<button class="btn sm del" data-del-cat="${c.category_id}">Delete</button>`
        ]
      };
    });

    $("#catTableWrap").innerHTML = table(["Category Name", "Linked Medicines", "Actions"], rows);
  }

  drawCatTable();

  form.onsubmit = async e => {
    e.preventDefault();
    tracker.markSubmitted();
    if (!validateCatForm()) return;
    const cId = form.category_id.value;
    const prevText = saveBtn.textContent;
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving...";

    try {
      if (cId) {
        await updateCategory(cId, { category_name: form.category_name.value });
        toast("Category updated.");
      } else {
        await addCategory({ category_name: form.category_name.value });
        toast("Category added.");
      }
      form.reset();
      form.category_id.value = "";
      tracker.reset();
      await vMedicines();
    } catch (err) {
      toast(err.message, true);
      saveBtn.disabled = false;
      saveBtn.textContent = prevText;
    }
  };

  $("#catTableWrap").onclick = async e => {
    const editId = e.target.dataset.editCat;
    const delId = e.target.dataset.delCat;
    if (editId) {
      const cat = cats.find(x => x.category_id === Number(editId));
      if (!cat) return;
      $("#catFormTitle").textContent = "Edit Category";
      form.category_id.value = cat.category_id;
      form.category_name.value = cat.category_name;
      cancelBtn.style.display = "inline-flex";
      saveBtn.textContent = "Update Category";
      tracker.reset();
      validateCatForm();
      form.scrollIntoView({ behavior: "smooth" });
    }
    if (delId) {
      if (confirm("Delete this category?")) {
        try {
          await deleteCategory(delId);
          toast("Category deleted.");
          await vMedicines();
        } catch (err) {
          toast(err.message, true);
        }
      }
    }
  };

  cancelBtn.onclick = () => {
    form.reset();
    form.category_id.value = "";
    $("#catFormTitle").textContent = "Add Category";
    cancelBtn.style.display = "none";
    saveBtn.textContent = "Save Category";
    tracker.reset();
    validateCatForm();
  };
}

/* ---------------------------------------------------------------------
   3. SCREEN: SUPPLIERS
   --------------------------------------------------------------------- */
async function vSuppliers() {
  const [sups, bats] = await Promise.all([getSuppliers(), getBatches()]);

  show(
    header("Suppliers", "Manage pharmaceutical vendors, distributors, and delivery agencies") +
    `<div class="panel">
      <h2 id="supFormTitle">Add New Supplier</h2>
      <form class="f" id="supForm">
        <input type="hidden" name="supplier_id">
        <div class="form-group">
          <label>Supplier Name <span class="req">*</span>
            <input name="supplier_name" placeholder="e.g. MediLink Distributors" required>
          </label>
          <div class="field-error" id="err_sup_name"></div>
        </div>
        <div class="form-group">
          <label>Phone Number <span class="req">*</span>
            <input name="phone" placeholder="10 digits (6-9...)" required>
          </label>
          <div class="field-error" id="err_sup_phone"></div>
        </div>
        <div class="form-group">
          <label>Address (5-100 characters) <span class="req">*</span>
            <input name="address" placeholder="e.g. 12 MG Road, Pune, 411001" required>
          </label>
          <div class="field-error" id="err_sup_addr"></div>
        </div>
        <div class="form-actions">
          <button type="submit" class="btn" id="supSaveBtn">Save Supplier</button>
          <button type="button" class="btn ghost" id="supCancelBtn" style="display:none">Cancel</button>
        </div>
      </form>
    </div>

    <div class="panel">
      <div class="panel-header">
        <h2>Registered Suppliers</h2>
      </div>
      <div class="filters">
        <input id="supSearch" placeholder="Search supplier name, phone, or address...">
      </div>
      <div id="supTableWrap"></div>
    </div>`
  );

  const form = $("#supForm");
  const saveBtn = $("#supSaveBtn");
  const cancelBtn = $("#supCancelBtn");
  const tracker = createFormTracker(form);
  attachPhoneMask(form.phone);

  function validateSupForm() {
    let valid = true;
    const vName = Validators.name(form.supplier_name.value, "Supplier name");
    tracker.showError("supplier_name", $("#err_sup_name"), form.supplier_name, vName.valid ? "" : vName.msg);
    if (!vName.valid) valid = false;

    const vPhone = Validators.phone(form.phone.value);
    tracker.showError("phone", $("#err_sup_phone"), form.phone, vPhone.valid ? "" : vPhone.msg);
    if (!vPhone.valid) valid = false;

    const vAddr = Validators.address(form.address.value);
    tracker.showError("address", $("#err_sup_addr"), form.address, vAddr.valid ? "" : vAddr.msg);
    if (!vAddr.valid) valid = false;

    saveBtn.disabled = !valid;
    return valid;
  }

  form.querySelectorAll("input").forEach(el => el.addEventListener("input", validateSupForm));
  validateSupForm();

  function drawSupTable() {
    const q = ($("#supSearch").value || "").toLowerCase().trim();
    const filtered = sups.filter(s =>
      s.supplier_name.toLowerCase().includes(q) ||
      s.phone.includes(q) ||
      s.address.toLowerCase().includes(q)
    );

    const rows = filtered.map(s => {
      const activeCount = bats.filter(b => b.supplier_id === s.supplier_id).length;
      return {
        cells: [
          `<b>${esc(s.supplier_name)}</b>`,
          `<span class="code">${esc(s.phone)}</span>`,
          esc(s.address),
          `<span class="tag neutral">${activeCount} batches</span>`,
          `<button class="btn sm ghost" data-edit-sup="${s.supplier_id}">Edit</button> ` +
          `<button class="btn sm del" data-del-sup="${s.supplier_id}">Delete</button>`
        ]
      };
    });

    $("#supTableWrap").innerHTML = table(["Supplier Name", "Phone", "Address", "Stocked Batches", "Actions"], rows);
  }

  drawSupTable();
  $("#supSearch").oninput = drawSupTable;

  form.onsubmit = async e => {
    e.preventDefault();
    tracker.markSubmitted();
    if (!validateSupForm()) return;
    const sId = form.supplier_id.value;
    const prevText = saveBtn.textContent;
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving...";

    try {
      if (sId) {
        await updateSupplier(sId, {
          supplier_name: form.supplier_name.value,
          phone: form.phone.value,
          address: form.address.value
        });
        toast("Supplier updated.");
      } else {
        await addSupplier({
          supplier_name: form.supplier_name.value,
          phone: form.phone.value,
          address: form.address.value
        });
        toast("Supplier added.");
      }
      form.reset();
      form.supplier_id.value = "";
      tracker.reset();
      await vSuppliers();
    } catch (err) {
      toast(err.message, true);
      saveBtn.disabled = false;
      saveBtn.textContent = prevText;
    }
  };

  $("#supTableWrap").onclick = async e => {
    const editId = e.target.dataset.editSup;
    const delId = e.target.dataset.delSup;
    if (editId) {
      const s = sups.find(x => x.supplier_id === Number(editId));
      if (!s) return;
      $("#supFormTitle").textContent = "Edit Supplier";
      form.supplier_id.value = s.supplier_id;
      form.supplier_name.value = s.supplier_name || s.name;
      form.phone.value = s.phone;
      form.address.value = s.address;
      cancelBtn.style.display = "inline-flex";
      saveBtn.textContent = "Update Supplier";
      tracker.reset();
      validateSupForm();
      form.scrollIntoView({ behavior: "smooth" });
    }
    if (delId) {
      if (confirm("Delete this supplier?")) {
        try {
          await deleteSupplier(delId);
          toast("Supplier deleted.");
          await vSuppliers();
        } catch (err) {
          toast(err.message, true);
        }
      }
    }
  };

  cancelBtn.onclick = () => {
    form.reset();
    form.supplier_id.value = "";
    $("#supFormTitle").textContent = "Add New Supplier";
    cancelBtn.style.display = "none";
    saveBtn.textContent = "Save Supplier";
    tracker.reset();
    validateSupForm();
  };
}

/* ---------------------------------------------------------------------
   4. SCREEN: CUSTOMERS
   --------------------------------------------------------------------- */
async function vCustomers() {
  const [custs, summary] = await Promise.all([getCustomers(), getCustomerSalesSummary()]);

  show(
    header("Customers", "Patient and buyer registry for medicine dispensing") +
    `<div class="panel">
      <h2 id="custFormTitle">Add New Customer</h2>
      <form class="f" id="custForm">
        <input type="hidden" name="customer_id">
        <div class="form-group">
          <label>Customer / Patient Name <span class="req">*</span>
            <input name="customer_name" placeholder="e.g. Ramesh Patil" required>
          </label>
          <div class="field-error" id="err_cust_name"></div>
        </div>
        <div class="form-group">
          <label>Phone Number <span class="req">*</span>
            <input name="phone" placeholder="10 digits (6-9...)" required>
          </label>
          <div class="field-error" id="err_cust_phone"></div>
        </div>
        <div class="form-group">
          <label>Email <span class="note">(optional, must be unique)</span>
            <input name="email" type="text" placeholder="e.g. name@example.com" autocomplete="off">
          </label>
          <div class="field-error" id="err_cust_email"></div>
        </div>
        <div class="form-actions">
          <button type="submit" class="btn" id="custSaveBtn">Save Customer</button>
          <button type="button" class="btn ghost" id="custCancelBtn" style="display:none">Cancel</button>
        </div>
      </form>
    </div>

    <div class="panel">
      <div class="panel-header">
        <h2>Customer Registry</h2>
      </div>
      <div class="filters">
        <input id="custSearch" placeholder="Search customer name, phone or email...">
      </div>
      <div id="custTableWrap"></div>
    </div>`
  );

  const form = $("#custForm");
  const saveBtn = $("#custSaveBtn");
  const cancelBtn = $("#custCancelBtn");
  const tracker = createFormTracker(form);
  attachPhoneMask(form.phone);

  function validateCustForm() {
    let valid = true;
    const vName = Validators.name(form.customer_name.value, "Customer name");
    tracker.showError("customer_name", $("#err_cust_name"), form.customer_name, vName.valid ? "" : vName.msg);
    if (!vName.valid) valid = false;

    const vPhone = Validators.phone(form.phone.value);
    tracker.showError("phone", $("#err_cust_phone"), form.phone, vPhone.valid ? "" : vPhone.msg);
    if (!vPhone.valid) valid = false;

    const vEmail = Validators.email(form.email.value);
    let emailErr = vEmail.valid ? "" : vEmail.msg;
    if (vEmail.valid && vEmail.value) {
      const editingId = Number(form.customer_id.value) || 0;
      const dupEmail = custs.some(c => c.customer_id !== editingId && (c.email || "").toLowerCase() === vEmail.value.toLowerCase());
      if (dupEmail) emailErr = "This email is already registered to another customer.";
    }
    tracker.showError("email", $("#err_cust_email"), form.email, emailErr);
    if (emailErr) valid = false;

    saveBtn.disabled = !valid;
    return valid;
  }

  form.querySelectorAll("input").forEach(el => el.addEventListener("input", validateCustForm));
  validateCustForm();

  function drawCustTable() {
    const q = ($("#custSearch").value || "").toLowerCase().trim();
    const filtered = custs.filter(c =>
      c.customer_name.toLowerCase().includes(q) ||
      c.phone.includes(q) ||
      (c.email || "").toLowerCase().includes(q)
    );

    const rows = filtered.map(c => {
      const stats = summary.get(c.customer_id) || { orderCount: 0, totalSpend: 0 };

      return {
        cells: [
          `<b>${esc(c.customer_name)}</b>`,
          `<span class="code">${esc(c.phone)}</span>`,
          c.email ? esc(c.email) : `<span class="note">&mdash;</span>`,
          `<span class="tag neutral">${stats.orderCount} orders</span>`,
          `₹${money(stats.totalSpend)}`,
          `<button class="btn sm ghost" data-edit-cust="${c.customer_id}">Edit</button> ` +
          `<button class="btn sm del" data-del-cust="${c.customer_id}">Delete</button>`
        ]
      };
    });

    $("#custTableWrap").innerHTML = table(["Customer Name", "Phone", "Email", "Orders Dispensed", "Total Spend", "Actions"], rows);
  }

  drawCustTable();
  $("#custSearch").oninput = drawCustTable;

  form.onsubmit = async e => {
    e.preventDefault();
    tracker.markSubmitted();
    if (!validateCustForm()) return;
    const cId = form.customer_id.value;
    const prevText = saveBtn.textContent;
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving...";

    try {
      if (cId) {
        await updateCustomer(cId, {
          customer_name: form.customer_name.value,
          phone: form.phone.value,
          email: form.email.value
        });
        toast("Customer updated.");
      } else {
        await addCustomer({
          customer_name: form.customer_name.value,
          phone: form.phone.value,
          email: form.email.value
        });
        toast("Customer registered.");
      }
      form.reset();
      form.customer_id.value = "";
      tracker.reset();
      await vCustomers();
    } catch (err) {
      toast(err.message, true);
      saveBtn.disabled = false;
      saveBtn.textContent = prevText;
    }
  };

  $("#custTableWrap").onclick = async e => {
    const editId = e.target.dataset.editCust;
    const delId = e.target.dataset.delCust;
    if (editId) {
      const c = custs.find(x => x.customer_id === Number(editId));
      if (!c) return;
      $("#custFormTitle").textContent = "Edit Customer";
      form.customer_id.value = c.customer_id;
      form.customer_name.value = c.customer_name || c.name;
      form.phone.value = c.phone;
      form.email.value = c.email || "";
      cancelBtn.style.display = "inline-flex";
      saveBtn.textContent = "Update Customer";
      tracker.reset();
      validateCustForm();
      form.scrollIntoView({ behavior: "smooth" });
    }
    if (delId) {
      if (confirm("Delete this customer?")) {
        try {
          await deleteCustomer(delId);
          toast("Customer deleted.");
          await vCustomers();
        } catch (err) {
          toast(err.message, true);
        }
      }
    }
  };

  cancelBtn.onclick = () => {
    form.reset();
    form.customer_id.value = "";
    $("#custFormTitle").textContent = "Add New Customer";
    cancelBtn.style.display = "none";
    saveBtn.textContent = "Save Customer";
    tracker.reset();
    validateCustForm();
  };
}

/* ---------------------------------------------------------------------
   5. SCREEN: STOCK-IN
   --------------------------------------------------------------------- */
async function vStockIn() {
  const [meds, sups, bats] = await Promise.all([getMedicines(), getSuppliers(), getBatches()]);

  const medMap = new Map(meds.map(m => [m.medicine_id, m.medicine_name]));
  const supMap = new Map(sups.map(s => [s.supplier_id, s.supplier_name]));

  show(
    header("Stock-in (Purchase Entry)", "Record newly received medicine batches into inventory") +
    `<div class="warn-box">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M3.6 15h16.8L12 3z"/></svg>
      <span><strong>Inward Acceptance Policy:</strong> Entries that are already expired or expire within <strong>30 days</strong> are strictly rejected. MRP must be &ge; Purchase Price. Dates must be in mm/dd/yy.</span>
    </div>

    <div class="panel">
      <h2>Inward Batch Entry Form</h2>
      <form class="f" id="stockInForm" autocomplete="off">
        <div class="form-group">
          <label>Medicine <span class="req">*</span>
            <select name="medicine_id" required>
              <option value="">-- Select Medicine --</option>
              ${options(meds, "medicine_id", m => `${m.medicine_name} [${m.unit}]`)}
            </select>
          </label>
          <div class="field-error" id="err_stk_med"></div>
        </div>

        <div class="form-group">
          <label>Supplier <span class="req">*</span>
            <select name="supplier_id" required>
              <option value="">-- Select Supplier --</option>
              ${options(sups, "supplier_id", s => s.supplier_name)}
            </select>
          </label>
          <div class="field-error" id="err_stk_sup"></div>
        </div>

        <div class="form-group">
          <label>Batch Number <span class="req">*</span>
            <input name="batch_no" placeholder="e.g. B2305" required>
          </label>
          <div class="field-error" id="err_stk_batch"></div>
        </div>

        <div class="form-group">
          <label>Manufacture Date <span class="req">*</span>
            <input name="mfg_date" placeholder="mm/dd/yy" required>
          </label>
          <div class="field-error" id="err_stk_mfg"></div>
        </div>

        <div class="form-group">
          <label>Expiry Date <span class="req">*</span>
            <input name="expiry_date" placeholder="mm/dd/yy" required>
          </label>
          <div class="field-error" id="err_stk_exp"></div>
        </div>

        <div class="form-group">
          <label>Purchase Date <span class="req">*</span>
            <input name="purchase_date" placeholder="mm/dd/yy" required>
          </label>
          <div class="field-error" id="err_stk_pur"></div>
        </div>

        <div class="form-group">
          <label>Purchase Price (Cost) <span class="req">*</span>
            <input name="purchase_price" type="number" step="0.01" min="0" placeholder="e.g. 19.60" required>
          </label>
          <div class="field-error" id="err_stk_cost"></div>
        </div>

        <div class="form-group">
          <label>MRP (Sale Price) <span class="req">*</span>
            <input name="mrp" type="number" step="0.01" min="0" placeholder="e.g. 28.00" required>
          </label>
          <div class="field-error" id="err_stk_mrp"></div>
        </div>

        <div class="form-group">
          <label>Quantity Received <span class="req">*</span>
            <input name="quantity" type="number" min="1" step="1" placeholder="e.g. 100" required>
          </label>
          <div class="field-error" id="err_stk_qty"></div>
        </div>

        <div class="form-actions">
          <button type="submit" class="btn" id="stockInBtn">Accept &amp; Save Batch</button>
        </div>
      </form>
    </div>

    <div class="panel">
      <h2>Recent Inward Stock-in Entries</h2>
      <div id="recentStockInWrap"></div>
    </div>`
  );

  const form = $("#stockInForm");
  const saveBtn = $("#stockInBtn");
  const tracker = createFormTracker(form);

  // Attach masks
  attachDateInputMask(form.mfg_date);
  attachDateInputMask(form.expiry_date);
  attachDateInputMask(form.purchase_date);

  // Default purchase date to today
  form.purchase_date.value = formatDisplayDate(getTodayIso());

  // Automatically update MRP field with selected medicine's unit_price
  form.medicine_id.addEventListener("change", () => {
    const selMed = meds.find(m => m.medicine_id === Number(form.medicine_id.value));
    if (selMed) {
      form.mrp.value = selMed.unit_price.toFixed(2);
      if (!form.purchase_price.value) {
        form.purchase_price.value = (selMed.unit_price * 0.7).toFixed(2);
      }
    }
    validateStockInForm();
  });

  function validateStockInForm() {
    let valid = true;

    // Medicine
    const medOk = Boolean(form.medicine_id.value);
    tracker.showError("medicine_id", $("#err_stk_med"), form.medicine_id, medOk ? "" : "Select a medicine.");
    if (!medOk) valid = false;

    // Supplier
    const supOk = Boolean(form.supplier_id.value);
    tracker.showError("supplier_id", $("#err_stk_sup"), form.supplier_id, supOk ? "" : "Select a supplier.");
    if (!supOk) valid = false;

    // Batch No
    const vBatch = Validators.batchNo(form.batch_no.value);
    let batchErr = vBatch.valid ? "" : vBatch.msg;
    if (vBatch.valid && medOk) {
      const isDup = bats.some(b =>
        b.medicine_id === Number(form.medicine_id.value) &&
        b.batch_no.toLowerCase() === form.batch_no.value.trim().toLowerCase()
      );
      if (isDup) batchErr = "This batch number already exists for this medicine.";
    }
    tracker.showError("batch_no", $("#err_stk_batch"), form.batch_no, batchErr);
    if (batchErr) valid = false;

    // Dates
    const todayIso = getTodayIso();
    const pMfg = parseDateInput(form.mfg_date.value);
    let mfgErr = pMfg.valid ? "" : pMfg.msg;
    if (pMfg.valid && pMfg.iso > todayIso) mfgErr = "Manufacture date cannot be in the future.";
    tracker.showError("mfg_date", $("#err_stk_mfg"), form.mfg_date, mfgErr);
    if (mfgErr) valid = false;

    const pPur = parseDateInput(form.purchase_date.value);
    let purErr = pPur.valid ? "" : pPur.msg;
    if (pPur.valid && pPur.iso > todayIso) purErr = "Purchase date cannot be in the future.";
    else if (pPur.valid && pMfg.valid && pPur.iso < pMfg.iso) purErr = "Purchase date cannot be before the manufacture date.";
    tracker.showError("purchase_date", $("#err_stk_pur"), form.purchase_date, purErr);
    if (purErr) valid = false;

    const pExp = parseDateInput(form.expiry_date.value);
    let expErr = pExp.valid ? "" : pExp.msg;
    if (pExp.valid) {
      if (pMfg.valid && pExp.iso <= pMfg.iso) {
        expErr = "Expiry must be strictly after manufacture date.";
      } else {
        const d = daysLeft(pExp.iso);
        if (d < 0) {
          expErr = "Rejected: Batch is already expired.";
        } else if (d <= CONFIG.MIN_DAYS_TO_ACCEPT) {
          expErr = `Rejected: Expires in ${d} days (Min ${CONFIG.MIN_DAYS_TO_ACCEPT} days required).`;
        }
      }
    }
    tracker.showError("expiry_date", $("#err_stk_exp"), form.expiry_date, expErr);
    if (expErr) valid = false;

    // Price
    const vCost = Validators.price(form.purchase_price.value, 0, "Purchase price");
    tracker.showError("purchase_price", $("#err_stk_cost"), form.purchase_price, vCost.valid ? "" : vCost.msg);
    if (!vCost.valid) valid = false;

    const vMrp = Validators.price(form.mrp.value, vCost.valid ? vCost.value : 0, "MRP");
    tracker.showError("mrp", $("#err_stk_mrp"), form.mrp, vMrp.valid ? "" : vMrp.msg);
    if (!vMrp.valid) valid = false;

    // Qty
    const vQty = Validators.integer(form.quantity.value, 1, "Quantity");
    tracker.showError("quantity", $("#err_stk_qty"), form.quantity, vQty.valid ? "" : vQty.msg);
    if (!vQty.valid) valid = false;

    saveBtn.disabled = !valid;
    return valid;
  }

  form.querySelectorAll("input, select").forEach(el => {
    el.addEventListener("input", validateStockInForm);
    el.addEventListener("change", validateStockInForm);
  });
  validateStockInForm();

  // Render recent 10 stock-in entries
  const recent = bats.slice().sort((a, b) => b.batch_id - a.batch_id).slice(0, 10);
  $("#recentStockInWrap").innerHTML = table(
    ["Medicine", "Batch No", "Supplier", "Mfg Date", "Expiry Date", "Cost", "MRP", "In Stock", "Status"],
    recent.map(b => ({
      cls: statusOf(b).badgeClass === "expired" ? "expired" : "",
      cells: [
        `<b>${esc(medMap.get(b.medicine_id) || "N/A")}</b>`,
        `<span class="code">${esc(b.batch_no)}</span>`,
        esc(supMap.get(b.supplier_id) || "N/A"),
        formatDisplayDate(b.mfg_date),
        formatDisplayDate(b.expiry_date),
        `₹${money(b.purchase_price)}`,
        `₹${money(b.mrp)}`,
        `<b>${b.quantity}</b>`,
        tag(b)
      ]
    }))
  );

  form.onsubmit = async e => {
    e.preventDefault();
    tracker.markSubmitted();
    if (!validateStockInForm()) return;
    try {
      await addBatch({
        medicine_id: form.medicine_id.value,
        supplier_id: form.supplier_id.value,
        batch_no: form.batch_no.value,
        mfg_date: form.mfg_date.value,
        expiry_date: form.expiry_date.value,
        purchase_date: form.purchase_date.value,
        purchase_price: form.purchase_price.value,
        mrp: form.mrp.value,
        quantity: form.quantity.value
      });
      toast("Batch successfully accepted and stocked in.");
      await vStockIn();
    } catch (err) {
      toast(err.message, true);
    }
  };
}

/* ---------------------------------------------------------------------
   6. SCREEN: DISPENSE (FEFO)
   --------------------------------------------------------------------- */
async function vDispense() {
  let [meds, bats, custs, users] = await Promise.all([
    getMedicines(), getBatches(), getCustomers(), getUsers()
  ]);

  const activeUser = users.find(u => u.user_id === currentLoggedInUserId) || users[0];

  show(
    header("Dispense Medicine", "FEFO Automated Dispensing: Earliest expiry batch is consumed first; expired stock is strictly quarantined") +
    `<div class="panel">
      <h2>Dispense Order Details</h2>
      <p class="note">Logged-in dispensing operator: <strong>${esc(activeUser.user_name)} (${esc(activeUser.role)})</strong></p>

      <!-- Quick Add Customer Box (toggleable) -->
      <div id="quickCustomerWrap" style="display:none">
        <div class="quick-add-box">
          <h3>Register New Customer</h3>
          <form class="f" id="quickCustForm">
            <div class="form-group">
              <label>Full Name <span class="req">*</span>
                <input name="qc_name" placeholder="Customer name" required>
              </label>
              <div class="field-error" id="err_qc_name"></div>
            </div>
            <div class="form-group">
              <label>Phone Number <span class="req">*</span>
                <input name="qc_phone" placeholder="10 digits" required>
              </label>
              <div class="field-error" id="err_qc_phone"></div>
            </div>
            <div class="form-group">
              <label>Email <span class="note">(optional)</span>
                <input name="qc_email" type="text" placeholder="name@example.com" autocomplete="off">
              </label>
              <div class="field-error" id="err_qc_email"></div>
            </div>
            <div class="form-actions">
              <button type="submit" class="btn sm" id="qcSaveBtn">Save &amp; Select</button>
              <button type="button" class="btn sm ghost" id="qcCancelBtn">Cancel</button>
            </div>
          </form>
        </div>
      </div>

      <form class="f" id="dispenseForm">
        <div class="form-group">
          <label>Customer <span class="req">*</span>
            <div style="display:flex;gap:8px;">
              <select name="customer_id" id="dispCustomerSelect" required style="flex:1">
                <option value="">-- Select Customer --</option>
                ${options(custs, "customer_id", c => `${c.customer_name} (${c.phone})`)}
              </select>
              <button type="button" class="btn sm secondary" id="toggleQuickCustBtn" title="Register new customer">+ New</button>
            </div>
          </label>
          <div class="field-error" id="err_dsp_cust"></div>
        </div>

        <div class="form-group">
          <label>Medicine to Dispense <span class="req">*</span>
            <select name="medicine_id" id="dispMedSelect" required>
              <option value="">-- Select Medicine --</option>
              ${meds.map(m => {
                const u = usableStock(m.medicine_id, bats);
                return `<option value="${m.medicine_id}">${esc(m.medicine_name)} (Usable Unexpired: ${u} ${esc(m.unit)}s)</option>`;
              }).join("")}
            </select>
          </label>
          <div class="field-error" id="err_dsp_med"></div>
        </div>

        <div class="form-group">
          <label>Quantity to Sell <span class="req">*</span>
            <input name="quantity" id="dispQtyInput" type="number" min="1" step="1" placeholder="Enter units" required>
          </label>
          <div class="field-error" id="err_dsp_qty"></div>
        </div>

        <div class="form-actions">
          <button type="submit" class="btn" id="dispenseSubmitBtn">Dispense via FEFO</button>
        </div>
      </form>

      <!-- FEFO Allocation Preview -->
      <div id="fefoPreview" style="margin-top:16px;"></div>

      <!-- Dispense Result Summary -->
      <div id="dispenseResultWrap"></div>
    </div>`
  );

  const form = $("#dispenseForm");
  const saveBtn = $("#dispenseSubmitBtn");
  const medSelect = $("#dispMedSelect");
  const qtyInput = $("#dispQtyInput");
  const custSelect = $("#dispCustomerSelect");
  const previewWrap = $("#fefoPreview");
  const resultWrap = $("#dispenseResultWrap");
  const tracker = createFormTracker(form);

  // Quick customer toggle & form
  const qcWrap = $("#quickCustomerWrap");
  const qcToggle = $("#toggleQuickCustBtn");
  const qcForm = $("#quickCustForm");
  const qcCancel = $("#qcCancelBtn");
  attachPhoneMask(qcForm.qc_phone);

  qcToggle.onclick = () => {
    qcWrap.style.display = qcWrap.style.display === "none" ? "block" : "none";
  };
  qcCancel.onclick = () => {
    qcWrap.style.display = "none";
  };

  qcForm.onsubmit = async e => {
    e.preventDefault();
    const vName = Validators.name(qcForm.qc_name.value, "Customer name");
    $("#err_qc_name").textContent = vName.valid ? "" : vName.msg;
    const vPhone = Validators.phone(qcForm.qc_phone.value);
    $("#err_qc_phone").textContent = vPhone.valid ? "" : vPhone.msg;
    const vEmail = Validators.email(qcForm.qc_email.value);
    $("#err_qc_email").textContent = vEmail.valid ? "" : vEmail.msg;
    if (!vName.valid || !vPhone.valid || !vEmail.valid) return;

    try {
      const newCust = await addCustomer({
        customer_name: qcForm.qc_name.value,
        phone: qcForm.qc_phone.value,
        email: qcForm.qc_email.value
      });
      toast("Customer registered.");
      qcWrap.style.display = "none";
      qcForm.reset();

      // Refresh dropdown and select new customer
      const freshCusts = await getCustomers();
      custSelect.innerHTML = `<option value="">-- Select Customer --</option>` +
        options(freshCusts, "customer_id", c => `${c.customer_name} (${c.phone})`, newCust.customer_id);
      validateDispenseForm();
    } catch (err) {
      toast(err.message, true);
    }
  };

  // Live FEFO Preview & Form Validation
  function validateDispenseForm() {
    let valid = true;
    previewWrap.innerHTML = "";

    const custOk = Boolean(custSelect.value);
    tracker.showError("customer_id", $("#err_dsp_cust"), custSelect, custOk ? "" : "Select a customer.");
    if (!custOk) valid = false;

    const medId = Number(medSelect.value);
    const medOk = Boolean(medId);
    tracker.showError("medicine_id", $("#err_dsp_med"), medSelect, medOk ? "" : "Select a medicine.");
    if (!medOk) valid = false;

    const vQty = Validators.integer(qtyInput.value, 1, "Quantity");
    let qtyErr = vQty.valid ? "" : vQty.msg;

    if (medOk) {
      const usable = usableStock(medId, bats);
      if (usable === 0) {
        qtyErr = "Cannot dispense: All existing stock for this medicine is expired and quarantined!";
      } else if (vQty.valid && vQty.value > usable) {
        qtyErr = `Insufficient unexpired stock. Available: ${usable}`;
      } else if (vQty.valid) {
        // Build FEFO allocation preview
        const usableSorted = bats
          .filter(b => b.medicine_id === medId && daysLeft(b.expiry_date) >= 0 && b.quantity > 0)
          .sort((a, b) => (a.expiry_date < b.expiry_date ? -1 : 1));

        let rem = vQty.value;
        const lines = [];
        let estTotal = 0;
        for (const b of usableSorted) {
          if (rem <= 0) break;
          const take = Math.min(b.quantity, rem);
          rem -= take;
          estTotal += take * b.mrp;
          lines.push(`<strong>Batch ${esc(b.batch_no)}</strong> (Exp: ${formatDisplayDate(b.expiry_date)}): <strong>${take}</strong> units @ ₹${money(b.mrp)}`);
        }

        previewWrap.innerHTML = `
          <div class="result" style="padding:14px;border-color:var(--cyan)">
            <h4 style="margin:0 0 8px;font-size:13px;color:var(--cyan)">FEFO Allocation Strategy (Automatic):</h4>
            <ul style="margin:0;padding-left:18px;font-size:12.5px;color:var(--tx-main)">
              ${lines.map(l => `<li>${l}</li>`).join("")}
            </ul>
            <div style="margin-top:8px;font-weight:700;color:var(--primary)">Estimated Total: ₹${money(estTotal)}</div>
          </div>`;
      }
    }

    tracker.showError("quantity", $("#err_dsp_qty"), qtyInput, qtyErr);
    if (qtyErr) valid = false;

    saveBtn.disabled = !valid;
    return valid;
  }

  custSelect.onchange = validateDispenseForm;
  medSelect.onchange = validateDispenseForm;
  qtyInput.oninput = validateDispenseForm;
  validateDispenseForm();

  form.onsubmit = async e => {
    e.preventDefault();
    tracker.markSubmitted();
    if (!validateDispenseForm()) return;
    resultWrap.innerHTML = "";

    try {
      const res = await dispenseMedicine(
        medSelect.value,
        qtyInput.value,
        $("#dispCustomerSelect").value,
        currentLoggedInUserId
      );

      toast("Order dispensed successfully!");

      // Show receipt card
      resultWrap.innerHTML = `
        <div class="result">
          <div class="result-header">
            <div>
              <span class="result-title">&#9989; Dispense Successful: ${esc(res.medicine_name)}</span>
              <div class="result-customer">Customer: <b>${esc(res.customer_name)}</b> &bull; Dispensed By: <b>${esc(res.user_name)} (${esc(res.user_role)})</b></div>
            </div>
            <span class="tag ok">FEFO Compliant</span>
          </div>

          <h4 style="margin:0 0 8px;font-size:13px;">Allocated Batch Breakdown:</h4>
          ${table(
            ["Batch No", "Expiry Date", "Units Sold", "Unit Price", "Subtotal"],
            res.used.map(u => ({
              cells: [
                `<span class="code">${esc(u.batch_no)}</span>`,
                formatDisplayDate(u.expiry_date),
                `<b>${u.quantity}</b>`,
                `₹${money(u.unit_price)}`,
                `<b>₹${money(u.subtotal)}</b>`
              ]
            }))
          )}

          <div class="result-summary">
            <span class="result-total">Grand Total: ₹${money(res.total)}</span>
            <span class="result-stock-left">Remaining Unexpired Stock: <b>${res.remainingStock}</b></span>
          </div>

          ${res.isLow ? `
            <div class="warn-box">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M3.6 15h16.8L12 3z"/></svg>
              <span><strong>Warning: Low-Stock Threshold Reached!</strong> Usable stock (${res.remainingStock}) is now at or below minimum reorder level (${res.min_stock_level}). Please initiate Stock-in.</span>
            </div>` : ""}
        </div>`;

      // Refresh batches in local view
      const freshBatches = await getBatches();
      bats = freshBatches; // keep preview & stock check in sync after a sale
      const currentMedId = medSelect.value;
      medSelect.innerHTML = `<option value="">-- Select Medicine --</option>` +
        meds.map(m => {
          const u = usableStock(m.medicine_id, freshBatches);
          return `<option value="${m.medicine_id}"${m.medicine_id === Number(currentMedId) ? " selected" : ""}>${esc(m.medicine_name)} (Usable Unexpired: ${u} ${esc(m.unit)}s)</option>`;
        }).join("");

      qtyInput.value = "";
      validateDispenseForm();
      resultWrap.scrollIntoView({ behavior: "smooth" });
    } catch (err) {
      toast(err.message, true);
    }
  };
}

/* ---------------------------------------------------------------------
   7. SCREEN: BATCHES
   --------------------------------------------------------------------- */
async function vBatches() {
  const [meds, sups, bats] = await Promise.all([getMedicines(), getSuppliers(), getBatches()]);

  const medMap = new Map(meds.map(m => [m.medicine_id, m.medicine_name]));
  const supMap = new Map(sups.map(s => [s.supplier_id, s.supplier_name]));

  show(
    header("Batch Inventory", "Comprehensive inventory registry with expiry tracking and quarantine status") +
    `<div class="panel">
      <div class="filters">
        <input id="batchSearch" placeholder="Search batch number or medicine...">
        <select id="batchStatFilter">
          <option value="">All Statuses</option>
          <option value="expired">Expired (Quarantined)</option>
          <option value="near">Expiring Soon (&le; 90d)</option>
          <option value="ok">Healthy Shelf-Life</option>
        </select>
        <select id="batchMedFilter">
          <option value="">All Medicines</option>
          ${options(meds, "medicine_id", m => m.medicine_name)}
        </select>
        <select id="batchSupFilter">
          <option value="">All Suppliers</option>
          ${options(sups, "supplier_id", s => s.supplier_name)}
        </select>
      </div>

      <div id="batchesTableWrap"></div>
    </div>`
  );

  function drawBatchesTable() {
    const q = ($("#batchSearch").value || "").toLowerCase().trim();
    const statF = $("#batchStatFilter").value;
    const medF = $("#batchMedFilter").value;
    const supF = $("#batchSupFilter").value;

    const filtered = bats
      .filter(b => {
        const mName = (medMap.get(b.medicine_id) || "").toLowerCase();
        const matchQ = b.batch_no.toLowerCase().includes(q) || mName.includes(q);
        const st = statusOf(b);
        const matchStat = !statF || st.key === statF;
        const matchMed = !medF || String(b.medicine_id) === String(medF);
        const matchSup = !supF || String(b.supplier_id) === String(supF);
        return matchQ && matchStat && matchMed && matchSup;
      })
      .sort((a, b) => (a.expiry_date < b.expiry_date ? -1 : 1));

    const rows = filtered.map(b => {
      const st = statusOf(b);
      const isExp = st.key === "expired";
      return {
        cls: isExp ? "expired" : "",
        cells: [
          `<b>${esc(medMap.get(b.medicine_id) || "N/A")}</b>`,
          `<span class="code">${esc(b.batch_no)}</span>`,
          esc(supMap.get(b.supplier_id) || "N/A"),
          formatDisplayDate(b.mfg_date),
          formatDisplayDate(b.expiry_date),
          formatDisplayDate(b.purchase_date),
          `₹${money(b.purchase_price)}`,
          `₹${money(b.mrp)}`,
          `<b>${b.quantity}</b>`,
          isExp ?
            `<span class="tag expired">&#9888; Quarantined (${Math.abs(st.daysLeft)}d ago)</span>` :
            tag(b)
        ]
      };
    });

    $("#batchesTableWrap").innerHTML = table(
      ["Medicine", "Batch No", "Supplier", "Mfg Date", "Expiry Date", "Purchase Date", "Cost", "MRP", "Qty", "Inventory Status"],
      rows
    );
  }

  drawBatchesTable();
  $("#batchSearch").oninput = drawBatchesTable;
  ["#batchStatFilter", "#batchMedFilter", "#batchSupFilter"].forEach(id => {
    $(id).onchange = drawBatchesTable;
  });
}

/* ---------------------------------------------------------------------
   8. SCREEN: ALERTS
   --------------------------------------------------------------------- */
async function vAlerts() {
  const [alerts, bats, meds] = await Promise.all([getAlerts(), getBatches(), getMedicines()]);

  const batchMap = new Map(bats.map(b => [b.batch_id, b]));
  const medMap = new Map(meds.map(m => [m.medicine_id, m.medicine_name]));

  show(
    header(
      "Inventory Alerts & Expiry Warnings",
      "Real-time notifications for expired batches, impending shelf-life expiry, and low stock",
      `<button class="btn accent-cyan" id="genAlertsBtn">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>
        Generate Alerts
      </button>`
    ) +
    `<div class="panel">
      <div class="filters">
        <select id="alertTypeFilter">
          <option value="">All Alert Types</option>
          <option value="EXPIRING_SOON">Expiring Soon</option>
          <option value="EXPIRED">Expired</option>
          <option value="LOW_STOCK">Low Stock</option>
          <option value="OUT_OF_STOCK">Out of Stock</option>
        </select>
        <select id="alertStatusFilter">
          <option value="">All Statuses</option>
          <option value="OPEN">Open</option>
          <option value="RESOLVED">Resolved</option>
        </select>
      </div>

      <div id="alertsTableWrap"></div>
    </div>`
  );

  // Generate Alerts Click Handler
  $("#genAlertsBtn").onclick = async () => {
    try {
      const count = await generateAlerts();
      if (count > 0) {
        toast(`Scan complete: ${count} new alert(s) generated.`);
      } else {
        toast("All alert records are already up to date.");
      }
      await vAlerts();
    } catch (err) {
      toast(err.message, true);
    }
  };

  function drawAlertsTable() {
    const typeF = $("#alertTypeFilter").value;
    const statF = $("#alertStatusFilter").value;

    const filtered = alerts
      .slice()
      .reverse()
      .filter(a => {
        const matchType = !typeF || a.alert_type === typeF;
        const normStatus = (a.status || "").toUpperCase();
        const normFilter = (statF || "").toUpperCase();
        const matchStat = !normFilter || normStatus === normFilter;
        return matchType && matchStat;
      });

    const rows = filtered.map(a => {
      const b = batchMap.get(a.batch_id);
      const mName = a.medicine_name || (b ? medMap.get(b.medicine_id) : (a.medicine_id ? medMap.get(a.medicine_id) : "General Stock"));
      const bNo = a.batch_no || (b ? b.batch_no : "N/A");

      let typeBadge = "";
      if (a.alert_type === "EXPIRED") typeBadge = '<span class="tag expired">EXPIRED</span>';
      else if (a.alert_type === "EXPIRING_SOON") typeBadge = '<span class="tag near">EXPIRING SOON</span>';
      else if (a.alert_type === "LOW_STOCK") typeBadge = '<span class="tag near">LOW STOCK</span>';
      else typeBadge = '<span class="tag expired">OUT OF STOCK</span>';

      const normStatus = (a.status || "").toUpperCase();
      let statusBadge = "";
      if (normStatus === "OPEN") {
        statusBadge = '<span class="tag expired">Open</span>';
      } else if (normStatus === "ACKNOWLEDGED") {
        statusBadge = '<span class="tag near">Acknowledged</span>';
      } else {
        statusBadge = '<span class="tag ok">Resolved</span>';
      }

      const actions = [];
      if (normStatus === "OPEN" || normStatus === "ACKNOWLEDGED") {
        actions.push(`<button class="btn sm ghost" data-res-alert="${a.alert_id}">Resolve</button>`);
      } else {
        actions.push('<span class="tag neutral">Resolved</span>');
      }

      return {
        cells: [
          `#${a.alert_id}`,
          typeBadge,
          `<b>${esc(mName)}</b> <span class="code">${esc(bNo)}</span>`,
          formatDisplayDate(a.alert_date),
          b ? formatDisplayDate(b.expiry_date) : "N/A",
          statusBadge,
          actions.join(" ")
        ]
      };
    });

    $("#alertsTableWrap").innerHTML = table(
      ["Alert ID", "Type", "Medicine & Batch", "Raised Date", "Batch Expiry", "Status", "Actions"],
      rows
    );
  }

  drawAlertsTable();
  $("#alertTypeFilter").onchange = drawAlertsTable;
  $("#alertStatusFilter").onchange = drawAlertsTable;

  // Actions click handler
  $("#alertsTableWrap").onclick = async e => {
    const ackId = e.target.dataset.ackAlert;
    const resId = e.target.dataset.resAlert;

    if (ackId) {
      try {
        await updateAlertStatus(ackId, "Acknowledged");
        toast("Alert marked as Acknowledged.");
        await vAlerts();
      } catch (err) {
        toast(err.message, true);
      }
    }
    if (resId) {
      try {
        await updateAlertStatus(resId, "Resolved");
        toast("Alert marked as Resolved.");
        await vAlerts();
      } catch (err) {
        toast(err.message, true);
      }
    }
  };
}

/* ---------------------------------------------------------------------
   9. SCREEN: DISPOSAL
   --------------------------------------------------------------------- */
async function vDisposal() {
  const [bats, meds, mfrs, users, disposals] = await Promise.all([
    getBatches(), getMedicines(), getManufacturers(), getUsers(), getDisposals()
  ]);

  const medMap = new Map(meds.map(m => [m.medicine_id, m]));

  // Strictly filter batches: ONLY expired batches with quantity > 0
  const expiredBatches = bats.filter(b => daysLeft(b.expiry_date) < 0 && b.quantity > 0);

  // Guarantee users list is always a populated array
  const userList = (Array.isArray(users) && users.length > 0) ? users : [
    { user_id: 1, user_name: "Dr. Rajesh Sharma (Admin)", role: "admin" },
    { user_id: 2, user_name: "Priya Patel (Pharmacist)", role: "pharmacist" }
  ];

  // Robust approver filter: Admin or Pharmacist (case-insensitive & fuzzy)
  let eligibleApprovers = userList.filter(u => {
    const r = String(u.role || "").toLowerCase().trim();
    return r === "admin" || r === "pharmacist" || r.includes("admin") || r.includes("pharm");
  });

  // If role filter returned nothing, fallback to all users
  if (!eligibleApprovers || eligibleApprovers.length === 0) {
    eligibleApprovers = userList.slice();
  }

  // Determine default approver
  const loggedInUser = userList.find(u => String(u.user_id) === String(currentLoggedInUserId));
  const defaultApproverId = (loggedInUser && ['admin', 'pharmacist'].includes((loggedInUser.role || '').toLowerCase()))
    ? loggedInUser.user_id
    : (eligibleApprovers[0] ? eligibleApprovers[0].user_id : 1);

  show(
    header("Quarantined Stock Disposal", "Safely destroy and write off expired medicines under certified supervision") +
    `<div class="panel">
      <h2>Record Expired Batch Disposal</h2>
      <p class="note">Disposal is only permitted for expired batches with positive stock. Decrements batch quantity upon sign-off.</p>

      ${expiredBatches.length === 0 ? `
        <div class="empty">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/><path d="m9 12 2 2 4-4"/></svg>
          <span>No expired stock currently in quarantine requiring disposal. Inventory is clean!</span>
        </div>
      ` : `
        <form class="f" id="disposalForm">
          <div class="form-group">
            <label>Expired Quarantined Batch <span class="req">*</span>
              <select name="batch_id" id="dispBatchSelect" required>
                <option value="">-- Select Expired Batch --</option>
                ${expiredBatches.map(b => {
                  const m = medMap.get(b.medicine_id);
                  const mName = m ? m.medicine_name : "Medicine";
                  return `<option value="${b.batch_id}" data-max="${b.quantity}">[${esc(b.batch_no)}] ${esc(mName)} (Expired: ${formatDisplayDate(b.expiry_date)} | Stock: ${b.quantity})</option>`;
                }).join("")}
              </select>
            </label>
            <div class="field-error" id="err_dsp_batch"></div>
          </div>

          <div class="form-group">
            <label>Quantity to Dispose <span class="req">*</span>
              <input name="quantity" id="dispQty" type="number" min="1" step="1" placeholder="Enter disposal units" required>
              <span class="field-hint" id="dispMaxHint">Select batch first</span>
            </label>
            <div class="field-error" id="err_dsp_dqty"></div>
          </div>

          <div class="form-group">
            <label>Disposal Reason (5-100 characters) <span class="req">*</span>
              <input name="reason" placeholder="e.g. Quarantined stock past expiry date - certified incinerator" required>
            </label>
            <div class="field-error" id="err_dsp_reason"></div>
          </div>

          <div class="form-group">
            <label>Approved By (Admin or Pharmacist) <span class="req">*</span>
              <select name="approved_by_user_id" id="dispApproverSelect" required>
                ${eligibleApprovers.map(u => {
                  const uid = u.user_id || 1;
                  const uname = u.user_name || u.name || "Authorized Staff";
                  const urole = (u.role || "Officer").toUpperCase();
                  const isSel = String(uid) === String(defaultApproverId);
                  return `<option value="${uid}"${isSel ? " selected" : ""}>${esc(uname)} (${esc(urole)})</option>`;
                }).join("")}
              </select>
            </label>
            <div class="field-error" id="err_dsp_appr"></div>
          </div>

          <div class="form-actions">
            <button type="submit" class="btn del" id="disposalSubmitBtn">Authorize &amp; Destroy Stock</button>
          </div>
        </form>
      `}
    </div>

    <div class="panel">
      <h2>Regulatory Disposal Audit Log</h2>
      <p class="note">Official records of disposed batches joined through manufacturer and approving authority</p>
      <div id="disposalsTableWrap"></div>
    </div>`
  );

  // Render disposals history table
  $("#disposalsTableWrap").innerHTML = (disposals && disposals.length > 0)
    ? table(
        ["Disposal ID", "Date", "Medicine Name", "Batch No", "Manufacturer", "Qty Disposed", "Reason", "Authorized Approver"],
        disposals.map(d => ({
          cells: [
            `#${d.disposal_id}`,
            formatDisplayDate(d.disposal_date),
            `<b>${esc(d.medicine_name)}</b>`,
            `<span class="code">${esc(d.batch_no)}</span>`,
            esc(d.manufacturer_name),
            `<b style="color:var(--red)">${d.quantity}</b>`,
            esc(d.reason),
            `<span class="role-pill admin">${esc(d.approved_by_name || 'Admin')}</span>`
          ]
        }))
      )
    : `
      <div class="empty" style="padding: 28px 16px;">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
        <span>No disposal records logged yet. Authorized disposals will appear here in the regulatory audit trail.</span>
      </div>
    `;

  if (expiredBatches.length === 0) return;

  const form = $("#disposalForm");
  const saveBtn = $("#disposalSubmitBtn");
  const bSelect = $("#dispBatchSelect");
  const qInput = $("#dispQty");
  const maxHint = $("#dispMaxHint");
  const apprSelect = $("#dispApproverSelect");
  const tracker = createFormTracker(form);

  // Pre-select default approver if available
  if (apprSelect && defaultApproverId && !apprSelect.value) {
    apprSelect.value = String(defaultApproverId);
  }

  bSelect.onchange = () => {
    const opt = bSelect.selectedOptions[0];
    if (opt && opt.dataset.max) {
      maxHint.textContent = `Max available: ${opt.dataset.max} units`;
      qInput.max = opt.dataset.max;
    } else {
      maxHint.textContent = "Select batch first";
    }
    validateDisposalForm();
  };

  function validateDisposalForm() {
    let valid = true;
    const bOk = Boolean(bSelect.value);
    tracker.showError("batch_id", $("#err_dsp_batch"), bSelect, bOk ? "" : "Select an expired batch.");
    if (!bOk) valid = false;

    const opt = bSelect.selectedOptions[0];
    const max = opt && opt.dataset.max ? Number(opt.dataset.max) : 0;

    const vQty = Validators.integer(qInput.value, 1, "Disposal quantity");
    let qtyErr = vQty.valid ? "" : vQty.msg;
    if (vQty.valid && bOk && vQty.value > max) {
      qtyErr = `Quantity cannot exceed available stock (${max}).`;
    }
    tracker.showError("quantity", $("#err_dsp_dqty"), qInput, qtyErr);
    if (qtyErr) valid = false;

    const vReason = Validators.address(form.reason.value);
    tracker.showError("reason", $("#err_dsp_reason"), form.reason, vReason.valid ? "" : "Reason must be 5 to 100 characters.");
    if (!vReason.valid) valid = false;

    const apprOk = Boolean(apprSelect && apprSelect.value);
    tracker.showError("approved_by_user_id", $("#err_dsp_appr"), apprSelect, apprOk ? "" : "Select an approving user.");
    if (!apprOk) valid = false;

    saveBtn.disabled = !valid;
    return valid;
  }

  form.querySelectorAll("input, select").forEach(el => {
    el.addEventListener("input", validateDisposalForm);
    el.addEventListener("change", validateDisposalForm);
  });
  validateDisposalForm();

  form.onsubmit = async e => {
    e.preventDefault();
    tracker.markSubmitted();
    if (!validateDisposalForm()) return;

    if (!confirm("Confirm irreversible disposal of this expired medicine batch?")) return;

    try {
      await disposeBatch(
        bSelect.value,
        qInput.value,
        form.reason.value,
        apprSelect ? apprSelect.value : defaultApproverId
      );
      toast("Disposal recorded and batch stock reduced.");
      await vDisposal();
    } catch (err) {
      toast(err.message, true);
    }
  };
}

/* ---------------------------------------------------------------------
   10. SCREEN: SALES LOG
   --------------------------------------------------------------------- */
async function vSales() {
  const [sales, meds] = await Promise.all([getSales(), getMedicines()]);

  // Total summary calculations
  const totalRevenue = sales.reduce((acc, s) => acc + s.amount, 0);
  const totalUnits = sales.reduce((acc, s) => acc + s.qty_sold, 0);
  const totalOrders = new Set(sales.map(s => s.sale_id)).size;

  show(
    header("Sales & Dispense Log", "Audit trail of every dispensed batch and transaction") +
    `<div class="cards">
      <div class="stat stat-primary">
        <div class="stat-header">
          <div class="stat-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg></div>
          <span class="stat-pill">Total</span>
        </div>
        <b>₹${money(totalRevenue)}</b>
        <span>Gross Revenue</span>
      </div>

      <div class="stat stat-cyan">
        <div class="stat-header">
          <div class="stat-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/></svg></div>
          <span class="stat-pill">Volume</span>
        </div>
        <b>${totalUnits}</b>
        <span>Units Sold</span>
      </div>

      <div class="stat stat-stock">
        <div class="stat-header">
          <div class="stat-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg></div>
          <span class="stat-pill">Orders</span>
        </div>
        <b>${totalOrders}</b>
        <span>Completed Sales</span>
      </div>
    </div>

    <div class="panel">
      <div class="filters">
        <div>
          <label>From Date (mm/dd/yy)
            <input id="salesFromDate" placeholder="mm/dd/yy">
          </label>
        </div>
        <div>
          <label>To Date (mm/dd/yy)
            <input id="salesToDate" placeholder="mm/dd/yy">
          </label>
        </div>
        <div>
          <label>Filter by Medicine
            <select id="salesMedFilter">
              <option value="">All Medicines</option>
              ${options(meds, "medicine_id", m => m.medicine_name)}
            </select>
          </label>
        </div>
        <div>
          <label>Search Customer
            <input id="salesCustSearch" placeholder="Search customer...">
          </label>
        </div>
      </div>

      <div id="salesTableWrap"></div>
    </div>`
  );

  const fromInput = $("#salesFromDate");
  const toInput = $("#salesToDate");
  attachDateInputMask(fromInput);
  attachDateInputMask(toInput);

  function drawSalesTable() {
    const pFrom = parseDateInput(fromInput.value);
    const pTo = parseDateInput(toInput.value);
    const medF = $("#salesMedFilter").value;
    const custQ = ($("#salesCustSearch").value || "").toLowerCase().trim();

    const filtered = sales.filter(s => {
      if (pFrom.valid && s.sale_date < pFrom.iso) return false;
      if (pTo.valid && s.sale_date > pTo.iso) return false;
      if (medF && String(s.medicine_id) !== String(medF)) return false;
      if (custQ && !s.customer_name.toLowerCase().includes(custQ)) return false;
      return true;
    });

    const rows = filtered.map(s => ({
      cells: [
        formatDisplayDate(s.sale_date),
        `#${s.sale_id}`,
        `<b>${esc(s.customer_name)}</b>`,
        esc(s.medicine_name),
        `<span class="code">${esc(s.batch_no)}</span>`,
        `<b>${s.qty_sold}</b>`,
        `₹${money(s.price)}`,
        `<b>₹${money(s.amount)}</b>`,
        `<span class="role-pill pharmacist">${esc(s.dispensed_by)}</span>`
      ]
    }));

    $("#salesTableWrap").innerHTML = table(
      ["Sale Date", "Sale ID", "Customer", "Medicine", "Batch No", "Quantity", "Unit Price", "Total Amount", "Dispensed By"],
      rows
    );
  }

  drawSalesTable();
  fromInput.oninput = drawSalesTable;
  toInput.oninput = drawSalesTable;
  $("#salesMedFilter").onchange = drawSalesTable;
  $("#salesCustSearch").oninput = drawSalesTable;
}

/* ---------------------------------------------------------------------
   11. SCREEN: USERS
   --------------------------------------------------------------------- */
async function vUsers() {
  const users = await getUsers();
  const activeUser = users.find(u => Number(u.user_id) === Number(currentLoggedInUserId)) || users[0];
  const isAdmin = activeUser && String(activeUser.role || '').toLowerCase() === 'admin';

  const formPanelHtml = isAdmin ? `
    <div class="panel">
      <h2 id="userFormTitle">Add New User</h2>
      <form class="f" id="userForm">
        <input type="hidden" name="user_id">
        <div class="form-group">
          <label>Full Name <span class="req">*</span>
            <input name="user_name" placeholder="e.g. Priya Patel" required>
          </label>
          <div class="field-error" id="err_usr_name"></div>
        </div>

        <div class="form-group">
          <label>System Role <span class="req">*</span>
            <select name="role" required>
              ${CONFIG.ROLES.map(r => `<option value="${r}">${r}</option>`).join("")}
            </select>
          </label>
          <div class="field-error" id="err_usr_role"></div>
        </div>

        <div class="form-group">
          <label>Account Password <span class="note">(leave blank for default: admin123)</span>
            <input name="password" type="password" placeholder="e.g. secret123" autocomplete="new-password">
          </label>
        </div>

        <div class="form-actions">
          <button type="submit" class="btn" id="userSaveBtn">Save User</button>
          <button type="button" class="btn ghost" id="userCancelBtn" style="display:none">Cancel</button>
        </div>
      </form>
    </div>` : `
    <div class="panel">
      <div style="display:flex; align-items:center; gap:12px; color:var(--text-muted);">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        <div>
          <h3 style="margin:0 0 4px 0; font-size:14px; font-weight:600; color:var(--text);">Read-Only Staff Directory</h3>
          <p style="margin:0; font-size:13px;">Only administrators are authorized to register, edit, or delete system user accounts.</p>
        </div>
      </div>
    </div>`;

  show(
    header("Users & Access Control", "Manage personnel permissions for Pharmacists, Store Keepers, and Administrators") +
    formPanelHtml +
    `<div class="panel">
      <h2>Registered System Users</h2>
      <div id="usersTableWrap"></div>
    </div>`
  );

  function drawUsersTable() {
    const rows = users.map(u => {
      let roleCls = "storekeeper";
      const r = (u.role || "").toLowerCase();
      if (r === "admin") roleCls = "admin";
      else if (r === "pharmacist") roleCls = "pharmacist";

      const isMe = Number(u.user_id) === Number(currentLoggedInUserId);
      const isPrimaryAdmin = Number(u.user_id) === 1;

      const cells = [
        `#${u.user_id}`,
        `<b>${esc(u.user_name || u.name)}</b>`,
        `<span class="code">${esc(u.email || '—')}</span>`,
        `<span class="role-pill ${roleCls}">${esc(u.role)}</span>`,
        isMe ?
          '<span class="tag ok">Active Session</span>' :
          '<span class="tag neutral">Available</span>'
      ];

      if (isAdmin) {
        cells.push(
          `<button class="btn sm ghost" data-edit-usr="${u.user_id}">Edit</button> ` +
          (isPrimaryAdmin || isMe ? '' : `<button class="btn sm del" data-del-usr="${u.user_id}">Delete</button>`)
        );
      }

      return { cells };
    });

    const headers = isAdmin
      ? ["User ID", "User Name", "Email / Account", "Assigned Role", "Status", "Actions"]
      : ["User ID", "User Name", "Email / Account", "Assigned Role", "Status"];

    $("#usersTableWrap").innerHTML = table(headers, rows);
  }

  drawUsersTable();

  if (!isAdmin) return; // Non-admin users cannot edit or delete users

  const form = $("#userForm");
  const saveBtn = $("#userSaveBtn");
  const cancelBtn = $("#userCancelBtn");
  const tracker = createFormTracker(form);

  function validateUserForm() {
    let valid = true;
    const vName = Validators.name(form.user_name.value, "User name");
    tracker.showError("user_name", $("#err_usr_name"), form.user_name, vName.valid ? "" : vName.msg);
    if (!vName.valid) valid = false;

    const roleOk = CONFIG.ROLES.some(r => r.toLowerCase() === form.role.value.toLowerCase());
    tracker.showError("role", $("#err_usr_role"), form.role, roleOk ? "" : "Select a valid role.");
    if (!roleOk) valid = false;

    saveBtn.disabled = !valid;
    return valid;
  }

  form.querySelectorAll("input, select").forEach(el => el.addEventListener("input", validateUserForm));
  validateUserForm();

  form.onsubmit = async e => {
    e.preventDefault();
    tracker.markSubmitted();
    if (!validateUserForm()) return;
    const uId = form.user_id.value;
    const prevText = saveBtn.textContent;
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving...";

    try {
      if (uId) {
        await updateUser(uId, {
          user_name: form.user_name.value,
          role: form.role.value,
          password: form.password.value
        });
        toast("User updated.");
      } else {
        await addUser({
          user_name: form.user_name.value,
          role: form.role.value,
          password: form.password.value
        });
        toast("User registered.");
      }
      form.reset();
      form.user_id.value = "";
      tracker.reset();
      await refreshUserPicker();
      await vUsers();
    } catch (err) {
      toast(err.message, true);
      saveBtn.disabled = false;
      saveBtn.textContent = prevText;
    }
  };

  $("#usersTableWrap").onclick = async e => {
    const editId = e.target.dataset.editUsr;
    const delId = e.target.dataset.delUsr;
    if (editId) {
      const u = users.find(x => x.user_id === Number(editId));
      if (!u) return;
      $("#userFormTitle").textContent = "Edit User";
      form.user_id.value = u.user_id;
      form.user_name.value = u.user_name || u.name;
      const matchedRole = CONFIG.ROLES.find(r => r.toLowerCase() === (u.role || "").toLowerCase()) || u.role;
      form.role.value = matchedRole;
      cancelBtn.style.display = "inline-flex";
      saveBtn.textContent = "Update User";
      tracker.reset();
      validateUserForm();
      form.scrollIntoView({ behavior: "smooth" });
    }
    if (delId) {
      if (confirm("Delete this user?")) {
        try {
          await deleteUser(delId);
          toast("User deleted.");
          await refreshUserPicker();
          await vUsers();
        } catch (err) {
          toast(err.message, true);
        }
      }
    }
  };

  cancelBtn.onclick = () => {
    form.reset();
    form.user_id.value = "";
    $("#userFormTitle").textContent = "Add New User";
    cancelBtn.style.display = "none";
    saveBtn.textContent = "Save User";
    tracker.reset();
    validateUserForm();
  };
}

/* =====================================================================
   PART 5: STARTUP, NAVIGATION, THEME & USER STATE
   ===================================================================== */

/** Global screen router exposed on window for quick actions */
window.go = go;

/** Build sidebar navigation links */
function buildNav() {
  const nav = $("#nav");
  if (!nav) return;
  nav.innerHTML = SCREENS.map(s => `
    <button class="${s.id === currentScreen ? "on" : ""}" data-screen="${s.id}">
      ${s.icon}
      <span>${s.label}</span>
    </button>
  `).join("");
}

/** Screen router */
async function go(screenId) {
  currentScreen = screenId;
  buildNav();
  // Close mobile sidebar if open
  $("#sidebar").classList.remove("open");
  const overlay = $("#sidebarOverlay");
  if (overlay) overlay.classList.remove("active");

  const views = {
    "Dashboard": vDashboard,
    "Medicines": vMedicines,
    "Suppliers": vSuppliers,
    "Customers": vCustomers,
    "Stock-in": vStockIn,
    "Dispense": vDispense,
    "Batches": vBatches,
    "Alerts": vAlerts,
    "Disposal": vDisposal,
    "Sales log": vSales,
    "Users": vUsers
  };

  if (views[screenId]) {
    try {
      await views[screenId]();
    } catch (err) {
      console.error(`Error loading screen ${screenId}:`, err);
      const viewEl = $("#view");
      if (viewEl) {
        viewEl.innerHTML = `
          <div class="panel" style="max-width: 600px; margin: 40px auto; text-align: center; padding: 32px 24px;">
            <div style="font-size: 2.8rem; margin-bottom: 12px;">⚠️</div>
            <h2 style="margin-bottom: 8px;">Notice: Could Not Load ${esc(screenId)}</h2>
            <p class="note" style="margin-bottom: 24px; font-size: 13.5px; color: var(--tx-muted);">
              ${esc(err.message || String(err))}
            </p>
            <div style="display: flex; gap: 12px; justify-content: center; flex-wrap: wrap;">
              <button class="btn primary" onclick="go('${esc(screenId)}')">Retry Page</button>
              <button class="btn ghost" onclick="go('Dashboard')">Return to Dashboard</button>
            </div>
          </div>
        `;
      }
    }
  }
}

let modalPendingUserId = null;

function openUserSwitchModal(targetUserId, users) {
  const targetUser = users.find(u => Number(u.user_id) === Number(targetUserId));
  if (!targetUser) return;

  modalPendingUserId = Number(targetUserId);

  const modal = $("#authSwitchModal");
  const pwdInput = $("#authSwitchPassword");
  const errDiv = $("#authSwitchError");
  const badge = $("#authTargetUserBadge");

  badge.innerHTML = `
    <div>
      <div class="auth-target-name">${esc(targetUser.user_name || targetUser.name)}</div>
      <div class="auth-target-email">${esc(targetUser.email || 'System Staff User')}</div>
    </div>
    <span class="role-pill ${(targetUser.role || '').toLowerCase()}">${esc(targetUser.role || 'Staff')}</span>
  `;

  pwdInput.value = "";
  pwdInput.type = "password";
  errDiv.style.display = "none";
  errDiv.textContent = "";

  const toggleBtn = $("#authTogglePwdBtn");
  if (toggleBtn) toggleBtn.textContent = "👁️";

  modal.style.display = "flex";
  setTimeout(() => pwdInput.focus(), 60);
}

function closeUserSwitchModal() {
  const modal = $("#authSwitchModal");
  if (modal) modal.style.display = "none";
  modalPendingUserId = null;
  // Revert dropdown selection to current active user
  const select = $("#currentUserSelect");
  if (select) select.value = currentLoggedInUserId;
}

function initAuthModal() {
  const modal = $("#authSwitchModal");
  const form = $("#authSwitchForm");
  const closeBtn = $("#authModalCloseBtn");
  const cancelBtn = $("#authModalCancelBtn");
  const togglePwdBtn = $("#authTogglePwdBtn");
  const pwdInput = $("#authSwitchPassword");
  const submitBtn = $("#authModalSubmitBtn");
  const errDiv = $("#authSwitchError");

  if (!modal || !form) return;

  if (closeBtn) closeBtn.onclick = closeUserSwitchModal;
  if (cancelBtn) cancelBtn.onclick = closeUserSwitchModal;

  modal.onclick = e => {
    if (e.target === modal) closeUserSwitchModal();
  };

  if (togglePwdBtn) {
    togglePwdBtn.onclick = () => {
      if (pwdInput.type === "password") {
        pwdInput.type = "text";
        togglePwdBtn.textContent = "🙈";
      } else {
        pwdInput.type = "password";
        togglePwdBtn.textContent = "👁️";
      }
    };
  }

  form.onsubmit = async e => {
    e.preventDefault();
    if (!modalPendingUserId) return;
    const pwd = pwdInput.value;
    if (!pwd) return;

    const prevText = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = "Verifying...";
    errDiv.style.display = "none";

    const res = await authenticateUserSwitch(modalPendingUserId, pwd);

    submitBtn.disabled = false;
    submitBtn.textContent = prevText;

    if (res.success) {
      toast(`Signed in as: ${res.user.name} (${res.user.role})`);
      closeUserSwitchModal();
      await refreshUserPicker();
      buildNav();
      await go(currentScreen);
    } else {
      errDiv.textContent = res.message || "Incorrect password.";
      errDiv.style.display = "block";
      pwdInput.select();
    }
  };
}

/** Refresh Top Bar User Picker */
async function refreshUserPicker() {
  const users = await getUsers();
  const select = $("#currentUserSelect");
  if (!select) return;

  // Restore or default currentLoggedInUserId
  const saved = localStorage.getItem("medstock_active_user");
  if (saved && users.some(u => u.user_id === Number(saved))) {
    currentLoggedInUserId = Number(saved);
  } else if (!users.some(u => u.user_id === currentLoggedInUserId)) {
    currentLoggedInUserId = users[0] ? users[0].user_id : 1;
  }

  select.innerHTML = users.map(u => `
    <option value="${u.user_id}"${u.user_id === currentLoggedInUserId ? " selected" : ""}>
      ${esc(u.user_name || u.name)} (${esc(u.role)})
    </option>
  `).join("");

  select.onchange = () => {
    const nextId = Number(select.value);
    if (nextId === currentLoggedInUserId) return;
    openUserSwitchModal(nextId, users);
  };
}

/** Theme Controller (Dark mode by default, remembered in localStorage, follows system pref on 1st visit) */
function initTheme() {
  const savedTheme = localStorage.getItem("medstock_theme");
  let theme = "dark";

  if (savedTheme) {
    theme = savedTheme;
  } else if (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches) {
    theme = "light";
  }

  applyTheme(theme);

  const toggleBtn = $("#themeToggleBtn");
  if (toggleBtn) {
    toggleBtn.onclick = () => {
      const isLight = document.body.classList.contains("light-mode");
      const nextTheme = isLight ? "dark" : "light";
      applyTheme(nextTheme);
    };
  }
}

function applyTheme(theme) {
  const isLight = theme === "light";
  document.body.classList.toggle("light-mode", isLight);
  document.body.classList.toggle("dark-mode", !isLight);
  localStorage.setItem("medstock_theme", theme);

  const iconSlot = $("#themeToggleIcon");
  const textSlot = $("#themeToggleText");
  const statusSlot = $("#systemStatusText");

  if (isLight) {
    if (iconSlot) iconSlot.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>';
    if (textSlot) textSlot.textContent = "Dark Mode";
    if (statusSlot) statusSlot.innerHTML = "System Active &bull; Light Mode";
  } else {
    if (iconSlot) iconSlot.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>';
    if (textSlot) textSlot.textContent = "Light Mode";
    if (statusSlot) statusSlot.innerHTML = "System Active &bull; Dark Mode";
  }
}

/** Global Event Listeners & Bootstrapping */
document.addEventListener("DOMContentLoaded", async () => {
  // Navigation delegated click
  const nav = $("#nav");
  if (nav) {
    nav.onclick = e => {
      const btn = e.target.closest("button[data-screen]");
      if (btn) go(btn.dataset.screen);
    };
  }

  // Mobile menu toggle
  const menuBtn = $("#menuBtn");
  const overlay = $("#sidebarOverlay");
  if (menuBtn) {
    menuBtn.onclick = () => {
      $("#sidebar").classList.toggle("open");
      if (overlay) overlay.classList.toggle("active");
    };
  }
  if (overlay) {
    overlay.onclick = () => {
      $("#sidebar").classList.remove("open");
      overlay.classList.remove("active");
    };
  }

  // Reset sample data button
  const resetBtn = $("#resetBtn");
  if (resetBtn) {
    resetBtn.onclick = async () => {
      if (confirm("Reset all inventory, sales, suppliers and master records to the official default sample dataset?")) {
        await resetData();
        toast("Default sample dataset successfully restored.");
        await refreshUserPicker();
        await go(currentScreen);
      }
    };
  }

  // Initialize theme, auth modal, user picker & render first view
  initTheme();
  initAuthModal();
  await refreshUserPicker();
  buildNav();
  await go("Dashboard");
});
