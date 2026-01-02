// =====================================================
// Client Controller
// =====================================================

const pool = require('../config/db');
const bcrypt = require('bcryptjs');

/**
 * Get all clients
 * GET /api/v1/clients
 */
const getAll = async (req, res) => {
  try {
    const { status, search } = req.query;

    // company_id is REQUIRED - must filter by company to prevent showing all clients
    const companyId = req.query.company_id || req.body.company_id || req.companyId;

    console.log('GET /clients - companyId:', companyId, 'query:', req.query, 'body:', req.body);

    if (!companyId) {
      return res.status(400).json({
        success: false,
        error: 'company_id is required'
      });
    }

    let whereClause = 'WHERE c.is_deleted = 0';
    const params = [];

    // Filter by company_id - MANDATORY
    whereClause += ' AND c.company_id = ?';
    params.push(companyId);

    if (status) {
      whereClause += ' AND c.status = ?';
      params.push(status);
    }
    if (search) {
      whereClause += ' AND (c.company_name LIKE ? OR c.phone_number LIKE ? OR u.name LIKE ? OR u.email LIKE ?)';
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm, searchTerm);
    }

    // Get all clients without pagination
    // Include client's actual name and email from users table
    // COALESCE ensures we always have a display name (prefer user name, fallback to company_name)
    const [clients] = await pool.execute(
      `SELECT c.*, 
              COALESCE(u.name, c.company_name) as client_name,
              COALESCE(u.name, c.company_name) as name,
              c.company_name,
              c.phone_number as phone,
              COALESCE(u.name, c.company_name) as owner_name, 
              COALESCE(u.email, '') as email,
              comp.name as admin_company_name,
              (SELECT COUNT(*) FROM projects p WHERE p.client_id = c.id AND p.is_deleted = 0) as total_projects,
              (SELECT COALESCE(SUM(total), 0) FROM invoices i WHERE i.client_id = c.id AND i.is_deleted = 0) as total_invoiced,
              (SELECT COALESCE(SUM(p.amount), 0) 
               FROM payments p 
               INNER JOIN invoices i ON p.invoice_id = i.id 
               WHERE i.client_id = c.id AND p.is_deleted = 0) as payment_received
       FROM clients c
       LEFT JOIN users u ON c.owner_id = u.id
       LEFT JOIN companies comp ON c.company_id = comp.id
       ${whereClause}
       ORDER BY c.created_at DESC`,
      params
    );

    // Calculate due amount for each client
    for (let client of clients) {
      client.due = (parseFloat(client.total_invoiced) || 0) - (parseFloat(client.payment_received) || 0);
    }

    // Get contacts for each client (groups and labels removed)
    for (let client of clients) {
      const [contacts] = await pool.execute(
        `SELECT * FROM client_contacts WHERE client_id = ? AND is_deleted = 0`,
        [client.id]
      );
      client.contacts = contacts;
    }

    res.json({
      success: true,
      data: clients
    });
  } catch (error) {
    console.error('Get clients error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch clients'
    });
  }
};

/**
 * Get client by ID
 * GET /api/v1/clients/:id
 */
const getById = async (req, res) => {
  try {
    const { id } = req.params;

    // Admin must provide company_id - required for filtering
    const companyId = req.query.company_id || req.body.company_id || req.companyId;
    
    console.log('GET /clients/:id - id:', id, 'companyId:', companyId, 'query:', req.query, 'body:', req.body);
    
    if (!companyId) {
      console.error('GET /clients/:id - company_id is missing for id:', id);
      return res.status(400).json({
        success: false,
        error: 'company_id is required'
      });
    }
    // Get client with actual client name from users table
    // COALESCE ensures we always have a display name
    const [clients] = await pool.execute(
      `SELECT c.*, 
              COALESCE(u.name, c.company_name) as client_name,
              COALESCE(u.name, c.company_name) as name,
              c.company_name,
              c.phone_number as phone,
              COALESCE(u.name, c.company_name) as owner_name, 
              COALESCE(u.email, '') as email,
              comp.name as admin_company_name,
              (SELECT COUNT(*) FROM projects p WHERE p.client_id = c.id AND p.is_deleted = 0) as total_projects,
              (SELECT COALESCE(SUM(total), 0) FROM invoices i WHERE i.client_id = c.id AND i.is_deleted = 0) as total_invoiced,
              (SELECT COALESCE(SUM(p.amount), 0) 
               FROM payments p 
               INNER JOIN invoices i ON p.invoice_id = i.id 
               WHERE i.client_id = c.id AND p.is_deleted = 0) as payment_received
       FROM clients c
       LEFT JOIN users u ON c.owner_id = u.id
       LEFT JOIN companies comp ON c.company_id = comp.id
       WHERE c.id = ? AND c.company_id = ? AND c.is_deleted = 0`,
      [id, companyId]
    );

    if (clients.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Client not found'
      });
    }

    const client = clients[0];
    
    // Calculate due amount
    client.due = (parseFloat(client.total_invoiced) || 0) - (parseFloat(client.payment_received) || 0);

    // Get contacts
    const [contacts] = await pool.execute(
      `SELECT * FROM client_contacts WHERE client_id = ? AND is_deleted = 0`,
      [client.id]
    );
    client.contacts = contacts;

    res.json({
      success: true,
      data: client
    });
  } catch (error) {
    console.error('Get client error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch client'
    });
  }
};

