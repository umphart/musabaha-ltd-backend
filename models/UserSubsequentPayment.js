const pool = require("../config/database");

const UserSubsequentPayment = {
  async create(paymentData) {
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
      receipt_file,
    } = paymentData;

    const query = `
      INSERT INTO userSubsequentPayments
      (user_id, user_name, user_contact, plot_id, number_of_plots, plot_size, 
       total_price, outstanding_balance, amount, payment_method, 
       transaction_reference, note, receipt_file, status, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'pending', NOW())
      RETURNING *
    `;

    const values = [
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
      receipt_file,
    ];

    const result = await pool.query(query, values);
    return result.rows[0];
  },

async updateStatus(paymentId, status) {
  // Update status in userSubsequentPayments
  const query = `
    UPDATE userSubsequentPayments
    SET status = $1, updated_at = NOW()
    WHERE id = $2
    RETURNING *
  `;
  const result = await pool.query(query, [status, paymentId]);
  const payment = result.rows[0];

  if (payment && status === "approved") {
    // 1️⃣ Deduct from outstanding_balance in userSubsequentPayments
    const updateOutstandingQuery = `
      UPDATE userSubsequentPayments
      SET outstanding_balance = GREATEST(outstanding_balance - amount, 0)
      WHERE id = $1
      RETURNING *
    `;
    const updatedPayment = await pool.query(updateOutstandingQuery, [paymentId]);
    const finalPayment = updatedPayment.rows[0];

    // 2️⃣ Deduct from outstanding_balance in userPayments (main table)
    const updateUserPaymentsQuery = `
      UPDATE userPayments
      SET outstanding_balance = GREATEST(outstanding_balance - $1, 0)
      WHERE user_id = $2
      RETURNING *
    `;
    await pool.query(updateUserPaymentsQuery, [finalPayment.amount, finalPayment.user_id]);

    return finalPayment;
  }

  return payment;
}
,

  async getByUser(userId) {
    const result = await pool.query(
      `SELECT * FROM userSubsequentPayments 
       WHERE user_id = $1 
       ORDER BY created_at DESC`,
      [userId]
    );
    return result.rows;
  },

  async getAll() {
    const result = await pool.query(
      `SELECT * FROM userSubsequentPayments ORDER BY created_at DESC`
    );
    return result.rows;
  },
};

module.exports = UserSubsequentPayment;