const pool = require('../config/database');

const Subscription = {
  // Get by ID from both subscriptions and usersTable
  getById: async (id) => {
    try {
      // First try subscriptions table
      const subscriptionQuery = 'SELECT * FROM subscriptions WHERE id = $1';
      const subscriptionResult = await pool.query(subscriptionQuery, [id]);
      
      if (subscriptionResult.rows[0]) {
        const subscription = subscriptionResult.rows[0];
        
        // Parse plot_ids if it exists and is a string
        if (subscription.plot_ids && typeof subscription.plot_ids === 'string') {
          subscription.plot_ids_array = subscription.plot_ids.split(',')
            .map(plotId => plotId.trim())
            .filter(plotId => plotId !== '');
        } else {
          subscription.plot_ids_array = [];
        }
        
        subscription.source = 'subscriptions';
        return subscription;
      }
      
      // If not found in subscriptions, try usersTable
      const usersTableQuery = 'SELECT * FROM usersTable WHERE id = $1';
      const usersTableResult = await pool.query(usersTableQuery, [id]);
      
      if (usersTableResult.rows[0]) {
        const user = usersTableResult.rows[0];
        user.source = 'usersTable';
        return user;
      }
      
      return null;
    } catch (error) {
      console.error('Error in getById:', error);
      throw error;
    }
  },

  // Find by email from both subscriptions and usersTable
  findByEmail: async (email) => {
    try {
      // Query subscriptions table
      const subscriptionQuery = 'SELECT * FROM subscriptions WHERE email = $1 ORDER BY created_at DESC';
      const subscriptionResult = await pool.query(subscriptionQuery, [email]);
      
      // Query usersTable
      const usersTableQuery = 'SELECT * FROM usersTable WHERE email = $1 ORDER BY created_at DESC';
      const usersTableResult = await pool.query(usersTableQuery, [email]);
      
      // Combine results and add source identifier
      const subscriptionData = subscriptionResult.rows.map(item => ({
        ...item,
        source: 'subscriptions'
      }));
      
      const usersTableData = usersTableResult.rows.map(item => ({
        ...item,
        source: 'usersTable'
      }));
      
      return [...subscriptionData, ...usersTableData];
    } catch (error) {
      console.error('Error in findByEmail:', error);
      throw error;
    }
  },

  // Optional: Unified method to get from specific source
  getByIdFromSource: async (id, source) => {
    try {
      if (source === 'subscriptions') {
        const query = 'SELECT * FROM subscriptions WHERE id = $1';
        const result = await pool.query(query, [id]);
        if (result.rows[0]) {
          const item = result.rows[0];
          item.source = 'subscriptions';
          return item;
        }
      } else if (source === 'usersTable') {
        const query = 'SELECT * FROM usersTable WHERE id = $1';
        const result = await pool.query(query, [id]);
        if (result.rows[0]) {
          const item = result.rows[0];
          item.source = 'usersTable';
          return item;
        }
      }
      return null;
    } catch (error) {
      console.error('Error in getByIdFromSource:', error);
      throw error;
    }
  },

  // Your existing methods remain the same
  create: async (data) => {
    // ... your existing create method code
    const fieldMap = {
      title: 'title',
      name: 'name',
      residentialAddress: 'residential_address',
      occupation: 'occupation',
      officeAddress: 'office_address',
      dob: 'dob',
      stateOfOrigin: 'state_of_origin',
      lga: 'lga',
      sex: 'sex',
      phoneNumber: 'phone_number', 
      nationality: 'nationality',
      homeNumber: 'home_number',
      email: 'email',
      identification: 'identification',
      passportPhoto: 'passport_photo',
      identificationFile: 'identification_file',
      nextOfKinName: 'next_of_kin_name',
      nextOfKinAddress: 'next_of_kin_address',
      nextOfKinRelationship: 'next_of_kin_relationship',
      nextOfKinPhoneNumber: 'next_of_kin_phone_number', 
      nextOfKinOccupation: 'next_of_kin_occupation',
      nextOfKinOfficeAddress: 'next_of_kin_office_address',
      layoutName: 'layout_name', 
      numberOfPlots: 'number_of_plots',
      proposedUse: 'proposed_use',
      proposedType: 'proposed_type',
      plotSize: 'plot_size',
      paymentTerms: 'payment_terms',
      price: 'price',
      price_per_plot: 'price_per_plot',
      agreedToTerms: 'agreed_to_terms',
      signatureText: 'signature_text',
      signatureFile: 'signature_file',
      plotId: 'plot_id',
      plot_ids: 'plot_ids',
    };

    const columns = [];
    const values = [];
    const placeholders = [];
    
    let paramCount = 1;
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined && value !== null && fieldMap[key]) {
        columns.push(fieldMap[key]);
        values.push(value);
        placeholders.push(`$${paramCount}`);
        paramCount++;
      }
    }

    columns.push('created_at');
    values.push(new Date());
    placeholders.push(`$${paramCount}`);

    if (columns.length === 0) {
      throw new Error('No valid data provided for insertion');
    }

    const query = `
      INSERT INTO subscriptions (${columns.join(', ')})
      VALUES (${placeholders.join(', ')})
      RETURNING *;
    `;

    try {
      console.log('Executing query:', query);
      console.log('With values:', values);
      
      const result = await pool.query(query, values);
      return result.rows[0];
    } catch (error) {
      console.error('Database error:', error);
      throw error;
    }
  },

  getAll: async () => {
    const query = 'SELECT * FROM subscriptions ORDER BY created_at DESC';
    const result = await pool.query(query);
    return result.rows;
  },

  updateStatus: async (id, status) => {
    const query = "UPDATE subscriptions SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *";
    const values = [status, id];
    const result = await pool.query(query, values);
    return result.rows[0];
  },

  isPlotReserved: async (plotId) => {
    const query = 'SELECT * FROM subscriptions WHERE plot_id = $1 AND status IN ($2, $3)';
    const result = await pool.query(query, [plotId, 'pending', 'approved']);
    return result.rows.length > 0;
  }
};

module.exports = Subscription;