/**
 * Create client
 * POST /api/v1/clients
 */
const create = async (req, res) => {
  const connection = await pool.getConnection();
  await connection.beginTransaction();
  
  try {
    const {
      client_name, company_name, email, password, address, city, state, zip,
      country, phone_country_code, phone_number, website, vat_number,
      gst_number, currency, currency_symbol, disable_online_payment,
      status
    } = req.body;

    // Use client_name if provided, otherwise fallback to company_name for backward compatibility
    const clientName = client_name || company_name;

    // Validation
    if (!clientName || !email || !password) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        error: 'client_name, email, and password are required'
      });
    }

    // Admin must provide company_id - required for filtering
    const companyId = req.companyId || req.body.company_id || req.query.company_id;
    
    if (!companyId) {
      await connection.rollback();
      connection.release();
      return res.status(400).json({
        success: false,
        error: 'company_id is required'
      });
    }
    // Check if user already exists
    const [existingUsers] = await connection.execute(
      `SELECT id FROM users WHERE email = ? AND company_id = ?`,
      [email, companyId]
    );

    if (existingUsers.length > 0) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        error: 'User with this email already exists'
      });
    }

    // Create user account first
    const hashedPassword = await bcrypt.hash(password, 10);
    const [userResult] = await connection.execute(
      `INSERT INTO users (company_id, name, email, password, role, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        companyId,
        clientName, // Use client name as user name
        email,
        hashedPassword,
        'CLIENT', // Auto-set role to CLIENT
        status || 'Active'
      ]
    );

    const ownerId = userResult.insertId;

    // Insert client
    const [result] = await connection.execute(
      `INSERT INTO clients (
        company_id, company_name, owner_id, address, city, state, zip, country,
        phone_country_code, phone_number, website, vat_number, gst_number,
        currency, currency_symbol, disable_online_payment, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        companyId, clientName, ownerId, address, city, state, zip,
        country || 'United States', phone_country_code || '+1', phone_number,
        website, vat_number, gst_number, currency || 'USD',
        currency_symbol || '$', disable_online_payment || 0, status || 'Active'
      ]
    );

    const clientId = result.insertId;

    await connection.commit();
    connection.release();

    // Get created client with user details (use pool after transaction is committed)
    const [clients] = await pool.execute(
      `SELECT c.*, u.email, u.name as owner_name, comp.name as admin_company_name
       FROM clients c
       JOIN users u ON c.owner_id = u.id
       LEFT JOIN companies comp ON c.company_id = comp.id
       WHERE c.id = ?`,
      [clientId]
    );

    const client = clients[0];

    // Get contacts
    const [contacts] = await pool.execute(
      `SELECT * FROM client_contacts WHERE client_id = ? AND is_deleted = 0`,
      [clientId]
    );
    client.contacts = contacts;

    res.status(201).json({
      success: true,
      data: client,
      message: 'Client created successfully'
    });
  } catch (error) {
    await connection.rollback();
    connection.release();
    console.error('Create client error:', error);
    console.error('Error details:', {
      message: error.message,
      sqlMessage: error.sqlMessage,
      code: error.code,
      errno: error.errno,
      stack: error.stack
    });
    res.status(500).json({
      success: false,
      error: error.sqlMessage || error.message || 'Failed to create client'
    });
  }
};

/**
 * Update client
 * PUT /api/v1/clients/:id
 */
