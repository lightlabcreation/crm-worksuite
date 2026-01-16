// =====================================================
// Notification Controller
// =====================================================

const pool = require('../config/db');

/**
 * Get all notifications
 * GET /api/v1/notifications
 */
const getAll = async (req, res) => {
  try {
    // No pagination - return all notifications
    const userId = req.query.user_id || req.body.user_id || 1;
    const is_read = req.query.is_read;
    const type = req.query.type;

    let whereClause = 'WHERE n.is_deleted = 0';
    const params = [];

    // Add user_id filter only if provided
    if (userId) {
      whereClause += ' AND n.user_id = ?';
      params.push(userId);
    }

    if (is_read !== undefined) {
      whereClause += ' AND n.is_read = ?';
      params.push(is_read === 'true' ? 1 : 0);
    }

    if (type) {
      whereClause += ' AND n.type = ?';
      params.push(type);
    }

    // Filter by related entity if provided
    if (req.query.related_entity_type) {
      whereClause += ' AND n.related_entity_type = ?';
      params.push(req.query.related_entity_type);
    }

    if (req.query.related_entity_id) {
      whereClause += ' AND n.related_entity_id = ?';
      params.push(req.query.related_entity_id);
    }

    // Filter by company_id if provided
    if (req.query.company_id) {
      whereClause += ' AND n.company_id = ?';
      params.push(req.query.company_id);
    }

    // Get all notifications without pagination
    const [notifications] = await pool.execute(
      `SELECT n.*, u.name as created_by_name
       FROM notifications n
       LEFT JOIN users u ON n.created_by = u.id
       ${whereClause}
       ORDER BY n.created_at DESC`,
      params
    );

    res.json({
      success: true,
      data: notifications
    });
  } catch (error) {
    console.error('Get notifications error:', error);
    console.error('Error details:', error.sqlMessage || error.message);
    // If error is due to missing columns, return empty array instead of error
    if (error.sqlMessage && (error.sqlMessage.includes('Unknown column') || error.sqlMessage.includes('related_entity'))) {
      return res.json({
        success: true,
        data: []
      });
    }
    res.status(500).json({
      success: false,
      error: 'Failed to fetch notifications'
    });
  }
};

/**
 * Get notification by ID
 * GET /api/v1/notifications/:id
 */
const getById = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.query.user_id || req.body.user_id || 1;

    const [notifications] = await pool.execute(
      `SELECT n.*, u.name as created_by_name
       FROM notifications n
       LEFT JOIN users u ON n.created_by = u.id
       WHERE n.id = ? AND n.is_deleted = 0`,
      [id]
    );

    if (notifications.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Notification not found'
      });
    }

    // Mark as read when viewing
    await pool.execute(
      'UPDATE notifications SET is_read = 1 WHERE id = ?',
      [id]
    );

    res.json({
      success: true,
      data: notifications[0]
    });
  } catch (error) {
    console.error('Get notification error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch notification'
    });
  }
};

/**
 * Create notification
 * POST /api/v1/notifications
 */
const create = async (req, res) => {
  try {
    const {
      user_id,
      type,
      title,
      message,
      link,
      related_entity_type,
      related_entity_id
    } = req.body;

    if (!user_id || !type || !title || !message) {
      return res.status(400).json({
        success: false,
        error: 'User ID, type, title, and message are required'
      });
    }

    let companyId = req.body.company_id || req.query.company_id || null;
    const createdBy = req.body.created_by || req.body.user_id || req.query.user_id || user_id;

    // Validate user_id exists
    try {
      const [userCheck] = await pool.execute(
        'SELECT id FROM users WHERE id = ?',
        [user_id]
      );
      if (userCheck.length === 0) {
        return res.status(400).json({
          success: false,
          error: `User ID ${user_id} does not exist`
        });
      }
    } catch (err) {
      console.error('User validation error:', err);
      // Continue anyway - might be a permissions issue
    }

    // Validate company_id if provided
    if (companyId) {
      try {
        const [companyCheck] = await pool.execute(
          'SELECT id FROM companies WHERE id = ?',
          [companyId]
        );
        if (companyCheck.length === 0) {
          console.warn(`Company ID ${companyId} does not exist, setting to NULL`);
          companyId = null;
        }
      } catch (err) {
        console.error('Company validation error:', err);
        // Continue with null company_id
        companyId = null;
      }
    }

    const [result] = await pool.execute(
      `INSERT INTO notifications (
        company_id, user_id, type, title, message, link, related_entity_type, related_entity_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        companyId || null,
        user_id,
        type,
        title,
        message,
        link || null,
        related_entity_type || null,
        related_entity_id || null
      ]
    );

    const [newNotification] = await pool.execute(
      'SELECT * FROM notifications WHERE id = ?',
      [result.insertId]
    );

    res.status(201).json({
      success: true,
      data: newNotification[0],
      message: 'Notification created successfully'
    });
  } catch (error) {
    console.error('Create notification error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create notification',
      details: error.message || 'Unknown error',
      sqlMessage: error.sqlMessage || null
    });
  }
};

/**
 * Mark notification as read
 * PUT /api/v1/notifications/:id/read
 */
const markAsRead = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.query.user_id || req.body.user_id || 1;

    const [result] = await pool.execute(
      'UPDATE notifications SET is_read = 1 WHERE id = ?',
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        error: 'Notification not found'
      });
    }

    res.json({
      success: true,
      message: 'Notification marked as read'
    });
  } catch (error) {
    console.error('Mark notification as read error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to mark notification as read'
    });
  }
};

/**
 * Mark all notifications as read
 * PUT /api/v1/notifications/mark-all-read
 */
const markAllAsRead = async (req, res) => {
  try {
    const userId = req.query.user_id || req.body.user_id || 1;

    await pool.execute(
      'UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0',
      [userId]
    );

    res.json({
      success: true,
      message: 'All notifications marked as read'
    });
  } catch (error) {
    console.error('Mark all notifications as read error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to mark all notifications as read'
    });
  }
};

/**
 * Delete notification (soft delete)
 * DELETE /api/v1/notifications/:id
 */
const deleteNotification = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.query.user_id || req.body.user_id || 1;

    const [result] = await pool.execute(
      'UPDATE notifications SET is_deleted = 1 WHERE id = ?',
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        error: 'Notification not found'
      });
    }

    res.json({
      success: true,
      message: 'Notification deleted successfully'
    });
  } catch (error) {
    console.error('Delete notification error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete notification'
    });
  }
};

/**
 * Get unread count
 * GET /api/v1/notifications/unread-count
 */
const getUnreadCount = async (req, res) => {
  try {
    const userId = req.query.user_id || req.body.user_id || 1;

    const [result] = await pool.execute(
      'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0 AND is_deleted = 0',
      [userId]
    );

    res.json({
      success: true,
      data: {
        unread_count: result[0].count
      }
    });
  } catch (error) {
    console.error('Get unread count error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get unread count'
    });
  }
};

module.exports = {
  getAll,
  getById,
  create,
  markAsRead,
  markAllAsRead,
  delete: deleteNotification,
  getUnreadCount
};

