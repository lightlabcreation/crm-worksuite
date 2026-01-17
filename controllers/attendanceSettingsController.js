const pool = require('../config/db');

// ================================================
// ATTENDANCE SETTINGS CONTROLLER
// ================================================

/**
 * Ensure attendance_settings table exists
 */
const ensureTablesExist = async () => {
  try {
    // Check if attendance_settings table exists
    const [tables] = await pool.query(
      "SHOW TABLES LIKE 'attendance_settings'"
    );

    if (tables.length === 0) {
      console.log('Creating attendance_settings table...');
      // Execute schema from migration file
      const fs = require('fs');
      const path = require('path');
      const schemaPath = path.join(__dirname, '../migrations/attendance_settings_schema.sql');
      const schema = fs.readFileSync(schemaPath, 'utf8');
      
      // Split by semicolon and execute each statement
      const statements = schema.split(';').filter(stmt => stmt.trim());
      for (const stmt of statements) {
        if (stmt.trim()) {
          await pool.query(stmt);
        }
      }
      console.log('Attendance settings tables created successfully');
    }
  } catch (error) {
    console.error('Error ensuring tables exist:', error);
    throw error;
  }
};

/**
 * GET /api/admin/attendance-settings
 * Fetch attendance settings for a company
 */
exports.getAttendanceSettings = async (req, res) => {
  try {
    await ensureTablesExist();
    
    const { company_id } = req.query;
    
    if (!company_id) {
      return res.status(400).json({
        success: false,
        error: 'Company ID is required'
      });
    }

    // Fetch settings
    const [settings] = await pool.query(
      `SELECT * FROM attendance_settings WHERE company_id = ?`,
      [company_id]
    );

    // If no settings exist, create default
    if (settings.length === 0) {
      const defaultSettings = {
        company_id,
        allow_shift_change_request: 0,
        save_clock_in_location: 0,
        allow_employee_self_clock_in_out: 1,
        auto_clock_in_first_login: 0,
        clock_in_location_radius_check: 0,
        clock_in_location_radius_value: 0,
        allow_clock_in_outside_shift: 0,
        clock_in_ip_check: 0,
        clock_in_ip_addresses: JSON.stringify([]),
        send_monthly_report_email: 0,
        week_starts_from: 'Monday',
        attendance_reminder_status: 0
      };

      await pool.query(
        `INSERT INTO attendance_settings SET ?`,
        [defaultSettings]
      );

      const [newSettings] = await pool.query(
        `SELECT * FROM attendance_settings WHERE company_id = ?`,
        [company_id]
      );

      return res.json({
        success: true,
        data: {
          ...newSettings[0],
          clock_in_ip_addresses: JSON.parse(newSettings[0].clock_in_ip_addresses || '[]')
        }
      });
    }

    res.json({
      success: true,
      data: {
        ...settings[0],
        clock_in_ip_addresses: JSON.parse(settings[0].clock_in_ip_addresses || '[]')
      }
    });
  } catch (error) {
    console.error('Error fetching attendance settings:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch attendance settings',
      details: error.message
    });
  }
};

/**
 * PUT /api/admin/attendance-settings
 * Update attendance settings for a company
 */
exports.updateAttendanceSettings = async (req, res) => {
  try {
    await ensureTablesExist();
    
    const { company_id } = req.query;
    const updates = req.body;

    if (!company_id) {
      return res.status(400).json({
        success: false,
        error: 'Company ID is required'
      });
    }

    // Convert IP addresses array to JSON string
    if (updates.clock_in_ip_addresses && Array.isArray(updates.clock_in_ip_addresses)) {
      updates.clock_in_ip_addresses = JSON.stringify(updates.clock_in_ip_addresses);
    }

    // Check if settings exist
    const [existing] = await pool.query(
      `SELECT id FROM attendance_settings WHERE company_id = ?`,
      [company_id]
    );

    if (existing.length === 0) {
      // Insert new settings
      updates.company_id = company_id;
      await pool.query(
        `INSERT INTO attendance_settings SET ?`,
        [updates]
      );
    } else {
      // Update existing settings
      await pool.query(
        `UPDATE attendance_settings SET ? WHERE company_id = ?`,
        [updates, company_id]
      );
    }

    // Fetch updated settings
    const [updatedSettings] = await pool.query(
      `SELECT * FROM attendance_settings WHERE company_id = ?`,
      [company_id]
    );

    res.json({
      success: true,
      message: 'Attendance settings updated successfully',
      data: {
        ...updatedSettings[0],
        clock_in_ip_addresses: JSON.parse(updatedSettings[0].clock_in_ip_addresses || '[]')
      }
    });
  } catch (error) {
    console.error('Error updating attendance settings:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update attendance settings',
      details: error.message
    });
  }
};

