// =====================================================
// Lead Controller
// =====================================================

const pool = require('../config/db');
const bcrypt = require('bcryptjs');

/**
 * Helper function to convert ISO 8601 date string to MySQL DATE format (YYYY-MM-DD)
 * @param {string|Date|null|undefined} dateValue - The date value to convert
 * @returns {string|null} - MySQL DATE format string or null
 */
const convertToMySQLDate = (dateValue) => {
  // Handle null, undefined, or empty values
  if (dateValue === null || dateValue === undefined) {
    return null;
  }

  // Handle empty strings
  if (dateValue === '' || (typeof dateValue === 'string' && dateValue.trim() === '')) {
    return null;
  }

  // If it's already a Date object, format it
  if (dateValue instanceof Date) {
    if (isNaN(dateValue.getTime())) {
      return null;
    }
    const year = dateValue.getFullYear();
    const month = String(dateValue.getMonth() + 1).padStart(2, '0');
    const day = String(dateValue.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  // If it's a string, parse it
  if (typeof dateValue === 'string') {
    const trimmed = dateValue.trim();

    // Handle empty string after trim
    if (trimmed === '') {
      return null;
    }

    // Handle ISO 8601 format: '2025-12-25T00:00:00.000Z' or '2025-12-25T00:00:00Z'
    // Split on 'T' and take the date part (first 10 characters: YYYY-MM-DD)
    if (trimmed.includes('T')) {
      const datePart = trimmed.split('T')[0];
      // Validate the date part format
      if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
        return datePart;
      }
    }

    // If it's already in YYYY-MM-DD format, validate and return
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return trimmed;
    }

    // Try to parse as Date and format
    const date = new Date(trimmed);
    if (!isNaN(date.getTime())) {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
  }

  return null;
};

/**
 * Helper function to sanitize integer values for MySQL
 * Converts empty strings to null and ensures valid integer values
 * @param {string|number|null|undefined} intValue - The integer value to sanitize
 * @returns {number|null} - Valid integer or null
 */
const sanitizeInteger = (intValue) => {
  // Handle null, undefined, or empty values first
  if (intValue === null || intValue === undefined) {
    return null;
  }

  // Convert empty strings to null (check multiple ways)
  if (intValue === '' || intValue === 'null' || intValue === 'undefined') {
    return null;
  }

  // If it's a string, trim and check if empty
  if (typeof intValue === 'string') {
    const trimmed = intValue.trim();
    if (trimmed === '' || trimmed === 'null' || trimmed === 'undefined') {
      return null;
    }
    // Try to parse as integer
    const parsed = parseInt(trimmed, 10);
    // Return null if parsing failed or if it's NaN
    if (isNaN(parsed) || !isFinite(parsed)) {
      return null;
    }
    return parsed;
  }

  // If it's already a number, validate and convert to integer
  if (typeof intValue === 'number') {
    if (isNaN(intValue) || !isFinite(intValue)) {
      return null;
    }
    return parseInt(intValue, 10);
  }

  // For any other type, return null
  return null;
};

/**
 * Get all leads
 * GET /api/v1/leads
 */
// Helper to replace nulls with empty strings/zeros
const sanitizeLead = (lead) => {
  const sanitized = { ...lead };
  // String fields
  ['company_name', 'person_name', 'email', 'phone', 'address', 'city', 'state', 'zip', 'country', 'notes'].forEach(field => {
    if (sanitized[field] === null) sanitized[field] = '';
  });
  // Numeric/Date fields (keep dates null if really no date? User complained about nulls generally)
  // Let's keep dates as null if empty, but probability/value as 0
  if (sanitized.value === null) sanitized.value = '0.00';
  if (sanitized.probability === null) sanitized.probability = 0;

  return sanitized;
};

const getAll = async (req, res) => {
  try {
    const { status, owner_id, source, city } = req.query;
    // company_id is optional - if not provided, return all leads
    const companyId = req.query.company_id || req.body.company_id || req.companyId;

    let whereClause = 'WHERE l.is_deleted = 0';
    const params = [];

    // Filter by company_id only if provided
    if (companyId) {
      whereClause += ' AND l.company_id = ?';
      params.push(companyId);
    }

    if (status) {
      whereClause += ' AND l.status = ?';
      params.push(status);
    }
    if (owner_id) {
      whereClause += ' AND l.owner_id = ?';
      params.push(owner_id);
    }
    if (source) {
      whereClause += ' AND l.source = ?';
      params.push(source);
    }
    if (city) {
      whereClause += ' AND l.city = ?';
      params.push(city);
    }

    // Get all leads without pagination
    const [leads] = await pool.execute(
      `SELECT l.*, u.name as owner_name, u.email as owner_email, c.name as company_name
       FROM leads l
       LEFT JOIN users u ON l.owner_id = u.id
       LEFT JOIN companies c ON l.company_id = c.id
       ${whereClause}
       ORDER BY l.created_at DESC`,
      params
    );

    // Get labels for each lead
    const leadsWithLabels = await Promise.all(leads.map(async (lead) => {
      const [labels] = await pool.execute(
        `SELECT label FROM lead_labels WHERE lead_id = ?`,
        [lead.id]
      );
      const leadLabels = labels.map(l => l.label);
      return sanitizeLead({ ...lead, labels: leadLabels });
    }));

    res.json({
      success: true,
      data: leadsWithLabels
    });
  } catch (error) {
    console.error('Get leads error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch leads'
    });
  }
};

