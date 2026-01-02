// =====================================================
// Company Controller
// =====================================================

const pool = require('../config/db');

/**
 * Get all companies
 * GET /api/v1/companies
 */
const getAll = async (req, res) => {
  try {
    // Check if companyId exists (for multi-tenant filtering)
    // For super admin, they might want to see all companies
    // For regular admin, they see only their company
    
    const { search } = req.query;

    let whereClause = 'WHERE is_deleted = 0';
    const params = [];

    // If user has company_id, filter by it (unless they're super admin)
    // For now, we'll allow admins to see all companies
    // You can add role-based filtering here if needed
    
    if (search) {
      whereClause += ' AND name LIKE ?';
      params.push(`%${search}%`);
    }

    // Get all companies without pagination
    const [companies] = await pool.execute(
      `SELECT * FROM companies 
       ${whereClause}
       ORDER BY created_at DESC`,
      params
    );

    res.json({
      success: true,
      data: companies
    });
  } catch (error) {
    console.error('Get companies error:', error);
    console.error('Error details:', {
      message: error.message,
      stack: error.stack
    });
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch companies',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

/**
 * Get company by ID
 * GET /api/v1/companies/:id
 */
const getById = async (req, res) => {
  try {
    const { id } = req.params;

    const [companies] = await pool.execute(
      `SELECT * FROM companies 
       WHERE id = ? AND is_deleted = 0`,
      [id]
    );

    if (companies.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Company not found'
      });
    }

    res.json({
      success: true,
      data: companies[0]
    });
  } catch (error) {
    console.error('Get company by ID error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch company'
    });
  }
};

/**
 * Create new company
 * POST /api/v1/companies
 */
const create = async (req, res) => {
  try {
    const {
      name,
      industry,
      website,
      address,
      notes,
      logo,
      currency = 'USD',
      timezone = 'UTC'
    } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        error: 'Company name is required'
      });
    }

    const [result] = await pool.execute(
      `INSERT INTO companies (name, industry, website, address, notes, logo, currency, timezone)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [name, industry || null, website || null, address || null, notes || null, logo || null, currency, timezone]
    );

    const [newCompany] = await pool.execute(
      `SELECT * FROM companies WHERE id = ?`,
      [result.insertId]
    );

    res.status(201).json({
      success: true,
      data: newCompany[0],
      message: 'Company created successfully'
    });
  } catch (error) {
    console.error('Create company error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to create company'
    });
  }
};

/**
 * Update company
 * PUT /api/v1/companies/:id
 */
const update = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      industry,
      website,
      address,
      notes,
      logo,
      currency,
      timezone,
      package_id
    } = req.body;

    // Check if company exists
    const [existing] = await pool.execute(
      `SELECT id FROM companies 
       WHERE id = ? AND is_deleted = 0`,
      [id]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Company not found'
      });
    }

    const updateFields = [];
    const updateValues = [];

    if (name !== undefined) {
      updateFields.push('name = ?');
      updateValues.push(name);
    }
    if (industry !== undefined) {
      updateFields.push('industry = ?');
      updateValues.push(industry || null);
    }
    if (website !== undefined) {
      updateFields.push('website = ?');
      updateValues.push(website || null);
    }
    if (address !== undefined) {
      updateFields.push('address = ?');
      updateValues.push(address || null);
    }
    if (notes !== undefined) {
      updateFields.push('notes = ?');
      updateValues.push(notes || null);
    }
    if (logo !== undefined) {
      updateFields.push('logo = ?');
      updateValues.push(logo);
    }
    if (currency !== undefined) {
      updateFields.push('currency = ?');
      updateValues.push(currency);
    }
    if (timezone !== undefined) {
      updateFields.push('timezone = ?');
      updateValues.push(timezone);
    }
    if (package_id !== undefined) {
      updateFields.push('package_id = ?');
      updateValues.push(package_id || null);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No fields to update'
      });
    }

    await pool.execute(
      `UPDATE companies 
       SET ${updateFields.join(', ')}, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [...updateValues, id]
    );

    const [updated] = await pool.execute(
      `SELECT * FROM companies WHERE id = ?`,
      [id]
    );

    res.json({
      success: true,
      data: updated[0],
      message: 'Company updated successfully'
    });
  } catch (error) {
    console.error('Update company error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to update company'
    });
  }
};

/**
 * Delete company (soft delete)
 * DELETE /api/v1/companies/:id
 */
const deleteCompany = async (req, res) => {
  try {
    const { id } = req.params;

    const [existing] = await pool.execute(
      `SELECT id FROM companies 
       WHERE id = ? AND is_deleted = 0`,
      [id]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Company not found'
      });
    }

    await pool.execute(
      `UPDATE companies 
       SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [id]
    );

    res.json({
      success: true,
      message: 'Company deleted successfully'
    });
  } catch (error) {
    console.error('Delete company error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to delete company'
    });
  }
};

module.exports = {
  getAll,
  getById,
  create,
  update,
  deleteCompany
};

