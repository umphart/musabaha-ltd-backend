// routes/userPaymentRequests.js
const express = require("express");
const router = express.Router();
const pool = require("../config/database"); // Adjust path as needed

// Get all payment requests for a specific user
router.get("/user/:userId", async (req, res) => {
  try {
    const userId = req.params.userId;

    const result = await pool.query(`
      SELECT 
        pr.*, 
        u.name AS user_name, 
        u.email AS user_email, 
        u.contact AS user_contact,
        u.plot_taken AS user_plot_taken,
        u.total_balance AS user_total_balance,
        u.total_money_to_pay AS user_total_money_to_pay,
        p.number AS plot_number,
        p.status AS plot_status
      FROM payment_requests pr
      LEFT JOIN userstable u ON pr.user_id = u.id
      LEFT JOIN plots p ON pr.plot_id = p.id
      WHERE pr.user_id = $1
      ORDER BY pr.created_at DESC
    `, [userId]);

    res.json({
      success: true,
      requests: result.rows,
      count: result.rows.length
    });

  } catch (err) {
    console.error("❌ Error fetching user payment requests:", err.message);
    res.status(500).json({
      success: false,
      message: "Server error: " + err.message
    });
  }
});

// Get a specific payment request for a user (with ownership verification)
router.get("/user/:userId/:requestId", async (req, res) => {
  try {
    const { userId, requestId } = req.params;

    const result = await pool.query(`
      SELECT 
        pr.*, 
        u.name AS user_name, 
        u.email AS user_email, 
        u.contact AS user_contact,
        u.plot_taken AS user_plot_taken,
        u.total_balance AS user_total_balance,
        u.total_money_to_pay AS user_total_money_to_pay,
        p.number AS plot_number,
        p.status AS plot_status
      FROM payment_requests pr
      LEFT JOIN userstable u ON pr.user_id = u.id
      LEFT JOIN plots p ON pr.plot_id = p.id
      WHERE pr.id = $1 AND pr.user_id = $2
    `, [requestId, userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Payment request not found or you don't have access to this request"
      });
    }

    res.json({
      success: true,
      request: result.rows[0]
    });

  } catch (err) {
    console.error("❌ Error fetching user payment request:", err.message);
    res.status(500).json({
      success: false,
      message: "Server error: " + err.message
    });
  }
});

module.exports = router;