/**
 * Get lead by ID
 * GET /api/v1/leads/:id
 */
const getById = async (req, res) => {
  try {
    const { id } = req.params;

    // Admin must provide company_id - required for filtering
    const companyId = req.query.company_id || req.body.company_id || req.companyId;

    if (!companyId) {
      return res.status(400).json({
        success: false,
        error: 'company_id is required'
      });
    }
    const [leads] = await pool.execute(
      `SELECT l.*, u.name as owner_name, u.email as owner_email, c.name as company_name
       FROM leads l
       LEFT JOIN users u ON l.owner_id = u.id
       LEFT JOIN companies c ON l.company_id = c.id
       WHERE l.id = ? AND l.company_id = ? AND l.is_deleted = 0`,
      [id, companyId]
    );

    if (leads.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Lead not found'
      });
    }

    const lead = leads[0];

    // Get labels
    const [labels] = await pool.execute(
      `SELECT label FROM lead_labels WHERE lead_id = ?`,
      [lead.id]
    );
    lead.labels = labels.map(l => l.label);

    res.json({
      success: true,
      data: sanitizeLead(lead)
    });
  } catch (error) {
    console.error('Get lead error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch lead'
    });
  }
};

/**
 * Create lead
 * POST /api/v1/leads
 */
const create = async (req, res) => {
  try {
    const {
      lead_type, company_name, person_name, email, phone,
      owner_id, status, source, address,
      city, state, zip, country, value, due_followup,
      notes, probability, call_this_week, labels = []
    } = req.body;

    // Removed required validations - allow empty data
    // Sanitize integer fields
    const sanitizedOwnerId = sanitizeInteger(owner_id);
    const sanitizedValue = sanitizeInteger(value);
    const sanitizedProbability = sanitizeInteger(probability);

    // Only validate owner_id if provided, otherwise use default
    const effectiveOwnerId = sanitizedOwnerId || req.userId || 1;

    // Insert lead - convert undefined to null for SQL
    const companyId = req.companyId || req.body.company_id || req.query.company_id || 1;
    // Get created_by from user session, body, query, or use owner_id as fallback
    const userId = req.userId || req.body.user_id || req.query.user_id || req.body.created_by || sanitizedOwnerId || 1;
    const [result] = await pool.execute(
      `INSERT INTO leads (
        company_id, lead_type, company_name, person_name, email, phone,
        owner_id, status, source, address, city, state, zip, country,
        value, due_followup, notes, probability, call_this_week, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        companyId,
        lead_type || 'Organization',
        company_name ?? null,
        person_name ?? null,
        email ?? null,
        phone ?? null,
        effectiveOwnerId,
        status || 'New',
        source ?? null,
        address ?? null,
        city ?? null,
        state ?? null,
        zip ?? null,
        country ?? null,
        sanitizedValue,
        convertToMySQLDate(due_followup),
        notes ?? null,
        sanitizedProbability,
        call_this_week ?? false,
        userId
      ]
    );

    const leadId = result.insertId;

    // Insert labels
    if (labels.length > 0) {
      const labelValues = labels.map(label => [leadId, label]);
      await pool.query(
        `INSERT INTO lead_labels (lead_id, label) VALUES ?`,
        [labelValues]
      );
    }

    // Get created lead with company name and owner details
    const [leads] = await pool.execute(
      `SELECT l.*, u.name as owner_name, u.email as owner_email, c.name as company_name
       FROM leads l
       LEFT JOIN users u ON l.owner_id = u.id
       LEFT JOIN companies c ON l.company_id = c.id
       WHERE l.id = ?`,
      [leadId]
    );

    res.status(201).json({
      success: true,
      data: sanitizeLead(leads[0]),
      message: 'Lead created successfully'
    });
  } catch (error) {
    console.error('Create lead error:', error);
    res.status(500).json({
      success: false,
      error: error.sqlMessage || error.message || 'Failed to create lead'
    });
  }
};

/**
 * Update lead
 * PUT /api/v1/leads/:id
 */
const update = async (req, res) => {
  try {
    const { id } = req.params;
    const updateFields = req.body;

    const companyId = req.companyId || req.query.company_id || req.body.company_id || 1;

    // Pre-process and sanitize updateFields BEFORE building query
    // Convert due_followup date format if present
    if (updateFields.hasOwnProperty('due_followup')) {
      updateFields.due_followup = convertToMySQLDate(updateFields.due_followup);
    }

    // Sanitize integer fields if present
    const integerFields = ['owner_id', 'value', 'probability'];
    for (const intField of integerFields) {
      if (updateFields.hasOwnProperty(intField)) {
        updateFields[intField] = sanitizeInteger(updateFields[intField]);
      }
    }

    // Check if lead exists
    const [leads] = await pool.execute(
      `SELECT id FROM leads WHERE id = ? AND company_id = ? AND is_deleted = 0`,
      [id, companyId]
    );

    if (leads.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Lead not found'
      });
    }

    // Build update query
    const allowedFields = [
      'lead_type', 'company_name', 'person_name', 'email', 'phone',
      'owner_id', 'status', 'source', 'address', 'city', 'state',
      'zip', 'country', 'value', 'due_followup', 'notes', 'probability', 'call_this_week'
    ];

    const updates = [];
    const values = [];

    for (const field of allowedFields) {
      if (updateFields.hasOwnProperty(field)) {
        let fieldValue = updateFields[field];

        // Convert undefined to null for other fields
        if (fieldValue === undefined) {
          fieldValue = null;
        }

        updates.push(`${field} = ?`);
        values.push(fieldValue);
      }
    }

    if (updates.length > 0) {
      updates.push('updated_at = CURRENT_TIMESTAMP');
      values.push(id, companyId);

      await pool.execute(
        `UPDATE leads SET ${updates.join(', ')} WHERE id = ? AND company_id = ?`,
        values
      );
    }

    // Update labels if provided
    if (updateFields.labels) {
      await pool.execute(`DELETE FROM lead_labels WHERE lead_id = ?`, [id]);
      if (updateFields.labels.length > 0) {
        const labelValues = updateFields.labels.map(label => [id, label]);
        await pool.query(
          `INSERT INTO lead_labels (lead_id, label) VALUES ?`,
          [labelValues]
        );
      }
    }

    // Get updated lead with company name
    const [updatedLeads] = await pool.execute(
      `SELECT l.*, u.name as owner_name, u.email as owner_email, c.name as company_name
       FROM leads l
       LEFT JOIN users u ON l.owner_id = u.id
       LEFT JOIN companies c ON l.company_id = c.id
       WHERE l.id = ?`,
      [id]
    );

    const updatedLead = updatedLeads[0];

    // Get labels for updated lead
    if (updatedLead) {
      const [labels] = await pool.execute(
        `SELECT label FROM lead_labels WHERE lead_id = ?`,
        [id]
      );
      updatedLead.labels = labels.map(l => l.label);
    }

    res.json({
      success: true,
      data: sanitizeLead(updatedLead),
      message: 'Lead updated successfully'
    });
  } catch (error) {
    console.error('Update lead error:', error);
    res.status(500).json({
      success: false,
      error: error.sqlMessage || error.message || 'Failed to update lead'
    });
  }
};

/**
 * Delete lead (soft delete)
 * DELETE /api/v1/leads/:id
 */
const deleteLead = async (req, res) => {
  try {
    const { id } = req.params;

    const companyId = req.companyId || req.query.company_id || 1;
    const [result] = await pool.execute(
      `UPDATE leads SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND company_id = ?`,
      [id, companyId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        error: 'Lead not found'
      });
    }

    res.json({
      success: true,
      message: 'Lead deleted successfully'
    });
  } catch (error) {
    console.error('Delete lead error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete lead'
    });
  }
};

/**
 * Convert lead to client
 * POST /api/v1/leads/:id/convert-to-client
 */
const convertToClient = async (req, res) => {
  const connection = await pool.getConnection();
  await connection.beginTransaction();

  try {
    const { id } = req.params;

    // Destructure properties and default to null so that we never pass undefined to SQL
    const {
      companyName = null,
      email = null,
      password = null,
      address = null,
      city = null,
      state = null,
      zip = null,
      country = 'United States',
      phoneCountryCode = '+1',
      phoneNumber = null,
      website = null,
      vatNumber = null,
      gstNumber = null,
      currency = 'USD',
      currencySymbol = '$',
      disableOnlinePayment = 0
    } = req.body;

    // Ensure company_id is properly parsed as integer
    const companyId = parseInt(req.companyId || req.query.company_id || req.body.company_id || 0, 10);

    // company_id is required
    if (!companyId || isNaN(companyId) || companyId <= 0) {
      await connection.rollback();
      connection.release();
      return res.status(400).json({
        success: false,
        error: 'company_id is required'
      });
    }

    // Get lead to verify existence
    const [leads] = await connection.execute(
      `SELECT * FROM leads WHERE id = ? AND company_id = ? AND is_deleted = 0`,
      [id, companyId]
    );

    if (leads.length === 0) {
      await connection.rollback();
      connection.release();
      return res.status(404).json({
        success: false,
        error: 'Lead not found'
      });
    }

    const lead = leads[0];

    // Validate strictly required fields
    if (!companyName || !email || !password) {
      await connection.rollback();
      connection.release();
      return res.status(400).json({
        success: false,
        error: 'Company Name, Email and Password are required'
      });
    }

    // Check if user already exists
    const [existingUsers] = await connection.execute(
      `SELECT id FROM users WHERE email = ? AND company_id = ?`,
      [email, companyId]
    );

    let ownerId;

    if (existingUsers.length > 0) {
      ownerId = existingUsers[0].id;
    } else {
      // Create user account first
      // Note: bcrypt must be initialized/imported
      const hashedPassword = await bcrypt.hash(password, 10);
      const [userResult] = await connection.execute(
        `INSERT INTO users (company_id, name, email, password, role, status)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          companyId,
          companyName,
          email,
          hashedPassword,
          'CLIENT',
          'Active'
        ]
      );
      ownerId = userResult.insertId;
    }

    // Create client
    const [clientResult] = await connection.execute(
      `INSERT INTO clients (
        company_id, company_name, owner_id, address, city, state, zip, country,
        phone_country_code, phone_number, website, vat_number, gst_number,
        currency, currency_symbol, disable_online_payment, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        companyId,
        companyName,
        ownerId,
        address || lead.address || null,
        city || lead.city || null,
        state || lead.state || null,
        zip || lead.zip || null,
        country || lead.country || 'United States',
        phoneCountryCode || '+1',
        phoneNumber || lead.phone || null,
        website || null,
        vatNumber || null,
        gstNumber || null,
        currency || 'USD',
        currencySymbol || '$',
        disableOnlinePayment || 0,
        'Active'
      ]
    );

    const clientId = clientResult.insertId;

    // Create primary contact
    // Determine contact name safely
    const contactName = lead.person_name || companyName || 'Contact';
    const contactPhone = phoneNumber || lead.phone || null;

    if (contactName) {
      await connection.execute(
        `INSERT INTO client_contacts (
          client_id, name, job_title, email, phone, is_primary
        ) VALUES (?, ?, ?, ?, ?, ?)`,
        [
          clientId,
          contactName,
          null, // job_title is explicitly null
          email,
          contactPhone,
          1
        ]
      );
    }

    // Update lead status to 'Won'
    await connection.execute(
      `UPDATE leads SET status = 'Won', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [id]
    );

    await connection.commit();
    connection.release();

    res.json({
      success: true,
      data: { client_id: clientId },
      message: 'Lead converted to client successfully'
    });
  } catch (error) {
    if (connection) await connection.rollback();
    if (connection) connection.release();
    console.error('Convert lead error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to convert lead to client',
      details: error.message
    });
  }
};

