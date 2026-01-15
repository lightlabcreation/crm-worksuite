// =====================================================
// Finance Template Controller
// =====================================================

const pool = require('../config/db');

const getAll = async (req, res) => {
  try {
    // Only filter by company_id if explicitly provided in query params or req.companyId exists
    const filterCompanyId = req.query.company_id || req.companyId;
    const type = req.query.type;

    let whereClause = 'WHERE f.is_deleted = 0';
    const params = [];

    if (filterCompanyId) {
      whereClause += ' AND (f.company_id = ? OR f.company_id IS NULL)'; // Show company specific + global templates
      params.push(filterCompanyId);
    } else {
      whereClause += ' AND f.company_id IS NULL'; // Show only global templates if no company context
    }

    if (type) {
      whereClause += ' AND f.type = ?';
      params.push(type);
    }

    // Get all templates without pagination
    const [templates] = await pool.execute(
      `SELECT 
        f.id,
        f.company_id,
        f.name,
        f.type,
        f.template_data,
        f.created_at,
        f.updated_at,
        comp.name as company_name
       FROM finance_templates f
       LEFT JOIN companies comp ON f.company_id = comp.id
       ${whereClause}
       ORDER BY f.created_at DESC`,
      params
    );

    // Parse JSON template_data
    const parsedTemplates = templates.map(template => ({
      ...template,
      template_data: template.template_data ? JSON.parse(template.template_data) : null,
      status: 'Active' // Default status
    }));

    res.json({
      success: true,
      data: parsedTemplates
    });
  } catch (error) {
    console.error('Get finance templates error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch finance templates'
    });
  }
};

const getById = async (req, res) => {
  try {
    const { id } = req.params;

    const [templates] = await pool.execute(
      `SELECT 
        f.*,
        comp.name as company_name
       FROM finance_templates f
       LEFT JOIN companies comp ON f.company_id = comp.id
       WHERE f.id = ? AND f.is_deleted = 0`,
      [id]
    );

    if (templates.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Finance template not found'
      });
    }

    const template = templates[0];

    // Parse JSON template_data
    if (template.template_data) {
      template.template_data = JSON.parse(template.template_data);
    }

    res.json({ success: true, data: template });
  } catch (error) {
    console.error('Get finance template error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch finance template'
    });
  }
};

const create = async (req, res) => {
  try {
    const {
      name,
      type,
      template_data
    } = req.body;

    // Validation
    if (!name || !type) {
      return res.status(400).json({
        success: false,
        error: 'name and type are required'
      });
    }

    const companyId = req.companyId || null;

    // Convert template_data to JSON string
    const templateDataJson = template_data ? JSON.stringify(template_data) : null;

    // Insert template
    const [result] = await pool.execute(
      `INSERT INTO finance_templates (
        company_id, name, type, template_data
      ) VALUES (?, ?, ?, ?)`,
      [
        companyId,
        name,
        type,
        templateDataJson
      ]
    );

    const templateId = result.insertId;

    // Get created template
    const [templates] = await pool.execute(
      `SELECT 
        f.*,
        comp.name as company_name
       FROM finance_templates f
       LEFT JOIN companies comp ON f.company_id = comp.id
       WHERE f.id = ?`,
      [templateId]
    );

    const template = templates[0];

    // Parse JSON template_data
    if (template.template_data) {
      template.template_data = JSON.parse(template.template_data);
    }

    res.status(201).json({
      success: true,
      data: template,
      message: 'Finance template created successfully'
    });
  } catch (error) {
    console.error('Create finance template error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to create finance template'
    });
  }
};

const update = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      type,
      template_data
    } = req.body;

    // Check if template exists
    const [existing] = await pool.execute(
      `SELECT id FROM finance_templates WHERE id = ? AND is_deleted = 0`,
      [id]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Finance template not found'
      });
    }

    // Build update query
    const updates = [];
    const values = [];

    if (name !== undefined) {
      if (!name || name.trim() === '') {
        return res.status(400).json({ error: 'Name cannot be empty' });
      }
      updates.push('name = ?');
      values.push(name.trim());
    }
    if (type !== undefined) {
      if (!type || type.trim() === '') {
        return res.status(400).json({ error: 'Type cannot be empty' });
      }
      updates.push('type = ?');
      values.push(type.trim());
    }
    if (template_data !== undefined) {
      updates.push('template_data = ?');
      values.push(template_data ? JSON.stringify(template_data) : null);
    }

    if (updates.length > 0) {
      updates.push('updated_at = CURRENT_TIMESTAMP');
      values.push(id);

      await pool.execute(
        `UPDATE finance_templates SET ${updates.join(', ')} WHERE id = ?`,
        values
      );
    }

    // Get updated template
    const [templates] = await pool.execute(
      `SELECT 
        f.*,
        comp.name as company_name
       FROM finance_templates f
       LEFT JOIN companies comp ON f.company_id = comp.id
       WHERE f.id = ?`,
      [id]
    );

    const template = templates[0];

    // Parse JSON template_data
    if (template.template_data) {
      template.template_data = JSON.parse(template.template_data);
    }

    res.json({
      success: true,
      data: template,
      message: 'Finance template updated successfully'
    });
  } catch (error) {
    console.error('Update finance template error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to update finance template'
    });
  }
};

