// =====================================================
// Message Controller
// =====================================================

const pool = require('../config/db');

/**
 * Get all messages/conversations
 * GET /api/v1/messages
 */
const getAll = async (req, res) => {
  try {
    const userId = req.query.user_id || req.body.user_id || null;
    const companyId = req.query.company_id || req.body.company_id || 1;
    const conversationWith = req.query.conversation_with; // User ID to get conversation with
    const groupId = req.query.group_id; // Group ID to get group messages

    console.log('getAll messages - userId:', userId, 'companyId:', companyId, 'conversationWith:', conversationWith, 'groupId:', groupId);

    if (!userId || !companyId) {
      return res.status(400).json({
        success: false,
        error: 'user_id and company_id are required'
      });
    }

    if (groupId) {
      // Get group messages
      // Verify user is member of the group
      const [memberships] = await pool.execute(
        `SELECT * FROM group_members 
         WHERE group_id = ? AND user_id = ? AND is_deleted = 0`,
        [groupId, userId]
      );

      if (memberships.length === 0) {
        return res.status(403).json({
          success: false,
          error: 'You are not a member of this group'
        });
      }

      const [messages] = await pool.execute(
        `SELECT m.*, 
                from_user.name as from_user_name,
                from_user.email as from_user_email,
                from_user.role as from_user_role,
                g.name as group_name
         FROM messages m
         LEFT JOIN users from_user ON m.from_user_id = from_user.id
         LEFT JOIN groups g ON m.group_id = g.id
         WHERE m.company_id = ? 
           AND m.group_id = ?
           AND m.is_deleted = 0
         ORDER BY m.created_at ASC`,
        [companyId, groupId]
      );

      console.log('Group messages found:', messages.length);

      return res.json({
        success: true,
        data: messages
      });
    }

    if (conversationWith) {
      // Get conversation between two users
      const [messages] = await pool.execute(
        `SELECT m.*, 
                from_user.name as from_user_name,
                from_user.email as from_user_email,
                from_user.role as from_user_role,
                to_user.name as to_user_name,
                to_user.email as to_user_email,
                to_user.role as to_user_role
         FROM messages m
         LEFT JOIN users from_user ON m.from_user_id = from_user.id
         LEFT JOIN users to_user ON m.to_user_id = to_user.id
         WHERE m.company_id = ? 
           AND m.is_deleted = 0
           AND m.group_id IS NULL
           AND ((m.from_user_id = ? AND m.to_user_id = ?) 
                OR (m.from_user_id = ? AND m.to_user_id = ?))
         ORDER BY m.created_at ASC`,
        [companyId, userId, conversationWith, conversationWith, userId]
      );

      console.log('Conversation messages found:', messages.length);

      return res.json({
        success: true,
        data: messages
      });
    }

    // Get all conversations (grouped by other user) - Fixed to show latest message per conversation
    const [conversations] = await pool.execute(
      `SELECT 
         other_user_id,
         other_user_name,
         other_user_email,
         other_user_role,
         last_message,
         last_message_time,
         unread_count
       FROM (
         SELECT 
           CASE 
             WHEN m.from_user_id = ? THEN m.to_user_id
             ELSE m.from_user_id
           END as other_user_id,
           CASE 
             WHEN m.from_user_id = ? THEN u_to.name
             ELSE u_from.name
           END as other_user_name,
           CASE 
             WHEN m.from_user_id = ? THEN u_to.email
             ELSE u_from.email
           END as other_user_email,
           CASE 
             WHEN m.from_user_id = ? THEN u_to.role
             ELSE u_from.role
           END as other_user_role,
           m.message as last_message,
           m.created_at as last_message_time,
           (SELECT COUNT(*) 
            FROM messages msg 
            WHERE msg.to_user_id = ? 
              AND msg.from_user_id = CASE 
                WHEN m.from_user_id = ? THEN m.to_user_id
                ELSE m.from_user_id
              END 
              AND msg.is_read = 0 
              AND msg.is_deleted = 0) as unread_count,
           ROW_NUMBER() OVER (
             PARTITION BY CASE 
               WHEN m.from_user_id = ? THEN m.to_user_id
               ELSE m.from_user_id
             END 
             ORDER BY m.created_at DESC
           ) as rn
         FROM messages m
         LEFT JOIN users u_from ON m.from_user_id = u_from.id
         LEFT JOIN users u_to ON m.to_user_id = u_to.id
         WHERE m.company_id = ? 
           AND m.is_deleted = 0
           AND m.group_id IS NULL
           AND (m.from_user_id = ? OR m.to_user_id = ?)
       ) as conversations
       WHERE rn = 1
       ORDER BY last_message_time DESC`,
      [userId, userId, userId, userId, userId, userId, userId, companyId, userId, userId]
    );

    console.log('Conversations found:', conversations.length);

    res.json({
      success: true,
      data: conversations,
    });
  } catch (error) {
    console.error('Get messages error:', error);
    console.error('Error details:', {
      message: error.message,
      sqlMessage: error.sqlMessage
    });
    res.status(500).json({
      success: false,
      error: error.sqlMessage || error.message || 'Failed to fetch messages'
    });
  }
};