/**
 * Get leads overview statistics
 * GET /api/v1/leads/overview
 */
const getOverview = async (req, res) => {
  try {
    const { date_range = 'all', start_date, end_date } = req.query;
    // Ensure company_id is properly parsed as integer
    const companyId = parseInt(req.companyId || req.query.company_id || req.body.company_id || 0, 10);

    // Log for debugging
    console.log('Leads Overview API - Request details:', {
      query: req.query,
      companyId: companyId,
      reqCompanyId: req.companyId,
      queryCompanyId: req.query.company_id
    });

    // company_id is required for admin users
    if (!companyId || isNaN(companyId) || companyId <= 0) {
      return res.status(400).json({
        success: false,
        error: 'company_id is required and must be a valid positive number'
      });
    }

    // Calculate date range
    let dateFilter = '';
    const dateParams = [];

    if (date_range === 'today') {
      dateFilter = 'AND DATE(l.created_at) = CURDATE()';
    } else if (date_range === 'this_week') {
      dateFilter = 'AND YEARWEEK(l.created_at, 1) = YEARWEEK(CURDATE(), 1)';
    } else if (date_range === 'this_month') {
      dateFilter = 'AND YEAR(l.created_at) = YEAR(CURDATE()) AND MONTH(l.created_at) = MONTH(CURDATE())';
    } else if (date_range === 'custom' && start_date && end_date) {
      dateFilter = 'AND DATE(l.created_at) BETWEEN ? AND ?';
      dateParams.push(start_date, end_date);
    }

    // Total Leads
    const [totalLeadsResult] = await pool.execute(
      `SELECT COUNT(*) as count FROM leads l 
       WHERE l.company_id = ? AND l.is_deleted = 0 ${dateFilter}`,
      [companyId, ...dateParams]
    );
    const totalLeads = totalLeadsResult[0].count;

    // New Leads
    const [newLeadsResult] = await pool.execute(
      `SELECT COUNT(*) as count FROM leads l 
       WHERE l.company_id = ? AND l.is_deleted = 0 AND l.status = 'New' ${dateFilter}`,
      [companyId, ...dateParams]
    );
    const newLeads = newLeadsResult[0].count;

    // Converted Leads (Won)
    const [convertedLeadsResult] = await pool.execute(
      `SELECT COUNT(*) as count FROM leads l 
       WHERE l.company_id = ? AND l.is_deleted = 0 AND l.status = 'Won' ${dateFilter}`,
      [companyId, ...dateParams]
    );
    const convertedLeads = convertedLeadsResult[0].count;

    // Lost Leads
    const [lostLeadsResult] = await pool.execute(
      `SELECT COUNT(*) as count FROM leads l 
       WHERE l.company_id = ? AND l.is_deleted = 0 AND l.status = 'Lost' ${dateFilter}`,
      [companyId, ...dateParams]
    );
    const lostLeads = lostLeadsResult[0].count;

    // Lead Sources Distribution
    const [sourcesResult] = await pool.execute(
      `SELECT 
        COALESCE(l.source, 'Unknown') as source,
        COUNT(*) as count
       FROM leads l
       WHERE l.company_id = ? AND l.is_deleted = 0 ${dateFilter}
       GROUP BY l.source
       ORDER BY count DESC
       LIMIT 10`,
      [companyId, ...dateParams]
    );

    // Lead Status Distribution
    const [statusResult] = await pool.execute(
      `SELECT 
        l.status,
        COUNT(*) as count
       FROM leads l
       WHERE l.company_id = ? AND l.is_deleted = 0 ${dateFilter}
       GROUP BY l.status
       ORDER BY count DESC`,
      [companyId, ...dateParams]
    );

    // Assigned Users - Only show users from the same company with leads
    // Use INNER JOIN to ensure only users with leads are shown
    const assignedUsersQuery = `
      SELECT 
        u.id,
        u.name,
        u.email,
        COUNT(l.id) as leads_count
       FROM users u
       INNER JOIN leads l ON l.owner_id = u.id AND l.company_id = ? AND l.is_deleted = 0 ${dateFilter}
       WHERE u.company_id = ? AND u.is_deleted = 0
       GROUP BY u.id, u.name, u.email
       ORDER BY leads_count DESC
       LIMIT 10
    `;
    const assignedUsersParams = [companyId, ...dateParams, companyId];

    console.log('Assigned Users Query:', assignedUsersQuery);
    console.log('Assigned Users Params:', assignedUsersParams);
    console.log('Company ID being used:', companyId);

    const [assignedUsersResult] = await pool.execute(assignedUsersQuery, assignedUsersParams);

    console.log('Assigned Users Result count:', assignedUsersResult.length);

    // Follow-up Today
    const [followUpTodayResult] = await pool.execute(
      `SELECT COUNT(*) as count FROM leads l
       WHERE l.company_id = ? AND l.is_deleted = 0 
       AND DATE(l.due_followup) = CURDATE()`,
      [companyId]
    );
    const followUpToday = followUpTodayResult[0].count;

    // Follow-up Upcoming (next 7 days)
    const [followUpUpcomingResult] = await pool.execute(
      `SELECT COUNT(*) as count FROM leads l
       WHERE l.company_id = ? AND l.is_deleted = 0 
       AND DATE(l.due_followup) BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY)`,
      [companyId]
    );
    const followUpUpcoming = followUpUpcomingResult[0].count;

    // Revenue/Value Summary
    const [revenueResult] = await pool.execute(
      `SELECT 
        COALESCE(SUM(l.value), 0) as total_value,
        COALESCE(SUM(CASE WHEN l.status = 'Won' THEN l.value ELSE 0 END), 0) as converted_value,
        COALESCE(AVG(l.value), 0) as avg_value
       FROM leads l
       WHERE l.company_id = ? AND l.is_deleted = 0 ${dateFilter}`,
      [companyId, ...dateParams]
    );
    const revenue = revenueResult[0];

    res.json({
      success: true,
      data: {
        totals: {
          total_leads: totalLeads,
          new_leads: newLeads,
          converted_leads: convertedLeads,
          lost_leads: lostLeads,
        },
        sources: sourcesResult,
        statuses: statusResult,
        assigned_users: assignedUsersResult,
        follow_ups: {
          today: followUpToday,
          upcoming: followUpUpcoming,
        },
        revenue: {
          total_value: parseFloat(revenue.total_value) || 0,
          converted_value: parseFloat(revenue.converted_value) || 0,
          avg_value: parseFloat(revenue.avg_value) || 0,
        },
      },
    });
  } catch (error) {
    console.error('Get leads overview error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch leads overview',
    });
  }
};

