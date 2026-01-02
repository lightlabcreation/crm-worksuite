// =====================================================
// Leave Request Controller
// =====================================================

const pool = require('../config/db');

// Ensure leave_requests table exists and has all required columns
const ensureTableExists = async () => {
  try {
    // Create table if not exists
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS leave_requests (
        id INT AUTO_INCREMENT PRIMARY KEY,
        company_id INT,
        user_id INT,
        leave_type VARCHAR(100),
        start_date DATE,
        end_date DATE,
        reason TEXT,
        status VARCHAR(50) DEFAULT 'Pending',
        is_deleted TINYINT(1) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_company (company_id),
        INDEX idx_user (user_id),
        INDEX idx_status (status)
      )
    `);
    
    // Try to add user_id column if missing
    try {
      await pool.execute(`ALTER TABLE leave_requests ADD COLUMN user_id INT AFTER company_id`);
    } catch (e) {
      // Column already exists, ignore
    }
    
  } catch (error) {
    console.error('Error ensuring leave_requests table exists:', error);
  }
};

// Call once on module load
ensureTableExists();

/**
 * Get all leave requests
 * GET /api/v1/leave-requests
 */
const getAll = async (req, res) => {
  try {
    const filterCompanyId = req.query.company_id || req.body.company_id;
    const user_id = req.query.user_id || req.query.employee_id || req.userId;
    const status = req.query.status;
    const leave_type = req.query.leave_type;

    if (!filterCompanyId) {
      return res.status(400).json({
        success: false,
        error: 'company_id is required'
      });
    }

    let whereClause = 'WHERE lr.is_deleted = 0 AND lr.company_id = ?';
    const params = [filterCompanyId];

    // Filter by user_id
    if (user_id) {
      whereClause += ' AND lr.user_id = ?';
      params.push(user_id);
    }

    if (status) {
      whereClause += ' AND lr.status = ?';
      params.push(status);
    }

    if (leave_type) {
      whereClause += ' AND lr.leave_type = ?';
      params.push(leave_type);
    }

    // Simple query with user join and calculated days
    const [requests] = await pool.execute(
      `SELECT lr.id, lr.company_id, lr.user_id, lr.leave_type, 
              lr.start_date, lr.end_date, lr.reason, lr.status,
              lr.is_deleted, lr.created_at, lr.updated_at,
              DATEDIFF(lr.end_date, lr.start_date) + 1 as days,
              u.name as employee_name,
              u.email as employee_email
       FROM leave_requests lr
       LEFT JOIN users u ON lr.user_id = u.id
       ${whereClause}
       ORDER BY lr.created_at DESC`,
      params
    );

    res.json({
      success: true,
      data: requests
    });
  } catch (error) {
    console.error('Get leave requests error:', error);
    console.error('Error details:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch leave requests',
      details: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
};

/**
 * Get leave request by ID
 * GET /api/v1/leave-requests/:id
 */
const getById = async (req, res) => {
  try {
    const { id } = req.params;
    const filterCompanyId = req.query.company_id || req.companyId;
    const user_id = req.query.user_id || req.userId;

    let whereClause = 'WHERE lr.id = ? AND lr.is_deleted = 0';
    const params = [id];

    if (filterCompanyId) {
      whereClause += ' AND lr.company_id = ?';
      params.push(filterCompanyId);
    }

    // Filter by user_id if provided
    if (user_id) {
      whereClause += ' AND lr.user_id = ?';
      params.push(user_id);
    }

    const [requests] = await pool.execute(
      `SELECT lr.id, lr.company_id, lr.user_id, lr.leave_type, 
              lr.start_date, lr.end_date, lr.reason, lr.status,
              lr.is_deleted, lr.created_at, lr.updated_at,
              DATEDIFF(lr.end_date, lr.start_date) + 1 as days,
              u.name as employee_name,
              u.email as employee_email
       FROM leave_requests lr
       LEFT JOIN users u ON lr.user_id = u.id
       ${whereClause}`,
      params
    );

    if (requests.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Leave request not found'
      });
    }

    res.json({
      success: true,
      data: requests[0]
    });
  } catch (error) {
    console.error('Get leave request error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch leave request'
    });
  }
};

/**
 * Create leave request
 * POST /api/v1/leave-requests
 */
const create = async (req, res) => {
  try {
    const {
      employee_id,
      user_id,
      leave_type,
      start_date,
      end_date,
      reason,
      status = 'Pending'
    } = req.body;

    if (!leave_type || !start_date || !end_date) {
      return res.status(400).json({
        success: false,
        error: 'Leave type, start date, and end date are required'
      });
    }

    const companyId = req.body.company_id || req.query.company_id;
    
    if (!companyId) {
      return res.status(400).json({
        success: false,
        error: 'company_id is required'
      });
    }
    
    // Use user_id directly
    const finalUserId = user_id || employee_id;

    if (!finalUserId) {
      return res.status(400).json({
        success: false,
        error: 'user_id is required'
      });
    }

    // Insert without days column (calculate dynamically when needed)
    const [result] = await pool.execute(
      `INSERT INTO leave_requests (
        company_id, user_id, leave_type, start_date, end_date,
        reason, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [
        companyId,
        finalUserId,
        leave_type,
        start_date,
        end_date,
        reason || null,
        status
      ]
    );

    // Return with calculated days
    const [newRequest] = await pool.execute(
      `SELECT *, DATEDIFF(end_date, start_date) + 1 as days 
       FROM leave_requests WHERE id = ?`,
      [result.insertId]
    );

    res.status(201).json({
      success: true,
      data: newRequest[0],
      message: 'Leave request created successfully'
    });
  } catch (error) {
    console.error('Create leave request error:', error);
    console.error('Error details:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to create leave request',
      details: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
};

/**
 * Update leave request
 * PUT /api/v1/leave-requests/:id
 */
const update = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      leave_type,
      start_date,
      end_date,
      reason,
      status,
      user_id
    } = req.body;

    const filterCompanyId = req.body.company_id || req.query.company_id;
    const userId = user_id || req.query.user_id || req.userId;

    // Check if request exists
    let whereClause = 'WHERE id = ? AND is_deleted = 0';
    const checkParams = [id];

    if (filterCompanyId) {
      whereClause += ' AND company_id = ?';
      checkParams.push(filterCompanyId);
    }

    // Filter by user_id to ensure user can only update their own
    if (userId) {
      whereClause += ' AND user_id = ?';
      checkParams.push(userId);
    }

    const [existing] = await pool.execute(
      `SELECT * FROM leave_requests ${whereClause}`,
      checkParams
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Leave request not found or you do not have permission to update it'
      });
    }
    
    // Only allow update if status is Pending
    if (existing[0].status !== 'Pending') {
      return res.status(400).json({
        success: false,
        error: 'Can only update pending leave requests'
      });
    }

    // Build update query
    const updates = [];
    const params = [];

    if (leave_type !== undefined) {
      updates.push('leave_type = ?');
      params.push(leave_type);
    }
    if (start_date !== undefined) {
      updates.push('start_date = ?');
      params.push(start_date);
    }
    if (end_date !== undefined) {
      updates.push('end_date = ?');
      params.push(end_date);
    }
    if (reason !== undefined) {
      updates.push('reason = ?');
      params.push(reason);
    }
    // Only Admin can change status
    if (status !== undefined && req.user && req.user.role !== 'EMPLOYEE') {
      updates.push('status = ?');
      params.push(status);
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No fields to update'
      });
    }

    updates.push('updated_at = NOW()');
    params.push(id);

    await pool.execute(
      `UPDATE leave_requests SET ${updates.join(', ')} WHERE id = ?`,
      params
    );

    // Return with calculated days
    const [updatedRequest] = await pool.execute(
      `SELECT *, DATEDIFF(end_date, start_date) + 1 as days 
       FROM leave_requests WHERE id = ?`,
      [id]
    );

    res.json({
      success: true,
      data: updatedRequest[0],
      message: 'Leave request updated successfully'
    });
  } catch (error) {
    console.error('Update leave request error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update leave request'
    });
  }
};