const update = async (req, res) => {
  try {
    const { id } = req.params;
    const updateFields = req.body;
    const companyId = parseInt(req.companyId || req.query.company_id || req.body.company_id || 0, 10);

    if (!companyId || isNaN(companyId) || companyId <= 0) {
      return res.status(400).json({
        success: false,
        error: 'company_id is required and must be a valid positive number'
      });
    }

    // Handle client_name (map to company_name in database for backward compatibility)
    if (updateFields.client_name !== undefined) {
      updateFields.company_name = updateFields.client_name;
      delete updateFields.client_name;
    }

    // Check if client exists
    const [clients] = await pool.execute(
      `SELECT id FROM clients WHERE id = ? AND company_id = ? AND is_deleted = 0`,
      [id, companyId]
    );

    if (clients.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Client not found'
      });
    }

    // Build update query
    const allowedFields = [
      'company_name', 'owner_id', 'address', 'city', 'state', 'zip', 'country',
      'phone_country_code', 'phone_number', 'website', 'vat_number', 'gst_number',
      'currency', 'currency_symbol', 'disable_online_payment', 'status'
    ];

    const updates = [];
    const values = [];

    for (const field of allowedFields) {
      if (updateFields.hasOwnProperty(field)) {
        updates.push(`${field} = ?`);
        values.push(updateFields[field]);
      }
    }

    if (updates.length > 0) {
      updates.push('updated_at = CURRENT_TIMESTAMP');
      values.push(id, companyId);

      await pool.execute(
        `UPDATE clients SET ${updates.join(', ')} WHERE id = ? AND company_id = ?`,
        values
      );
    }

    // Update groups if provided
    if (updateFields.groups) {
      await pool.execute(`DELETE FROM client_groups WHERE client_id = ?`, [id]);
      if (updateFields.groups.length > 0) {
        const groupValues = updateFields.groups.map(groupName => [id, groupName]);
        await pool.query(
          `INSERT INTO client_groups (client_id, group_name) VALUES ?`,
          [groupValues]
        );
      }
    }

    // Update labels if provided
    if (updateFields.labels) {
      await pool.execute(`DELETE FROM client_labels WHERE client_id = ?`, [id]);
      if (updateFields.labels.length > 0) {
        const labelValues = updateFields.labels.map(label => [id, label]);
        await pool.query(
          `INSERT INTO client_labels (client_id, label) VALUES ?`,
          [labelValues]
        );
      }
    }

    // Get updated client
    const [updatedClients] = await pool.execute(
      `SELECT * FROM clients WHERE id = ?`,
      [id]
    );

    res.json({
      success: true,
      data: updatedClients[0],
      message: 'Client updated successfully'
    });
  } catch (error) {
    console.error('Update client error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update client'
    });
  }
};

/**
 * Delete client (soft delete)
 * DELETE /api/v1/clients/:id
 */
const deleteClient = async (req, res) => {
  try {
    const { id } = req.params;

    // Ensure company_id is properly parsed as integer
    const companyId = parseInt(req.companyId || req.query.company_id || req.body.company_id || 0, 10);
    
    // company_id is required for admin users
    if (!companyId || isNaN(companyId) || companyId <= 0) {
      return res.status(400).json({
        success: false,
        error: 'company_id is required and must be a valid positive number'
      });
    }
    
    const [result] = await pool.execute(
      `UPDATE clients SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND company_id = ? AND is_deleted = 0`,
      [id, companyId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        error: 'Client not found'
      });
    }

    res.json({
      success: true,
      message: 'Client deleted successfully'
    });
  } catch (error) {
    console.error('Delete client error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete client',
      details: error.message
    });
  }
};

/**
 * Add client contact
 * POST /api/v1/clients/:id/contacts
 */
