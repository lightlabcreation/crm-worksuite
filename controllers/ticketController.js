const pool = require('../config/db');

const generateTicketId = async (companyId, retryCount = 0) => {
  try {
    // Get all ticket_ids for this company
    const [tickets] = await pool.execute(
      `SELECT ticket_id FROM tickets WHERE company_id = ?`,
      [companyId]
    );
    
    let maxNum = 0;
    
    // Extract numeric part from all ticket_ids and find the maximum
    for (const ticket of tickets) {
      const match = ticket.ticket_id.match(/TKT-(\d+)/);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > maxNum) {
          maxNum = num;
        }
      }
    }
    
    // Generate next ticket_id (increment from max)
    const nextNum = maxNum + 1 + retryCount; // Add retryCount to handle retries
    const ticketId = `TKT-${String(nextNum).padStart(3, '0')}`;
    
    // Double-check if this ticket_id already exists (race condition protection)
    const [check] = await pool.execute(
      `SELECT ticket_id FROM tickets WHERE ticket_id = ?`,
      [ticketId]
    );
    
    if (check.length > 0) {
      // If it exists, try again with next number
      console.log(`Ticket ID ${ticketId} already exists, will retry with next number`);
      // The retry will happen in the create function
    }
    
    return ticketId;
  } catch (error) {
    console.error('Error generating ticket ID:', error);
    // Fallback: use timestamp-based ID if there's an error
    const timestamp = Date.now();
    return `TKT-${String(timestamp).slice(-6)}`;
  }
};

const getAll = async (req, res) => {
  try {
    // No pagination - return all tickets
    const companyId = req.query.company_id || req.body.company_id || 1;
    const clientId = req.query.client_id || req.body.client_id;
    const status = req.query.status;
    const priority = req.query.priority;
    
    let whereClause = 'WHERE t.is_deleted = 0';
    const params = [];

    // Add company_id filter only if provided
    if (companyId) {
      whereClause += ' AND t.company_id = ?';
      params.push(companyId);
    }

    // For clients, show only their assigned tickets
    if (clientId) {
      whereClause += ' AND t.client_id = ?';
      params.push(clientId);
    }

    // For employees, show tickets assigned to them
    const assignedToId = req.query.assigned_to_id || req.body.assigned_to_id;
    if (assignedToId) {
      whereClause += ' AND t.assigned_to_id = ?';
      params.push(assignedToId);
    }

    if (status) {
      whereClause += ' AND t.status = ?';
      params.push(status);
    }

    if (priority) {
      whereClause += ' AND t.priority = ?';
      params.push(priority);
    }

    // Get all tickets without pagination
    const [tickets] = await pool.execute(
      `SELECT t.*, 
              c.company_name as client_name,
              u.name as assigned_to_name
       FROM tickets t
       LEFT JOIN clients c ON t.client_id = c.id
       LEFT JOIN users u ON t.assigned_to_id = u.id
       ${whereClause} 
       ORDER BY t.created_at DESC`,
      params
    );
    res.json({ 
      success: true, 
      data: tickets
    });
  } catch (error) {
    console.error('Get tickets error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch tickets' });
  }
};

