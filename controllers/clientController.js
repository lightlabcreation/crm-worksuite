// =====================================================
// Client Controller
// =====================================================

const pool = require('../config/db');
const bcrypt = require('bcryptjs');

// Generate random color for labels
const generateLabelColor = () => {
  const colors = [
    '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16',
    '#22c55e', '#10b981', '#14b8a6', '#06b6d4', '#0ea5e9',
    '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7', '#d946ef',
    '#ec4899', '#f43f5e', '#78716c', '#71717a', '#64748b'
  ];
  return colors[Math.floor(Math.random() * colors.length)];
};

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
              c.type,
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

    // Get labels for each client
    for (let client of clients) {
      const [labels] = await pool.execute(
        `SELECT label, color FROM client_labels WHERE client_id = ?`,
        [client.id]
      );
      // Map labels to have both name and color
      client.labels = labels.map(l => l.label);
      client.labelDetails = labels; // Full details with colors
    }

    // Get groups for each client
    for (let client of clients) {
      const [groups] = await pool.execute(
        `SELECT group_name FROM client_groups WHERE client_id = ?`,
        [client.id]
      );
      client.groups = groups.map(g => g.group_name);
    }

    // Get contacts for each client
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
              c.type,
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

    // Get labels
    const [labels] = await pool.execute(
      `SELECT label, color FROM client_labels WHERE client_id = ?`,
      [client.id]
    );
    client.labels = labels.map(l => l.label);
    client.labelDetails = labels;

    // Get groups
    const [groups] = await pool.execute(
      `SELECT group_name FROM client_groups WHERE client_id = ?`,
      [client.id]
    );
    client.groups = groups.map(g => g.group_name);

    // Get managers
    const [managers] = await pool.execute(
      `SELECT cm.user_id, u.name 
       FROM client_managers cm
       JOIN users u ON cm.user_id = u.id
       WHERE cm.client_id = ?`,
      [client.id]
    );
    client.managers = managers; // Return array of {user_id, name}

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
        currency, currency_symbol, disable_online_payment, status, type
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        companyId, clientName, ownerId, address, city, state, zip,
        country || 'United States', phone_country_code || '+1', phone_number,
        website, vat_number, gst_number, currency || 'USD',
        currency_symbol || '$', disable_online_payment || 0, status || 'Active',
        req.body.type || 'Organization'
      ]
    );

    const clientId = result.insertId;

    // Save labels if provided
    if (req.body.labels && Array.isArray(req.body.labels) && req.body.labels.length > 0) {
      const uniqueLabels = [...new Set(req.body.labels)];
      const placeholders = uniqueLabels.map(() => '?').join(',');

      // Fetch existing colors to maintain consistency
      const [existingColors] = await connection.execute(
        `SELECT cl.label, MAX(cl.color) as color
           FROM client_labels cl
           INNER JOIN clients c ON cl.client_id = c.id
           WHERE c.company_id = ? AND c.is_deleted = 0 AND cl.label IN (${placeholders})
           GROUP BY cl.label`,
        [companyId, ...uniqueLabels]
      );

      const colorMap = new Map(existingColors.map(lc => [lc.label, lc.color]));
      const labelValues = uniqueLabels.map(lbl => [clientId, lbl, colorMap.get(lbl) || generateLabelColor()]);

      await connection.query(
        `INSERT INTO client_labels (client_id, label, color) VALUES ?`,
        [labelValues]
      );
    }

    // Save groups if provided
    if (req.body.client_groups && Array.isArray(req.body.client_groups) && req.body.client_groups.length > 0) {
      const groupValues = req.body.client_groups.map(group => [clientId, group]);
      await connection.query(
        `INSERT INTO client_groups (client_id, group_name) VALUES ?`,
        [groupValues]
      );
    }

    // Save managers if provided (array of user_ids)
    if (req.body.managers && Array.isArray(req.body.managers) && req.body.managers.length > 0) {
      const managerValues = req.body.managers.map(userId => [clientId, userId]);
      await connection.query(
        `INSERT INTO client_managers (client_id, user_id) VALUES ?`,
        [managerValues]
      );
    }

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
      'currency', 'currency_symbol', 'disable_online_payment', 'status', 'type'
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
        const uniqueLabels = [...new Set(updateFields.labels)];
        const placeholders = uniqueLabels.map(() => '?').join(',');
        const [labelColors] = await pool.execute(
          `SELECT cl.label, MAX(cl.color) as color
           FROM client_labels cl
           INNER JOIN clients c ON cl.client_id = c.id
           WHERE c.company_id = ? AND c.is_deleted = 0 AND cl.label IN (${placeholders})
           GROUP BY cl.label`,
          [companyId, ...uniqueLabels]
        );

        const colorMap = new Map(labelColors.map(lc => [lc.label, lc.color]));
        const labelValues = updateFields.labels.map(lbl => [id, lbl, colorMap.get(lbl) || generateLabelColor()]);
        await pool.query(
          `INSERT INTO client_labels (client_id, label, color) VALUES ?`,
          [labelValues]
        );
      }
    }

    // Update client_groups if provided (using client_groups key to match frontend)
    if (updateFields.client_groups) {
      await pool.execute(`DELETE FROM client_groups WHERE client_id = ?`, [id]);
      if (updateFields.client_groups.length > 0) {
        const groupValues = updateFields.client_groups.map(groupName => [id, groupName]);
        await pool.query(
          `INSERT INTO client_groups (client_id, group_name) VALUES ?`,
          [groupValues]
        );
      }
    }

    // Update managers if provided
    if (updateFields.managers) {
      await pool.execute(`DELETE FROM client_managers WHERE client_id = ?`, [id]);
      if (updateFields.managers.length > 0) {
        const managerValues = updateFields.managers.map(userId => [id, userId]);
        await pool.query(
          `INSERT INTO client_managers (client_id, user_id) VALUES ?`,
          [managerValues]
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

    // Base filters
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

    // --- 1. Client Totals ---
    const [clientStats] = await pool.execute(
      `SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'Active' THEN 1 ELSE 0 END) as active,
        SUM(CASE WHEN status = 'Inactive' THEN 1 ELSE 0 END) as inactive
       FROM clients c
       WHERE c.company_id = ? AND c.is_deleted = 0 ${dateFilter} ${statusFilter} ${ownerFilter}`,
      [companyId, ...dateParams, ...statusParams, ...ownerParams]
    );

    // --- 2. Contact Stats ---
    // Contacts don't link to owners directly usually, but link to clients who have owners
    // We join clients to filter by company and potentially owner/status if they affect "Contacts" visibility
    const [contactStats] = await pool.execute(
      `SELECT 
        COUNT(cc.id) as total_contacts,
        SUM(CASE WHEN DATE(cc.created_at) = CURDATE() THEN 1 ELSE 0 END) as contacts_today,
        SUM(CASE WHEN cc.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 ELSE 0 END) as contacts_last_7_days
       FROM client_contacts cc
       INNER JOIN clients c ON cc.client_id = c.id
       WHERE c.company_id = ? AND c.is_deleted = 0 AND cc.is_deleted = 0 ${statusFilter} ${ownerFilter}`,
      [companyId, ...statusParams, ...ownerParams]
    );

    // --- 3. Invoice Stats (Clients having...) ---
    // Unpaid, Partially Paid, Overdue
    const [invoiceStats] = await pool.execute(
      `SELECT 
        COUNT(DISTINCT CASE WHEN i.status = 'Unpaid' THEN c.id END) as clients_unpaid,
        COUNT(DISTINCT CASE WHEN i.status = 'Partially Paid' THEN c.id END) as clients_partially_paid,
        COUNT(DISTINCT CASE WHEN i.due_date < CURDATE() AND i.status != 'Paid' THEN c.id END) as clients_overdue
       FROM invoices i
       INNER JOIN clients c ON i.client_id = c.id
       WHERE c.company_id = ? AND c.is_deleted = 0 AND i.is_deleted = 0 ${statusFilter} ${ownerFilter}`,
      [companyId, ...statusParams, ...ownerParams]
    );

    // --- 4. Project Stats (Clients having...) ---
    const [projectStats] = await pool.execute(
      `SELECT 
        COUNT(DISTINCT CASE WHEN p.status = 'in progress' THEN c.id END) as clients_open_projects,
        COUNT(DISTINCT CASE WHEN p.status = 'completed' OR p.status = 'finished' THEN c.id END) as clients_completed_projects,
        COUNT(DISTINCT CASE WHEN p.status = 'on hold' THEN c.id END) as clients_hold_projects,
        COUNT(DISTINCT CASE WHEN p.status = 'canceled' THEN c.id END) as clients_canceled_projects
       FROM projects p
       INNER JOIN clients c ON p.client_id = c.id
       WHERE c.company_id = ? AND c.is_deleted = 0 AND p.is_deleted = 0 ${statusFilter} ${ownerFilter}`,
      [companyId, ...statusParams, ...ownerParams]
    );

    // --- 5. Estimate Stats (Clients having...) ---
    const [estimateStats] = await pool.execute(
      `SELECT 
        COUNT(DISTINCT CASE WHEN e.status IN ('sent', 'draft') THEN c.id END) as clients_open_estimates,
        COUNT(DISTINCT CASE WHEN e.status = 'accepted' THEN c.id END) as clients_accepted_estimates,
        COUNT(DISTINCT CASE WHEN e.status = 'waiting' THEN c.id END) as clients_new_estimate_requests,
        COUNT(DISTINCT CASE WHEN e.status = 'draft' THEN c.id END) as clients_estimates_in_progress
       FROM estimates e
       INNER JOIN clients c ON e.client_id = c.id
       WHERE c.company_id = ? AND c.is_deleted = 0 ${statusFilter} ${ownerFilter}`,
      [companyId, ...statusParams, ...ownerParams]
    );

    // --- 6. Other Stats (Tickets, Proposals) ---
    // Assuming tables exist: tickets, proposals. If not, ret 0.
    // We'll wrap in try/catch or just assume tables exist. Given project scope, likely yes.
    let ticketStats = { clients_open_tickets: 0 };
    let proposalStats = { clients_open_proposals: 0 };

    try {
      const [tStats] = await pool.execute(
        `SELECT COUNT(DISTINCT CASE WHEN t.status != 'closed' AND t.status != 'resolved' THEN c.id END) as clients_open_tickets
           FROM tickets t
           INNER JOIN clients c ON t.client_id = c.id
           WHERE c.company_id = ? AND c.is_deleted = 0 ${statusFilter} ${ownerFilter}`,
        [companyId, ...statusParams, ...ownerParams]
      );
      ticketStats = tStats[0];
    } catch (e) { /* Ignore if table missing */ }

    try {
      const [pStats] = await pool.execute(
        `SELECT COUNT(DISTINCT CASE WHEN p.status = 'open' OR p.status = 'active' THEN c.id END) as clients_open_proposals
           FROM proposals p
           INNER JOIN clients c ON p.client_id = c.id
           WHERE c.company_id = ? AND c.is_deleted = 0`, // Simplified filter for robustness
        [companyId]
      );
      proposalStats = pStats[0];
    } catch (e) { /* Ignore if table missing */ }


    // --- 7. Revenue ---
    const [revenueResult] = await pool.execute(
      `SELECT
        COALESCE(SUM(i.total), 0) as total_revenue,
        COALESCE(SUM(
          (SELECT COALESCE(SUM(p.amount), 0) 
           FROM payments p 
           WHERE p.invoice_id = i.id AND p.is_deleted = 0)
        ), 0) as payment_received
       FROM invoices i
       INNER JOIN clients c ON i.client_id = c.id
       WHERE c.company_id = ? AND c.is_deleted = 0 AND i.is_deleted = 0 ${dateFilter.replace('c.created_at', 'i.created_at')} ${statusFilter} ${ownerFilter}`,
      [companyId, ...dateParams, ...statusParams, ...ownerParams]
    );
    const revenueData = revenueResult[0] || { total_revenue: 0, payment_received: 0 };
    const revenue = {
      total_revenue: parseFloat(revenueData.total_revenue),
      payment_received: parseFloat(revenueData.payment_received),
      outstanding_amount: parseFloat(revenueData.total_revenue) - parseFloat(revenueData.payment_received)
    };

    res.json({
      success: true,
      data: {
        totals: {
          total_clients: clientStats[0].total,
          active_clients: clientStats[0].active,
          inactive_clients: clientStats[0].inactive,
        },
        contacts: {
          total_contacts: contactStats[0].total_contacts,
          today: contactStats[0].contacts_today,
          last_7_days: contactStats[0].contacts_last_7_days
        },
        invoices: {
          clients_unpaid: invoiceStats[0].clients_unpaid,
          clients_partially_paid: invoiceStats[0].clients_partially_paid,
          clients_overdue: invoiceStats[0].clients_overdue
        },
        projects: {
          clients_open: projectStats[0].clients_open_projects,
          clients_completed: projectStats[0].clients_completed_projects,
          clients_hold: projectStats[0].clients_hold_projects,
          clients_canceled: projectStats[0].clients_canceled_projects
        },
        estimates: {
          clients_open: estimateStats[0].clients_open_estimates,
          clients_accepted: estimateStats[0].clients_accepted_estimates,
          clients_new: estimateStats[0].clients_new_estimate_requests,
          clients_in_progress: estimateStats[0].clients_estimates_in_progress
        },
        tickets: {
          clients_open: ticketStats.clients_open_tickets
        },
        proposals: {
          clients_open: proposalStats.clients_open_proposals
        },
        revenue
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

const getAllContacts = async (req, res) => {
  try {
    const companyId = req.companyId || req.query.company_id || req.body.company_id;

    if (!companyId) {
      return res.status(400).json({
        success: false,
        error: 'company_id is required'
      });
    }

    const [contacts] = await pool.execute(
      `SELECT cc.*, c.company_name as client_name
       FROM client_contacts cc
       JOIN clients c ON cc.client_id = c.id
       WHERE c.company_id = ? AND cc.is_deleted = 0 AND c.is_deleted = 0
       ORDER BY cc.created_at DESC`,
      [companyId]
    );

    res.json({
      success: true,
      data: contacts
    });
  } catch (error) {
    console.error('Get all contacts error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch all contacts'
    });
  }
};

/**
 * Get all client labels
 * GET /api/v1/clients/labels
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

    // Get all unique labels from clients in this company
    const [labels] = await pool.execute(
      `SELECT cl.label, MIN(cl.id) as id, MIN(cl.created_at) as created_at, MAX(cl.color) as color
       FROM client_labels cl
       INNER JOIN clients c ON cl.client_id = c.id
       WHERE c.company_id = ? AND c.is_deleted = 0
       GROUP BY cl.label
       ORDER BY cl.label ASC`,
      [companyId]
    );

    res.json({
      success: true,
      data: labels
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
 * POST /api/v1/clients/labels
 */
const createLabel = async (req, res) => {
  try {
    const { label, client_id, color } = req.body;
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

    let targetClientId = client_id;

    if (targetClientId) {
      // Check if client exists and belongs to company
      const [clients] = await pool.execute(
        `SELECT id FROM clients WHERE id = ? AND company_id = ? AND is_deleted = 0`,
        [targetClientId, companyId]
      );

      if (clients.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Client not found'
        });
      }
    } else {
      // Find any client in this company to attach the label
      const [clients] = await pool.execute(
        `SELECT id FROM clients WHERE company_id = ? AND is_deleted = 0 ORDER BY id ASC LIMIT 1`,
        [companyId]
      );

      if (clients.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'At least one client is required to create labels'
        });
      }

      targetClientId = clients[0].id;
    }

    // Check if label already exists anywhere in this company
    const [existingInCompany] = await pool.execute(
      `SELECT cl.id
       FROM client_labels cl
       INNER JOIN clients c ON cl.client_id = c.id
       WHERE cl.label = ? AND c.company_id = ? AND c.is_deleted = 0
       LIMIT 1`,
      [label, companyId]
    );

    if (existingInCompany.length > 0) {
      if (color) {
        await pool.execute(
          `UPDATE client_labels cl
           INNER JOIN clients c ON cl.client_id = c.id
           SET cl.color = ?
           WHERE cl.label = ? AND c.company_id = ? AND c.is_deleted = 0`,
          [color, label, companyId]
        );

        return res.json({
          success: true,
          message: 'Label updated successfully',
          data: { label, color }
        });
      }

      return res.status(400).json({
        success: false,
        error: 'Label already exists'
      });
    }

    // Insert label with random color if not provided
    const labelColor = color || generateLabelColor();
    await pool.execute(
      `INSERT INTO client_labels (client_id, label, color) VALUES (?, ?, ?)`,
      [targetClientId, label, labelColor]
    );

    res.json({
      success: true,
      message: 'Label created successfully',
      data: { label, color: labelColor }
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
 * Delete a label (removes from all clients in company)
 * DELETE /api/v1/clients/labels/:label
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

    // Delete label from all clients in this company
    await pool.execute(
      `DELETE cl FROM client_labels cl
       INNER JOIN clients c ON cl.client_id = c.id
       WHERE cl.label = ? AND c.company_id = ?`,
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
 * Update labels for a specific client
 * PUT /api/v1/clients/:id/labels
 */
const updateClientLabels = async (req, res) => {
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

    // Delete existing labels
    await pool.execute(`DELETE FROM client_labels WHERE client_id = ?`, [id]);

    // Insert new labels
    if (labels.length > 0) {
      const uniqueLabels = [...new Set(labels)];
      const placeholders = uniqueLabels.map(() => '?').join(',');
      const [labelColors] = await pool.execute(
        `SELECT cl.label, MAX(cl.color) as color
         FROM client_labels cl
         INNER JOIN clients c ON cl.client_id = c.id
         WHERE c.company_id = ? AND c.is_deleted = 0 AND cl.label IN (${placeholders})
         GROUP BY cl.label`,
        [companyId, ...uniqueLabels]
      );

      const colorMap = new Map(labelColors.map(lc => [lc.label, lc.color]));
      const labelValues = labels.map(lbl => [id, lbl, colorMap.get(lbl) || generateLabelColor()]);
      await pool.query(
        `INSERT INTO client_labels (client_id, label, color) VALUES ?`,
        [labelValues]
      );
    }

    res.json({
      success: true,
      message: 'Client labels updated successfully',
      data: { labels }
    });
  } catch (error) {
    console.error('Update client labels error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to update client labels'
    });
  }
};

/**
 * Get all distinct client groups for a company
 * GET /api/v1/clients/groups
 */
const getAllGroups = async (req, res) => {
  try {
    const companyId = req.query.company_id || req.body.company_id || req.companyId;

    if (!companyId) {
      return res.status(400).json({
        success: false,
        error: 'company_id is required'
      });
    }

    const [groups] = await pool.execute(
      `SELECT DISTINCT cg.group_name 
       FROM client_groups cg
       JOIN clients c ON cg.client_id = c.id
       WHERE c.company_id = ? AND c.is_deleted = 0
       ORDER BY cg.group_name ASC`,
      [companyId]
    );

    res.json({
      success: true,
      data: groups.map(g => g.group_name)
    });
  } catch (error) {
    console.error('Get all groups error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch client groups'
    });
  }
};

/**
 * Get client statement (invoices and payments with running balance)
 * GET /api/v1/clients/:id/statement
 */
const getStatement = async (req, res) => {
  try {
    const { id } = req.params;
    const { start_date, end_date } = req.query;
    
    const companyId = req.query.company_id || req.body.company_id || req.companyId;
    
    if (!companyId) {
      return res.status(400).json({
        success: false,
        error: 'company_id is required'
      });
    }

    // Verify client exists
    const [clients] = await pool.execute(
      `SELECT id, company_name FROM clients WHERE id = ? AND company_id = ? AND is_deleted = 0`,
      [id, companyId]
    );

    if (clients.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Client not found'
      });
    }

    // Build date filter
    let dateFilter = '';
    const dateParams = [];
    if (start_date) {
      dateFilter += ' AND DATE(i.invoice_date) >= ?';
      dateParams.push(start_date);
    }
    if (end_date) {
      dateFilter += ' AND DATE(i.invoice_date) <= ?';
      dateParams.push(end_date);
    }

    // Get all invoices for this client
    const [invoices] = await pool.execute(
      `SELECT 
        i.id,
        i.invoice_number,
        i.invoice_date,
        i.due_date,
        i.total,
        i.paid,
        i.unpaid,
        i.status,
        i.currency,
        i.created_at,
        'invoice' as type
      FROM invoices i
      WHERE i.client_id = ? AND i.company_id = ? AND i.is_deleted = 0 ${dateFilter}
      ORDER BY i.invoice_date ASC, i.created_at ASC`,
      [id, companyId, ...dateParams]
    );

    // Get all payments for invoices of this client
    let paymentDateFilter = '';
    const paymentDateParams = [];
    if (start_date) {
      paymentDateFilter += ' AND DATE(p.paid_on) >= ?';
      paymentDateParams.push(start_date);
    }
    if (end_date) {
      paymentDateFilter += ' AND DATE(p.paid_on) <= ?';
      paymentDateParams.push(end_date);
    }

    const [payments] = await pool.execute(
      `SELECT 
        p.id,
        p.invoice_id,
        i.invoice_number,
        p.paid_on as transaction_date,
        p.amount,
        p.currency,
        p.payment_gateway,
        p.offline_payment_method,
        p.remark,
        p.created_at,
        'payment' as type
      FROM payments p
      INNER JOIN invoices i ON p.invoice_id = i.id
      WHERE i.client_id = ? AND p.company_id = ? AND p.is_deleted = 0 ${paymentDateFilter}
      ORDER BY p.paid_on ASC, p.created_at ASC`,
      [id, companyId, ...paymentDateParams]
    );

    // Combine invoices and payments into a single array
    const statementItems = [];

    // Add invoices
    invoices.forEach(invoice => {
      statementItems.push({
        id: invoice.id,
        type: 'invoice',
        date: invoice.invoice_date,
        reference: invoice.invoice_number,
        description: `Invoice ${invoice.invoice_number}`,
        debit: parseFloat(invoice.total || 0),
        credit: 0,
        balance: 0, // Will be calculated
        invoice_id: invoice.id,
        invoice_number: invoice.invoice_number,
        due_date: invoice.due_date,
        status: invoice.status,
        paid: parseFloat(invoice.paid || 0),
        unpaid: parseFloat(invoice.unpaid || 0),
        currency: invoice.currency || 'USD',
        created_at: invoice.created_at
      });
    });

    // Add payments
    payments.forEach(payment => {
      statementItems.push({
        id: payment.id,
        type: 'payment',
        date: payment.transaction_date,
        reference: payment.invoice_number || `PAY-${payment.id}`,
        description: `Payment for Invoice ${payment.invoice_number || payment.invoice_id}`,
        debit: 0,
        credit: parseFloat(payment.amount || 0),
        balance: 0, // Will be calculated
        payment_id: payment.id,
        invoice_id: payment.invoice_id,
        invoice_number: payment.invoice_number,
        payment_method: payment.payment_gateway || payment.offline_payment_method,
        remark: payment.remark,
        currency: payment.currency || 'USD',
        created_at: payment.created_at
      });
    });

    // Sort by date (chronological order)
    statementItems.sort((a, b) => {
      const dateA = new Date(a.date || a.created_at);
      const dateB = new Date(b.date || b.created_at);
      if (dateA.getTime() === dateB.getTime()) {
        // If same date, invoices come before payments
        if (a.type === 'invoice' && b.type === 'payment') return -1;
        if (a.type === 'payment' && b.type === 'invoice') return 1;
        return new Date(a.created_at) - new Date(b.created_at);
      }
      return dateA - dateB;
    });

    // Calculate running balance
    let runningBalance = 0;
    statementItems.forEach(item => {
      runningBalance += item.debit - item.credit;
      item.balance = runningBalance;
    });

    // Calculate summary
    const totalInvoiced = invoices.reduce((sum, inv) => sum + parseFloat(inv.total || 0), 0);
    const totalPaid = payments.reduce((sum, pay) => sum + parseFloat(pay.amount || 0), 0);
    const outstandingBalance = totalInvoiced - totalPaid;
    const currentBalance = runningBalance; // Final balance

    // Get opening balance (balance before start_date if date filter is applied)
    let openingBalance = 0;
    if (start_date) {
      const [openingInvoices] = await pool.execute(
        `SELECT COALESCE(SUM(total), 0) as total
         FROM invoices
         WHERE client_id = ? AND company_id = ? AND is_deleted = 0 AND DATE(invoice_date) < ?`,
        [id, companyId, start_date]
      );
      const [openingPayments] = await pool.execute(
        `SELECT COALESCE(SUM(p.amount), 0) as total
         FROM payments p
         INNER JOIN invoices i ON p.invoice_id = i.id
         WHERE i.client_id = ? AND p.company_id = ? AND p.is_deleted = 0 AND DATE(p.paid_on) < ?`,
        [id, companyId, start_date]
      );
      openingBalance = parseFloat(openingInvoices[0]?.total || 0) - parseFloat(openingPayments[0]?.total || 0);
    }

    res.json({
      success: true,
      data: {
        client_id: parseInt(id),
        client_name: clients[0].company_name,
        opening_balance: openingBalance,
        closing_balance: currentBalance,
        total_invoiced: totalInvoiced,
        total_paid: totalPaid,
        outstanding_balance: outstandingBalance,
        currency: invoices[0]?.currency || payments[0]?.currency || 'USD',
        start_date: start_date || null,
        end_date: end_date || null,
        items: statementItems
      }
    });
  } catch (error) {
    console.error('Get client statement error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch client statement',
      details: error.message
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
  getAllContacts,
  updateContact,
  deleteContact,
  getOverview,
  getStatement,
  // Label management
  getAllLabels,
  createLabel,
  deleteLabel,
  updateClientLabels,
  getAllGroups
};