/**
 * Get message by ID
 * GET /api/v1/messages/:id
 */
const getById = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.userId;
    const companyId = req.companyId;

    const [messages] = await pool.execute(
      `SELECT m.*, 
              from_user.name as from_user_name,
              from_user.email as from_user_email,
              to_user.name as to_user_name,
              to_user.email as to_user_email
       FROM messages m
       LEFT JOIN users from_user ON m.from_user_id = from_user.id
       LEFT JOIN users to_user ON m.to_user_id = to_user.id
       WHERE m.id = ? AND m.company_id = ? AND m.is_deleted = 0
         AND (m.from_user_id = ? OR m.to_user_id = ?)`,
      [id, companyId, userId, userId]
    );

    if (messages.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Message not found'
      });
    }

    // Mark as read if current user is recipient
    if (messages[0].to_user_id === userId && messages[0].is_read === 0) {
      await pool.execute(
        `UPDATE messages SET is_read = 1, read_at = NOW() WHERE id = ?`,
        [id]
      );
    }

    res.json({
      success: true,
      data: messages[0]
    });
  } catch (error) {
    console.error('Get message error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch message'
    });
  }
};

/**
 * Create/Send message
 * POST /api/v1/messages
 */
const create = async (req, res) => {
  try {
    const { to_user_id, group_id, subject, message, file_path, user_id, company_id } = req.body;
    const userId = user_id || req.userId || req.query.user_id;
    const companyId = company_id || req.companyId || req.query.company_id;

    console.log('Create message - userId:', userId, 'companyId:', companyId, 'to_user_id:', to_user_id, 'group_id:', group_id);

    if (!userId || !companyId) {
      return res.status(400).json({
        success: false,
        error: 'user_id and company_id are required'
      });
    }

    if (!message || !message.trim()) {
      return res.status(400).json({
        success: false,
        error: 'message is required'
      });
    }

    // Group message
    if (group_id) {
      // Verify user is member of the group
      const [memberships] = await pool.execute(
        `SELECT * FROM group_members 
         WHERE group_id = ? AND user_id = ? AND is_deleted = 0`,
        [group_id, userId]
      );

      if (memberships.length === 0) {
        return res.status(403).json({
          success: false,
          error: 'You are not a member of this group'
        });
      }

      // Verify group exists and belongs to company
      const [groups] = await pool.execute(
        `SELECT * FROM groups 
         WHERE id = ? AND company_id = ? AND is_deleted = 0`,
        [group_id, companyId]
      );

      if (groups.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Group not found'
        });
      }

      // Create group message
      const [result] = await pool.execute(
        `INSERT INTO messages (company_id, from_user_id, group_id, subject, message, file_path, created_at)
         VALUES (?, ?, ?, ?, ?, ?, NOW())`,
        [companyId, userId, group_id, subject || 'Group Message', message.trim(), file_path || null]
      );

      // Get all group members except sender
      const [members] = await pool.execute(
        `SELECT user_id FROM group_members 
         WHERE group_id = ? AND user_id != ? AND is_deleted = 0`,
        [group_id, userId]
      );

      // Create message recipients for unread tracking
      for (const member of members) {
        try {
          await pool.execute(
            `INSERT INTO message_recipients (message_id, user_id, is_read, created_at)
             VALUES (?, ?, 0, NOW())`,
            [result.insertId, member.user_id]
          );
        } catch (err) {
          // Ignore duplicate key errors
          if (err.code !== 'ER_DUP_ENTRY') {
            console.error('Error creating message recipient:', err);
          }
        }
      }

      console.log('Group message created with ID:', result.insertId);

      return res.status(201).json({
        success: true,
        data: { id: result.insertId },
        message: 'Group message sent successfully'
      });
    }

    // Private message
    if (!to_user_id) {
      return res.status(400).json({
        success: false,
        error: 'to_user_id or group_id is required'
      });
    }

    // Verify recipient exists and belongs to same company
    const [recipients] = await pool.execute(
      `SELECT id, role FROM users WHERE id = ? AND company_id = ? AND is_deleted = 0`,
      [to_user_id, companyId]
    );

    if (recipients.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Recipient not found or does not belong to your company'
      });
    }

    const [result] = await pool.execute(
      `INSERT INTO messages (company_id, from_user_id, to_user_id, subject, message, file_path, created_at)
       VALUES (?, ?, ?, ?, ?, ?, NOW())`,
      [companyId, userId, to_user_id, subject || 'Chat Message', message.trim(), file_path || null]
    );

    console.log('Message created with ID:', result.insertId);

    res.status(201).json({
      success: true,
      data: { id: result.insertId },
      message: 'Message sent successfully'
    });
  } catch (error) {
    console.error('Send message error:', error);
    console.error('Error details:', {
      message: error.message,
      sqlMessage: error.sqlMessage
    });
    res.status(500).json({
      success: false,
      error: error.sqlMessage || error.message || 'Failed to send message'
    });
  }
};

