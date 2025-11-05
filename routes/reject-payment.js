// routes/reject-payment.js
const express = require("express");
const router = express.Router();
const pool = require("../config/database");

/**
 * PATCH /api/reject-payment/:id
 * Admin rejects payment request
 */
router.patch("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { rejection_reason } = req.body;

    const result = await pool.query(
      `UPDATE payment_requests 
       SET status = 'rejected', 
           updated_at = NOW(),
           rejection_reason = $1
       WHERE id = $2
       RETURNING *`,
      [rejection_reason || "No reason provided", id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Payment request not found"
      });
    }

    res.json({
      success: true,
      message: "Payment rejected successfully",
      request: result.rows[0]
    });

  } catch (err) {
    console.error("❌ Rejection error:", err.message);
    res.status(500).json({
      success: false,
      message: "Server error: " + err.message
    });
  }
});
// Add this to your backend routes
router.put("/payment-requests/:id/reject", async (req, res) => { 
  const requestId = req.params.id;

  try {
    const requestResult = await pool.query(
      `SELECT * FROM payment_requests WHERE id = $1`,
      [requestId]
    );

    if (requestResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Payment request not found" });
    }

    await pool.query(
      `UPDATE payment_requests SET status = 'rejected', updated_at = NOW() WHERE id = $1`,
      [requestId]
    );

    res.json({
      success: true,
      message: "Payment request rejected successfully!",
    });

  } catch (err) {
    console.error("Error rejecting payment:", err.message);
    res.status(500).json({ success: false, message: "Server error: " + err.message });
  }
});

module.exports = router;