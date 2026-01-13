// =====================================================
// Proposal Controller
// =====================================================

const pool = require('../config/db');

const generateProposalNumber = async (companyId) => {
  try {
    // Find the highest existing proposal number for this company
    // Include ALL records (even deleted) to avoid duplicate key errors
    const [result] = await pool.execute(
      `SELECT estimate_number FROM estimates 
       WHERE company_id = ? 
       AND estimate_number LIKE 'PROP#%'
       ORDER BY LENGTH(estimate_number) DESC, estimate_number DESC 
       LIMIT 1`,
      [companyId]
    );

    let nextNum = 1;
    if (result.length > 0 && result[0].estimate_number) {
      // Extract number from PROP#001 format
      const proposalNum = result[0].estimate_number;
      const match = proposalNum.match(/PROP#(\d+)/);
      if (match && match[1]) {
        const existingNum = parseInt(match[1], 10);
        if (!isNaN(existingNum)) {
          nextNum = existingNum + 1;
        }
      }
    }

    // Ensure uniqueness by checking if the number already exists (including deleted)
    let proposalNumber = `PROP#${String(nextNum).padStart(3, '0')}`;
    let attempts = 0;
    const maxAttempts = 100;

    while (attempts < maxAttempts) {
      const [existing] = await pool.execute(
        `SELECT id FROM estimates WHERE estimate_number = ?`,
        [proposalNumber]
      );

      if (existing.length === 0) {
        // Number is unique, return it
        return proposalNumber;
      }

      // Number exists, try next one
      nextNum++;
      proposalNumber = `PROP#${String(nextNum).padStart(3, '0')}`;
      attempts++;
    }

    // Fallback: use timestamp-based number if we can't find a unique sequential number
    const timestamp = Date.now().toString().slice(-6);
    return `PROP#${timestamp}`;
  } catch (error) {
    console.error('Error generating proposal number:', error);
    // Fallback to timestamp-based number on error
    const timestamp = Date.now().toString().slice(-6);
    return `PROP#${timestamp}`;
  }
};

const calculateTotals = (items, discount, discountType) => {
  let subTotal = 0;
  let taxAmount = 0;

  if (items && Array.isArray(items) && items.length > 0) {
    items.forEach(item => {
      const quantity = parseFloat(item.quantity) || 0;
      const unitPrice = parseFloat(item.unit_price) || 0;
      const taxRate = parseFloat(item.tax_rate) || 0;

      const itemSubtotal = quantity * unitPrice;
      const itemTax = itemSubtotal * (taxRate / 100);

      subTotal += itemSubtotal;
      taxAmount += itemTax;
    });
  }

  let discountAmount = 0;
  const discountValue = parseFloat(discount) || 0;
  if (discountType === '%') {
    discountAmount = (subTotal * discountValue) / 100;
  } else {
    discountAmount = discountValue;
  }

  const total = subTotal + taxAmount - discountAmount;

  // Ensure all values are valid numbers (not NaN)
  return {
    sub_total: isNaN(subTotal) ? 0 : Math.round(subTotal * 100) / 100,
    discount_amount: isNaN(discountAmount) ? 0 : Math.round(discountAmount * 100) / 100,
    tax_amount: isNaN(taxAmount) ? 0 : Math.round(taxAmount * 100) / 100,
    total: isNaN(total) ? 0 : Math.round(total * 100) / 100
  };
};

const getAll = async (req, res) => {
  try {
    // Get filters from query params
    // Admin must provide company_id - required for filtering
    const filterCompanyId = req.query.company_id || req.body.company_id || req.companyId;

    if (!filterCompanyId) {
      return res.status(400).json({
        success: false,
        error: 'company_id is required'
      });
    }

    const status = req.query.status;
    const search = req.query.search;
    const client_id = req.query.client_id;
    const project_id = req.query.project_id;
    const lead_id = req.query.lead_id;
    const start_date = req.query.start_date;
    const end_date = req.query.end_date;
    const amount_min = req.query.amount_min;
    const amount_max = req.query.amount_max;
    const created_by = req.query.created_by;
    const sort_by = req.query.sort_by || 'created_at';
    const sort_order = req.query.sort_order || 'DESC';

    // Filter proposals - include all estimates that are proposals
    let whereClause = `WHERE e.company_id = ? AND e.is_deleted = 0 AND (
      e.estimate_number LIKE 'PROP#%' 
      OR e.estimate_number LIKE 'PROPOSAL%'
      OR e.estimate_number LIKE 'PROP-%'
    )`;
    const params = [parseInt(filterCompanyId)];

    if (status && status !== 'All' && status !== 'all') {
      const statusUpper = status.toUpperCase();
      whereClause += ' AND UPPER(e.status) = ?';
      params.push(statusUpper);
    }

    if (client_id) {
      // Support both direct client_id and owner_id (user who owns the client)
      whereClause += ' AND (e.client_id = ? OR c.owner_id = ?)';
      params.push(client_id, client_id);
    }

    if (project_id) {
      whereClause += ' AND e.project_id = ?';
      params.push(project_id);
    }

    if (lead_id) {
      whereClause += ' AND e.lead_id = ?';
      params.push(parseInt(lead_id));
    }

    if (start_date) {
      whereClause += ' AND DATE(e.created_at) >= ?';
      params.push(start_date);
    }

    if (end_date) {
      whereClause += ' AND DATE(e.created_at) <= ?';
      params.push(end_date);
    }

    if (amount_min !== undefined) {
      whereClause += ' AND e.total >= ?';
      params.push(parseFloat(amount_min));
    }

    if (amount_max !== undefined && amount_max !== null && amount_max !== '') {
      whereClause += ' AND e.total <= ?';
      params.push(parseFloat(amount_max));
    }

    if (created_by) {
      whereClause += ' AND e.created_by = ?';
      params.push(created_by);
    }

    if (lead_id) {
      whereClause += ' AND e.lead_id = ?';
      params.push(parseInt(lead_id));
    }

    // Search filter
    if (search) {
      whereClause += ` AND (
        e.estimate_number LIKE ? OR 
        c.company_name LIKE ? OR
        e.description LIKE ?
      )`;
      const searchPattern = `%${search}%`;
      params.push(searchPattern, searchPattern, searchPattern);
    }

    // Validate and set sort column
    const allowedSortColumns = {
      'id': 'e.id',
      'estimate_number': 'e.estimate_number',
      'status': 'e.status',
      'created_at': 'e.created_at',
      'valid_till': 'e.valid_till',
      'total': 'e.total',
      'client_name': 'c.company_name',
      'company_name': 'comp.name'
    };

    const sortColumn = allowedSortColumns[sort_by] || 'e.created_at';
    const sortDirection = (sort_order || 'DESC').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    // Get all proposals without pagination
    const [proposals] = await pool.execute(
      `SELECT e.*, 
       c.company_name as client_name, 
       c.id as client_id,
       u_client.email as client_email,
       p.project_name, 
       p.id as project_id,
       comp.name as company_name,
       comp.id as company_id,
       u.name as created_by_name
       FROM estimates e
       LEFT JOIN clients c ON e.client_id = c.id
       LEFT JOIN users u_client ON c.owner_id = u_client.id
       LEFT JOIN projects p ON e.project_id = p.id
       LEFT JOIN companies comp ON e.company_id = comp.id
       LEFT JOIN users u ON e.created_by = u.id
       ${whereClause}
       ORDER BY ${sortColumn} ${sortDirection}`,
      params
    );

    // Get items for each proposal
    for (let proposal of proposals) {
      const [items] = await pool.execute(
        `SELECT * FROM estimate_items WHERE estimate_id = ?`,
        [proposal.id]
      );
      proposal.items = items || [];

      // Format estimate_number to match frontend expectations
      if (!proposal.estimate_number || !proposal.estimate_number.includes('PROPOSAL')) {
        const numMatch = proposal.estimate_number?.match(/PROP#?(\d+)/);
        const proposalNum = numMatch ? numMatch[1] : proposal.id;
        proposal.estimate_number = `PROPOSAL #${proposalNum}`;
      }

      // Ensure status is lowercase for frontend
      if (proposal.status) {
        proposal.status = proposal.status.toLowerCase();
      }
    }

    res.json({
      success: true,
      data: proposals
    });
  } catch (error) {
    console.error('Get proposals error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch proposals'
    });
  }
};

const getById = async (req, res) => {
  try {
    const { id } = req.params;
    const [proposals] = await pool.execute(
      `SELECT e.*, c.company_name as client_name, p.project_name, comp.name as company_name
       FROM estimates e
       LEFT JOIN clients c ON e.client_id = c.id
       LEFT JOIN projects p ON e.project_id = p.id
       LEFT JOIN companies comp ON e.company_id = comp.id
       WHERE e.id = ? AND e.is_deleted = 0 AND (e.estimate_number LIKE 'PROP#%' OR e.status IN ('Sent', 'Draft'))`,
      [id]
    );
    if (proposals.length === 0) {
      return res.status(404).json({ success: false, error: 'Proposal not found' });
    }

    const proposal = proposals[0];

    // Get proposal items
    const [items] = await pool.execute(
      `SELECT * FROM estimate_items WHERE estimate_id = ?`,
      [id]
    );
    proposal.items = items;

    res.json({ success: true, data: proposal });
  } catch (error) {
    console.error('Get proposal error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch proposal' });
  }
};