/**
 * Update lead status (for Kanban drag-drop)
 * PUT /api/v1/leads/:id/update-status
 */
const updateStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, change_reason } = req.body;
    const companyId = req.companyId || req.query.company_id || req.body.company_id || 1;
    const userId = req.userId || req.query.user_id || req.body.user_id || null;

    if (!status) {
      return res.status(400).json({
        success: false,
        error: 'Status is required',
      });
    }

    // Get current status
    const [leads] = await pool.execute(
      `SELECT status FROM leads WHERE id = ? AND company_id = ? AND is_deleted = 0`,
      [id, companyId]
    );

    if (leads.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Lead not found',
      });
    }

    const oldStatus = leads[0].status;

    // Update status
    await pool.execute(
      `UPDATE leads SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?`,
      [status, id, companyId]
    );

    // Log status change
    await pool.execute(
      `INSERT INTO lead_status_history (company_id, lead_id, old_status, new_status, changed_by, change_reason)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [companyId, id, oldStatus, status, userId, change_reason || null]
    );

    // Get updated lead
    const [updatedLeads] = await pool.execute(
      `SELECT * FROM leads WHERE id = ?`,
      [id]
    );

    res.json({
      success: true,
      data: updatedLeads[0],
      message: 'Lead status updated successfully',
    });
  } catch (error) {
    console.error('Update lead status error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update lead status',
    });
  }
};

/**
 * Bulk actions on leads
 * POST /api/v1/leads/bulk-action
 */
const bulkAction = async (req, res) => {
  try {
    const { lead_ids, action, data } = req.body;
    const companyId = req.companyId || req.query.company_id || req.body.company_id || 1;

    if (!lead_ids || !Array.isArray(lead_ids) || lead_ids.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'lead_ids array is required',
      });
    }

    if (!action) {
      return res.status(400).json({
        success: false,
        error: 'action is required',
      });
    }

    const placeholders = lead_ids.map(() => '?').join(',');
    let query = '';
    const params = [];

    switch (action) {
      case 'delete':
        query = `UPDATE leads SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP 
                 WHERE id IN (${placeholders}) AND company_id = ?`;
        params.push(...lead_ids, companyId);
        break;

      case 'assign':
        if (!data || !data.owner_id) {
          return res.status(400).json({
            success: false,
            error: 'owner_id is required for assign action',
          });
        }
        query = `UPDATE leads SET owner_id = ?, updated_at = CURRENT_TIMESTAMP 
                 WHERE id IN (${placeholders}) AND company_id = ?`;
        params.push(data.owner_id, ...lead_ids, companyId);
        break;

      case 'change_status':
        if (!data || !data.status) {
          return res.status(400).json({
            success: false,
            error: 'status is required for change_status action',
          });
        }
        query = `UPDATE leads SET status = ?, updated_at = CURRENT_TIMESTAMP 
                 WHERE id IN (${placeholders}) AND company_id = ?`;
        params.push(data.status, ...lead_ids, companyId);
        break;

      default:
        return res.status(400).json({
          success: false,
          error: 'Invalid action. Supported: delete, assign, change_status',
        });
    }

    const [result] = await pool.execute(query, params);

    res.json({
      success: true,
      data: {
        affected_rows: result.affectedRows,
      },
      message: `Bulk action '${action}' completed successfully`,
    });
  } catch (error) {
    console.error('Bulk action error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to perform bulk action',
    });
  }
};

/**
 * Get all contacts (for Leads Contacts tab)
 * GET /api/v1/leads/contacts
 */
const getAllContacts = async (req, res) => {
  try {
    // Admin must provide company_id - required for filtering
    const companyId = req.query.company_id || req.body.company_id || req.companyId;

    if (!companyId) {
      return res.status(400).json({
        success: false,
        error: 'company_id is required'
      });
    }

    const { contact_type, status, search, lead_id } = req.query;

    let whereClause = 'WHERE c.company_id = ? AND c.is_deleted = 0';
    const params = [parseInt(companyId)];

    if (contact_type) {
      whereClause += ' AND c.contact_type = ?';
      params.push(contact_type);
    }
    if (status) {
      whereClause += ' AND c.status = ?';
      params.push(status);
    }
    if (lead_id) {
      whereClause += ' AND c.lead_id = ?';
      params.push(lead_id);
    }
    if (search) {
      whereClause += ' AND (c.name LIKE ? OR c.email LIKE ? OR c.phone LIKE ? OR c.company LIKE ?)';
      const searchPattern = `%${search}%`;
      params.push(searchPattern, searchPattern, searchPattern, searchPattern);
    }

    // Get all contacts without pagination
    const [contacts] = await pool.execute(
      `SELECT 
        c.*,
        u.name as assigned_user_name,
        u.email as assigned_user_email,
        l.person_name as lead_name,
        l.company_name as lead_company_name
       FROM contacts c
       LEFT JOIN users u ON c.assigned_user_id = u.id
       LEFT JOIN leads l ON c.lead_id = l.id
       ${whereClause}
       ORDER BY c.created_at DESC`,
      params
    );

    res.json({
      success: true,
      data: contacts
    });
  } catch (error) {
    console.error('Get all contacts error:', error);
    console.error('Error details:', {
      message: error.message,
      code: error.code,
      sqlState: error.sqlState,
      sqlMessage: error.sqlMessage,
      stack: error.stack
    });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch contacts',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Get contact by ID
 * GET /api/v1/leads/contacts/:id
 */
const getContactById = async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.companyId || req.query.company_id || 1;

    const [contacts] = await pool.execute(
      `SELECT 
        c.*,
        u.name as assigned_user_name,
        u.email as assigned_user_email,
        l.person_name as lead_name,
        l.company_name as lead_company_name
       FROM contacts c
       LEFT JOIN users u ON c.assigned_user_id = u.id
       LEFT JOIN leads l ON c.lead_id = l.id
       WHERE c.id = ? AND c.company_id = ? AND c.is_deleted = 0`,
      [id, companyId]
    );

    if (contacts.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Contact not found',
      });
    }

    // Get activities for this contact
    const [activities] = await pool.execute(
      `SELECT * FROM lead_activities 
       WHERE lead_id = ? AND is_deleted = 0
       ORDER BY activity_date DESC
       LIMIT 20`,
      [contacts[0].lead_id || 0]
    );
    contacts[0].activities = activities || [];

    res.json({
      success: true,
      data: contacts[0],
    });
  } catch (error) {
    console.error('Get contact by ID error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch contact',
    });
  }
};

/**
 * Create contact
 * POST /api/v1/leads/contacts
 */
const createContact = async (req, res) => {
  try {
    const {
      lead_id,
      name,
      company,
      company_id,
      email,
      phone,
      contact_type = 'Client',
      assigned_user_id,
      status = 'Active',
      notes,
    } = req.body;

    // Admin must provide company_id - required for filtering
    const companyId = req.body.company_id || req.query.company_id || req.companyId;

    if (!companyId) {
      return res.status(400).json({
        success: false,
        error: 'company_id is required',
      });
    }

    if (!name) {
      return res.status(400).json({
        success: false,
        error: 'Name is required',
      });
    }

    // If company_id is provided, fetch company name from companies table
    let finalCompanyName = company || null;
    if (company_id) {
      try {
        const [companyData] = await pool.execute(
          'SELECT name FROM companies WHERE id = ?',
          [company_id]
        );
        if (companyData.length > 0) {
          finalCompanyName = companyData[0].name;
        }
      } catch (err) {
        console.error('Error fetching company name:', err);
        // Continue with provided company name or null
      }
    }

    // Convert empty strings to null for optional fields
    const finalLeadId = lead_id && lead_id !== '' ? parseInt(lead_id) : null;
    const finalEmail = email && email.trim() !== '' ? email.trim() : null;
    const finalPhone = phone && phone.trim() !== '' ? phone.trim() : null;
    const finalAssignedUserId = assigned_user_id && assigned_user_id !== '' ? parseInt(assigned_user_id) : null;
    const finalNotes = notes && notes.trim() !== '' ? notes.trim() : null;

    const [result] = await pool.execute(
      `INSERT INTO contacts (
        company_id, lead_id, name, company, email, phone,
        contact_type, assigned_user_id, status, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        parseInt(companyId),
        finalLeadId,
        name.trim(),
        finalCompanyName,
        finalEmail,
        finalPhone,
        contact_type,
        finalAssignedUserId,
        status,
        finalNotes,
      ]
    );

    const [newContact] = await pool.execute(
      'SELECT * FROM contacts WHERE id = ?',
      [result.insertId]
    );

    res.status(201).json({
      success: true,
      data: newContact[0],
      message: 'Contact created successfully',
    });
  } catch (error) {
    console.error('Create contact error:', error);
    console.error('Error details:', {
      message: error.message,
      code: error.code,
      sqlState: error.sqlState,
      sqlMessage: error.sqlMessage,
      stack: error.stack
    });
    res.status(500).json({
      success: false,
      error: error.sqlMessage || error.message || 'Failed to create contact',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Update contact
 * PUT /api/v1/leads/contacts/:id
 */
const updateContact = async (req, res) => {
  try {
    const { id } = req.params;
    const updateFields = req.body;
    const companyId = req.companyId || req.query.company_id || req.body.company_id || 1;

    const [existing] = await pool.execute(
      `SELECT id FROM contacts WHERE id = ? AND company_id = ? AND is_deleted = 0`,
      [id, companyId]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Contact not found',
      });
    }

    const allowedFields = [
      'name',
      'company',
      'email',
      'phone',
      'contact_type',
      'assigned_user_id',
      'status',
      'notes',
      'lead_id',
    ];

    const updates = [];
    const values = [];

    for (const field of allowedFields) {
      if (updateFields.hasOwnProperty(field)) {
        updates.push(`${field} = ?`);
        values.push(updateFields[field] === undefined ? null : updateFields[field]);
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No valid fields to update',
      });
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id, companyId);

    await pool.execute(
      `UPDATE contacts SET ${updates.join(', ')} WHERE id = ? AND company_id = ?`,
      values
    );

    const [updatedContact] = await pool.execute(
      'SELECT * FROM contacts WHERE id = ?',
      [id]
    );

    res.json({
      success: true,
      data: updatedContact[0],
      message: 'Contact updated successfully',
    });
  } catch (error) {
    console.error('Update contact error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update contact',
    });
  }
};

