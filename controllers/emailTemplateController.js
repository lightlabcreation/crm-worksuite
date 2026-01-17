// =====================================================
// Email Template Controller
// =====================================================

const pool = require('../config/db');

/**
 * Ensure email_templates table exists with all required columns
 */
const ensureTableExists = async () => {
  try {
    // Create table if not exists
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS email_templates (
        id INT AUTO_INCREMENT PRIMARY KEY,
        company_id INT NOT NULL,
        name VARCHAR(255) NOT NULL,
        subject VARCHAR(500) NOT NULL,
        body LONGTEXT NOT NULL,
        type VARCHAR(100) DEFAULT NULL,
        is_deleted TINYINT(1) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_company_id (company_id),
        INDEX idx_type (type),
        INDEX idx_is_deleted (is_deleted)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Check if type column exists, add if not
    const [columns] = await pool.execute(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'email_templates' 
      AND COLUMN_NAME = 'type'
    `);

    if (columns.length === 0) {
      await pool.execute(`
        ALTER TABLE email_templates 
        ADD COLUMN type VARCHAR(100) DEFAULT NULL 
        AFTER body
      `);
    }

    return true;
  } catch (error) {
    console.error('Error ensuring email_templates table:', error);
    return false;
  }
};

const getAll = async (req, res) => {
  // Ensure table exists
  await ensureTableExists();
  try {
    // Only filter by company_id if explicitly provided in query params or req.companyId exists
    const filterCompanyId = req.query.company_id || req.body.company_id || 1;
    const category = req.query.category;
    
    let whereClause = 'WHERE e.is_deleted = 0';
    const params = [];
    
    if (filterCompanyId) {
      whereClause += ' AND e.company_id = ?';
      params.push(filterCompanyId);
    }
    
    if (category) {
      whereClause += ' AND e.type = ?';
      params.push(category);
    }

    // Get all templates without pagination
    const [templates] = await pool.execute(
      `SELECT 
        e.id,
        e.company_id,
        e.name,
        e.subject,
        e.body,
        e.type,
        e.created_at,
        e.updated_at,
        comp.name as company_name
       FROM email_templates e
       LEFT JOIN companies comp ON e.company_id = comp.id
       ${whereClause}
       ORDER BY e.created_at DESC`,
      params
    );

    // Extract merge tags from body
    const templatesWithTags = templates.map(template => {
      const mergeTags = [];
      const tagRegex = /\{\{(\w+)\}\}/g;
      let match;
      while ((match = tagRegex.exec(template.body)) !== null) {
        if (!mergeTags.includes(`{{${match[1]}}}`)) {
          mergeTags.push(`{{${match[1]}}}`);
        }
      }
      return {
        ...template,
        mergeTags
      };
    });

    res.json({ 
      success: true, 
      data: templatesWithTags
    });
  } catch (error) {
    console.error('Get email templates error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Failed to fetch email templates' 
    });
  }
};

const getById = async (req, res) => {
  try {
    const { id } = req.params;
    
    const [templates] = await pool.execute(
      `SELECT 
        e.*,
        comp.name as company_name
       FROM email_templates e
       LEFT JOIN companies comp ON e.company_id = comp.id
       WHERE e.id = ? AND e.is_deleted = 0`,
      [id]
    );
    
    if (templates.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: 'Email template not found' 
      });
    }

    const template = templates[0];
    
    // Extract merge tags
    const mergeTags = [];
    const tagRegex = /\{\{(\w+)\}\}/g;
    let match;
    while ((match = tagRegex.exec(template.body)) !== null) {
      if (!mergeTags.includes(`{{${match[1]}}}`)) {
        mergeTags.push(`{{${match[1]}}}`);
      }
    }
    template.mergeTags = mergeTags;

    res.json({ success: true, data: template });
  } catch (error) {
    console.error('Get email template error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Failed to fetch email template' 
    });
  }
};

const create = async (req, res) => {
  try {
    const {
      company_id,
      name,
      subject,
      body,
      type
    } = req.body;

    // Validation
    if (!name || !subject || !body) {
      return res.status(400).json({
        success: false,
        error: 'name, subject, and body are required'
      });
    }

    const companyId = company_id || req.companyId;
    if (!companyId) {
      return res.status(400).json({
        success: false,
        error: "company_id is required"
      });
    }

    // Insert template
    const [result] = await pool.execute(
      `INSERT INTO email_templates (
        company_id, name, subject, body, type
      ) VALUES (?, ?, ?, ?, ?)`,
      [
        companyId,
        name,
        subject,
        body,
        type || null
      ]
    );

    const templateId = result.insertId;

    // Get created template
    const [templates] = await pool.execute(
      `SELECT 
        e.*,
        comp.name as company_name
       FROM email_templates e
       LEFT JOIN companies comp ON e.company_id = comp.id
       WHERE e.id = ?`,
      [templateId]
    );

    const template = templates[0];
    
    // Extract merge tags
    const mergeTags = [];
    const tagRegex = /\{\{(\w+)\}\}/g;
    let match;
    while ((match = tagRegex.exec(template.body)) !== null) {
      if (!mergeTags.includes(`{{${match[1]}}}`)) {
        mergeTags.push(`{{${match[1]}}}`);
      }
    }
    template.mergeTags = mergeTags;

    res.status(201).json({ 
      success: true, 
      data: template,
      message: 'Email template created successfully' 
    });
  } catch (error) {
    console.error('Create email template error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Failed to create email template' 
    });
  }
};

const update = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      subject,
      body,
      type
    } = req.body;

    // Check if template exists
    const [existing] = await pool.execute(
      `SELECT id FROM email_templates WHERE id = ? AND is_deleted = 0`,
      [id]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Email template not found'
      });
    }

    // Build update query
    const updates = [];
    const values = [];

    if (name !== undefined) {
      updates.push('name = ?');
      values.push(name);
    }
    if (subject !== undefined) {
      updates.push('subject = ?');
      values.push(subject);
    }
    if (body !== undefined) {
      updates.push('body = ?');
      values.push(body);
    }
    if (type !== undefined) {
      updates.push('type = ?');
      values.push(type || null);
    }

    if (updates.length > 0) {
      updates.push('updated_at = CURRENT_TIMESTAMP');
      values.push(id);

      await pool.execute(
        `UPDATE email_templates SET ${updates.join(', ')} WHERE id = ?`,
        values
      );
    }

    // Get updated template
    const [templates] = await pool.execute(
      `SELECT 
        e.*,
        comp.name as company_name
       FROM email_templates e
       LEFT JOIN companies comp ON e.company_id = comp.id
       WHERE e.id = ?`,
      [id]
    );

    const template = templates[0];
    
    // Extract merge tags
    const mergeTags = [];
    const tagRegex = /\{\{(\w+)\}\}/g;
    let match;
    while ((match = tagRegex.exec(template.body)) !== null) {
      if (!mergeTags.includes(`{{${match[1]}}}`)) {
        mergeTags.push(`{{${match[1]}}}`);
      }
    }
    template.mergeTags = mergeTags;

    res.json({
      success: true,
      data: template,
      message: 'Email template updated successfully'
    });
  } catch (error) {
    console.error('Update email template error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Failed to update email template' 
    });
  }
};

const deleteTemplate = async (req, res) => {
  try {
    const { id } = req.params;
    
    const [result] = await pool.execute(
      `UPDATE email_templates 
       SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP 
       WHERE id = ?`,
      [id]
    );
    
    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        error: 'Email template not found'
      });
    }
    
    res.json({ 
      success: true, 
      message: 'Email template deleted successfully' 
    });
  } catch (error) {
    console.error('Delete email template error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Failed to delete email template' 
    });
  }
};

module.exports = { 
  getAll, 
  getById, 
  create, 
  update, 
  delete: deleteTemplate
};