/**
 * GET /api/admin/shifts
 * Fetch all shifts for a company
 */
exports.getAllShifts = async (req, res) => {
  try {
    await ensureTablesExist();
    
    const { company_id } = req.query;

    if (!company_id) {
      return res.status(400).json({
        success: false,
        error: 'Company ID is required'
      });
    }

    const [shifts] = await pool.query(
      `SELECT * FROM shifts WHERE company_id = ? ORDER BY is_default DESC, shift_name ASC`,
      [company_id]
    );

    // Parse JSON fields
    const parsedShifts = shifts.map(shift => ({
      ...shift,
      working_days: JSON.parse(shift.working_days || '[]')
    }));

    res.json({
      success: true,
      data: parsedShifts
    });
  } catch (error) {
    console.error('Error fetching shifts:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch shifts',
      details: error.message
    });
  }
};

/**
 * GET /api/admin/shifts/:id
 * Fetch a single shift by ID
 */
exports.getShiftById = async (req, res) => {
  try {
    await ensureTablesExist();
    
    const { id } = req.params;
    const { company_id } = req.query;

    if (!company_id) {
      return res.status(400).json({
        success: false,
        error: 'Company ID is required'
      });
    }

    const [shifts] = await pool.query(
      `SELECT * FROM shifts WHERE id = ? AND company_id = ?`,
      [id, company_id]
    );

    if (shifts.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Shift not found'
      });
    }

    res.json({
      success: true,
      data: {
        ...shifts[0],
        working_days: JSON.parse(shifts[0].working_days || '[]')
      }
    });
  } catch (error) {
    console.error('Error fetching shift:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch shift',
      details: error.message
    });
  }
};

/**
 * POST /api/admin/shifts
 * Create a new shift
 */
exports.createShift = async (req, res) => {
  try {
    await ensureTablesExist();
    
    const { company_id } = req.query;
    const shiftData = req.body;

    if (!company_id) {
      return res.status(400).json({
        success: false,
        error: 'Company ID is required'
      });
    }

    // Validate required fields
    if (!shiftData.shift_name || !shiftData.start_time || !shiftData.end_time) {
      return res.status(400).json({
        success: false,
        error: 'Shift name, start time, and end time are required'
      });
    }

    // If this shift is marked as default, unset other defaults
    if (shiftData.is_default) {
      await pool.query(
        `UPDATE shifts SET is_default = 0 WHERE company_id = ?`,
        [company_id]
      );
    }

    // Convert working_days array to JSON string
    if (shiftData.working_days && Array.isArray(shiftData.working_days)) {
      shiftData.working_days = JSON.stringify(shiftData.working_days);
    } else {
      shiftData.working_days = JSON.stringify([]);
    }

    shiftData.company_id = company_id;

    const [result] = await pool.query(
      `INSERT INTO shifts SET ?`,
      [shiftData]
    );

    // Fetch the created shift
    const [newShift] = await pool.query(
      `SELECT * FROM shifts WHERE id = ?`,
      [result.insertId]
    );

    res.status(201).json({
      success: true,
      message: 'Shift created successfully',
      data: {
        ...newShift[0],
        working_days: JSON.parse(newShift[0].working_days || '[]')
      }
    });
  } catch (error) {
    console.error('Error creating shift:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create shift',
      details: error.message
    });
  }
};

/**
 * PUT /api/admin/shifts/:id
 * Update a shift
 */
exports.updateShift = async (req, res) => {
  try {
    await ensureTablesExist();
    
    const { id } = req.params;
    const { company_id } = req.query;
    const updates = req.body;

    if (!company_id) {
      return res.status(400).json({
        success: false,
        error: 'Company ID is required'
      });
    }

    // Check if shift exists
    const [existing] = await pool.query(
      `SELECT id FROM shifts WHERE id = ? AND company_id = ?`,
      [id, company_id]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Shift not found'
      });
    }

    // If this shift is marked as default, unset other defaults
    if (updates.is_default) {
      await pool.query(
        `UPDATE shifts SET is_default = 0 WHERE company_id = ? AND id != ?`,
        [company_id, id]
      );
    }

    // Convert working_days array to JSON string
    if (updates.working_days && Array.isArray(updates.working_days)) {
      updates.working_days = JSON.stringify(updates.working_days);
    }

    await pool.query(
      `UPDATE shifts SET ? WHERE id = ? AND company_id = ?`,
      [updates, id, company_id]
    );

    // Fetch updated shift
    const [updatedShift] = await pool.query(
      `SELECT * FROM shifts WHERE id = ?`,
      [id]
    );

    res.json({
      success: true,
      message: 'Shift updated successfully',
      data: {
        ...updatedShift[0],
        working_days: JSON.parse(updatedShift[0].working_days || '[]')
      }
    });
  } catch (error) {
    console.error('Error updating shift:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update shift',
      details: error.message
    });
  }
};