/**
 * Delete contact (soft delete)
 * DELETE /api/v1/leads/contacts/:id
 */
const deleteContact = async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.companyId || req.query.company_id || 1;

    const [result] = await pool.execute(
      `UPDATE contacts SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND company_id = ?`,
      [id, companyId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        error: 'Contact not found',
      });
    }

    res.json({
      success: true,
      message: 'Contact deleted successfully',
    });
  } catch (error) {
    console.error('Delete contact error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete contact',
    });
  }
};

/**
 * Get all unique labels for a company
 * GET /api/v1/leads/labels
 */
const getAllLabels = async (req, res) => {
  try {
    const companyId = req.query.company_id || req.body.company_id || req.companyId;

    if (!companyId) {
      return res.status(400).json({
        success: false,
        error: 'company_id is required'
      });
    }

    // First try to get from label definitions (with colors)
    const [definitions] = await pool.execute(
      `SELECT id, name, color, created_at
       FROM lead_label_definitions
       WHERE company_id = ?
       ORDER BY name ASC`,
      [companyId]
    );

    if (definitions.length > 0) {
      // Return definitions with name as label for consistency
      const labelsWithColors = definitions.map(d => ({
        id: d.id,
        label: d.name,
        name: d.name,
        color: d.color || '#22c55e',
        created_at: d.created_at
      }));

      return res.json({
        success: true,
        data: labelsWithColors
      });
    }

    // Fallback: Get all unique labels from leads in this company
    const [labels] = await pool.execute(
      `SELECT DISTINCT ll.label, ll.id, ll.color, ll.created_at
       FROM lead_labels ll
       INNER JOIN leads l ON ll.lead_id = l.id
       WHERE l.company_id = ? AND l.is_deleted = 0
       ORDER BY ll.label ASC`,
      [companyId]
    );

    // Return with name field for consistency
    const labelsWithName = labels.map(l => ({
      ...l,
      name: l.label,
      color: l.color || '#22c55e'
    }));

    res.json({
      success: true,
      data: labelsWithName
    });
  } catch (error) {
    console.error('Get labels error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch labels'
    });
  }
};