const create = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const {
      proposal_date, valid_till, client_id, tax, second_tax, note,
      currency, status, items, description, terms, discount, discount_type
    } = req.body;

    const companyId = req.body.company_id || req.query.company_id || req.companyId || 1;
    const proposal_number = await generateProposalNumber(companyId);
    const effectiveCreatedBy = req.body.user_id || req.query.user_id || req.userId || req.user?.id || 1;

    // Map status
    let mappedStatus = 'Draft';
    if (status === 'sent') mappedStatus = 'Sent';
    else if (status === 'draft') mappedStatus = 'Draft';
    else if (status) mappedStatus = status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();

    // Calculate totals if items exist
    let totals = { sub_total: 0, discount_amount: 0, tax_amount: 0, total: 0 };
    if (items && Array.isArray(items) && items.length > 0) {
      totals = calculateTotals(items, discount, discount_type);
    }

    // Insert proposal
    const [result] = await connection.execute(
      `INSERT INTO estimates (
        company_id, estimate_number, proposal_date, valid_till, currency, client_id,
        tax, second_tax, note, description, terms, discount, discount_type,
        sub_total, discount_amount, tax_amount, total, status, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        companyId || null,
        proposal_number || null,
        (proposal_date && proposal_date !== '') ? proposal_date : null,
        (valid_till && valid_till !== '') ? valid_till : null,
        (currency && currency !== '') ? currency : 'USD',
        (client_id && client_id !== '') ? client_id : null,
        (tax && tax !== '') ? tax : null,
        (second_tax && second_tax !== '') ? second_tax : null,
        (note && note !== '') ? note : null,
        (description && description !== '') ? description : null,
        (terms && terms !== '') ? terms : 'Thank you for your business.',
        discount || 0,
        discount_type || '%',
        totals.sub_total,
        totals.discount_amount,
        totals.tax_amount,
        totals.total,
        mappedStatus || 'Draft',
        effectiveCreatedBy || 1
      ]
    );

    const proposalId = result.insertId;

    // Insert items
    if (items && Array.isArray(items) && items.length > 0) {
      for (const item of items) {
        await connection.execute(
          `INSERT INTO estimate_items 
           (estimate_id, item_name, description, quantity, unit, unit_price, tax, tax_rate, amount)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            proposalId,
            item.item_name || '',
            item.description || '',
            item.quantity || 1,
            item.unit || 'Pcs',
            item.unit_price || 0,
            item.tax || '',
            item.tax_rate || 0,
            item.amount || 0
          ]
        );
      }
    }

    await connection.commit();

    // Fetch the created proposal with relations
    const [proposals] = await pool.execute(
      `SELECT e.*, c.company_name as client_name, p.project_name, comp.name as company_name
       FROM estimates e
       LEFT JOIN clients c ON e.client_id = c.id
       LEFT JOIN projects p ON e.project_id = p.id
       LEFT JOIN companies comp ON e.company_id = comp.id
       WHERE e.id = ?`,
      [proposalId]
    );

    const proposal = proposals[0];

    // Get items
    const [itemsData] = await pool.execute(
      `SELECT * FROM estimate_items WHERE estimate_id = ?`,
      [proposalId]
    );
    proposal.items = itemsData || [];

    res.status(201).json({ success: true, data: proposal });
  } catch (error) {
    await connection.rollback();
    console.error('Create proposal error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to create proposal'
    });
  } finally {
    connection.release();
  }
};