const deleteTemplate = async (req, res) => {
  try {
    const { id } = req.params;

    const [result] = await pool.execute(
      `UPDATE finance_templates 
       SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP 
       WHERE id = ?`,
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        error: 'Finance template not found'
      });
    }

    res.json({
      success: true,
      message: 'Finance template deleted successfully'
    });
  } catch (error) {
    console.error('Delete finance template error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to delete finance template'
    });
  }
};

/**
 * Generate report using template
 * POST /api/v1/finance-templates/:id/generate-report
 */
const generateReport = async (req, res) => {
  try {
    const { id } = req.params;
    const { data, format = 'pdf' } = req.body; // data: invoice/proposal/estimate data, format: 'pdf' | 'excel' | 'html'

    // Get template
    const [templates] = await pool.execute(
      `SELECT * FROM finance_templates WHERE id = ? AND is_deleted = 0`,
      [id]
    );

    if (templates.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Finance template not found'
      });
    }

    const template = templates[0];
    const templateData = template.template_data ? JSON.parse(template.template_data) : {};

    // Generate report based on format
    if (format === 'pdf') {
      // For PDF generation, return template data and document data
      // In production, you would use a library like pdfkit or puppeteer
      res.json({
        success: true,
        data: {
          template: templateData,
          document: data,
          format: 'pdf',
          message: 'PDF report generated successfully. In production, this would return a PDF file.'
        }
      });
    } else if (format === 'excel') {
      // For Excel generation, return CSV-like data
      res.json({
        success: true,
        data: {
          template: templateData,
          document: data,
          format: 'excel',
          message: 'Excel report generated successfully. In production, this would return an Excel file.'
        }
      });
    } else {
      // HTML format
      res.json({
        success: true,
        data: {
          template: templateData,
          document: data,
          format: 'html',
          html: generateHTMLReport(templateData, data)
        }
      });
    }
  } catch (error) {
    console.error('Generate report error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to generate report'
    });
  }
};

/**
 * Generate HTML report from template and data
 */
const generateHTMLReport = (templateData, documentData) => {
  const primaryColor = templateData.primaryColor || '#3B82F6';
  const secondaryColor = templateData.secondaryColor || '#1E40AF';
  const logo = templateData.logo || '';
  const template = templateData.template || '';

  let html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>${documentData.type || 'Document'} Report</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .header { display: flex; justify-content: space-between; margin-bottom: 30px; }
        .logo { max-width: 150px; }
        .content { color: #333; }
        .primary-color { color: ${primaryColor}; }
        .secondary-color { color: ${secondaryColor}; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        th, td { padding: 10px; text-align: left; border-bottom: 1px solid #ddd; }
        th { background-color: ${primaryColor}; color: white; }
        .total { font-weight: bold; text-align: right; }
      </style>
    </head>
    <body>
      <div class="header">
        ${logo ? `<img src="${logo}" alt="Logo" class="logo">` : '<div></div>'}
        <div>
          <h1 class="primary-color">${documentData.type || 'Document'}</h1>
          <p>${documentData.number || ''}</p>
        </div>
      </div>
      <div class="content">
        ${template || generateDefaultTemplate(documentData)}
      </div>
    </body>
    </html>
  `;

  return html;
};

/**
 * Generate default template HTML
 */
const generateDefaultTemplate = (data) => {
  let html = '<div>';

  if (data.client_name) {
    html += `<p><strong>Client:</strong> ${data.client_name}</p>`;
  }
  if (data.date) {
    html += `<p><strong>Date:</strong> ${data.date}</p>`;
  }
  if (data.items && data.items.length > 0) {
    html += '<table><thead><tr><th>Description</th><th>Quantity</th><th>Rate</th><th>Amount</th></tr></thead><tbody>';
    data.items.forEach(item => {
      html += `<tr>
        <td>${item.description || item.name || '-'}</td>
        <td>${item.quantity || 0}</td>
        <td>$${parseFloat(item.rate || item.price || 0).toFixed(2)}</td>
        <td>$${parseFloat(item.amount || item.total || 0).toFixed(2)}</td>
      </tr>`;
    });
    html += '</tbody></table>';
  }
  if (data.total) {
    html += `<p class="total">Total: $${parseFloat(data.total).toFixed(2)}</p>`;
  }

  html += '</div>';
  return html;
};

module.exports = {
  getAll,
  getById,
  create,
  update,
  delete: deleteTemplate,
  generateReport
};

