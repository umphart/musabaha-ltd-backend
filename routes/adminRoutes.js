const express = require('express');
const jwt = require('jsonwebtoken');
const Admin = require('../models/Admin');

const router = express.Router();

// Helper function
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN,
  });
};

// Admin registration
router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    
    if (!name || !email || !password) {
      return res.status(400).json({ 
        success: false,
        message: 'Please provide all required fields' 
      });
    }
    
    if (password.length < 6) {
      return res.status(400).json({ 
        success: false,
        message: 'Password must be at least 6 characters' 
      });
    }
    
    const adminExists = await Admin.findByEmail(email);
    if (adminExists) {
      return res.status(400).json({ 
        success: false,
        message: 'Admin already exists with this email' 
      });
    }

    const admin = await Admin.create({ name, email, password });

    if (admin) {
      res.status(201).json({
        success: true,
        data: {
          id: admin.id,
          name: admin.name,
          email: admin.email,
        },
        message: 'Admin registered successfully'
      });
    } else {
      res.status(400).json({ 
        success: false,
        message: 'Invalid admin data' 
      });
    }
  } catch (error) {
    console.error('Admin registration error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error during admin registration' 
    });
  }
});

// Admin login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ 
        success: false,
        message: 'Please provide both email and password' 
      });
    }
    
    const admin = await Admin.findByEmail(email);

    if (admin && (await Admin.verifyPassword(password, admin.password))) {
      res.json({
        success: true,
        data: {
          id: admin.id,
          name: admin.name,
          email: admin.email,
          token: generateToken(admin.id),
        },
        message: 'Admin login successful'
      });
    } else {
      res.status(401).json({ 
        success: false,
        message: 'Invalid email or password' 
      });
    }
  } catch (error) {
    console.error('Admin login error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error during admin login' 
    });
  }
});

// Admin profile (protected)
router.get('/me', async (req, res) => {
  try {
    // Check for token
    const token = req.headers.authorization;
    if (!token || !token.startsWith('Bearer ')) {
      return res.status(401).json({ 
        success: false,
        message: 'Not authorized, no token provided' 
      });
    }
    
    // Verify token
    const jwtToken = token.split(' ')[1];
    const decoded = jwt.verify(jwtToken, process.env.JWT_SECRET);
    
    // Get admin from database
    const admin = await Admin.findById(decoded.id);
    
    if (!admin) {
      return res.status(401).json({ 
        success: false,
        message: 'Not authorized, admin not found' 
      });
    }
    
    res.json({
      success: true,
      data: {
        id: admin.id,
        name: admin.name,
        email: admin.email
      },
      message: 'Admin profile retrieved successfully'
    });
    
  } catch (error) {
    console.error('Get admin profile error:', error);
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ 
        success: false,
        message: 'Not authorized, invalid token' 
      });
    }
    res.status(500).json({ 
      success: false,
      message: 'Server error' 
    });
  }
});
// Update payment route - remove /admin prefix since it's already mounted
router.put('/payments/:id', authenticateAdmin, async (req, res) => {
  try {
    const paymentId = req.params.id;
    const paymentData = req.body;
    
    const result = await updatePayment(paymentId, paymentData);
    
    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    console.error('Error in update payment route:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Delete payment route
router.delete('/payments/:id', authenticateAdmin, async (req, res) => {
  try {
    const paymentId = req.params.id;
    
    const result = await deletePayment(paymentId);
    
    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    console.error('Error in delete payment route:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

module.exports = router;