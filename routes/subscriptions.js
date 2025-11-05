const express = require("express");
const router = express.Router();
const Subscription = require("../models/Subscription");
const upload = require("../middleware/upload");
const pool = require("../config/database");

// Create subscription (with files)
router.post(
  "/",
  upload.fields([
    { name: "passportPhoto", maxCount: 1 },
    { name: "identificationFile", maxCount: 1 },
    { name: "signatureFile", maxCount: 1 },
  ]),
  async (req, res) => {
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');

      const data = req.body;
      console.log("Received subscription data:", data);
      console.log("Received files:", req.files);

      // ✅ IMPROVED: Extract plot IDs from selectedPlotIds
      let plotIds = [];
      
      console.log("Raw selectedPlotIds:", data.selectedPlotIds);
      
      if (data.selectedPlotIds) {
        // Handle array format: selectedPlotIds[0], selectedPlotIds[1], etc.
        if (typeof data.selectedPlotIds === 'object') {
          plotIds = Object.values(data.selectedPlotIds)
            .filter(plotId => plotId && plotId !== '' && plotId !== 'undefined');
        } 
        // Handle single value
        else if (typeof data.selectedPlotIds === 'string') {
          plotIds = [data.selectedPlotIds];
        }
      }
      
      // Fallback to plotId if no selectedPlotIds (backward compatibility)
      if (plotIds.length === 0 && data.plotId) {
        if (Array.isArray(data.plotId)) {
          plotIds = data.plotId.filter(plotId => plotId && plotId !== '');
        } else {
          plotIds = [data.plotId];
        }
      }

      console.log("✅ Processed plot IDs:", plotIds);
      console.log("✅ Number of plots:", plotIds.length);

      // Validate that at least one plot is selected
      if (plotIds.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'At least one plot must be selected'
        });
      }

      // Check if ANY plot is already reserved
      for (const plotId of plotIds) {
        const isReserved = await Subscription.isPlotReserved(plotId);
        if (isReserved) {
          return res.status(400).json({
            success: false,
            error: `Plot ${plotId} is already reserved. Please select another plot.`
          });
        }
      }

      // Process file uploads
      if (req.files) {
        if (req.files["passportPhoto"]) {
          data.passportPhoto = req.files["passportPhoto"][0].filename;
        }
        if (req.files["identificationFile"]) {
          data.identificationFile = req.files["identificationFile"][0].filename;
        }
        if (req.files["signatureFile"]) {
          data.signatureFile = req.files["signatureFile"][0].filename;
        }
      }

      // Convert agreedToTerms to boolean
      if (data.agreedToTerms) {
        data.agreedToTerms = data.agreedToTerms === 'true' || data.agreedToTerms === true;
      }

      // Use the first plot ID for the subscription record (main plot)
      data.plotId = plotIds[0];

      // ✅ FIXED: Set plot_ids field to store all plot IDs as string
      data.plot_ids = plotIds.join(', ');
      console.log("✅ Setting plot_ids:", data.plot_ids);

      // ✅ FIXED: Handle price_per_plot - clean up and ensure single value
      if (data.price_per_plot) {
        // If it's an array, take the first value only
        if (Array.isArray(data.price_per_plot)) {
          data.price_per_plot = data.price_per_plot[0];
          console.log("✅ Fixed price_per_plot array:", data.price_per_plot);
        }
        
        // Clean up the price string - remove duplicates
        if (typeof data.price_per_plot === 'string') {
          const prices = data.price_per_plot.split(',')
            .map(price => price.trim())
            .filter(price => price !== '');
          
          // Take only unique prices
          const uniquePrices = [...new Set(prices)];
          data.price_per_plot = uniquePrices.join(', ');
          console.log("✅ Cleaned price_per_plot:", data.price_per_plot);
        }
      }

      // ✅ FIXED: Calculate total price properly based on individual plot prices
      let totalPrice = 0;
      const individualPrices = [];
      
      try {
        // Get individual plot prices from the database
        for (const plotId of plotIds) {
          const plotQuery = 'SELECT price, number FROM plots WHERE id = $1';
          const plotResult = await client.query(plotQuery, [plotId]);
          
          if (plotResult.rows.length > 0) {
            const plotPrice = parseFloat(plotResult.rows[0].price) || 0;
            const plotNumber = plotResult.rows[0].number;
            individualPrices.push(plotPrice);
            totalPrice += plotPrice;
            console.log(`✅ Plot ${plotId} (${plotNumber}): $${plotPrice}`);
          } else {
            console.warn(`⚠️ Plot ${plotId} not found in database`);
          }
        }
        
        if (totalPrice > 0) {
          data.price = totalPrice;
          // Set price_per_plot based on actual plot prices
          data.price_per_plot = individualPrices.join(', ');
          console.log(`✅ Calculated total price from individual plots: $${totalPrice}`);
          console.log(`✅ Individual plot prices: ${individualPrices.join(', ')}`);
        } else {
          // Fallback: use simple calculation from price_per_plot
          if (data.price_per_plot) {
            const prices = data.price_per_plot.split(',')
              .map(price => parseFloat(price.trim()))
              .filter(price => !isNaN(price));
            
            if (prices.length > 0) {
              totalPrice = prices.reduce((sum, price) => sum + price, 0);
              data.price = totalPrice;
              console.log(`✅ Calculated total price from price_per_plot: $${totalPrice}`);
            }
          }
        }
      } catch (error) {
        console.warn("⚠️ Error calculating price from plots:", error.message);
        // Final fallback: use existing price or calculate from number of plots
        if (!data.price || data.price === 0) {
          data.price = plotIds.length * 50000; // Default price fallback
          console.log(`⚠️ Using fallback price calculation: $${data.price}`);
        }
      }

      // Ensure price is a valid number
      if (data.price && typeof data.price === 'string') {
        data.price = parseFloat(data.price);
      }

      if (isNaN(data.price)) {
        data.price = 0;
      }

      console.log("✅ Final data for subscription:", {
        plotIds: plotIds,
        plot_ids: data.plot_ids,
        price_per_plot: data.price_per_plot,
        total_price: data.price,
        number_of_plots: plotIds.length
      });

      // Create subscription - now includes plot_ids
      const subscription = await Subscription.create(data);

      // ✅ UPDATED: Update ALL selected plots status to "Reserved" and set owner
      console.log(`🔄 Updating ${plotIds.length} plots to Reserved status with owner: ${data.name}`);
      
      const updatedPlots = [];
      for (const plotId of plotIds) {
        const updatePlotQuery = `
          UPDATE plots 
          SET status = 'Reserved', 
              reserved_at = NOW(),
              reserved_by = $1,
              owner = $2,
              updated_at = NOW()
          WHERE id = $3
          RETURNING *;
        `;
        
        const plotResult = await client.query(updatePlotQuery, [
          subscription.id,  // reserved_by (subscription ID)
          data.name,        // owner (user's name)
          plotId            // plot ID
        ]);
        
        if (plotResult.rows.length === 0) {
          console.warn(`⚠️ Plot ${plotId} not found`);
        } else {
          const updatedPlot = plotResult.rows[0];
          updatedPlots.push(updatedPlot);
          console.log(`✅ Plot ${plotId} (${updatedPlot.number}) status updated to Reserved, owner: ${data.name}`);
        }
      }

      await client.query('COMMIT');
      
      res.json({ 
        success: true, 
        message: `Subscription created successfully for ${plotIds.length} plot(s): ${plotIds.join(', ')}`,
        data: {
          ...subscription,
          plotIds: plotIds,
          price_per_plot: data.price_per_plot,
          total_plots: plotIds.length,
          updatedPlots: updatedPlots
        }
      });
      
      console.log(`🎉 Subscription ${subscription.id} created successfully for ${plotIds.length} plots`);
      console.log(`📊 Final details - Plot IDs: ${subscription.plot_ids}, Price: $${subscription.price}`);
      
    } catch (error) {
      await client.query('ROLLBACK');
      console.error("❌ Error creating subscription:", error);
      res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    } finally {
      client.release();
    }
  }
);

