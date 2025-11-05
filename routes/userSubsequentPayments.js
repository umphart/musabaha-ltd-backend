const express = require("express");
const multer = require("multer");
const path = require("path");
const UserSubsequentPayment = require("../models/UserSubsequentPayment");

const router = express.Router();

// Multer setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, "../uploads/receipts"));
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + "-" + file.originalname);
  },
});
const upload = multer({ storage });

// Create a new subsequent payment
router.post("/", upload.single("receipt"), async (req, res) => {
  try {
    const {
      user_id,
      user_name,
      user_contact,
      plot_id,
      number_of_plots,
      plot_size,
      total_price,
      outstanding_balance,
      amount,
      payment_method,
      transaction_reference,
      note,
    } = req.body;

    const paymentData = {
      user_id: parseInt(user_id, 10),
      user_name: user_name || null,
      user_contact: user_contact || null,
      plot_id: plot_id ? parseInt(plot_id, 10) : null,
      number_of_plots: number_of_plots ? parseInt(number_of_plots, 10) : null,
      plot_size: plot_size || null,
      total_price: total_price ? parseFloat(total_price) : null,
      outstanding_balance: outstanding_balance ? parseFloat(outstanding_balance) : null,
      amount: parseFloat(amount),
      payment_method: payment_method || null,
      transaction_reference: transaction_reference || null,
      note: note || null,
      receipt_file: req.file ? req.file.filename : null,
    };

    if (isNaN(paymentData.user_id) || isNaN(paymentData.amount)) {
      return res
        .status(400)
        .json({ success: false, error: "Invalid user_id or amount" });
    }

    const payment = await UserSubsequentPayment.create(paymentData);
    res.status(201).json({ success: true, payment });
  } catch (err) {
    console.error("Error creating subsequent payment:", err.message);
    res
      .status(500)
      .json({ success: false, error: "Failed to create subsequent payment" });
  }
});

// Update status (admin approval/reject)
// Update status (admin approval/reject)
router.patch("/:id/status", async (req, res) => {
  try {
    const { status } = req.body;
    const { id } = req.params;

    // Validate allowed statuses
    if (!["approved", "rejected", "pending"].includes(status)) {
      return res
        .status(400)
        .json({ success: false, error: "Invalid status value" });
    }

    // Update status (and subtract outstanding if approved)
    const payment = await UserSubsequentPayment.updateStatus(id, status);

    if (!payment) {
      return res
        .status(404)
        .json({ success: false, error: "Subsequent payment not found" });
    }

    res.json({
      success: true,
      message: `Payment ${status} successfully.`,
      payment,
    });
  } catch (err) {
    console.error("Error updating subsequent payment status:", err.message);
    res
      .status(500)
      .json({ success: false, error: "Failed to update payment status" });
  }
});

// Get all payments (admin) - add this specific endpoint
router.get("/all-subsequent-payments", async (req, res) => {
  try {
    const payments = await UserSubsequentPayment.getAll();
    res.json({ success: true, payments });
  } catch (err) {
    console.error("Error fetching subsequent payments:", err.message);
    res.status(500).json({ success: false, error: "Server error" });
  }
});
// Get payments by user
router.get("/user/:userId", async (req, res) => {
  try {
    const payments = await UserSubsequentPayment.getByUser(req.params.userId);
    res.json({ success: true, payments });
  } catch (err) {
    console.error("Error fetching user subsequent payments:", err.message);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

// Get all payments (admin)
router.get("/", async (req, res) => {
  try {
    const payments = await UserSubsequentPayment.getAll();
    res.json({ success: true, payments });
  } catch (err) {
    console.error("Error fetching subsequent payments:", err.message);
    res.status(500).json({ success: false, error: "Server error" });
  }
});
// Get all subsequent payments for a specific user
router.get("/user/:userId", async (req, res) => {
  try {
    const userId = req.params.userId;

    const result = await pool.query(`
      SELECT 
        sp.*,
        u.name AS user_name,
        u.email AS user_email,
        p.number AS plot_number,
        pr.amount AS original_amount,
        pr.status AS original_request_status
      FROM subsequent_payments sp
      LEFT JOIN payment_requests pr ON sp.payment_request_id = pr.id
      LEFT JOIN userstable u ON pr.user_id = u.id
      LEFT JOIN plots p ON pr.plot_id = p.id
      WHERE pr.user_id = $1
      ORDER BY sp.created_at DESC
    `, [userId]);

    res.json({
      success: true,
      payments: result.rows,
      count: result.rows.length
    });

  } catch (err) {
    console.error("❌ Error fetching user subsequent payments:", err.message);
    res.status(500).json({
      success: false,
      message: "Server error: " + err.message
    });
  }
});

// Get a specific subsequent payment for a user (with ownership verification)
router.get("/user/:userId/:paymentId", async (req, res) => {
  try {
    const { userId, paymentId } = req.params;

    const result = await pool.query(`
      SELECT 
        sp.*,
        u.name AS user_name,
        u.email AS user_email,
        p.number AS plot_number,
        pr.amount AS original_amount,
        pr.status AS original_request_status
      FROM subsequent_payments sp
      LEFT JOIN payment_requests pr ON sp.payment_request_id = pr.id
      LEFT JOIN userstable u ON pr.user_id = u.id
      LEFT JOIN plots p ON pr.plot_id = p.id
      WHERE sp.id = $1 AND pr.user_id = $2
    `, [paymentId, userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Subsequent payment not found or you don't have access to this payment"
      });
    }

    res.json({
      success: true,
      payment: result.rows[0]
    });

  } catch (err) {
    console.error("❌ Error fetching user subsequent payment:", err.message);
    res.status(500).json({
      success: false,
      message: "Server error: " + err.message
    });
  }
});


module.exports = router;