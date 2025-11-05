// models/Admin.js
const pool = require('../config/database');
const bcrypt = require('bcryptjs');

const Admin = {
  // ====================== Admin ======================

  async create(adminData) {
    const { name, email, password } = adminData;
    const hashedPassword = await bcrypt.hash(password, 10);

    const query = `
      INSERT INTO admins (name, email, password)
      VALUES ($1, $2, $3)
      RETURNING id, name, email, created_at, updated_at
    `;

    const values = [name, email, hashedPassword];

    try {
      const result = await pool.query(query, values);
      return result.rows[0];
    } catch (error) {
      if (error.code === '23505') {
        throw new Error('Admin with this email already exists');
      }
      throw error;
    }
  },

  async findByEmail(email) {
    const query = 'SELECT * FROM admins WHERE email = $1';
    const result = await pool.query(query, [email]);
    return result.rows[0];
  },

  async findById(id) {
    const query = 'SELECT id, name, email, created_at, updated_at FROM admins WHERE id = $1';
    const result = await pool.query(query, [id]);
    return result.rows[0];
  },

  async verifyPassword(plainPassword, hashedPassword) {
    return await bcrypt.compare(plainPassword, hashedPassword);
  },

  // ====================== Users (usersTable) ======================

  async createUser(userData) {
    // Use the actual keys from the object instead of destructuring
    const name = userData.name;
    const email = userData.email;
    const contact = userData.contact;
    const plot_taken = userData.plot_taken;
    const date_taken = userData.date_taken;
    const initial_deposit = userData.initial_deposit;
    const price_per_plot = userData.price_per_plot;
    const payment_schedule = userData.payment_schedule;
    const total_money_to_pay = userData.total_money_to_pay;
    const plot_number = userData.plot_number;
    
    // Try different possible key names for plot_size and location
    const plot_size = userData.plot_size || userData.plotSize || userData['plot-size'] || userData.PLOT_SIZE ;
    const location = userData.location || userData.Location || userData.LOCATION ;

    // Add validation for required fields
    if (!name || !email || !contact) {
      throw new Error('Name, email, and contact are required fields');
    }

    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      
      console.log('Creating user with email:', email);
      
      // Generate password from contact number for login user
      const password = contact;
      const hashedPassword = await bcrypt.hash(password, 10);
      
      // 1. First create login user in 'users' table
      const loginUserQuery = `
        INSERT INTO users (name, email, password) 
        VALUES ($1, $2, $3) 
        RETURNING id, name, email, created_at
      `;
      
      const loginUserValues = [name, email, hashedPassword];
      const loginUserResult = await client.query(loginUserQuery, loginUserValues);
      const loginUser = loginUserResult.rows[0];

      const initialDepositValue = parseFloat(initial_deposit) || 0;
      const total_balance = total_money_to_pay - initialDepositValue;
      const status = initialDepositValue >= total_money_to_pay ? 'Completed' : 'Active';

      // Calculate number of plots from plot_taken string
      const plotCount = plot_number || (plot_taken ? plot_taken.split(',').length : 1);

      // 2. Insert customer record in 'usersTable' with reference to login user id
      const userQuery = `
        INSERT INTO usersTable 
        (user_id, name, email, contact, plot_taken, date_taken, initial_deposit, price_per_plot, 
         payment_schedule, total_balance, total_money_to_pay, status, plot_number, plot_size, location, owner)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
        RETURNING *
      `;

      const userValues = [
        loginUser.id,
        name,
        email,
        contact,
        plot_taken,
        date_taken,
        initial_deposit,
        price_per_plot,
        payment_schedule,
        total_balance,
        total_money_to_pay,
        status,
        plotCount,
        plot_size,
        location,
        name  // owner is set to the customer's name
      ];

      const userResult = await client.query(userQuery, userValues);
      const newUser = userResult.rows[0];

      // 3. Update plots status
      if (plot_taken) {
        const plotNumbers = plot_taken.split(',').map(plot => plot.trim());
        
        for (const plotNumber of plotNumbers) {
          const updatePlotQuery = `
            UPDATE plots 
            SET status = 'Sold', 
                owner = $1, 
                reserved_at = NOW(), 
                updated_at = NOW()
            WHERE number = $2 AND status = 'Available'
            RETURNING *
          `;
          
          const plotValues = [name, plotNumber];
          await client.query(updatePlotQuery, plotValues);
        }
      }

      await client.query('COMMIT');
      
      return {
        ...newUser,
        login_user: {
          id: loginUser.id,
          email: loginUser.email,
          password: contact
        }
      };

    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error creating user and updating plots:', error);
      
      if (error.code === '23505') {
        throw new Error('User with this email already exists');
      } else if (error.code === '23502') {
        throw new Error('Required field is missing: ' + error.column);
      }
      throw error;
    } finally {
      client.release();
    }
  },

  // Update getAllUsers to join with users table if needed
  async getAllUsers() {
    const query = `
      SELECT ut.*, u.email as login_email 
      FROM usersTable ut 
      LEFT JOIN users u ON ut.user_id = u.id 
      ORDER BY ut.id ASC
    `;
    const result = await pool.query(query);
    
    // For each user, calculate current balance based on initial deposit + payments
    const usersWithUpdatedBalance = await Promise.all(
      result.rows.map(async (user) => {
        const payments = await this.getPaymentsByUser(user.id);
        const totalSubsequentPayments = payments.reduce((sum, payment) => sum + parseFloat(payment.amount), 0);
        const totalPaid = parseFloat(user.initial_deposit || 0) + totalSubsequentPayments;
        const currentBalance = Math.max(0, parseFloat(user.total_money_to_pay) - totalPaid);
        
        // Update status if fully paid
        let status = user.status;
        if (currentBalance <= 0 && user.status !== 'Completed') {
          status = 'Completed';
          // Update user status in database
          await pool.query(
            'UPDATE usersTable SET status = $1, total_balance = $2 WHERE id = $3',
            [status, 0, user.id]
          );
        } else if (currentBalance > 0 && user.status === 'Completed') {
          status = 'Active';
          // Update user status if somehow it was marked completed but has balance
          await pool.query(
            'UPDATE usersTable SET status = $1, total_balance = $2 WHERE id = $3',
            [status, currentBalance, user.id]
          );
        } else {
          // Update balance only (status remains the same)
          await pool.query(
            'UPDATE usersTable SET total_balance = $1 WHERE id = $2',
            [currentBalance, user.id]
          );
        }

        return {
          ...user,
          total_balance: currentBalance,
          total_paid: totalPaid,
          status: status,
          payments: payments
        };
      })
    );

    return usersWithUpdatedBalance;
  },

  // Update getUserById to include login email
  async getUserById(userId) {
    const query = `
      SELECT ut.*, u.email as login_email 
      FROM usersTable ut 
      LEFT JOIN users u ON ut.user_id = u.id 
      WHERE ut.id = $1
    `;
    const result = await pool.query(query, [userId]);
    
    if (result.rows.length === 0) {
      return null;
    }

    const user = result.rows[0];
    const payments = await this.getPaymentsByUser(userId);
    const totalSubsequentPayments = payments.reduce((sum, payment) => sum + parseFloat(payment.amount), 0);
    const totalPaid = parseFloat(user.initial_deposit || 0) + totalSubsequentPayments;
    const currentBalance = Math.max(0, parseFloat(user.total_money_to_pay) - totalPaid);
    
    // Update status if fully paid
    let status = user.status;
    if (currentBalance <= 0 && user.status !== 'Completed') {
      status = 'Completed';
      // Update user status in database
      await pool.query(
        'UPDATE usersTable SET status = $1, total_balance = $2 WHERE id = $3',
        [status, 0, userId]
      );
    } else if (currentBalance > 0 && user.status === 'Completed') {
      status = 'Active';
      // Update user status if somehow it was marked completed but has balance
      await pool.query(
        'UPDATE usersTable SET status = $1, total_balance = $2 WHERE id = $3',
        [status, currentBalance, userId]
      );
    } else {
      // Update balance only (status remains the same)
      await pool.query(
        'UPDATE usersTable SET total_balance = $1 WHERE id = $2',
        [currentBalance, userId]
      );
    }

    return {
      ...user,
      total_balance: currentBalance,
      total_paid: totalPaid,
      status: status,
      payments: payments // Include payments in the response
    };
  },

  // ====================== Payments ======================

  async createPayment(paymentData) {
    const { user_id, amount, date, note, admin, recorded_by } = paymentData;

    // ✅ Use recorded_by if provided, otherwise fallback to admin
    const recorder = recorded_by || admin;

    // Start transaction
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // 1. Create the payment
      const paymentQuery = `
        INSERT INTO payments (user_id, amount, date, note, recorded_by)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
      `;
      const paymentValues = [user_id, amount, date, note, recorder];
      const paymentResult = await client.query(paymentQuery, paymentValues);
      const payment = paymentResult.rows[0];

      // 2. Get user details
      const userQuery = 'SELECT * FROM usersTable WHERE id = $1';
      const userResult = await client.query(userQuery, [user_id]);
      const user = userResult.rows[0];

      if (!user) {
        throw new Error('User not found');
      }

      // 3. Get all payments for this user (including the new one)
      const paymentsQuery = 'SELECT * FROM payments WHERE user_id = $1';
      const paymentsResult = await client.query(paymentsQuery, [user_id]);
      const userPayments = paymentsResult.rows;

      const totalSubsequentPayments = userPayments.reduce(
        (sum, p) => sum + parseFloat(p.amount || 0),
        0
      );
      const totalPaid =
        parseFloat(user.initial_deposit || 0) + totalSubsequentPayments;
      const currentBalance = Math.max(
        0,
        parseFloat(user.total_money_to_pay || 0) - totalPaid
      );

      // 4. Update user balance and status
      let status = user.status;
      if (currentBalance <= 0) {
        status = 'Completed';
      } else if (currentBalance > 0 && status === 'Completed') {
        status = 'Active';
      }

      const updateUserQuery = `
        UPDATE usersTable 
        SET total_balance = $1, status = $2, updated_at = CURRENT_TIMESTAMP
        WHERE id = $3
      `;
      const updateValues = [currentBalance, status, user_id];
      await client.query(updateUserQuery, updateValues);

      await client.query('COMMIT');

      return {
        success: true,
        payment: {
          ...payment,
          user_balance: currentBalance,
          user_status: status,
          total_paid: totalPaid
        }
      };
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error creating payment:', error);
      return {
        success: false,
        message: error.message || 'Failed to create payment'
      };
    } finally {
      client.release();
    }
  },

  // Update Payment Function - CORRECTED
  async updatePayment(paymentId, paymentData) {
    const { amount, date, note, admin, recorded_by } = paymentData;
    
    // ✅ Use recorded_by if provided, otherwise fallback to admin
    const recorder = recorded_by || admin;

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // 1. Get the existing payment to find user_id
      const existingPaymentQuery = 'SELECT * FROM payments WHERE id = $1';
      const existingPaymentResult = await client.query(existingPaymentQuery, [paymentId]);
      const existingPayment = existingPaymentResult.rows[0];

      if (!existingPayment) {
        throw new Error('Payment not found');
      }

      const user_id = existingPayment.user_id;

      // 2. Update the payment
      const updatePaymentQuery = `
        UPDATE payments 
        SET amount = $1, date = $2, note = $3, recorded_by = $4, updated_at = CURRENT_TIMESTAMP
        WHERE id = $5
        RETURNING *
      `;
      const updatePaymentValues = [amount, date, note, recorder, paymentId];
      const updateResult = await client.query(updatePaymentQuery, updatePaymentValues);
      const updatedPayment = updateResult.rows[0];

      // 3. Get user details
      const userQuery = 'SELECT * FROM usersTable WHERE id = $1';
      const userResult = await client.query(userQuery, [user_id]);
      const user = userResult.rows[0];

      if (!user) {
        throw new Error('User not found');
      }

      // 4. Recalculate user balance and status
      const paymentsQuery = 'SELECT * FROM payments WHERE user_id = $1';
      const paymentsResult = await client.query(paymentsQuery, [user_id]);
      const userPayments = paymentsResult.rows;

      const totalSubsequentPayments = userPayments.reduce(
        (sum, p) => sum + parseFloat(p.amount || 0),
        0
      );
      const totalPaid =
        parseFloat(user.initial_deposit || 0) + totalSubsequentPayments;
      const currentBalance = Math.max(
        0,
        parseFloat(user.total_money_to_pay || 0) - totalPaid
      );

      // 5. Update user balance and status
      let status = user.status;
      if (currentBalance <= 0) {
        status = 'Completed';
      } else if (currentBalance > 0 && status === 'Completed') {
        status = 'Active';
      }

      const updateUserQuery = `
        UPDATE usersTable 
        SET total_balance = $1, status = $2, updated_at = CURRENT_TIMESTAMP
        WHERE id = $3
      `;
      const updateValues = [currentBalance, status, user_id];
      await client.query(updateUserQuery, updateValues);

      await client.query('COMMIT');

      return {
        success: true,
        payment: {
          ...updatedPayment,
          user_balance: currentBalance,
          user_status: status,
          total_paid: totalPaid
        }
      };
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error updating payment:', error);
      return {
        success: false,
        message: error.message || 'Failed to update payment'
      };
    } finally {
      client.release();
    }
  },

  // Delete Payment Function - CORRECTED
  async deletePayment(paymentId) {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // 1. Get the payment to find user_id
      const paymentQuery = 'SELECT * FROM payments WHERE id = $1';
      const paymentResult = await client.query(paymentQuery, [paymentId]);
      const payment = paymentResult.rows[0];

      if (!payment) {
        throw new Error('Payment not found');
      }

      const user_id = payment.user_id;

      // 2. Delete the payment
      const deleteQuery = 'DELETE FROM payments WHERE id = $1';
      await client.query(deleteQuery, [paymentId]);

      // 3. Get user details
      const userQuery = 'SELECT * FROM usersTable WHERE id = $1';
      const userResult = await client.query(userQuery, [user_id]);
      const user = userResult.rows[0];

      if (!user) {
        throw new Error('User not found');
      }

      // 4. Recalculate user balance and status after deletion
      const paymentsQuery = 'SELECT * FROM payments WHERE user_id = $1';
      const paymentsResult = await client.query(paymentsQuery, [user_id]);
      const userPayments = paymentsResult.rows;

      const totalSubsequentPayments = userPayments.reduce(
        (sum, p) => sum + parseFloat(p.amount || 0),
        0
      );
      const totalPaid =
        parseFloat(user.initial_deposit || 0) + totalSubsequentPayments;
      const currentBalance = Math.max(
        0,
        parseFloat(user.total_money_to_pay || 0) - totalPaid
      );

      // 5. Update user balance and status
      let status = user.status;
      if (currentBalance <= 0) {
        status = 'Completed';
      } else if (currentBalance > 0 && status === 'Completed') {
        status = 'Active';
      }

      const updateUserQuery = `
        UPDATE usersTable 
        SET total_balance = $1, status = $2, updated_at = CURRENT_TIMESTAMP
        WHERE id = $3
      `;
      const updateValues = [currentBalance, status, user_id];
      await client.query(updateUserQuery, updateValues);

      await client.query('COMMIT');

      return {
        success: true,
        message: 'Payment deleted successfully',
        user_balance: currentBalance,
        user_status: status
      };
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error deleting payment:', error);
      return {
        success: false,
        message: error.message || 'Failed to delete payment'
      };
    } finally {
      client.release();
    }
  },

  async requestPayment(paymentData) {
    const { user_id, amount, date, note, admin, recorded_by } = paymentData;
    const recorder = recorded_by || admin;

    const query = `
      INSERT INTO payment_requests (user_id, amount, date, note, recorded_by)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `;
    const values = [user_id, amount, date, note, recorder];

    const result = await pool.query(query, values);
    return { success: true, request: result.rows[0] };
  },

  async getPaymentsByUser(userId) {
    const query = `
      SELECT * FROM payments 
      WHERE user_id = $1 
      ORDER BY date DESC, created_at DESC
    `;
    const result = await pool.query(query, [userId]);
    return result.rows;
  },

  // ====================== Helper function to calculate total money to pay ======================
  async calculateTotalMoneyToPay(plotTaken, pricePerPlot) {
    try {
      if (!plotTaken || !pricePerPlot) return 0;
      
      // Parse plot_taken (e.g., "Plot 1, Plot 2, Plot 3")
      const plots = plotTaken.split(',').map(plot => plot.trim());
      const numberOfPlots = plots.length;
      
      // Parse price_per_plot (comma-separated string of prices)
      const prices = pricePerPlot.split(',').map(price => {
        const parsed = parseFloat(price.trim());
        return isNaN(parsed) ? 0 : parsed;
      });
      
      // Calculate total money to pay
      let total = 0;
      for (let i = 0; i < Math.min(numberOfPlots, prices.length); i++) {
        total += prices[i];
      }
      
      return total;
    } catch (error) {
      console.error('Error calculating total money to pay:', error);
      return 0;
    }
  },

  // ====================== Helper to get user with detailed financial info ======================
  async getUserFinancialDetails(userId) {
    const user = await this.getUserById(userId);
    if (!user) return null;

    const payments = await this.getPaymentsByUser(userId);
    const totalSubsequentPayments = payments.reduce((sum, payment) => sum + parseFloat(payment.amount), 0);
    const totalPaid = parseFloat(user.initial_deposit || 0) + totalSubsequentPayments;
    const currentBalance = Math.max(0, parseFloat(user.total_money_to_pay) - totalPaid);

    return {
      ...user,
      initial_deposit: parseFloat(user.initial_deposit || 0),
      total_subsequent_payments: totalSubsequentPayments,
      total_paid: totalPaid,
      remaining_balance: currentBalance,
      is_completed: currentBalance <= 0,
      payment_progress: (totalPaid / parseFloat(user.total_money_to_pay)) * 100
    };
  }
};

module.exports = Admin;