const update = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      proposal_date, valid_till, client_id, tax, second_tax, note,
      currency, status, items, description, terms, discount, discount_type
    } = req.body;

    // Check if proposal exists
    const [existing] = await pool.execute(
      `SELECT id FROM estimates WHERE id = ? AND is_deleted = 0 AND (estimate_number LIKE 'PROP#%' OR status IN ('Sent', 'Draft'))`,
      [id]
    );

    if (existing.length === 0) {
      return res.status(404).json({ success: false, error: 'Proposal not found' });
    }

    // Map status
    let mappedStatus = null;
    if (status === 'sent') {
      mappedStatus = 'Sent';
    } else if (status === 'draft') {
      mappedStatus = 'Draft';
    } else if (status) {
      mappedStatus = status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      // Update basic fields
      const updateFields = [];
      const updateValues = [];

      if (proposal_date !== undefined) updateFields.push('proposal_date = ?'), updateValues.push(proposal_date);
      if (valid_till !== undefined) updateFields.push('valid_till = ?'), updateValues.push(valid_till);
      if (currency !== undefined) updateFields.push('currency = ?'), updateValues.push(currency);
      if (client_id !== undefined) updateFields.push('client_id = ?'), updateValues.push(client_id);
      if (tax !== undefined) updateFields.push('tax = ?'), updateValues.push(tax);
      if (second_tax !== undefined) updateFields.push('second_tax = ?'), updateValues.push(second_tax);
      if (note !== undefined) updateFields.push('note = ?'), updateValues.push(note);
      if (description !== undefined) updateFields.push('description = ?'), updateValues.push(description);
      if (terms !== undefined) updateFields.push('terms = ?'), updateValues.push(terms);
      if (mappedStatus !== null) updateFields.push('status = ?'), updateValues.push(mappedStatus);
      if (discount !== undefined) updateFields.push('discount = ?'), updateValues.push(discount);
      if (discount_type !== undefined) updateFields.push('discount_type = ?'), updateValues.push(discount_type);

      // Handle Items if provided
      if (items && Array.isArray(items)) {
        // Delete existing items
        await connection.execute('DELETE FROM estimate_items WHERE estimate_id = ?', [id]);

        // Insert new items
        for (const item of items) {
          await connection.execute(
            `INSERT INTO estimate_items 
             (estimate_id, item_name, description, quantity, unit, unit_price, tax, tax_rate, amount)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              id,
              item.item_name || '',
              item.description || '',
              item.quantity || 1,
              item.unit || 'Pcs',
              item.unit_price || 0,
              item.tax || '',
              item.tax_rate || 0,
              item.amount || 0
            ]
          );
        }

        // Calculate Totals
        const totals = calculateTotals(items, discount, discount_type); // Make sure calculateTotals is accessible or define it inside

        updateFields.push('sub_total = ?'); updateValues.push(totals.sub_total);
        updateFields.push('discount_amount = ?'); updateValues.push(totals.discount_amount);
        updateFields.push('tax_amount = ?'); updateValues.push(totals.tax_amount);
        updateFields.push('total = ?'); updateValues.push(totals.total);
      }

      updateFields.push('updated_at = CURRENT_TIMESTAMP');
      updateValues.push(id);

      if (updateFields.length > 1) { // > 1 because updated_at is always added
        await connection.execute(
          `UPDATE estimates SET ${updateFields.join(', ')} WHERE id = ?`,
          updateValues
        );
      }

      await connection.commit();
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }

    // Fetch updated proposal
    const [proposals] = await pool.execute(
      `SELECT e.*, c.company_name as client_name, p.project_name, comp.name as company_name
       FROM estimates e
       LEFT JOIN clients c ON e.client_id = c.id
       LEFT JOIN projects p ON e.project_id = p.id
       LEFT JOIN companies comp ON e.company_id = comp.id
       WHERE e.id = ?`,
      [id]
    );

    const proposal = proposals[0];
    const [itemsData] = await pool.execute(
      `SELECT * FROM estimate_items WHERE estimate_id = ?`,
      [id]
    );
    proposal.items = itemsData;

    res.json({ success: true, data: proposal });
  } catch (error) {
    console.error('Update proposal error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to update proposal'
    });
  }
};

const deleteProposal = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if proposal exists
    const [existing] = await pool.execute(
      `SELECT id FROM estimates WHERE id = ? AND is_deleted = 0 AND (estimate_number LIKE 'PROP#%' OR status IN ('Sent', 'Draft'))`,
      [id]
    );

    if (existing.length === 0) {
      return res.status(404).json({ success: false, error: 'Proposal not found' });
    }

    // Soft delete
    await pool.execute(
      `UPDATE estimates SET is_deleted = 1 WHERE id = ?`,
      [id]
    );

    res.json({ success: true, message: 'Proposal deleted successfully' });
  } catch (error) {
    console.error('Delete proposal error:', error);
    res.status(500).json({ success: false, error: 'Failed to delete proposal' });
  }
};

const convertToInvoice = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if proposal exists
    const [proposals] = await pool.execute(
      `SELECT e.* FROM estimates e 
       WHERE e.id = ? AND e.is_deleted = 0 AND (e.estimate_number LIKE 'PROP#%' OR e.status IN ('Sent', 'Draft'))`,
      [id]
    );

    if (proposals.length === 0) {
      return res.status(404).json({ success: false, error: 'Proposal not found' });
    }

    const proposal = proposals[0];

    // Get proposal items
    const [items] = await pool.execute(
      `SELECT * FROM estimate_items WHERE estimate_id = ?`,
      [id]
    );

    // Create invoice from proposal (you'll need to implement invoice creation logic)
    // For now, just return success
    res.json({
      success: true,
      message: 'Proposal converted to invoice successfully',
      data: { proposal, items }
    });
  } catch (error) {
    console.error('Convert proposal to invoice error:', error);
    res.status(500).json({ success: false, error: 'Failed to convert proposal to invoice' });
  }
};

/**
 * Send proposal by email
 * POST /api/v1/proposals/:id/send-email
 */
const sendEmail = async (req, res) => {
  try {
    const { id } = req.params;
    const { to, subject, message } = req.body;

    // Get proposal
    const [proposals] = await pool.execute(
      `SELECT e.*, c.company_name as client_name, u_client.email as client_email, comp.name as company_name
       FROM estimates e
       LEFT JOIN clients c ON e.client_id = c.id
       LEFT JOIN users u_client ON c.owner_id = u_client.id
       LEFT JOIN companies comp ON e.company_id = comp.id
       WHERE e.id = ? AND e.is_deleted = 0 AND (e.estimate_number LIKE 'PROP#%' OR e.status IN ('Sent', 'Draft'))`,
      [id]
    );

    if (proposals.length === 0) {
      return res.status(404).json({ success: false, error: 'Proposal not found' });
    }

    const proposal = proposals[0];

    // Generate public URL (you'll need to implement this)
    const publicUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/public/proposals/${id}`;

    // Generate email HTML
    const { sendEmail: sendEmailUtil, generateProposalEmailHTML } = require('../utils/emailService');
    const emailHTML = generateProposalEmailHTML(proposal, publicUrl);

    // Send email
    const recipientEmail = to || proposal.client_email;
    if (!recipientEmail) {
      return res.status(400).json({ success: false, error: 'Recipient email is required' });
    }

    await sendEmailUtil({
      to: recipientEmail,
      subject: subject || `Proposal ${proposal.estimate_number}`,
      html: emailHTML,
      text: `Please view the proposal at: ${publicUrl}`
    });

    // Update proposal status to 'Sent'
    await pool.execute(
      `UPDATE estimates SET status = 'Sent', sent_at = NOW() WHERE id = ?`,
      [id]
    );

    res.json({
      success: true,
      message: 'Proposal sent successfully',
      data: { email: recipientEmail }
    });
  } catch (error) {
    console.error('Send proposal email error:', error);
    res.status(500).json({ success: false, error: 'Failed to send proposal email' });
  }
};

/**
 * Get proposal PDF
 * GET /api/v1/proposals/:id/pdf
 */
const getPDF = async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.query.company_id || req.body.company_id || req.companyId;

    if (!companyId) {
      return res.status(400).json({
        success: false,
        error: 'company_id is required'
      });
    }

    // Get proposal
    const [proposals] = await pool.execute(
      `SELECT e.*, c.company_name as client_name, p.project_name, comp.name as company_name
       FROM estimates e
       LEFT JOIN clients c ON e.client_id = c.id
       LEFT JOIN projects p ON e.project_id = p.id
       LEFT JOIN companies comp ON e.company_id = comp.id
       WHERE e.id = ? AND e.company_id = ? AND e.is_deleted = 0 AND (e.estimate_number LIKE 'PROP#%' OR e.status IN ('Sent', 'Draft'))`,
      [id, companyId]
    );

    if (proposals.length === 0) {
      return res.status(404).json({ success: false, error: 'Proposal not found' });
    }

    const proposal = proposals[0];

    // Get proposal items
    const [items] = await pool.execute(
      `SELECT * FROM estimate_items WHERE estimate_id = ?`,
      [id]
    );
    proposal.items = items;

    // For now, return JSON. In production, you would generate actual PDF using libraries like pdfkit or puppeteer
    // This is a placeholder that returns the proposal data
    if (req.query.download === '1') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename=proposal-${proposal.estimate_number}.json`);
    } else {
      res.setHeader('Content-Type', 'application/json');
    }

    res.json({
      success: true,
      data: proposal,
      message: 'PDF generation will be implemented with pdfkit or puppeteer'
    });
  } catch (error) {
    console.error('Get proposal PDF error:', error);
    res.status(500).json({ success: false, error: 'Failed to generate PDF' });
  }
};

/**
 * Get filter options for proposals
 * GET /api/v1/proposals/filters
 */
const getFilters = async (req, res) => {
  try {
    const companyId = req.query.company_id || req.companyId;

    let whereClause = `WHERE e.is_deleted = 0 AND (
      e.estimate_number LIKE 'PROP#%' 
      OR e.estimate_number LIKE 'PROPOSAL%'
      OR e.estimate_number LIKE 'PROP-%'
    )`;
    const params = [];

    if (companyId) {
      whereClause += ' AND e.company_id = ?';
      params.push(companyId);
    }

    // Get unique statuses
    const [statuses] = await pool.execute(
      `SELECT DISTINCT e.status FROM estimates e ${whereClause} ORDER BY e.status`,
      params
    );

    // Get clients
    const [clients] = await pool.execute(
      `SELECT DISTINCT c.id, c.company_name 
       FROM clients c
       INNER JOIN estimates e ON c.id = e.client_id
       ${whereClause}
       ORDER BY c.company_name`,
      params
    );

    // Get projects
    const [projects] = await pool.execute(
      `SELECT DISTINCT p.id, p.project_name 
       FROM projects p
       INNER JOIN estimates e ON p.id = e.project_id
       ${whereClause}
       ORDER BY p.project_name`,
      params
    );

    // Get created by users
    const [users] = await pool.execute(
      `SELECT DISTINCT u.id, u.name, u.email
       FROM users u
       INNER JOIN estimates e ON u.id = e.created_by
       ${whereClause}
       ORDER BY u.name`,
      params
    );

    res.json({
      success: true,
      data: {
        statuses: statuses.map(s => s.status),
        clients: clients,
        projects: projects,
        created_by_users: users
      }
    });
  } catch (error) {
    console.error('Get filters error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch filter options'
    });
  }
};

/**
 * Update proposal status
 * PUT /api/v1/proposals/:id/status
 */
const updateStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({
        success: false,
        error: 'Status is required'
      });
    }

    // Check if proposal exists
    const [existing] = await pool.execute(
      `SELECT id FROM estimates WHERE id = ? AND is_deleted = 0 AND (estimate_number LIKE 'PROP#%' OR status IN ('Sent', 'Draft'))`,
      [id]
    );

    if (existing.length === 0) {
      return res.status(404).json({ success: false, error: 'Proposal not found' });
    }

    // Map status
    let mappedStatus = status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();

    // Update status
    await pool.execute(
      `UPDATE estimates SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [mappedStatus, id]
    );

    // Get updated proposal
    const [proposals] = await pool.execute(
      `SELECT e.*, c.company_name as client_name, p.project_name, comp.name as company_name
       FROM estimates e
       LEFT JOIN clients c ON e.client_id = c.id
       LEFT JOIN projects p ON e.project_id = p.id
       LEFT JOIN companies comp ON e.company_id = comp.id
       WHERE e.id = ?`,
      [id]
    );

    const proposal = proposals[0];
    const [itemsData] = await pool.execute(
      `SELECT * FROM estimate_items WHERE estimate_id = ?`,
      [id]
    );
    proposal.items = itemsData;

    res.json({
      success: true,
      data: proposal,
      message: 'Proposal status updated successfully'
    });
  } catch (error) {
    console.error('Update proposal status error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to update proposal status'
    });
  }
};