const create = async (req, res) => {
  let retryCount = 0;
  const maxRetries = 5;
  
  while (retryCount < maxRetries) {
    try {
      const companyId = req.query.company_id || req.body.company_id || 1;
      const userId = req.query.user_id || req.body.user_id || req.body.created_by || req.userId || 1;
      const ticket_id = await generateTicketId(companyId, retryCount);
      const { subject, client_id, priority, description, status, assigned_to_id, ticket_type } = req.body;

      const safeSubject = subject && subject.trim() ? subject.trim() : 'Ticket';
      const safePriority = priority && priority.trim() ? priority : 'Medium';
      const safeStatus = status && status.trim() ? status : 'Open';
      const safeTicketType = ticket_type && ticket_type.trim() ? ticket_type : 'General Support';

      // Validate client_id against company; if invalid, set to null to avoid FK issues
      let finalClientId = client_id ?? null;
      if (finalClientId) {
        try {
          // Validate client_id exists (ignore company match to allow client linkage)
          const [clientCheck] = await pool.execute(
            `SELECT id FROM clients WHERE id = ?`,
            [finalClientId]
          );
          if (clientCheck.length === 0) {
            console.log(`ℹ️ client_id ${finalClientId} not found, setting to NULL`);
            finalClientId = null;
          }
        } catch (err) {
          console.log('⚠️ client_id validation error, setting client_id to NULL:', err.message);
          finalClientId = null;
        }
      }

      const [result] = await pool.execute(
        `INSERT INTO tickets (company_id, ticket_id, subject, client_id, priority, description, status, assigned_to_id, created_by, ticket_type)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          companyId,
          ticket_id,
          safeSubject,
          finalClientId,
          safePriority,
          description ?? null,
          safeStatus,
          assigned_to_id ?? null,
          userId ?? null,
          safeTicketType
        ]
      );
      
      // Get created ticket
      const [tickets] = await pool.execute(
        `SELECT * FROM tickets WHERE id = ?`,
        [result.insertId]
      );
      
      res.status(201).json({ 
        success: true, 
        data: tickets[0],
        message: 'Ticket created successfully'
      });
      return; // Success, exit retry loop
    } catch (error) {
      // Check if it's a duplicate key error
      if (error.code === 'ER_DUP_ENTRY' && error.sqlMessage && error.sqlMessage.includes('ticket_id')) {
        retryCount++;
        console.log(`Duplicate ticket_id detected, retrying... (attempt ${retryCount}/${maxRetries})`);
        if (retryCount >= maxRetries) {
          console.error('Max retries reached for ticket creation');
          res.status(500).json({ 
            success: false, 
            error: 'Failed to create ticket', 
            details: 'Unable to generate unique ticket ID after multiple attempts. Please try again.' 
          });
          return;
        }
        // Wait a bit before retrying (to avoid race conditions)
        await new Promise(resolve => setTimeout(resolve, 100 * retryCount));
        continue; // Retry the loop
      } else {
        // Other errors - don't retry
        console.error('Create ticket error:', error);
        console.error('Error details:', {
          message: error.message,
          code: error.code,
          sqlMessage: error.sqlMessage,
          stack: error.stack
        });
        res.status(500).json({ success: false, error: 'Failed to create ticket', details: error.message });
        return;
      }
    }
  }
};

/**
 * Add comment to ticket
 * POST /api/v1/tickets/:id/comments
 */
/**
 * Get ticket by ID
 * GET /api/v1/tickets/:id
 */
const getById = async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.query.company_id || req.body.company_id || 1;
    const clientId = req.query.client_id || req.body.client_id;

    let whereClause = 'WHERE t.id = ? AND t.is_deleted = 0';
    const params = [id];

    if (companyId) {
      whereClause += ' AND t.company_id = ?';
      params.push(companyId);
    }

    // For clients, only show their tickets
    if (clientId) {
      whereClause += ' AND t.client_id = ?';
      params.push(clientId);
    }

    const [tickets] = await pool.execute(
      `SELECT t.*, 
              c.company_name as client_name,
              u.name as assigned_to_name
       FROM tickets t
       LEFT JOIN clients c ON t.client_id = c.id
       LEFT JOIN users u ON t.assigned_to_id = u.id
       ${whereClause}`,
      params
    );

    if (tickets.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Ticket not found'
      });
    }

    // Get comments for this ticket
    const [comments] = await pool.execute(
      `SELECT tc.*, u.name as user_name 
       FROM ticket_comments tc
       LEFT JOIN users u ON tc.created_by = u.id
       WHERE tc.ticket_id = ?
       ORDER BY tc.created_at ASC`,
      [id]
    );

    res.json({
      success: true,
      data: {
        ...tickets[0],
        comments
      }
    });
  } catch (error) {
    console.error('Get ticket error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch ticket'
    });
  }
};

/**
 * Update ticket
 * PUT /api/v1/tickets/:id
 */
const update = async (req, res) => {
  try {
    const { id } = req.params;
    const { subject, priority, description, status, assigned_to_id } = req.body;
    const companyId = req.query.company_id || req.body.company_id || 1;

    // Check if ticket exists
    const [tickets] = await pool.execute(
      `SELECT id FROM tickets WHERE id = ? AND company_id = ? AND is_deleted = 0`,
      [id, companyId]
    );

    if (tickets.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Ticket not found'
      });
    }

    // Build update query
    const updates = [];
    const values = [];

    if (subject !== undefined) {
      updates.push('subject = ?');
      values.push(subject);
    }
    if (priority !== undefined) {
      updates.push('priority = ?');
      values.push(priority);
    }
    if (description !== undefined) {
      updates.push('description = ?');
      values.push(description);
    }
    if (status !== undefined) {
      updates.push('status = ?');
      values.push(status);
    }
    if (assigned_to_id !== undefined) {
      updates.push('assigned_to_id = ?');
      values.push(assigned_to_id);
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No fields to update'
      });
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);

    await pool.execute(
      `UPDATE tickets SET ${updates.join(', ')} WHERE id = ?`,
      values
    );

    // Get updated ticket
    const [updatedTickets] = await pool.execute(
      `SELECT * FROM tickets WHERE id = ?`,
      [id]
    );

    res.json({
      success: true,
      data: updatedTickets[0],
      message: 'Ticket updated successfully'
    });
  } catch (error) {
    console.error('Update ticket error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update ticket'
    });
  }
};

/**
 * Delete ticket
 * DELETE /api/v1/tickets/:id
 */
const deleteTicket = async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.query.company_id || req.body.company_id || 1;

    const [result] = await pool.execute(
      `UPDATE tickets SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND company_id = ?`,
      [id, companyId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        error: 'Ticket not found'
      });
    }

    res.json({
      success: true,
      message: 'Ticket deleted successfully'
    });
  } catch (error) {
    console.error('Delete ticket error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete ticket'
    });
  }
};

const addComment = async (req, res) => {
  try {
    const { id } = req.params;
    const { comment, file_path } = req.body;
    const companyId = req.query.company_id || req.body.company_id || 1;
    const userId = req.query.user_id || req.body.user_id || null;

    // Check if ticket exists
    const [tickets] = await pool.execute(
      `SELECT id FROM tickets WHERE id = ? AND is_deleted = 0`,
      [id]
    );

    if (tickets.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Ticket not found'
      });
    }

    // Insert comment
    const [result] = await pool.execute(
      `INSERT INTO ticket_comments (ticket_id, comment, file_path, created_by)
       VALUES (?, ?, ?, ?)`,
      [id, comment, file_path ?? null, userId]
    );

    // Get created comment
    const [comments] = await pool.execute(
      `SELECT * FROM ticket_comments WHERE id = ?`,
      [result.insertId]
    );

    res.status(201).json({
      success: true,
      data: comments[0],
      message: 'Comment added successfully'
    });
  } catch (error) {
    console.error('Add ticket comment error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to add comment'
    });
  }
};

module.exports = { getAll, getById, create, update, delete: deleteTicket, addComment };