/**
 * Update message (mark as read, etc.)
 * PUT /api/v1/messages/:id
 */
const update = async (req, res) => {
  try {
    const { id } = req.params;
    const { is_read } = req.body;
    const userId = req.userId;
    const companyId = req.companyId;

    const updates = [];
    const values = [];

    if (is_read !== undefined) {
      updates.push('is_read = ?');
      values.push(is_read ? 1 : 0);
      if (is_read) {
        updates.push('read_at = NOW()');
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No fields to update'
      });
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id, companyId, userId);

    const [result] = await pool.execute(
      `UPDATE messages SET ${updates.join(', ')} 
       WHERE id = ? AND company_id = ? AND to_user_id = ?`,
      values
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        error: 'Message not found'
      });
    }

    res.json({
      success: true,
      message: 'Message updated successfully'
    });
  } catch (error) {
    console.error('Update message error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update message'
    });
  }
};

/**
 * Delete message (soft delete)
 * DELETE /api/v1/messages/:id
 */
const deleteMessage = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.userId;
    const companyId = req.companyId;

    const [result] = await pool.execute(
      `UPDATE messages SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND company_id = ? AND (from_user_id = ? OR to_user_id = ?)`,
      [id, companyId, userId, userId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        error: 'Message not found'
      });
    }

    res.json({
      success: true,
      message: 'Message deleted successfully'
    });
  } catch (error) {
    console.error('Delete message error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete message'
    });
  }
};

/**
 * Get available users to message (role-based)
 * GET /api/v1/messages/available-users
 */
const getAvailableUsers = async (req, res) => {
  try {
    const userId = req.query.user_id || req.body.user_id;
    const companyId = req.query.company_id || req.body.company_id || req.companyId;
    const userRole = req.query.user_role || req.body.user_role;
    
    if (!userId || !companyId || !userRole) {
      return res.status(400).json({
        success: false,
        error: 'user_id, company_id, and user_role are required'
      });
    }

    let availableUsers = [];

    // ROLE-BASED LOGIC
    if (userRole === 'SUPERADMIN') {
      // SuperAdmin has NO messaging
      return res.json({
        success: true,
        data: [],
        message: 'SuperAdmin cannot use messaging system'
      });
    }
    
    else if (userRole === 'ADMIN') {
      // Admin can message their own Clients and Employees
      const [users] = await pool.execute(
        `SELECT u.id, 
                u.name, 
                u.email, 
                u.role,
                u.name as display_name,
                CASE 
                  WHEN u.role = 'CLIENT' THEN 'Client'
                  WHEN u.role = 'EMPLOYEE' THEN 'Employee'
                  ELSE u.role
                END as role_display
         FROM users u
         WHERE u.company_id = ? 
           AND u.id != ?
           AND u.role IN ('CLIENT', 'EMPLOYEE')
           AND u.is_deleted = 0
         ORDER BY u.role, u.name`,
        [companyId, userId]
      );
      availableUsers = users;
    }
    
    else if (userRole === 'CLIENT') {
      // Client can ONLY message Admin users of their company
      const [users] = await pool.execute(
        `SELECT u.id, u.name, u.email, u.role
         FROM users u
         WHERE u.company_id = ? 
           AND u.role = 'ADMIN'
           AND u.is_deleted = 0
         ORDER BY u.name`,
        [companyId]
      );
      availableUsers = users;
    }
    
    else if (userRole === 'EMPLOYEE') {
      // Employee can ONLY message Admin users of their company
      const [users] = await pool.execute(
        `SELECT u.id, u.name, u.email, u.role
         FROM users u
         WHERE u.company_id = ? 
           AND u.role = 'ADMIN'
           AND u.is_deleted = 0
         ORDER BY u.name`,
        [companyId]
      );
      availableUsers = users;
    }

    res.json({
      success: true,
      data: availableUsers
    });
  } catch (error) {
    console.error('Get available users error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch available users'
    });
  }
};

module.exports = {
  getAll,
  getById,
  create,
  update,
  deleteMessage,
  getAvailableUsers
};
