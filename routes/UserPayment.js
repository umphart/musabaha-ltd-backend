// routes/userPayments.js
const express = require("express");
const multer = require("multer");
const path = require("path");
const router = express.Router();
const UserPayment = require("../models/UserPayment");
const pool = require("../config/database");

// ==========================
// Multer setup for receipts
// ==========================
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, "../uploads/receipts"));
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + "-" + file.originalname);
  },
});
const upload = multer({ storage });

/**
 * POST /api/user-payments
 * Create new payment (always pending until admin approval)
 */
router.post("/", upload.single("receipt"), async (req, res) => {
  try {
    const {
      subscriptionId,
      userId,
      paymentMethod,
      transactionDate,
      notes,
      confirmed,
      plotSize,
      numberOfPlots,
      totalPrice,
      outstandingBalance,
      amount,
      name,
      contact,
      plotId,
    } = req.body;

    const paymentData = {
      user_id: parseInt(userId),
      subscription_id: subscriptionId ? parseInt(subscriptionId) : null,
      plot_id: plotId ? parseInt(plotId) : null,
      amount: parseFloat(amount),
      payment_method: paymentMethod,
      transaction_date: transactionDate ? new Date(transactionDate) : new Date(),
      notes: notes || '',
      receipt_file: req.file ? req.file.filename : null,
      confirmed: confirmed === "true" || confirmed === true,
      plot_size: plotSize,
      number_of_plots: numberOfPlots ? parseInt(numberOfPlots) : null,
      total_price: totalPrice ? parseFloat(totalPrice) : null,
      outstanding_balance: outstandingBalance
        ? parseFloat(outstandingBalance)
        : null,
      name: name || '',
      contact: contact || '', // Ensure contact is not undefined
      status: "pending", // ✅ Always pending
    };

    const payment = await UserPayment.create(paymentData);
    res.status(201).json({ success: true, payment });
  } catch (error) {
    console.error("Error creating payment:", error.message);
    res.status(500).json({ success: false, error: "Failed to create payment" });
  }
});

/**

 */
router.patch("/:id/status", async (req, res) => {
  const client = await pool.connect();
  try {
    const { status } = req.body;
    const { id } = req.params;

    if (!["approved", "rejected", "pending"].includes(status)) {
      return res
        .status(400)
        .json({ success: false, error: "Invalid status value" });
    }

    await client.query("BEGIN");

    // 1️⃣ Get the payment row
    const paymentResult = await client.query(
      "SELECT * FROM userPayments WHERE id = $1",
      [id]
    );

    if (paymentResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res
        .status(404)
        .json({ success: false, error: "Payment not found" });
    }

    const payment = paymentResult.rows[0];

    // 2️⃣ Update status
    const updatedPaymentResult = await client.query(
      "UPDATE userPayments SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *",
      [status, id]
    );
    let updatedPayment = updatedPaymentResult.rows[0];

    // 3️⃣ If approved → recalc outstanding
    if (status === "approved") {
      const totalPrice = updatedPayment.total_price || 0;

      // Get total of all approved payments for this user
      const approvedPayments = await client.query(
        "SELECT COALESCE(SUM(amount), 0) as total_paid FROM userPayments WHERE user_id = $1 AND status = 'approved'",
        [updatedPayment.user_id]
      );
      const totalPaidSoFar =
        parseFloat(approvedPayments.rows[0].total_paid) || 0;

      const newOutstanding = totalPrice - totalPaidSoFar;

      // Update outstanding balance in this payment row
      const balanceResult = await client.query(
        "UPDATE userPayments SET outstanding_balance = $1 WHERE id = $2 RETURNING *",
        [newOutstanding >= 0 ? newOutstanding : 0, id]
      );

      updatedPayment = balanceResult.rows[0];

      // ✅ Only update plot status, not owner
      if (updatedPayment.plot_id) {
        await client.query(
          "UPDATE plots SET status = 'sold' WHERE id = $1",
          [updatedPayment.plot_id]
        );
      }
    }

    // 4️⃣ If rejected → revert plot to available (no owner change)
    if (status === "rejected" && payment.plot_id) {
      await client.query(
        "UPDATE plots SET status = 'Available' WHERE id = $1",
        [payment.plot_id]
      );
    }

    await client.query("COMMIT");

    res.json({ success: true, payment: updatedPayment });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error updating payment status:", error.message);
    res
      .status(500)
      .json({ success: false, error: "Failed to update payment status" });
  } finally {
    client.release();
  }
});


/**
 * GET /api/user-payments/user/:userId
 * Get all payments for a specific user
 */
router.get("/user/:userId", async (req, res) => {
  const { userId } = req.params;
  try {
    const result = await pool.query(
      "SELECT * FROM userPayments WHERE user_id = $1 ORDER BY created_at DESC",
      [userId]
    );
    res.json({ success: true, payments: result.rows });
  } catch (error) {
    console.error("Error fetching payments:", error.message);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

/**
 * GET /api/user-payments
 * Get all payments (admin)
 */
router.get("/", async (req, res) => {
  try {
    const payments = await UserPayment.getAll();
    res.json({ success: true, payments });
  } catch (error) {
    console.error("Error fetching all payments:", error.message);
    res.status(500).json({ success: false, error: "Failed to fetch payments" });
  }
});

module.exports = router;
