const pool = require('../config/db');
const fs = require('fs');
const path = require('path');

// ================================================
// LEAD CALLS CONTROLLER
// ================================================

/**
 * Ensure lead_calls table exists
 */
const ensureTableExists = async () => {
  try {
    const [tables] = await pool.query("SHOW TABLES LIKE 'lead_calls'");

    if (tables.length === 0) {
      console.log('Creating lead_calls table...');
      const schemaPath = path.join(__dirname, '../migrations/lead_calls_schema.sql');
      const schema = fs.readFileSync(schemaPath, 'utf8');
      
      const statements = schema.split(';').filter(stmt => stmt.trim());
      for (const stmt of statements) {
        if (stmt.trim()) {
          await pool.query(stmt);
        }
      }
      console.log('Lead calls table created successfully');
    }
  } catch (error) {
    console.error('Error ensuring lead_calls table exists:', error);
    throw error;
  }
};

/**
 * GET /api/admin/leads/:lead_id/calls
 * Get all calls for a lead
 */
exports.getCallsByLeadId = async (req, res) => {
  try {
    await ensureTableExists();
    
    const { lead_id } = req.params;
    const { company_id } = req.query;

    if (!company_id) {
      return res.status(400).json({
        success: false,
        error: 'Company ID is required'
      });
    }

    const [calls] = await pool.query(
      `SELECT 
        lc.*,
        u.first_name,
        u.last_name
       FROM lead_calls lc
       LEFT JOIN users u ON lc.created_by = u.id
       WHERE lc.lead_id = ? AND lc.company_id = ?
       ORDER BY lc.call_date DESC, lc.call_time DESC`,
      [lead_id, company_id]
    );

    res.json({
      success: true,
      data: calls
    });
  } catch (error) {
    console.error('Error fetching lead calls:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch lead calls',
      details: error.message
    });
  }
};

/**
 * POST /api/admin/leads/:lead_id/calls
 * Create a new call log
 */
exports.createCall = async (req, res) => {
  try {
    await ensureTableExists();
    
    const { lead_id } = req.params;
    const { company_id } = req.query;
    const callData = req.body;

    if (!company_id) {
      return res.status(400).json({
        success: false,
        error: 'Company ID is required'
      });
    }

    // Validate required fields
    if (!callData.call_date || !callData.phone_number) {
      return res.status(400).json({
        success: false,
        error: 'Call date and phone number are required'
      });
    }

    // Prepare data
    const dataToInsert = {
      company_id,
      lead_id,
      call_date: callData.call_date,
      call_time: callData.call_time || null,
      phone_number: callData.phone_number,
      call_type: callData.call_type || 'Outgoing',
      duration_minutes: callData.duration_minutes || 0,
      subject: callData.subject || null,
      message: callData.message || null,
      created_by: req.user?.id || null
    };

    const [result] = await pool.query(
      'INSERT INTO lead_calls SET ?',
      [dataToInsert]
    );

    // Fetch the created call
    const [newCall] = await pool.query(
      `SELECT 
        lc.*,
        u.first_name,
        u.last_name
       FROM lead_calls lc
       LEFT JOIN users u ON lc.created_by = u.id
       WHERE lc.id = ?`,
      [result.insertId]
    );

    res.status(201).json({
      success: true,
      message: 'Call log created successfully',
      data: newCall[0]
    });
  } catch (error) {
    console.error('Error creating call log:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create call log',
      details: error.message
    });
  }
};

/**
 * PUT /api/admin/leads/:lead_id/calls/:call_id
 * Update a call log
 */
exports.updateCall = async (req, res) => {
  try {
    await ensureTableExists();
    
    const { lead_id, call_id } = req.params;
    const { company_id } = req.query;
    const updates = req.body;

    if (!company_id) {
      return res.status(400).json({
        success: false,
        error: 'Company ID is required'
      });
    }

    // Check if call exists
    const [existing] = await pool.query(
      'SELECT id FROM lead_calls WHERE id = ? AND lead_id = ? AND company_id = ?',
      [call_id, lead_id, company_id]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Call log not found'
      });
    }

    // Update call
    await pool.query(
      'UPDATE lead_calls SET ? WHERE id = ? AND company_id = ?',
      [updates, call_id, company_id]
    );

    // Fetch updated call
    const [updatedCall] = await pool.query(
      `SELECT 
        lc.*,
        u.first_name,
        u.last_name
       FROM lead_calls lc
       LEFT JOIN users u ON lc.created_by = u.id
       WHERE lc.id = ?`,
      [call_id]
    );

    res.json({
      success: true,
      message: 'Call log updated successfully',
      data: updatedCall[0]
    });
  } catch (error) {
    console.error('Error updating call log:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update call log',
      details: error.message
    });
  }
};

/**
 * DELETE /api/admin/leads/:lead_id/calls/:call_id
 * Delete a call log
 */
exports.deleteCall = async (req, res) => {
  try {
    await ensureTableExists();
    
    const { lead_id, call_id } = req.params;
    const { company_id } = req.query;

    if (!company_id) {
      return res.status(400).json({
        success: false,
        error: 'Company ID is required'
      });
    }

    // Check if call exists
    const [existing] = await pool.query(
      'SELECT id FROM lead_calls WHERE id = ? AND lead_id = ? AND company_id = ?',
      [call_id, lead_id, company_id]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Call log not found'
      });
    }

    // Delete call
    await pool.query(
      'DELETE FROM lead_calls WHERE id = ? AND company_id = ?',
      [call_id, company_id]
    );

    res.json({
      success: true,
      message: 'Call log deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting call log:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete call log',
      details: error.message
    });
  }
};

module.exports = exports;