/**
 * Delete leave request (soft delete)
 * DELETE /api/v1/leave-requests/:id
 */
const deleteRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const filterCompanyId = req.query.company_id || req.companyId;
    const userId = req.query.user_id || req.userId;

    let whereClause = 'WHERE id = ? AND is_deleted = 0';
    const params = [id];

    if (filterCompanyId) {
      whereClause += ' AND company_id = ?';
      params.push(filterCompanyId);
    }

    // Filter by user_id (user can only delete their own)
    if (userId) {
      whereClause += ' AND user_id = ?';
      params.push(userId);
    }

    // Only allow deleting pending requests
    whereClause += ' AND status = ?';
    params.push('Pending');

    const [existing] = await pool.execute(
      `SELECT id FROM leave_requests ${whereClause}`,
      params
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Leave request not found or cannot be deleted (only pending requests can be deleted)'
      });
    }

    await pool.execute(
      'UPDATE leave_requests SET is_deleted = 1, updated_at = NOW() WHERE id = ?',
      [id]
    );

    res.json({
      success: true,
      message: 'Leave request deleted successfully'
    });
  } catch (error) {
    console.error('Delete leave request error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete leave request'
    });
  }
};

module.exports = {
  getAll,
  getById,
  create,
  update,
  delete: deleteRequest
};