/**
 * Create a new label (adds to label pool)
 * POST /api/v1/leads/labels
 */
const createLabel = async (req, res) => {
  try {
    const { label, color, lead_id } = req.body;
    const companyId = req.query.company_id || req.body.company_id || req.companyId;

    if (!label) {
      return res.status(400).json({
        success: false,
        error: 'Label name is required'
      });
    }

    if (!companyId) {
      return res.status(400).json({
        success: false,
        error: 'company_id is required'
      });
    }

    // Identify if this is a request to add label to a lead OR create a global label definition

    // 1. Create/Ensure label definition exists
    // Even if lead_id is provided, we should ensure the label definition exists (for color consistency)
    try {
      await pool.execute(
        `INSERT IGNORE INTO lead_label_definitions (company_id, name, color) VALUES (?, ?, ?)`,
        [companyId, label, color || '#22c55e']
      );

      // If color is updated for existing label?
      if (color) {
        await pool.execute(
          `UPDATE lead_label_definitions SET color = ? WHERE company_id = ? AND name = ?`,
          [color, companyId, label]
        );
      }
    } catch (err) {
      console.error('Error creating label definition:', err);
      // Continue, as we might just want to assign it to a lead
    }

    // 2. If lead_id is provided, add label to that lead
    if (lead_id) {
      // Check if lead exists and belongs to company
      const [leads] = await pool.execute(
        `SELECT id FROM leads WHERE id = ? AND company_id = ? AND is_deleted = 0`,
        [lead_id, companyId]
      );

      if (leads.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Lead not found'
        });
      }

      // Check if label already exists for this lead
      const [existing] = await pool.execute(
        `SELECT id FROM lead_labels WHERE lead_id = ? AND label = ?`,
        [lead_id, label]
      );

      if (existing.length > 0) {
        return res.status(400).json({
          success: false,
          error: 'Label already exists for this lead'
        });
      }

      // Insert label
      await pool.execute(
        `INSERT INTO lead_labels (lead_id, label) VALUES (?, ?)`,
        [lead_id, label]
      );

      // Also update color in lead_labels table (for backward compatibility if needed, though we rely on definitions mostly now)
      // The migration added `color` column to `lead_labels` as well.
      if (color) {
        try {
          await pool.execute(
            `UPDATE lead_labels SET color = ? WHERE lead_id = ? AND label = ?`,
            [color, lead_id, label]
          );
        } catch (e) { /* ignore */ }
      }
    }

    res.json({
      success: true,
      message: 'Label created successfully',
      data: { label, color }
    });
  } catch (error) {
    console.error('Create label error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to create label'
    });
  }
};

