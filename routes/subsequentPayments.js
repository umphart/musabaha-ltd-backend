const express = require("express");
const router = express.Router();
const pool = require("../config/database");
const multer = require("multer");
const path = require("path");

// ✅ Upload receipt
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, "../uploads/receipts"));
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + "-" + file.originalname);
  }
});
const upload = multer({ storage });

/**
 * ✅ POST /api/subsequent-payments
 */
router.post("/", upload.single("receipt"), async (req, res) => {
  try {
    const {
      userId,
      plotId,
      amount,
      paymentMethod,
      transactionDate,
      notes
    } = req.body;

    console.log("📥 Received payment request:", {
      userId,
      plotId,
      amount,
      paymentMethod,
      transactionDate,
      notes
    });
    console.log("📁 File:", req.file ? req.file.filename : "No file");

    // Validate required fields
    if (!userId) {
      return res.status(400).json({ 
        success: false, 
        message: "User ID is required" 
      });
    }

    if (!amount) {
      return res.status(400).json({ 
        success: false, 
        message: "Amount is required" 
      });
    }

    // ✅ FIXED: Handle undefined plotId properly
    let processedPlotId = plotId;
    if (!plotId || plotId === 'undefined' || plotId === 'null') {
      processedPlotId = null;
    }

    // ✅ FIXED: Try different table name variations
    let userCheck;
    try {
      // Try lowercase first (most common)
      userCheck = await pool.query(
        'SELECT id FROM userstable WHERE id = $1',
        [userId]
      );
    } catch (firstError) {
      try {
        // Try with capital T if lowercase fails
        userCheck = await pool.query(
          'SELECT id FROM "usersTable" WHERE id = $1',
          [userId]
        );
      } catch (secondError) {
        try {
          // Try just 'users' as table name
          userCheck = await pool.query(
            'SELECT id FROM users WHERE id = $1',
            [userId]
          );
        } catch (thirdError) {
          console.error("All table name attempts failed:");
          console.error("userstable:", firstError.message);
          console.error('"usersTable":', secondError.message);
          console.error("users:", thirdError.message);
          throw new Error("Could not find users table");
        }
      }
    }

    if (userCheck.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: "User not found"
      });
    }

    // Verify plot exists if plotId is provided and valid
    if (processedPlotId && processedPlotId !== 'undefined') {
      let plotCheck;
      try {
        plotCheck = await pool.query(
          'SELECT id FROM plots WHERE id = $1',
          [processedPlotId]
        );
        
        if (plotCheck.rows.length === 0) {
          console.warn(`⚠️ Plot ID ${processedPlotId} not found, but continuing...`);
        }
      } catch (plotError) {
        console.warn("⚠️ Plot check failed, but continuing:", plotError.message);
      }
    }

    const receiptFile = req.file ? req.file.filename : null;

    const result = await pool.query(
      `INSERT INTO payment_requests
        (user_id, plot_id, amount, payment_method, transaction_date, notes, receipt_file, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
       RETURNING *`,
      [
        userId,
        processedPlotId, // Use the processed value
        parseFloat(amount),
        paymentMethod || 'bank_transfer',
        transactionDate || new Date(),
        notes || "",
        receiptFile
      ]
    );

    console.log("✅ Payment request saved successfully. ID:", result.rows[0].id);

    res.json({ 
      success: true, 
      message: "Payment request submitted successfully",
      request: result.rows[0] 
    });

  } catch (err) {
    console.error("❌ Error saving payment request:", err.message);
    res.status(500).json({ 
      success: false, 
      message: "Server error: " + err.message 
    });
  }
});

router.get("/payment-requests", async (req, res) => {
  try {
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
      ORDER BY pr.id DESC
    `);

    res.json({
      success: true,
      requests: result.rows
    });
  } catch (err) {
    console.error("❌ Error fetching payment requests:", err.message);
    res.status(500).json({
      success: false,
      message: "Server error: " + err.message
    });
  }
});

router.get("/payment-requests/:id", async (req, res) => {
  try {
    const requestId = req.params.id;

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
      WHERE pr.id = $1
    `, [requestId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Payment request not found"
      });
    }

    res.json({
      success: true,
      request: result.rows[0]
    });

  } catch (err) {
    console.error("❌ Error fetching payment request:", err.message);
    res.status(500).json({
      success: false,
      message: "Server error: " + err.message
    });
  }
});
router.put("/payment-requests/:id/approve", async (req, res) => { 
  const requestId = req.params.id;
  const { user_id } = req.body; // Get user_id from request body

  try {
    const requestResult = await pool.query(
      `SELECT * FROM payment_requests WHERE id = $1`,
      [requestId]
    );

    if (requestResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Payment request not found" });
    }

    const requestData = requestResult.rows[0];
    const userId = user_id || requestData.user_id; // Use provided user_id or fallback to request data
    const amountPaid = parseFloat(requestData.amount);

    // ✅ Try user_id
    let userResult = await pool.query(
      `SELECT total_balance FROM userstable WHERE user_id = $1`,
      [userId]
    );

    // ❗ If not found, try id instead
    if (userResult.rows.length === 0) {
      userResult = await pool.query(
        `SELECT total_balance FROM userstable WHERE id = $1`,
        [userId]
      );
    }

    if (userResult.rows.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: `User not found in userstable for id/user_id: ${userId}` 
      });
    }

    const currentBalance = parseFloat(userResult.rows[0].total_balance);
    const newBalance = currentBalance - amountPaid;

    await pool.query("BEGIN");

    await pool.query(
      `UPDATE payment_requests SET status = 'approved' WHERE id = $1`,
      [requestId]
    );

    // ✅ Update using correct column
    if (newBalance <= 0) {
      await pool.query(
        `UPDATE userstable 
         SET total_balance = 0, status = 'Completed'
         WHERE user_id = $1 OR id = $1`,
        [userId]
      );
    } else {
      await pool.query(
        `UPDATE userstable 
         SET total_balance = $1 
         WHERE user_id = $2 OR id = $2`,
        [newBalance, userId]
      );
    }

    await pool.query("COMMIT");

    res.json({
      success: true,
      message: "✅ Payment approved successfully!",
      new_balance: newBalance <= 0 ? 0 : newBalance,
    });

  } catch (err) {
    await pool.query("ROLLBACK");
    console.error("❌ Error approving payment:", err.message);
    res.status(500).json({ success: false, message: "Server error: " + err.message });
  }
});

router.put("/payment-requests/:id/reject", async (req, res) => {
  const requestId = req.params.id;

  try {
    const result = await pool.query(
      `UPDATE payment_requests 
       SET status = 'rejected' 
       WHERE id = $1 
       RETURNING *`,
      [requestId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Payment request not found" });
    }

    res.json({
      success: true,
      message: "❌ Payment rejected successfully",
      request: result.rows[0]
    });

  } catch (err) {
    console.error("❌ Error rejecting payment:", err.message);
    res.status(500).json({
      success: false,
      message: "Server error: " + err.message
    });
  }
});


module.exports = router;