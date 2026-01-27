// =====================================================
// Contract Template Controller
// =====================================================

const pool = require('../config/db');

/**
 * Get all contract templates
 * GET /api/v1/contract-templates
 */
const getAll = async (req, res) => {
  try {
    const companyId = req.query.company_id || req.body.company_id || req.companyId;
    
    if (!companyId) {
      return res.status(400).json({
        success: false,
        error: 'company_id is required'
      });
    }

    const [templates] = await pool.execute(
      `SELECT * FROM contract_templates 
       WHERE company_id = ? AND is_deleted = 0 AND is_active = 1
       ORDER BY is_default DESC, template_name ASC`,
      [companyId]
    );

    res.json({
      success: true,
      data: templates
    });
  } catch (error) {
    console.error('Get contract templates error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch contract templates'
    });
  }
};

/**
 * Get template by ID
 * GET /api/v1/contract-templates/:id
 */
const getById = async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.query.company_id || req.body.company_id || req.companyId;

    const [templates] = await pool.execute(
      `SELECT * FROM contract_templates 
       WHERE id = ? AND company_id = ? AND is_deleted = 0`,
      [id, companyId]
    );

    if (templates.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Template not found'
      });
    }

    res.json({
      success: true,
      data: templates[0]
    });
  } catch (error) {
    console.error('Get contract template error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch contract template'
    });
  }
};

/**
 * Create contract template
 * POST /api/v1/contract-templates
 */