/**
 * Delete a label (removes from all leads in company)
 * DELETE /api/v1/leads/labels/:label
 */
const deleteLabel = async (req, res) => {
  try {
    const { label } = req.params;
    const companyId = req.query.company_id || req.body.company_id || req.companyId;

    if (!companyId) {
      return res.status(400).json({
        success: false,
        error: 'company_id is required'
      });
    }

    // Delete label from all leads in this company
    await pool.execute(
      `DELETE ll FROM lead_labels ll
       INNER JOIN leads l ON ll.lead_id = l.id
       WHERE ll.label = ? AND l.company_id = ?`,
      [label, companyId]
    );

    res.json({
      success: true,
      message: 'Label deleted successfully'
    });
  } catch (error) {
    console.error('Delete label error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete label'
    });
  }
};

/**
 * Update labels for a specific lead
 * PUT /api/v1/leads/:id/labels
 */
const updateLeadLabels = async (req, res) => {
  try {
    const { id } = req.params;
    const { labels } = req.body;
    const companyId = req.query.company_id || req.body.company_id || req.companyId;

    if (!companyId) {
      return res.status(400).json({
        success: false,
        error: 'company_id is required'
      });
    }

    if (!Array.isArray(labels)) {
      return res.status(400).json({
        success: false,
        error: 'Labels must be an array'
      });
    }

    // Check if lead exists
    const [leads] = await pool.execute(
      `SELECT id FROM leads WHERE id = ? AND company_id = ? AND is_deleted = 0`,
      [id, companyId]
    );

    if (leads.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Lead not found'
      });
    }

    // Delete existing labels
    await pool.execute(`DELETE FROM lead_labels WHERE lead_id = ?`, [id]);

    // Insert new labels
    if (labels.length > 0) {
      const labelValues = labels.map(label => [id, label]);
      await pool.query(
        `INSERT INTO lead_labels (lead_id, label) VALUES ?`,
        [labelValues]
      );
    }

    res.json({
      success: true,
      message: 'Lead labels updated successfully',
      data: { labels }
    });
  } catch (error) {
    console.error('Update lead labels error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to update lead labels'
    });
  }
};

