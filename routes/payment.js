// routes/payment.js
const express = require("express");
const router = express.Router();
const Admin = require("../models/payment"); // adjust path if needed

// ✅ Get all payments with user details
router.get("/all", async (req, res) => {
  try {
    const users = await Admin.getAllUsers();

    // Flatten into payment records with user info
    const payments = [];
    users.forEach((user) => {
      user.payments.forEach((payment) => {
        payments.push({
          id: payment.id,
          userId: user.id,
          userName: user.name,
          amount: parseFloat(payment.amount),
          date: payment.date,
          status: payment.status || "Completed", // fallback
          method: payment.method || "Unknown",
          note: payment.note,
        });
      });
    });

    res.json({ success: true, data: payments });
  } catch (error) {
    console.error("Error fetching payments:", error);
    res.status(500).json({ success: false, message: "Failed to fetch payments" });
  }
});

// ✅ Get payments by specific user
router.get("/user/:id", async (req, res) => {
  try {
    const payments = await Admin.getPaymentsByUser(req.params.id);
    res.json({ success: true, data: payments });
  } catch (error) {
    console.error("Error fetching user payments:", error);
    res.status(500).json({ success: false, message: "Failed to fetch user payments" });
  }
});

// ✅ Create a new payment
router.post("/", async (req, res) => {
  try {
    const payment = await Admin.createPayment(req.body);
    res.json({ success: true, data: payment });
  } catch (error) {
    console.error("Error creating payment:", error);
    res.status(500).json({ success: false, message: "Failed to create payment" });
  }
});

// Get all payments with status filter
router.get("/user-payment-records/:id", async (req, res) => {
  try {
    const userId = req.params.id;

    // First try subscriptions table
    const subscriptionPayments = await pool.query(`
      SELECT 
        sp.id,
        sp.amount,
        sp.payment_method,
        sp.transaction_reference,
        sp.created_at,
        sp.note,
        'subscription' AS source,
        u.name AS user_name,
        u.contact AS user_contact,
        u.plot_taken AS user_plot_taken,
        u.plot_number
      FROM subsequent_payments sp
      LEFT JOIN usersTable u ON u.id = sp.user_id
      WHERE sp.user_id = $1
      ORDER BY sp.created_at DESC
    `, [userId]);

    if (subscriptionPayments.rows.length > 0) {
      return res.json({
        success: true,
        source: "subscriptions",
        paymentRecords: subscriptionPayments.rows
      });
    }

    // If subscription is empty → check usersPayments
    const usersPayments = await pool.query(`
      SELECT *
      FROM usersPayments
      WHERE user_id = $1
      ORDER BY date_taken DESC
    `, [userId]);

    return res.json({
      success: true,
      source: "usersTable",
      paymentRecords: usersPayments.rows
    });

  } catch (error) {
    console.error("❌ Error fetching payment records:", error);
    res.status(500).json({ success: false, message: "Server error while fetching payment records" });
  }
});

module.exports = router;