const create = async (req, res) => {
  try {
    const {
      template_name,
      template_type,
      description,
      content,
      variables,
      is_default,
      is_active
    } = req.body;

    const companyId = req.body.company_id || req.query.company_id || req.companyId || 1;
    const createdBy = req.body.user_id || req.query.user_id || req.userId || 1;

    if (!template_name || !content) {
      return res.status(400).json({
        success: false,
        error: 'template_name and content are required'
      });
    }

    // If setting as default, unset other defaults
    if (is_default) {
      await pool.execute(
        `UPDATE contract_templates SET is_default = 0 WHERE company_id = ?`,
        [companyId]
      );
    }

    const [result] = await pool.execute(
      `INSERT INTO contract_templates 
       (company_id, template_name, template_type, description, content, variables, is_default, is_active, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        companyId,
        template_name,
        template_type || 'General',
        description || null,
        content,
        variables ? JSON.stringify(variables) : null,
        is_default ? 1 : 0,
        is_active !== undefined ? (is_active ? 1 : 0) : 1,
        createdBy
      ]
    );

    const [newTemplate] = await pool.execute(
      `SELECT * FROM contract_templates WHERE id = ?`,
      [result.insertId]
    );

    res.status(201).json({
      success: true,
      data: newTemplate[0],
      message: 'Template created successfully'
    });
  } catch (error) {
    console.error('Create contract template error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create contract template',
      details: error.message
    });
  }
};

/**
 * Update contract template
 * PUT /api/v1/contract-templates/:id
 */
const update = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      template_name,
      template_type,
      description,
      content,
      variables,
      is_default,
      is_active
    } = req.body;

    const companyId = req.body.company_id || req.query.company_id || req.companyId;

    // Check if template exists
    const [templates] = await pool.execute(
      `SELECT id FROM contract_templates 
       WHERE id = ? AND company_id = ? AND is_deleted = 0`,
      [id, companyId]
    );

    if (templates.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Template not found'
      });
    }

    // If setting as default, unset other defaults
    if (is_default) {
      await pool.execute(
        `UPDATE contract_templates SET is_default = 0 WHERE company_id = ? AND id != ?`,
        [companyId, id]
      );
    }

    const updates = [];
    const values = [];

    if (template_name !== undefined) updates.push('template_name = ?'), values.push(template_name);
    if (template_type !== undefined) updates.push('template_type = ?'), values.push(template_type);
    if (description !== undefined) updates.push('description = ?'), values.push(description);
    if (content !== undefined) updates.push('content = ?'), values.push(content);
    if (variables !== undefined) updates.push('variables = ?'), values.push(JSON.stringify(variables));
    if (is_default !== undefined) updates.push('is_default = ?'), values.push(is_default ? 1 : 0);
    if (is_active !== undefined) updates.push('is_active = ?'), values.push(is_active ? 1 : 0);

    if (updates.length > 0) {
      updates.push('updated_at = CURRENT_TIMESTAMP');
      values.push(id);

      await pool.execute(
        `UPDATE contract_templates SET ${updates.join(', ')} WHERE id = ?`,
        values
      );
    }

    const [updatedTemplate] = await pool.execute(
      `SELECT * FROM contract_templates WHERE id = ?`,
      [id]
    );

    res.json({
      success: true,
      data: updatedTemplate[0],
      message: 'Template updated successfully'
    });
  } catch (error) {
    console.error('Update contract template error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update contract template',
      details: error.message
    });
  }
};

/**
 * Delete contract template
 * DELETE /api/v1/contract-templates/:id
 */
const deleteTemplate = async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.query.company_id || req.body.company_id || req.companyId;

    const [result] = await pool.execute(
      `UPDATE contract_templates 
       SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND company_id = ?`,
      [id, companyId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        error: 'Template not found'
      });
    }

    res.json({
      success: true,
      message: 'Template deleted successfully'
    });
  } catch (error) {
    console.error('Delete contract template error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete contract template'
    });
  }
};

/**
 * Render template with contract data
 * POST /api/v1/contract-templates/:id/render
 */
const renderTemplate = async (req, res) => {
  try {
    const { id } = req.params;
    const { contractData } = req.body;
    const companyId = req.query.company_id || req.body.company_id || req.companyId;

    const [templates] = await pool.execute(
      `SELECT * FROM contract_templates 
       WHERE id = ? AND company_id = ? AND is_deleted = 0 AND is_active = 1`,
      [id, companyId]
    );

    if (templates.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Template not found'
      });
    }

    const template = templates[0];
    let renderedContent = template.content;

    // Fetch company data if not provided
    let companyInfo = {};
    if (companyId) {
      try {
        const [companies] = await pool.execute(
          `SELECT name, address, phone, email, city, state, postal_code, country 
           FROM companies WHERE id = ?`,
          [companyId]
        );
        if (companies.length > 0) {
          companyInfo = companies[0];
        }
      } catch (err) {
        console.warn('Error fetching company info:', err.message);
      }
    }

    // Fetch client data if client_id provided
    let clientInfo = {};
    if (contractData.client_id) {
      try {
        const [clients] = await pool.execute(
          `SELECT company_name, address, city, state, postal_code, country 
           FROM clients WHERE id = ? AND company_id = ?`,
          [contractData.client_id, companyId]
        );
        if (clients.length > 0) {
          clientInfo = clients[0];
        }
      } catch (err) {
        console.warn('Error fetching client info:', err.message);
      }
    }

    // Format dates
    const formatDate = (dateString) => {
      if (!dateString) return '';
      try {
        const date = new Date(dateString);
        return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
      } catch {
        return dateString;
      }
    };

    // Replace variables with contract data
    const replacements = {
      '{CONTRACT_NUMBER}': contractData.contract_number || '',
      '{CONTRACT_DATE}': formatDate(contractData.contract_date) || contractData.contract_date || '',
      '{VALID_UNTIL}': formatDate(contractData.valid_until) || contractData.valid_until || '',
      '{COMPANY_NAME}': contractData.company_name || companyInfo.name || '',
      '{COMPANY_ADDRESS}': contractData.company_address || companyInfo.address || '',
      '{COMPANY_PHONE}': contractData.company_phone || companyInfo.phone || '',
      '{COMPANY_EMAIL}': contractData.company_email || companyInfo.email || '',
      '{CLIENT_NAME}': contractData.client_name || clientInfo.company_name || '',
      '{CLIENT_ADDRESS}': contractData.client_address || 
        [clientInfo.address, clientInfo.city, clientInfo.state, clientInfo.postal_code]
          .filter(Boolean).join(', ') || '',
      '{CONTRACT_AMOUNT}': contractData.amount ? `$${parseFloat(contractData.amount).toFixed(2)}` : '$0.00',
      '{ITEMS_LIST}': contractData.items ? generateItemsList(contractData.items) : '',
      '{ADDITIONAL_TERMS}': contractData.note || '',
      '{PAYMENT_TERMS}': contractData.payment_terms || 'Net 30',
      '{DELIVERY_TERMS}': contractData.delivery_terms || 'Standard delivery',
      '{WARRANTY_TERMS}': contractData.warranty_terms || 'Standard warranty',
      '{POSITION_DESCRIPTION}': contractData.position_description || ''
    };

    // Replace all variables
    Object.keys(replacements).forEach(key => {
      const regex = new RegExp(key.replace(/[{}]/g, '\\$&'), 'g');
      renderedContent = renderedContent.replace(regex, replacements[key]);
    });

    res.json({
      success: true,
      data: {
        rendered_content: renderedContent,
        template: {
          id: template.id,
          template_name: template.template_name,
          template_type: template.template_type
        }
      }
    });
  } catch (error) {
    console.error('Render template error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to render template',
      details: error.message
    });
  }
};

/**
 * Helper function to generate items list HTML
 */
const generateItemsList = (items) => {
  if (!items || items.length === 0) {
    return '<p>No items specified.</p>';
  }

  let html = '<table style="width: 100%; border-collapse: collapse; margin: 20px 0;">';
  html += '<thead><tr style="background-color: #f2f2f2;">';
  html += '<th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Item</th>';
  html += '<th style="border: 1px solid #ddd; padding: 8px; text-align: center;">Quantity</th>';
  html += '<th style="border: 1px solid #ddd; padding: 8px; text-align: right;">Rate</th>';
  html += '<th style="border: 1px solid #ddd; padding: 8px; text-align: right;">Amount</th>';
  html += '</tr></thead><tbody>';

  items.forEach(item => {
    const quantity = item.quantity || 1;
    const unitPrice = parseFloat(item.unit_price || 0);
    const amount = parseFloat(item.amount || (quantity * unitPrice));
    
    html += '<tr>';
    html += `<td style="border: 1px solid #ddd; padding: 8px;">${item.item_name || '-'}</td>`;
    html += `<td style="border: 1px solid #ddd; padding: 8px; text-align: center;">${quantity} ${item.unit || ''}</td>`;
    html += `<td style="border: 1px solid #ddd; padding: 8px; text-align: right;">$${unitPrice.toFixed(2)}</td>`;
    html += `<td style="border: 1px solid #ddd; padding: 8px; text-align: right;">$${amount.toFixed(2)}</td>`;
    html += '</tr>';
  });

  html += '</tbody></table>';
  return html;
};

module.exports = {
  getAll,
  getById,
  create,
  update,
  delete: deleteTemplate,
  renderTemplate
};