const addContact = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, job_title, email, phone, is_primary } = req.body;

    // Validation
    if (!name || !email) {
      return res.status(400).json({
        success: false,
        error: 'name and email are required'
      });
    }

    // Ensure company_id is properly parsed as integer
    const companyId = parseInt(req.companyId || req.query.company_id || req.body.company_id || 0, 10);
    
    // company_id is required for admin users
    if (!companyId || isNaN(companyId) || companyId <= 0) {
      return res.status(400).json({
        success: false,
        error: 'company_id is required and must be a valid positive number'
      });
    }
    
    // Check if client exists
    const [clients] = await pool.execute(
      `SELECT id FROM clients WHERE id = ? AND company_id = ? AND is_deleted = 0`,
      [id, companyId]
    );

    if (clients.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Client not found'
      });
    }

    // If setting as primary, unset other primary contacts
    if (is_primary) {
      await pool.execute(
        `UPDATE client_contacts SET is_primary = 0 WHERE client_id = ?`,
        [id]
      );
    }

    // Insert contact
    const [result] = await pool.execute(
      `INSERT INTO client_contacts (
        client_id, name, job_title, email, phone, is_primary
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      [id, name, job_title, email, phone, is_primary || 0]
    );

    res.status(201).json({
      success: true,
      data: { id: result.insertId },
      message: 'Contact added successfully'
    });
  } catch (error) {
    console.error('Add contact error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to add contact'
    });
  }
};

/**
 * Get client contacts
 * GET /api/v1/clients/:id/contacts
 */
const getContacts = async (req, res) => {
  try {
    const { id } = req.params;

    const [contacts] = await pool.execute(
      `SELECT * FROM client_contacts
       WHERE client_id = ? AND is_deleted = 0
       ORDER BY is_primary DESC, created_at DESC`,
      [id]
    );

    res.json({
      success: true,
      data: contacts
    });
  } catch (error) {
    console.error('Get contacts error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch contacts'
    });
  }
};

/**
 * Update client contact
 * PUT /api/v1/clients/:id/contacts/:contactId
 */
const updateContact = async (req, res) => {
  try {
    const { id, contactId } = req.params;
    const { name, job_title, email, phone, is_primary } = req.body;

    const companyId = parseInt(req.companyId || req.query.company_id || req.body.company_id || 0, 10);

    if (!companyId || isNaN(companyId) || companyId <= 0) {
      return res.status(400).json({
        success: false,
        error: 'company_id is required and must be a valid positive number'
      });
    }

    // Check if client exists
    const [clients] = await pool.execute(
      `SELECT id FROM clients WHERE id = ? AND company_id = ? AND is_deleted = 0`,
      [id, companyId]
    );

    if (clients.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Client not found'
      });
    }

    // Check if contact exists
    const [contacts] = await pool.execute(
      `SELECT id FROM client_contacts WHERE id = ? AND client_id = ? AND is_deleted = 0`,
      [contactId, id]
    );

    if (contacts.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Contact not found'
      });
    }

    // If setting as primary, unset other primary contacts
    if (is_primary) {
      await pool.execute(
        `UPDATE client_contacts SET is_primary = 0 WHERE client_id = ? AND id != ?`,
        [id, contactId]
      );
    }

    // Update contact
    const updates = [];
    const values = [];

    if (name !== undefined) {
      updates.push('name = ?');
      values.push(name);
    }
    if (job_title !== undefined) {
      updates.push('job_title = ?');
      values.push(job_title);
    }
    if (email !== undefined) {
      updates.push('email = ?');
      values.push(email);
    }
    if (phone !== undefined) {
      updates.push('phone = ?');
      values.push(phone);
    }
    if (is_primary !== undefined) {
      updates.push('is_primary = ?');
      values.push(is_primary ? 1 : 0);
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No fields to update'
      });
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(contactId, id);

    await pool.execute(
      `UPDATE client_contacts SET ${updates.join(', ')} WHERE id = ? AND client_id = ?`,
      values
    );

    // Get updated contact
    const [updatedContacts] = await pool.execute(
      `SELECT * FROM client_contacts WHERE id = ? AND client_id = ?`,
      [contactId, id]
    );

    res.json({
      success: true,
      data: updatedContacts[0],
      message: 'Contact updated successfully'
    });
  } catch (error) {
    console.error('Update contact error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update contact'
    });
  }
};

/**
 * Delete client contact (soft delete)
 * DELETE /api/v1/clients/:id/contacts/:contactId
 */
const deleteContact = async (req, res) => {
  try {
    const { id, contactId } = req.params;

    const companyId = parseInt(req.companyId || req.query.company_id || req.body.company_id || 0, 10);

    if (!companyId || isNaN(companyId) || companyId <= 0) {
      return res.status(400).json({
        success: false,
        error: 'company_id is required and must be a valid positive number'
      });
    }

    // Check if client exists
    const [clients] = await pool.execute(
      `SELECT id FROM clients WHERE id = ? AND company_id = ? AND is_deleted = 0`,
      [id, companyId]
    );

    if (clients.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Client not found'
      });
    }

    // Soft delete contact
    const [result] = await pool.execute(
      `UPDATE client_contacts SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND client_id = ?`,
      [contactId, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        error: 'Contact not found'
      });
    }

    res.json({
      success: true,
      message: 'Contact deleted successfully'
    });
  } catch (error) {
    console.error('Delete contact error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete contact'
    });
  }
};

/**
 * Get clients overview statistics
 * GET /api/v1/clients/overview
 */
const getOverview = async (req, res) => {
  try {
    const { date_range = 'all', start_date, end_date, status, owner_id } = req.query;
    const companyId = parseInt(req.companyId || req.query.company_id || req.body.company_id || 0, 10);

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
      dateFilter = 'AND DATE(c.created_at) = CURDATE()';
    } else if (date_range === 'this_week') {
      dateFilter = 'AND YEARWEEK(c.created_at, 1) = YEARWEEK(CURDATE(), 1)';
    } else if (date_range === 'this_month') {
      dateFilter = 'AND YEAR(c.created_at) = YEAR(CURDATE()) AND MONTH(c.created_at) = MONTH(CURDATE())';
    } else if (date_range === 'custom' && start_date && end_date) {
      dateFilter = 'AND DATE(c.created_at) BETWEEN ? AND ?';
      dateParams.push(start_date, end_date);
    }

    let statusFilter = '';
    const statusParams = [];
    if (status) {
      statusFilter = 'AND c.status = ?';
      statusParams.push(status);
    }

    let ownerFilter = '';
    const ownerParams = [];
    if (owner_id) {
      ownerFilter = 'AND c.owner_id = ?';
      ownerParams.push(parseInt(owner_id, 10));
    }

    // Total Clients
    const [totalClientsResult] = await pool.execute(
      `SELECT COUNT(*) as count FROM clients c
       WHERE c.company_id = ? AND c.is_deleted = 0 ${dateFilter} ${statusFilter} ${ownerFilter}`,
      [companyId, ...dateParams, ...statusParams, ...ownerParams]
    );
    const totalClients = totalClientsResult[0].count;

    // Active Clients
    const [activeClientsResult] = await pool.execute(
      `SELECT COUNT(*) as count FROM clients c
       WHERE c.company_id = ? AND c.is_deleted = 0 AND c.status = 'Active' ${dateFilter} ${ownerFilter}`,
      [companyId, ...dateParams, ...ownerParams]
    );
    const activeClients = activeClientsResult[0].count;

    // Inactive Clients
    const [inactiveClientsResult] = await pool.execute(
      `SELECT COUNT(*) as count FROM clients c
       WHERE c.company_id = ? AND c.is_deleted = 0 AND c.status = 'Inactive' ${dateFilter} ${ownerFilter}`,
      [companyId, ...dateParams, ...ownerParams]
    );
    const inactiveClients = inactiveClientsResult[0].count;

    // Total Revenue (from invoices)
    const [revenueResult] = await pool.execute(
      `SELECT
        COALESCE(SUM(i.total), 0) as total_revenue,
        COALESCE(SUM(i.paid), 0) as payment_received,
        COALESCE(SUM(i.unpaid), 0) as outstanding_amount
       FROM invoices i
       INNER JOIN clients c ON i.client_id = c.id
       WHERE c.company_id = ? AND c.is_deleted = 0 AND i.is_deleted = 0 ${dateFilter.replace('c.created_at', 'i.created_at')} ${statusFilter} ${ownerFilter}`,
      [companyId, ...dateParams, ...statusParams, ...ownerParams]
    );
    const revenue = revenueResult[0] || { total_revenue: 0, payment_received: 0, outstanding_amount: 0 };

    // Recent Clients (last 10)
    const [recentClientsResult] = await pool.execute(
      `SELECT
        c.id,
        c.company_name,
        c.status,
        c.created_at,
        u.name as owner_name,
        (SELECT COUNT(*) FROM invoices inv WHERE inv.client_id = c.id AND inv.is_deleted = 0) as total_invoices,
        (SELECT COALESCE(SUM(inv.total), 0) FROM invoices inv WHERE inv.client_id = c.id AND inv.is_deleted = 0) as total_invoiced
       FROM clients c
       LEFT JOIN users u ON c.owner_id = u.id
       WHERE c.company_id = ? AND c.is_deleted = 0 ${dateFilter} ${statusFilter} ${ownerFilter}
       ORDER BY c.created_at DESC
       LIMIT 10`,
      [companyId, ...dateParams, ...statusParams, ...ownerParams]
    );

    // Client Growth (last 6 months)
    const [growthResult] = await pool.execute(
      `SELECT 
        DATE_FORMAT(created_at, '%Y-%m') as month,
        COUNT(*) as count
       FROM clients
       WHERE company_id = ? AND is_deleted = 0
       AND created_at >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
       GROUP BY DATE_FORMAT(created_at, '%Y-%m')
       ORDER BY month ASC`,
      [companyId]
    );

    // Revenue by Client (top 10)
    const [revenueByClientResult] = await pool.execute(
      `SELECT
        c.id,
        c.company_name,
        COALESCE(SUM(i.total), 0) as total_revenue,
        COALESCE(SUM(i.paid), 0) as payment_received,
        COALESCE(SUM(i.unpaid), 0) as outstanding
       FROM clients c
       LEFT JOIN invoices i ON i.client_id = c.id AND i.is_deleted = 0
       WHERE c.company_id = ? AND c.is_deleted = 0 ${statusFilter} ${ownerFilter}
       GROUP BY c.id, c.company_name
       ORDER BY total_revenue DESC
       LIMIT 10`,
      [companyId, ...statusParams, ...ownerParams]
    );

    // Assigned Users
    const [assignedUsersResult] = await pool.execute(
      `SELECT
        u.id,
        u.name,
        u.email,
        COUNT(c.id) as clients_count
       FROM users u
       LEFT JOIN clients c ON c.owner_id = u.id AND c.company_id = ? AND c.is_deleted = 0 ${dateFilter.replace('c.created_at', 'c.created_at')} ${statusFilter}
       WHERE u.company_id = ? AND u.is_deleted = 0
       GROUP BY u.id, u.name, u.email
       HAVING clients_count > 0
       ORDER BY clients_count DESC
       LIMIT 10`,
      [companyId, ...dateParams, ...statusParams, companyId]
    );

    // Recent Activity (from invoices, payments, client updates)
    const [recentActivityResult] = await pool.execute(
      `(SELECT 
        'client_created' as activity_type,
        c.company_name as title,
        c.created_at as activity_date,
        c.id as related_id,
        'client' as related_type,
        u.name as user_name
       FROM clients c
       LEFT JOIN users u ON c.owner_id = u.id
       WHERE c.company_id = ? AND c.is_deleted = 0
       ORDER BY c.created_at DESC
       LIMIT 5)
       UNION ALL
       (SELECT 
        'invoice_created' as activity_type,
        CONCAT('Invoice #', i.invoice_number, ' for ', c.company_name) as title,
        i.created_at as activity_date,
        i.id as related_id,
        'invoice' as related_type,
        u.name as user_name
       FROM invoices i
       INNER JOIN clients c ON i.client_id = c.id
       LEFT JOIN users u ON i.created_by = u.id
       WHERE c.company_id = ? AND i.is_deleted = 0
       ORDER BY i.created_at DESC
       LIMIT 5)
       UNION ALL
       (SELECT 
        'payment_received' as activity_type,
        CONCAT('Payment received for Invoice #', i.invoice_number) as title,
        p.payment_date as activity_date,
        p.id as related_id,
        'payment' as related_type,
        u.name as user_name
       FROM payments p
       INNER JOIN invoices i ON p.invoice_id = i.id
       INNER JOIN clients c ON i.client_id = c.id
       LEFT JOIN users u ON p.created_by = u.id
       WHERE c.company_id = ? AND p.is_deleted = 0
       ORDER BY p.payment_date DESC
       LIMIT 5)
       ORDER BY activity_date DESC
       LIMIT 15`,
      [companyId, companyId, companyId]
    );

    res.json({
      success: true,
      data: {
        totals: {
          total_clients: totalClients,
          active_clients: activeClients,
          inactive_clients: inactiveClients,
        },
        revenue: {
          total_revenue: parseFloat(revenue.total_revenue) || 0,
          payment_received: parseFloat(revenue.payment_received) || 0,
          outstanding_amount: parseFloat(revenue.outstanding_amount) || 0,
        },
        recent_clients: recentClientsResult,
        client_growth: growthResult,
        revenue_by_client: revenueByClientResult,
        assigned_users: assignedUsersResult,
        recent_activity: recentActivityResult,
      },
    });
  } catch (error) {
    console.error('Get clients overview error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch clients overview',
    });
  }
};

module.exports = {
  getAll,
  getById,
  create,
  update,
  delete: deleteClient,
  addContact,
  getContacts,
  updateContact,
  deleteContact,
  getOverview,
};