/**
 * DELETE /api/admin/shifts/:id
 * Delete a shift
 */
exports.deleteShift = async (req, res) => {
  try {
    await ensureTablesExist();
    
    const { id } = req.params;
    const { company_id } = req.query;

    if (!company_id) {
      return res.status(400).json({
        success: false,
        error: 'Company ID is required'
      });
    }

    // Check if shift exists
    const [existing] = await pool.query(
      `SELECT is_default FROM shifts WHERE id = ? AND company_id = ?`,
      [id, company_id]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Shift not found'
      });
    }

    // Don't allow deleting default shift
    if (existing[0].is_default) {
      return res.status(400).json({
        success: false,
        error: 'Cannot delete the default shift'
      });
    }

    // Check if any employees are assigned to this shift
    const [assignments] = await pool.query(
      `SELECT COUNT(*) as count FROM employee_shift_assignments WHERE shift_id = ?`,
      [id]
    );

    if (assignments[0].count > 0) {
      return res.status(400).json({
        success: false,
        error: 'Cannot delete shift that has employee assignments'
      });
    }

    await pool.query(
      `DELETE FROM shifts WHERE id = ? AND company_id = ?`,
      [id, company_id]
    );

    res.json({
      success: true,
      message: 'Shift deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting shift:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete shift',
      details: error.message
    });
  }
};

/**
 * POST /api/admin/shifts/:id/set-default
 * Set a shift as default
 */
exports.setDefaultShift = async (req, res) => {
  try {
    await ensureTablesExist();
    
    const { id } = req.params;
    const { company_id } = req.query;

    if (!company_id) {
      return res.status(400).json({
        success: false,
        error: 'Company ID is required'
      });
    }

    // Check if shift exists
    const [existing] = await pool.query(
      `SELECT id FROM shifts WHERE id = ? AND company_id = ?`,
      [id, company_id]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Shift not found'
      });
    }

    // Unset all defaults
    await pool.query(
      `UPDATE shifts SET is_default = 0 WHERE company_id = ?`,
      [company_id]
    );

    // Set this shift as default
    await pool.query(
      `UPDATE shifts SET is_default = 1 WHERE id = ? AND company_id = ?`,
      [id, company_id]
    );

    res.json({
      success: true,
      message: 'Default shift updated successfully'
    });
  } catch (error) {
    console.error('Error setting default shift:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to set default shift',
      details: error.message
    });
  }
};

/**
 * GET /api/admin/shift-rotations
 * Fetch all shift rotations for a company
 */
exports.getAllRotations = async (req, res) => {
  try {
    await ensureTablesExist();
    
    const { company_id } = req.query;

    if (!company_id) {
      return res.status(400).json({
        success: false,
        error: 'Company ID is required'
      });
    }

    const [rotations] = await pool.query(
      `SELECT * FROM shift_rotations WHERE company_id = ? ORDER BY created_at DESC`,
      [company_id]
    );

    // Parse JSON fields
    const parsedRotations = rotations.map(rotation => ({
      ...rotation,
      shifts_in_sequence: JSON.parse(rotation.shifts_in_sequence || '[]')
    }));

    res.json({
      success: true,
      data: parsedRotations
    });
  } catch (error) {
    console.error('Error fetching rotations:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch rotations',
      details: error.message
    });
  }
};

/**
 * POST /api/admin/shift-rotations
 * Create a new shift rotation
 */