/**
 * Import leads from CSV/Excel data
 * POST /api/v1/leads/import
 */
const importLeads = async (req, res) => {
  try {
    const { leads } = req.body;
    const companyId = req.query.company_id || req.body.company_id || req.companyId;

    if (!companyId) {
      return res.status(400).json({ success: false, error: 'company_id is required' });
    }

    if (!leads || !Array.isArray(leads) || leads.length === 0) {
      return res.status(400).json({ success: false, error: 'No leads data provided' });
    }

    const importedLeads = [];
    const errors = [];

    for (let i = 0; i < leads.length; i++) {
      const lead = leads[i];
      try {
        // Generate lead number
        const [countResult] = await pool.execute(
          'SELECT COUNT(*) as count FROM leads WHERE company_id = ?',
          [companyId]
        );
        const leadNumber = `LEAD-${String((countResult[0].count || 0) + importedLeads.length + 1).padStart(4, '0')}`;

        const [result] = await pool.execute(
          `INSERT INTO leads (
            company_id, lead_number, lead_type, company_name, person_name,
            email, phone, status, source, address, city, value, probability, notes
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            companyId,
            leadNumber,
            lead.lead_type || 'Organization',
            lead.company_name || lead.companyName || null,
            lead.person_name || lead.personName || lead.name || null,
            lead.email || null,
            lead.phone || null,
            lead.status || 'New',
            lead.source || null,
            lead.address || null,
            lead.city || null,
            parseFloat(lead.value) || 0,
            parseInt(lead.probability) || 0,
            lead.notes || null
          ]
        );

        importedLeads.push({ id: result.insertId, lead_number: leadNumber });
      } catch (err) {
        errors.push({ row: i + 1, error: err.message });
      }
    }

    res.json({
      success: true,
      message: `Successfully imported ${importedLeads.length} leads`,
      data: {
        imported: importedLeads.length,
        failed: errors.length,
        errors: errors
      }
    });
  } catch (error) {
    console.error('Import leads error:', error);
    res.status(500).json({ success: false, error: 'Failed to import leads' });
  }
};

module.exports = {
  getAll,
  getById,
  create,
  update,
  delete: deleteLead,
  convertToClient,
  getOverview,
  updateStatus,
  bulkAction,
  getAllContacts,
  getAllLabels,
  createLabel,
  deleteLabel,
  updateLeadLabels,
  getContactById,
  createContact,
  updateContact,
  deleteContact,
  importLeads,
};

