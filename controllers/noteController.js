// =====================================================
// Note Controller
// =====================================================

const pool = require('../config/db');

// Ensure notes table exists
const ensureTableExists = async () => {
  try {
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS notes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        company_id INT,
        user_id INT,
        client_id INT,
        lead_id INT,
        project_id INT,
        title VARCHAR(255),
        content TEXT,
        is_deleted TINYINT(1) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_company (company_id),
        INDEX idx_user (user_id),
        INDEX idx_client (client_id)
      )
    `);
  } catch (error) {
    console.error('Error ensuring notes table exists:', error);
  }
};

// Call once on module load
ensureTableExists();

/**
 * Get all notes
 * GET /api/v1/notes
 */
const getAll = async (req, res) => {
  try {
    const companyId = req.query.company_id || req.body.company_id;
    const userId = req.query.user_id;
    const clientId = req.query.client_id;
    const leadId = req.query.lead_id;
    const projectId = req.query.project_id;

    if (!companyId) {
      return res.status(400).json({
        success: false,
        error: 'company_id is required'
      });
    }

    let whereClause = 'WHERE n.is_deleted = 0 AND n.company_id = ?';
    const params = [companyId];

    if (userId) {
      whereClause += ' AND n.user_id = ?';
      params.push(userId);
    }

    if (clientId) {
      // Direct client_id match (most common case)
      whereClause += ' AND n.client_id = ?';
      params.push(clientId);
    }

    if (leadId) {
      whereClause += ' AND n.lead_id = ?';
      params.push(leadId);
    }

    if (projectId) {
      whereClause += ' AND n.project_id = ?';
      params.push(projectId);
    }

    const [notes] = await pool.execute(
      `SELECT n.*, u.name as created_by_name
       FROM notes n
       LEFT JOIN users u ON n.user_id = u.id
       ${whereClause}
       ORDER BY n.created_at DESC`,
      params
    );

    res.json({
      success: true,
      data: notes
    });
  } catch (error) {
    console.error('Get notes error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch notes'
    });
  }
};

/**
 * Get note by ID
 * GET /api/v1/notes/:id
 */
const getById = async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.query.company_id;

    if (!companyId) {
      return res.status(400).json({
        success: false,
        error: 'company_id is required'
      });
    }

    const [notes] = await pool.execute(
      `SELECT n.*, u.name as created_by_name
       FROM notes n
       LEFT JOIN users u ON n.user_id = u.id
       WHERE n.id = ? AND n.company_id = ? AND n.is_deleted = 0`,
      [id, companyId]
    );

    if (notes.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Note not found'
      });
    }

    res.json({
      success: true,
      data: notes[0]
    });
  } catch (error) {
    console.error('Get note error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch note'
    });
  }
};

/**
 * Create note
 * POST /api/v1/notes
 */
const create = async (req, res) => {
  try {
    const {
      company_id,
      user_id,
      client_id,
      lead_id,
      project_id,
      title,
      content
    } = req.body;

    // Removed required validations - allow empty data

    const [result] = await pool.execute(
      `INSERT INTO notes (company_id, user_id, client_id, lead_id, project_id, title, content)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [company_id ?? null, user_id || null, client_id || null, lead_id || null, project_id || null, title || null, content || null]
    );

    const [newNote] = await pool.execute(
      'SELECT * FROM notes WHERE id = ?',
      [result.insertId]
    );

    res.status(201).json({
      success: true,
      data: newNote[0],
      message: 'Note created successfully'
    });
  } catch (error) {
    console.error('Create note error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create note'
    });
  }
};

/**
 * Update note
 * PUT /api/v1/notes/:id
 */
const update = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content } = req.body;
    const companyId = req.body.company_id || req.query.company_id;

    if (!companyId) {
      return res.status(400).json({
        success: false,
        error: 'company_id is required'
      });
    }

    // Check if note exists
    const [existing] = await pool.execute(
      'SELECT id FROM notes WHERE id = ? AND company_id = ? AND is_deleted = 0',
      [id, companyId]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Note not found'
      });
    }

    const updates = [];
    const params = [];

    if (title !== undefined) {
      updates.push('title = ?');
      params.push(title);
    }
    if (content !== undefined) {
      updates.push('content = ?');
      params.push(content);
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
      `UPDATE notes SET ${updates.join(', ')} WHERE id = ?`,
      params
    );

    const [updatedNote] = await pool.execute(
      'SELECT * FROM notes WHERE id = ?',
      [id]
    );

    res.json({
      success: true,
      data: updatedNote[0],
      message: 'Note updated successfully'
    });
  } catch (error) {
    console.error('Update note error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update note'
    });
  }
};

/**
 * Delete note (soft delete)
 * DELETE /api/v1/notes/:id
 */
const deleteNote = async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.query.company_id;

    if (!companyId) {
      return res.status(400).json({
        success: false,
        error: 'company_id is required'
      });
    }

    // Check if note exists
    const [existing] = await pool.execute(
      'SELECT id FROM notes WHERE id = ? AND company_id = ? AND is_deleted = 0',
      [id, companyId]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Note not found'
      });
    }

    await pool.execute(
      'UPDATE notes SET is_deleted = 1, updated_at = NOW() WHERE id = ?',
      [id]
    );

    res.json({
      success: true,
      message: 'Note deleted successfully'
    });
  } catch (error) {
    console.error('Delete note error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete note'
    });
  }
};

module.exports = {
  getAll,
  getById,
  create,
  update,
  delete: deleteNote
};