// Get ALL subscriptions (for admin)
router.get("/all", async (req, res) => {
  try {
    const subscriptions = await Subscription.getAll();
    res.json({ 
      success: true, 
      count: subscriptions.length,
      data: subscriptions 
    });
  } catch (error) {
    console.error("Error fetching all subscriptions:", error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Get subscription by ID
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const subscription = await Subscription.getById(id);
    
    if (!subscription) {
      return res.status(404).json({ 
        success: false, 
        error: "Subscription not found" 
      });
    }
    
    res.json({ 
      success: true, 
      data: subscription 
    });
  } catch (error) {
    console.error("Error fetching subscription:", error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Get subscriptions by email
router.get("/", async (req, res) => {
  try {
    const { email } = req.query;
    
    if (!email) {
      return res.status(400).json({ 
        success: false, 
        error: "Email parameter is required" 
      });
    }
    
    const subscriptions = await Subscription.findByEmail(email);
    
    res.json({ 
      success: true, 
      count: subscriptions.length,
      data: subscriptions 
    });
    console.log(`Fetched ${subscriptions.length} subscriptions for email: ${email}`);
  } catch (error) {
    console.error("Error fetching subscriptions:", error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Approve a subscription
router.put("/:id/approve", async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const { id } = req.params;
    
    // First, get the subscription
    const subscription = await Subscription.getById(id);
    
    if (!subscription) {
      return res.status(404).json({ 
        success: false, 
        message: "Subscription not found" 
      });
    }

    // Update subscription status
    const updatedSubscription = await Subscription.updateStatus(id, "approved");
    
    // Get all plot IDs associated with this subscription
    let plotIds = [];
    
    console.log("Subscription plot_ids:", subscription.plot_ids);
    console.log("Subscription plot_id:", subscription.plot_id);
    
    // ✅ FIXED: Handle plot_ids properly - it's stored as a string "49, 50"
    if (subscription.plot_ids) {
      if (typeof subscription.plot_ids === 'string') {
        // Convert string "49, 50" to array [49, 50]
        plotIds = subscription.plot_ids.split(',')
          .map(plotId => plotId.trim())
          .filter(plotId => plotId !== '');
      } else if (Array.isArray(subscription.plot_ids)) {
        plotIds = subscription.plot_ids;
      }
    }
    
    // Fallback to single plot_id if no plot_ids found
    if (plotIds.length === 0 && subscription.plot_id) {
      plotIds = [subscription.plot_id];
    }
    
    console.log(`✅ Approving subscription ${id} with ${plotIds.length} plots:`, plotIds);

    // Update ALL selected plots status to "Sold"
    if (plotIds.length > 0) {
      for (const plotId of plotIds) {
        const updatePlotQuery = `
          UPDATE plots 
          SET status = 'Sold', 
              sold_at = NOW(),
              updated_at = NOW()
          WHERE id = $1
          RETURNING *;
        `;
        
        const plotResult = await client.query(updatePlotQuery, [plotId]);
        
        if (plotResult.rows.length === 0) {
          console.warn(`⚠️ Plot ${plotId} not found during approval`);
        } else {
          const updatedPlot = plotResult.rows[0];
          console.log(`✅ Plot ${plotId} (${updatedPlot.number}) status updated to Sold`);
        }
      }
    } else {
      console.warn("⚠️ No plot IDs found for this subscription");
    }

    await client.query('COMMIT');
    
    res.json({ 
      success: true, 
      message: `Subscription approved successfully for ${plotIds.length} plot(s): ${plotIds.join(', ')}`,
      data: {
        ...updatedSubscription,
        plotIds: plotIds
      }
    });
    
    console.log(`🎉 Subscription ${id} approved successfully for ${plotIds.length} plots`);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error("❌ Error approving subscription:", error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  } finally {
    client.release();
  }
});
// Reject a subscription
router.put("/:id/reject", async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const { id } = req.params;
    
    // First, get the subscription
    const subscription = await Subscription.getById(id);
    
    if (!subscription) {
      return res.status(404).json({ 
        success: false, 
        message: "Subscription not found" 
      });
    }

    // Update subscription status
    const updatedSubscription = await Subscription.updateStatus(id, "rejected");
    
    // Get all plot IDs associated with this subscription
    let plotIds = [];
    
    if (subscription.plot_ids && Array.isArray(subscription.plot_ids)) {
      plotIds = subscription.plot_ids;
    } else if (subscription.plot_id) {
      plotIds = [subscription.plot_id];
    }

    console.log(`Rejecting subscription ${id} with plots:`, plotIds);

    // Update ALL selected plots status back to "Available"
    if (plotIds.length > 0) {
      for (const plotId of plotIds) {
        const updatePlotQuery = `
          UPDATE plots 
          SET status = 'Available', 
              reserved_at = NULL,
              reserved_by = NULL,
              sold_at = NULL,
              updated_at = NOW()
          WHERE id = $1
          RETURNING *;
        `;
        
        const plotResult = await client.query(updatePlotQuery, [plotId]);
        
        if (plotResult.rows.length === 0) {
          console.warn(`Plot ${plotId} not found during rejection`);
        } else {
          console.log(`Plot ${plotId} status updated to Available`);
        }
      }
    }

    await client.query('COMMIT');
    
    res.json({ 
      success: true, 
      message: `Subscription rejected successfully for ${plotIds.length} plot(s)`,
      data: {
        ...updatedSubscription,
        plotIds: plotIds
      }
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error("Error rejecting subscription:", error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  } finally {
    client.release();
  }
});

// Update subscription
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    
    // Build dynamic update query
    const setClause = [];
    const values = [];
    let paramCount = 1;

    for (const [key, value] of Object.entries(updates)) {
      setClause.push(`${key} = $${paramCount}`);
      values.push(value);
      paramCount++;
    }

    if (setClause.length === 0) {
      return res.status(400).json({
        success: false,
        error: "No fields to update"
      });
    }

    setClause.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);

    const query = `
      UPDATE subscriptions 
      SET ${setClause.join(', ')}
      WHERE id = $${paramCount}
      RETURNING *
    `;

    const result = await pool.query(query, values);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Subscription not found"
      });
    }

    res.json({
      success: true,
      message: "Subscription updated successfully",
      data: result.rows[0]
    });
  } catch (error) {
    console.error("Error updating subscription:", error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;