const pool = require('../config/db');

/**
 * Creates a sale using FEFO (First-Expiry-First-Out) batch allocation inside an ACID transaction.
 * Triggers in MySQL automatically deduct batch stock and prevent selling expired batches.
 */
async function createSale({ customer_id, items, created_by }) {
  if (!items || !Array.isArray(items) || items.length === 0) {
    const err = new Error('Sale must contain at least one item');
    err.statusCode = 400;
    throw err;
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // 1. Create sale record with total_amount = 0 initially
    const [saleResult] = await conn.query(
      `INSERT INTO sale (customer_id, sale_date, total_amount, created_by) VALUES (?, CURDATE(), 0, ?)`,
      [customer_id || null, created_by]
    );
    const saleId = saleResult.insertId;

    let totalAmount = 0;
    const soldItems = [];

    // 2. Process each requested item
    for (const item of items) {
      const { medicine_id, qty, batch_id } = item;
      const requestedQty = parseInt(qty, 10);

      if (!medicine_id || isNaN(requestedQty) || requestedQty <= 0) {
        const err = new Error('Each item must have a valid medicine_id and positive qty');
        err.statusCode = 400;
        throw err;
      }

      // Fetch medicine name for clear error messaging
      const [medRows] = await conn.query('SELECT name FROM medicine WHERE medicine_id = ?', [medicine_id]);
      const medicineName = medRows.length > 0 ? medRows[0].name : `Medicine #${medicine_id}`;

      if (batch_id) {
        // Specific batch requested: lock and check
        const [batches] = await conn.query(
          `SELECT batch_id, batch_no, quantity, mrp, expiry_date, status
           FROM batch
           WHERE batch_id = ? FOR UPDATE`,
          [batch_id]
        );

        if (batches.length === 0) {
          const err = new Error(`Batch #${batch_id} not found`);
          err.statusCode = 400;
          throw err;
        }

        const b = batches[0];
        if (b.status !== 'ACTIVE' || new Date(b.expiry_date) < new Date(new Date().toISOString().slice(0, 10))) {
          const err = new Error(`Cannot sell from expired or inactive batch ${b.batch_no}`);
          err.statusCode = 400;
          throw err;
        }

        if (b.quantity < requestedQty) {
          const err = new Error(`Insufficient stock for ${medicineName}: requested ${requestedQty}, available ${b.quantity}`);
          err.statusCode = 400;
          throw err;
        }

        const price = Number(b.mrp);
        totalAmount += requestedQty * price;

        // Inserting into sold_in will trigger trg_sold_in_after_insert (auto-deducts batch stock)
        await conn.query(
          `INSERT INTO sold_in (sale_id, batch_id, qty, price) VALUES (?, ?, ?, ?)`,
          [saleId, b.batch_id, requestedQty, price]
        );

        soldItems.push({
          medicine_id,
          medicine_name: medicineName,
          batch_id: b.batch_id,
          batch_no: b.batch_no,
          expiry_date: b.expiry_date,
          qty: requestedQty,
          price
        });
      } else {
        // FEFO allocation: Lock active, non-expired batches ordered by earliest expiry
        const [usableBatches] = await conn.query(
          `SELECT batch_id, batch_no, quantity, mrp, expiry_date
           FROM batch
           WHERE medicine_id = ? 
             AND status = 'ACTIVE' 
             AND expiry_date >= CURDATE() 
             AND quantity > 0
           ORDER BY expiry_date ASC
           FOR UPDATE`,
          [medicine_id]
        );

        const totalAvailable = usableBatches.reduce((sum, b) => sum + b.quantity, 0);
        if (totalAvailable < requestedQty) {
          const err = new Error(`Insufficient stock for ${medicineName}: requested ${requestedQty}, available ${totalAvailable}`);
          err.statusCode = 400;
          throw err;
        }

        let needed = requestedQty;
        for (const b of usableBatches) {
          if (needed <= 0) break;
          const take = Math.min(b.quantity, needed);
          const price = Number(b.mrp);
          totalAmount += take * price;
          needed -= take;

          // Inserting into sold_in triggers trg_sold_in_after_insert
          await conn.query(
            `INSERT INTO sold_in (sale_id, batch_id, qty, price) VALUES (?, ?, ?, ?)`,
            [saleId, b.batch_id, take, price]
          );

          soldItems.push({
            medicine_id,
            medicine_name: medicineName,
            batch_id: b.batch_id,
            batch_no: b.batch_no,
            expiry_date: b.expiry_date,
            qty: take,
            price
          });
        }
      }
    }

    // 3. Update total_amount on sale header
    await conn.query('UPDATE sale SET total_amount = ? WHERE sale_id = ?', [totalAmount, saleId]);

    await conn.commit();

    // 4. Return complete sale details
    const [headerRows] = await conn.query(`
      SELECT s.sale_id, s.sale_date, s.total_amount, s.created_by,
             c.customer_id, c.name AS customer_name,
             u.name AS user_name
      FROM sale s
      LEFT JOIN customer c ON s.customer_id = c.customer_id
      JOIN users u ON s.created_by = u.user_id
      WHERE s.sale_id = ?
    `, [saleId]);

    return {
      ...headerRows[0],
      items: soldItems
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = {
  createSale
};
