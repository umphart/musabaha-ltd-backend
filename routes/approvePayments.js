const express = require("express");
const router = express.Router();
const pool = require("../config/database");


router.put("/payment-requests/:id/approve", async (req, res) => { 
  const client = await pool.connect();
  try {
    const requestId = req.params.id;

    await client.query("BEGIN");

    // 1. Get the payment request
    const rq = await client.query(
      "SELECT * FROM payment_requests WHERE id = $1 AND status = 'pending'",
      [requestId]
    );
    
    if (rq.rowCount === 0) {
      return res.status(404).json({ 
        success: false, 
        message: "Request not found or already processed" 
      });
    }

    const reqData = rq.rows[0];

    // 2. Insert into payments table
    const insertPay = await client.query(
      `INSERT INTO payments (user_id, plot_id, amount, payment_method, date, note, receipt_file, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'approved')
       RETURNING *`,
      [
        reqData.user_id,
        reqData.plot_id,
        reqData.amount,
        reqData.payment_method,
        reqData.transaction_date,
        reqData.notes,
        reqData.receipt_file
      ]
    );
    const payment = insertPay.rows[0];

    // 3. Update payment_request to approved
    await client.query(
      "UPDATE payment_requests SET status = 'approved', updated_at = NOW() WHERE id = $1",
      [requestId]
    );

    // ✅ Update user balance in usersTable
    await client.query(
      `UPDATE usersTable 
       SET total_balance = total_balance - $1,
           updated_at = NOW()
       WHERE id = $2`,
      [reqData.amount, reqData.user_id]
    );

    await client.query("COMMIT");

    res.json({ 
      success: true, 
      message: "Payment approved successfully",
      payment 
    });

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Approval error:", err.message);
    res.status(500).json({ 
      success: false, 
      message: "Server error: " + err.message 
    });
  } finally {
    client.release();
  }
});

router.put("/payment-requests/:id/reject", async (req, res) => {
  const client = await pool.connect();
  try {
    const requestId = req.params.id;

    await client.query("BEGIN");

    // 1. Get the payment request
    const rq = await client.query(
      "SELECT * FROM payment_requests WHERE id = $1 AND status = 'pending'",
      [requestId]
    );

    if (rq.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Request not found or already processed",
      });
    }

    const reqData = rq.rows[0];

    // 2. Update payment_request to rejected
    await client.query(
      `UPDATE payment_requests 
       SET status = 'rejected',
           updated_at = NOW()
       WHERE id = $1`,
      [requestId]
    );

    // 3. Optional: Insert into rejected_payments table (without rejection_reason)
    try {
      await client.query(
        `INSERT INTO rejected_payments (
          user_id, plot_id, amount, payment_method,
          transaction_date, notes, receipt_file
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          reqData.user_id,
          reqData.plot_id,
          reqData.amount,
          reqData.payment_method,
          reqData.transaction_date,
          reqData.notes,
          reqData.receipt_file,
        ]
      );
    } catch (error) {
      console.log("Note: rejected_payments table might not exist, continuing...");
    }

    await client.query("COMMIT");

    res.json({
      success: true,
      message: "Payment rejected successfully",
    });

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Rejection error:", err.message);
    res.status(500).json({
      success: false,
      message: "Server error: " + err.message,
    });
  } finally {
    client.release();
  }
});

module.exports = router;