exports.createRotation = async (req, res) => {
  try {
    await ensureTablesExist();
    
    const { company_id } = req.query;
    const rotationData = req.body;

    if (!company_id) {
      return res.status(400).json({
        success: false,
        error: 'Company ID is required'
      });
    }

    // Validate required fields
    if (!rotationData.rotation_name || !rotationData.rotation_frequency) {
      return res.status(400).json({
        success: false,
        error: 'Rotation name and frequency are required'
      });
    }

    // Convert shifts_in_sequence array to JSON string
    if (rotationData.shifts_in_sequence && Array.isArray(rotationData.shifts_in_sequence)) {
      rotationData.shifts_in_sequence = JSON.stringify(rotationData.shifts_in_sequence);
    } else {
      rotationData.shifts_in_sequence = JSON.stringify([]);
    }

    rotationData.company_id = company_id;

    const [result] = await pool.query(
      `INSERT INTO shift_rotations SET ?`,
      [rotationData]
    );

    // Fetch the created rotation
    const [newRotation] = await pool.query(
      `SELECT * FROM shift_rotations WHERE id = ?`,
      [result.insertId]
    );

    res.status(201).json({
      success: true,
      message: 'Shift rotation created successfully',
      data: {
        ...newRotation[0],
        shifts_in_sequence: JSON.parse(newRotation[0].shifts_in_sequence || '[]')
      }
    });
  } catch (error) {
    console.error('Error creating rotation:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create rotation',
      details: error.message
    });
  }
};

/**
 * DELETE /api/admin/shift-rotations/:id
 * Delete a shift rotation
 */
exports.deleteRotation = async (req, res) => {
  try {
    await ensureTablesExist();
    
    const { id } = req.params;
    const { company_id } = req.query;

    if (!company_id) {
      return res.status(400).json({
        success: false,
        error: 'Company ID is required'
      });
    }

    // Check if rotation exists
    const [existing] = await pool.query(
      `SELECT id FROM shift_rotations WHERE id = ? AND company_id = ?`,
      [id, company_id]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Rotation not found'
      });
    }

    await pool.query(
      `DELETE FROM shift_rotations WHERE id = ? AND company_id = ?`,
      [id, company_id]
    );

    res.json({
      success: true,
      message: 'Rotation deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting rotation:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete rotation',
      details: error.message
    });
  }
};

/**
 * POST /api/admin/shift-rotations/run
 * Run shift rotation for selected employees
 */
exports.runRotation = async (req, res) => {
  try {
    await ensureTablesExist();
    
    const { company_id } = req.query;
    const { rotation_id, employee_ids, start_date } = req.body;

    if (!company_id) {
      return res.status(400).json({
        success: false,
        error: 'Company ID is required'
      });
    }

    if (!rotation_id || !employee_ids || !Array.isArray(employee_ids)) {
      return res.status(400).json({
        success: false,
        error: 'Rotation ID and employee IDs are required'
      });
    }

    // Fetch rotation details
    const [rotations] = await pool.query(
      `SELECT * FROM shift_rotations WHERE id = ? AND company_id = ?`,
      [rotation_id, company_id]
    );

    if (rotations.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Rotation not found'
      });
    }

    const rotation = rotations[0];
    const shiftsInSequence = JSON.parse(rotation.shifts_in_sequence || '[]');

    if (shiftsInSequence.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Rotation has no shifts defined'
      });
    }

    const assignmentDate = start_date || new Date().toISOString().split('T')[0];

    // Assign shifts to employees
    const assignments = [];
    for (let i = 0; i < employee_ids.length; i++) {
      const shiftId = shiftsInSequence[i % shiftsInSequence.length];
      
      // Check if assignment already exists
      const [existing] = await pool.query(
        `SELECT id FROM employee_shift_assignments 
         WHERE employee_id = ? AND assigned_date = ?`,
        [employee_ids[i], assignmentDate]
      );

      if (existing.length > 0 && rotation.replace_existing_shift) {
        // Update existing assignment
        await pool.query(
          `UPDATE employee_shift_assignments 
           SET shift_id = ? 
           WHERE employee_id = ? AND assigned_date = ?`,
          [shiftId, employee_ids[i], assignmentDate]
        );
      } else if (existing.length === 0) {
        // Create new assignment
        await pool.query(
          `INSERT INTO employee_shift_assignments 
           (company_id, employee_id, shift_id, assigned_date) 
           VALUES (?, ?, ?, ?)`,
          [company_id, employee_ids[i], shiftId, assignmentDate]
        );
      }

      assignments.push({
        employee_id: employee_ids[i],
        shift_id: shiftId,
        assigned_date: assignmentDate
      });
    }

    res.json({
      success: true,
      message: `Shift rotation applied to ${employee_ids.length} employees`,
      data: {
        assignments_created: assignments.length
      }
    });
  } catch (error) {
    console.error('Error running rotation:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to run rotation',
      details: error.message
    });
  }
};

module.exports = exports;