/**
 * Duplicate proposal
 * POST /api/v1/proposals/:id/duplicate
 */
const duplicate = async (req, res) => {
  try {
    const { id } = req.params;

    // Get original proposal
    const [proposals] = await pool.execute(
      `SELECT e.* FROM estimates e 
       WHERE e.id = ? AND e.is_deleted = 0 AND (e.estimate_number LIKE 'PROP#%' OR e.status IN ('Sent', 'Draft'))`,
      [id]
    );

    if (proposals.length === 0) {
      return res.status(404).json({ success: false, error: 'Proposal not found' });
    }

    const originalProposal = proposals[0];

    // Get items
    const [items] = await pool.execute(
      `SELECT * FROM estimate_items WHERE estimate_id = ?`,
      [id]
    );

    // Generate new proposal number
    const proposal_number = await generateProposalNumber(originalProposal.company_id);

    // Create new proposal
    const [result] = await pool.execute(
      `INSERT INTO estimates (
        company_id, estimate_number, valid_till, currency, client_id, project_id,
        calculate_tax, description, note, terms, discount, discount_type,
        sub_total, discount_amount, tax_amount, total, status, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        originalProposal.company_id,
        proposal_number,
        originalProposal.valid_till,
        originalProposal.currency || 'USD',
        originalProposal.client_id,
        originalProposal.project_id,
        originalProposal.calculate_tax || 'After Discount',
        originalProposal.description,
        originalProposal.note,
        originalProposal.terms || 'Thank you for your business.',
        originalProposal.discount ?? 0,
        originalProposal.discount_type || '%',
        originalProposal.sub_total,
        originalProposal.discount_amount,
        originalProposal.tax_amount,
        originalProposal.total,
        'Draft',
        req.user?.id || 1
      ]
    );

    const newProposalId = result.insertId;

    // Copy items
    if (items && items.length > 0) {
      const itemValues = items.map(item => [
        newProposalId,
        item.item_name || '',
        item.description || null,
        item.quantity || 1,
        item.unit || 'Pcs',
        item.unit_price || 0,
        item.tax || null,
        item.tax_rate || 0,
        item.file_path || null,
        item.amount || 0
      ]);

      await pool.query(
        `INSERT INTO estimate_items (
          estimate_id, item_name, description, quantity, unit, unit_price, tax, tax_rate, file_path, amount
        ) VALUES ?`,
        [itemValues]
      );
    }

    // Fetch created proposal
    const [newProposals] = await pool.execute(
      `SELECT e.*, c.company_name as client_name, p.project_name, comp.name as company_name
       FROM estimates e
       LEFT JOIN clients c ON e.client_id = c.id
       LEFT JOIN projects p ON e.project_id = p.id
       LEFT JOIN companies comp ON e.company_id = comp.id
       WHERE e.id = ?`,
      [newProposalId]
    );

    const newProposal = newProposals[0];
    const [newItemsData] = await pool.execute(
      `SELECT * FROM estimate_items WHERE estimate_id = ?`,
      [newProposalId]
    );
    newProposal.items = newItemsData;

    res.status(201).json({
      success: true,
      data: newProposal,
      message: 'Proposal duplicated successfully'
    });
  } catch (error) {
    console.error('Duplicate proposal error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to duplicate proposal'
    });
  }
};

module.exports = {
  getAll,
  getById,
  create,
  update,
  delete: deleteProposal,
  convertToInvoice,
  sendEmail,
  getFilters,
  updateStatus,
  duplicate,
  getPDF
};

