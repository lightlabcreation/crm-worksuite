// =====================================================
// Note Controller
// =====================================================

const pool = require('../config/db');

// Ensure notes table exists
const ensureTableExists = async () => {
  try {
    // First create notes table
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

    // Check if note_files table exists
    const [tables] = await pool.execute(
      "SHOW TABLES LIKE 'note_files'"
    );

    // Create note_files table only if it doesn't exist
    if (tables.length === 0) {
      await pool.execute(`
        CREATE TABLE note_files (
          id INT AUTO_INCREMENT PRIMARY KEY,
          note_id INT NOT NULL,
          company_id INT NOT NULL,
          file_name VARCHAR(255) NOT NULL,
          file_path VARCHAR(500) NOT NULL,
          file_size INT,
          file_type VARCHAR(100),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_note_file (note_id),
          INDEX idx_company (company_id)
        )
      `);
      
      // Add foreign key constraint separately if possible
      try {
        await pool.execute(`
          ALTER TABLE note_files 
          ADD CONSTRAINT fk_note_files_note_id 
          FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
        `);
      } catch (fkError) {
        // Foreign key creation failed, but table exists - that's okay
        console.log('Note: Foreign key constraint could not be added to note_files table (table may already have data)');
      }
    }
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

    if (notes.length > 0) {
      const noteIds = notes.map(n => n.id);
      const [files] = await pool.execute(
        `SELECT * FROM note_files WHERE note_id IN (${noteIds.map(() => '?').join(',')})`,
        noteIds
      );

      const filesByNote = {};
      files.forEach(f => {
        if (!filesByNote[f.note_id]) filesByNote[f.note_id] = [];
        filesByNote[f.note_id].push(f);
      });

      notes.forEach(n => {
        n.files = filesByNote[n.id] || [];
      });
    }

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
    // Handle both JSON and FormData requests
    const company_id = req.body.company_id || req.query.company_id;
    const user_id = req.body.user_id || req.query.user_id;
    const client_id = req.body.client_id || null;
    const lead_id = req.body.lead_id || null;
    const project_id = req.body.project_id || null;
    const title = req.body.title || null;
    const content = req.body.content || null;

    // Validate required fields
    if (!company_id) {
      return res.status(400).json({
        success: false,
        error: 'company_id is required'
      });
    }

    // Handle content - can be string or object (JSON stringified)
    let contentValue = content;
    if (typeof content === 'object') {
      contentValue = JSON.stringify(content);
    } else if (typeof content === 'string') {
      // Try to parse if it's a JSON string, otherwise use as-is
      try {
        const parsed = JSON.parse(content);
        if (typeof parsed === 'object') {
          contentValue = JSON.stringify(parsed);
        } else {
          contentValue = content.trim();
        }
      } catch (e) {
        contentValue = content.trim();
      }
    }

    if (!contentValue || (typeof contentValue === 'string' && !contentValue.trim())) {
      return res.status(400).json({
        success: false,
        error: 'Note content is required'
      });
    }

    // Ensure content is a string
    const finalContent = typeof contentValue === 'string' ? contentValue.trim() : String(contentValue).trim();

    // Provide default title if not provided (title column is NOT NULL in database)
    // Generate title from content if not provided
    let finalTitle = title;
    if (!finalTitle || !finalTitle.trim()) {
      // Extract first few words from content as title
      const contentText = finalContent.replace(/<[^>]*>/g, '').trim(); // Remove HTML tags
      if (contentText.length > 0) {
        const words = contentText.split(/\s+/).slice(0, 8); // First 8 words
        finalTitle = words.join(' ');
        if (contentText.length > finalTitle.length) {
          finalTitle += '...';
        }
      } else {
        finalTitle = 'Note'; // Fallback default
      }
    }
    finalTitle = finalTitle.trim().substring(0, 255); // Ensure it fits in VARCHAR(255)

    const [result] = await pool.execute(
      `INSERT INTO notes (company_id, user_id, client_id, lead_id, project_id, title, content)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [company_id, user_id || null, client_id || null, lead_id || null, project_id || null, finalTitle, finalContent]
    );

    const noteId = result.insertId;
    const files = [];

    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        const filePath = file.path.replace(/\\/g, '/'); // Normalize path
        await pool.execute(
          `INSERT INTO note_files (note_id, company_id, file_name, file_path, file_size, file_type)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [noteId, company_id, file.originalname, filePath, file.size, file.mimetype]
        );
        files.push({
          file_name: file.originalname,
          file_path: filePath,
          file_size: file.size,
          file_type: file.mimetype
        });
      }
    }

    const [newNote] = await pool.execute(
      'SELECT * FROM notes WHERE id = ?',
      [noteId]
    );

    newNote[0].files = files;

    res.status(201).json({
      success: true,
      data: newNote[0],
      message: 'Note created successfully'
    });
  } catch (error) {
    console.error('Create note error:', error);
    console.error('Error details:', error.message);
    console.error('Stack trace:', error.stack);
    res.status(500).json({
      success: false,
      error: 'Failed to create note',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
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

    // Handle content - can be string or object (JSON stringified)
    let contentValue = content;
    if (content !== undefined) {
      if (typeof content === 'object') {
        contentValue = JSON.stringify(content);
      } else if (typeof content === 'string') {
        // Try to parse if it's a JSON string, otherwise use as-is
        try {
          const parsed = JSON.parse(content);
          if (typeof parsed === 'object') {
            contentValue = JSON.stringify(parsed);
          } else {
            contentValue = content.trim();
          }
        } catch (e) {
          contentValue = content.trim();
        }
      }
    }

    // Handle title - generate from content if not provided
    let finalTitle = title;
    if (title !== undefined && (!title || !title.trim())) {
      if (contentValue) {
        // Extract first few words from content as title
        const contentText = contentValue.replace(/<[^>]*>/g, '').trim(); // Remove HTML tags
        if (contentText.length > 0) {
          const words = contentText.split(/\s+/).slice(0, 8); // First 8 words
          finalTitle = words.join(' ');
          if (contentText.length > finalTitle.length) {
            finalTitle += '...';
          }
        } else {
          finalTitle = 'Note'; // Fallback default
        }
      }
    }
    if (finalTitle) {
      finalTitle = finalTitle.trim().substring(0, 255); // Ensure it fits in VARCHAR(255)
    }

    const updates = [];
    const params = [];

    if (title !== undefined) {
      updates.push('title = ?');
      params.push(finalTitle || title);
    }
    if (content !== undefined) {
      updates.push('content = ?');
      params.push(contentValue);
    }

    if (updates.length === 0 && (!req.files || req.files.length === 0)) {
      return res.status(400).json({
        success: false,
        error: 'No fields to update'
      });
    }

    if (updates.length > 0) {
      updates.push('updated_at = NOW()');
      params.push(id);

      await pool.execute(
        `UPDATE notes SET ${updates.join(', ')} WHERE id = ?`,
        params
      );
    }

    // Handle file uploads
    const files = [];
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        const filePath = file.path.replace(/\\/g, '/'); // Normalize path
        await pool.execute(
          `INSERT INTO note_files (note_id, company_id, file_name, file_path, file_size, file_type)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [id, companyId, file.originalname, filePath, file.size, file.mimetype]
        );
        files.push({
          file_name: file.originalname,
          file_path: filePath,
          file_size: file.size,
          file_type: file.mimetype
        });
      }
    }

    // Get existing files
    const [existingFiles] = await pool.execute(
      'SELECT * FROM note_files WHERE note_id = ? AND company_id = ?',
      [id, companyId]
    );

    const [updatedNote] = await pool.execute(
      'SELECT * FROM notes WHERE id = ?',
      [id]
    );

    updatedNote[0].files = existingFiles || [];

    res.json({
      success: true,
      data: updatedNote[0],
      message: 'Note updated successfully'
    });
  } catch (error) {
    console.error('Update note error:', error);
    console.error('Error details:', error.message);
    console.error('Stack trace:', error.stack);
    res.status(500).json({
      success: false,
      error: 'Failed to update note',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
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

