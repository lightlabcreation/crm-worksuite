// =====================================================
// Estimate Controller
// =====================================================

const pool = require('../config/db');

const generateEstimateNumber = async (companyId) => {
  try {
    // Find the highest existing estimate number globally (estimate_number has UNIQUE constraint)
    // Include ALL records (even deleted) to avoid duplicate key errors
    const [result] = await pool.execute(
      `SELECT estimate_number FROM estimates 
       WHERE estimate_number LIKE 'EST#%'
       ORDER BY LENGTH(estimate_number) DESC, estimate_number DESC 
       LIMIT 1`
    );

    let nextNum = 1;
    if (result.length > 0 && result[0].estimate_number) {
      // Extract number from EST#001 format
      const estimateNum = result[0].estimate_number;
      const match = estimateNum.match(/EST#(\d+)/);
      if (match && match[1]) {
        const existingNum = parseInt(match[1], 10);
        if (!isNaN(existingNum)) {
          nextNum = existingNum + 1;
        }
      }
    }

    // Ensure uniqueness by checking if the number already exists globally
    let estimateNumber = `EST#${String(nextNum).padStart(3, '0')}`;
    let attempts = 0;
    const maxAttempts = 100;

    while (attempts < maxAttempts) {
      // Check globally since estimate_number has UNIQUE constraint
      const [existing] = await pool.execute(
        `SELECT id FROM estimates WHERE estimate_number = ?`,
        [estimateNumber]
      );

      if (existing.length === 0) {
        // Number is unique, return it
        return estimateNumber;
      }

      // Number exists, try next one
      nextNum++;
      estimateNumber = `EST#${String(nextNum).padStart(3, '0')}`;
      attempts++;
    }

    // Fallback: use timestamp-based number if we can't find a unique sequential number
    const timestamp = Date.now().toString().slice(-6);
    return `EST#${timestamp}`;
  } catch (error) {
    console.error('Error generating estimate number:', error);
    // Fallback to timestamp-based number on error
    const timestamp = Date.now().toString().slice(-6);
    return `EST#${timestamp}`;
  }
};

const getAll = async (req, res) => {
  try {
    // Admin must provide company_id - required for filtering
    const filterCompanyId = req.query.company_id || req.body.company_id || req.companyId;

    if (!filterCompanyId) {
      return res.status(400).json({
        success: false,
        error: 'company_id is required'
      });
    }

    const status = req.query.status;
    const search = req.query.search || req.query.query;
    const clientId = req.query.client_id;
    const leadId = req.query.lead_id;
    const startDate = req.query.start_date;
    const endDate = req.query.end_date;

    let whereClause = 'WHERE e.company_id = ? AND e.is_deleted = 0';
    const params = [filterCompanyId];

    // Status filter
    if (status && status !== 'All' && status !== 'all') {
      whereClause += ' AND UPPER(e.status) = UPPER(?)';
      params.push(status);
    }

    // Search filter (estimate number or client name)
    if (search) {
      whereClause += ' AND (e.estimate_number LIKE ? OR c.company_name LIKE ?)';
      const searchPattern = `%${search}%`;
      params.push(searchPattern, searchPattern);
    }

    // Client filter - support both direct client_id and owner_id (user who owns the client)
    if (clientId) {
      whereClause += ' AND (e.client_id = ? OR c.owner_id = ?)';
      params.push(clientId, clientId);
    }

    // Lead filter
    if (leadId) {
      whereClause += ' AND e.lead_id = ?';
      params.push(parseInt(leadId));
    }

    // Date range filter
    if (startDate) {
      whereClause += ' AND DATE(e.created_at) >= ?';
      params.push(startDate);
    }
    if (endDate) {
      whereClause += ' AND DATE(e.created_at) <= ?';
      params.push(endDate);
    }

    // No pagination needed - removed count query

    // Get all estimates without pagination - includes proposal_date as estimate_date
    const [estimates] = await pool.execute(
      `SELECT 
        e.id,
        e.company_id,
        e.estimate_number,
        e.proposal_date,
        e.created_at,
        e.created_by,
        e.valid_till,
        e.currency,
        e.client_id,
        e.project_id,
        e.calculate_tax,
        e.description,
        e.note,
        e.terms,
        e.tax,
        e.second_tax,
        e.discount,
        e.discount_type,
        e.sub_total,
        e.discount_amount,
        e.tax_amount,
        e.total,
        e.estimate_request_number,
        e.status,
        e.updated_at,
        e.is_deleted,
        c.company_name as client_name,
        p.project_name,
        comp.name as company_name,
        u.name as created_by_name
       FROM estimates e
       LEFT JOIN clients c ON e.client_id = c.id
       LEFT JOIN projects p ON e.project_id = p.id
       LEFT JOIN companies comp ON e.company_id = comp.id
       LEFT JOIN users u ON e.created_by = u.id
       ${whereClause}
       ORDER BY e.created_at DESC`,
      params
    );

    // Fetch items for each estimate and format the response
    for (let estimate of estimates) {
      const [items] = await pool.execute(
        `SELECT 
          id,
          estimate_id,
          item_name,
          description,
          quantity,
          unit,
          unit_price,
          tax,
          tax_rate,
          file_path,
          amount,
          created_at,
          updated_at
         FROM estimate_items WHERE estimate_id = ?`,
        [estimate.id]
      );
      estimate.items = items || [];
    }

    // Return response without pagination
    res.json({
      success: true,
      data: estimates
    });
  } catch (error) {
    console.error('Get estimates error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch estimates'
    });
  }
};

const getById = async (req, res) => {
  try {
    const { id } = req.params;
    const [estimates] = await pool.execute(
      `SELECT e.*, c.company_name as client_name, p.project_name, comp.name as company_name,
              u.name as created_by_name
       FROM estimates e
       LEFT JOIN clients c ON e.client_id = c.id
       LEFT JOIN projects p ON e.project_id = p.id
       LEFT JOIN companies comp ON e.company_id = comp.id
       LEFT JOIN users u ON e.created_by = u.id
       WHERE e.id = ? AND e.is_deleted = 0`,
      [id]
    );
    if (estimates.length === 0) {
      return res.status(404).json({ success: false, error: 'Estimate not found' });
    }

    const estimate = estimates[0];

    // Get estimate items
    const [items] = await pool.execute(
      `SELECT * FROM estimate_items WHERE estimate_id = ?`,
      [id]
    );
    estimate.items = items;

    res.json({ success: true, data: estimate });
  } catch (error) {
    console.error('Get estimate error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch estimate' });
  }
};

const create = async (req, res) => {
  try {
    const {
      estimate_date, proposal_date, valid_till, currency, client_id, project_id, lead_id,
      calculate_tax, description, note, terms, tax, second_tax,
      discount, discount_type, items = [], status
    } = req.body;

    // No required validation - save whatever data is provided

    const companyId = req.body.company_id || req.query.company_id || 1;
    const estimate_number = await generateEstimateNumber(companyId);

    // Get created_by from various sources - body, query, req.userId, or default to 1 (admin)
    const effectiveCreatedBy = req.body.user_id || req.query.user_id || req.userId || 1;

    // Calculate totals from items
    let totals;
    if (items.length > 0) {
      totals = calculateTotals(items, discount || 0, discount_type || '%');
    } else {
      // If no items, use provided totals or defaults
      const providedTotal = parseFloat(req.body.total || req.body.amount || 0);
      const providedSubTotal = parseFloat(req.body.sub_total || req.body.amount || 0);

      let discountAmount = 0;
      if (discount_type === '%') {
        discountAmount = (providedSubTotal * parseFloat(discount || 0)) / 100;
      } else {
        discountAmount = parseFloat(discount || 0);
      }

      totals = {
        sub_total: providedSubTotal,
        discount_amount: discountAmount,
        tax_amount: 0,
        total: providedTotal || (providedSubTotal - discountAmount)
      };
    }

    // Use estimate_date or proposal_date for the proposal_date field
    const estimateDateValue = estimate_date || proposal_date || null;

    // Insert estimate
    // Convert all undefined/empty values to null explicitly
    const [result] = await pool.execute(
      `INSERT INTO estimates (
        company_id, estimate_number, proposal_date, valid_till, currency, client_id, project_id, lead_id,
        calculate_tax, description, note, terms, tax, second_tax, discount, discount_type,
        sub_total, discount_amount, tax_amount, total, created_by, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        companyId || null,
        estimate_number || null,
        (estimateDateValue && estimateDateValue !== '') ? estimateDateValue : null,
        (valid_till && valid_till !== '') ? valid_till : null,
        (currency && currency !== '') ? currency : 'USD',
        (client_id && client_id !== '') ? client_id : null,
        (project_id && project_id !== '') ? project_id : null,
        (lead_id && lead_id !== '') ? lead_id : null,
        (calculate_tax && calculate_tax !== '') ? calculate_tax : 'After Discount',
        (description && description !== '') ? description : null,
        (note && note !== '') ? note : null,
        (terms && terms !== '') ? terms : 'Thank you for your business.',
        (tax && tax !== '') ? tax : null,
        (second_tax && second_tax !== '') ? second_tax : null,
        (discount !== undefined && discount !== null && discount !== '') ? parseFloat(discount) : 0,
        // Map discount_type to valid ENUM values: '%' or 'fixed'
        (discount_type === 'fixed' || discount_type === 'Fixed' || discount_type === 'amount') ? 'fixed' : '%',
        totals.sub_total || 0,
        totals.discount_amount || 0,
        totals.tax_amount || 0,
        totals.total || 0,
        effectiveCreatedBy || 1,
        // Map status to valid ENUM values: 'Waiting', 'Accepted', 'Declined', 'Expired', 'Draft', 'Sent'
        (status === 'draft' || status === 'Draft' || !status) ? 'Draft' : (status === 'sent' || status === 'Sent') ? 'Sent' : status
      ]
    );

    const estimateId = result.insertId;

    // Insert items - calculate amount if not provided
    if (items.length > 0) {
      const itemValues = items.map(item => {
        const quantity = parseFloat(item.quantity || 1);
        const unitPrice = parseFloat(item.unit_price || 0);
        const taxRate = parseFloat(item.tax_rate || 0);

        // Calculate amount: (quantity * unit_price) + tax
        let amount = quantity * unitPrice;
        if (taxRate > 0) {
          amount += (amount * taxRate / 100);
        }

        // Use provided amount if available, otherwise use calculated amount
        const finalAmount = item.amount !== undefined && item.amount !== null
          ? parseFloat(item.amount)
          : amount;

        return [
          estimateId,
          item.item_name,
          item.description || null,
          quantity,
          item.unit || 'Pcs',
          unitPrice,
          item.tax || null,
          taxRate,
          item.file_path || null,
          finalAmount
        ];
      });

      await pool.query(
        `INSERT INTO estimate_items (
          estimate_id, item_name, description, quantity, unit, unit_price,
          tax, tax_rate, file_path, amount
        ) VALUES ?`,
        [itemValues]
      );
    }

    // Get created estimate
    const [estimates] = await pool.execute(
      `SELECT * FROM estimates WHERE id = ?`,
      [estimateId]
    );

    // Get items
    const [estimateItems] = await pool.execute(
      `SELECT * FROM estimate_items WHERE estimate_id = ?`,
      [estimateId]
    );
    estimates[0].items = estimateItems;

    res.status(201).json({
      success: true,
      data: estimates[0],
      message: 'Estimate created successfully'
    });
  } catch (error) {
    console.error('Create estimate error:', error);
    res.status(500).json({ success: false, error: 'Failed to create estimate' });
  }
};

const update = async (req, res) => {
  try {
    const { id } = req.params;
    const rawFields = req.body || {};

    // Sanitize all fields - convert undefined to null
    const updateFields = {};
    for (const [key, value] of Object.entries(rawFields)) {
      updateFields[key] = value === undefined ? null : value;
    }

    // Check if estimate exists
    const [estimates] = await pool.execute(
      `SELECT * FROM estimates WHERE id = ? AND is_deleted = 0`,
      [id]
    );

    if (estimates.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Estimate not found'
      });
    }

    const currentEstimate = estimates[0];

    // Build update query
    const allowedFields = [
      'estimate_date', 'proposal_date', 'valid_till', 'currency', 'client_id', 'project_id', 'calculate_tax',
      'description', 'note', 'terms', 'tax', 'second_tax', 'discount', 'discount_type', 'status'
    ];

    const updates = [];
    const values = [];

    for (const field of allowedFields) {
      if (updateFields.hasOwnProperty(field)) {
        // Handle estimate_date -> proposal_date mapping
        if (field === 'estimate_date') {
          updates.push(`proposal_date = ?`);
          const val = updateFields[field];
          values.push(val === undefined || val === '' ? null : val);
        } else {
          updates.push(`${field} = ?`);
          // Ensure no undefined values
          const val = updateFields[field];
          values.push(val === undefined || val === '' ? null : val);
        }
      }
    }

    // Recalculate totals if items are updated
    if (updateFields.items) {
      const discountVal = updateFields.discount !== undefined ? updateFields.discount : currentEstimate.discount;
      const discountType = updateFields.discount_type !== undefined ? updateFields.discount_type : currentEstimate.discount_type;

      const totals = calculateTotals(
        updateFields.items,
        discountVal || 0,
        discountType || '%'
      );
      updates.push('sub_total = ?', 'discount_amount = ?', 'tax_amount = ?', 'total = ?');
      values.push(totals.sub_total, totals.discount_amount, totals.tax_amount, totals.total);

      // Update items
      await pool.execute(`DELETE FROM estimate_items WHERE estimate_id = ?`, [id]);
      if (updateFields.items.length > 0) {
        const itemValues = updateFields.items.map(item => {
          const quantity = parseFloat(item.quantity || 1);
          const unitPrice = parseFloat(item.unit_price || 0);
          const taxRate = parseFloat(item.tax_rate || 0);

          // Calculate amount: (quantity * unit_price) + tax
          let amount = quantity * unitPrice;
          if (taxRate > 0) {
            amount += (amount * taxRate / 100);
          }

          // Use provided amount if available, otherwise use calculated amount
          const finalAmount = item.amount !== undefined && item.amount !== null
            ? parseFloat(item.amount)
            : amount;

          return [
            id,
            item.item_name,
            item.description || null,
            quantity,
            item.unit || 'Pcs',
            unitPrice,
            item.tax || null,
            taxRate,
            item.file_path || null,
            finalAmount
          ];
        });

        await pool.query(
          `INSERT INTO estimate_items (
            estimate_id, item_name, description, quantity, unit, unit_price,
            tax, tax_rate, file_path, amount
          ) VALUES ?`,
          [itemValues]
        );
      }
    } else if (updateFields.discount !== undefined || updateFields.discount_type !== undefined) {
      // If items are NOT updated but discount is updated, recalculate based on existing sub_total
      const subTotal = parseFloat(currentEstimate.sub_total || 0);

      const discountVal = updateFields.discount !== undefined ? updateFields.discount : currentEstimate.discount;
      const discountType = updateFields.discount_type !== undefined ? updateFields.discount_type : currentEstimate.discount_type;

      let discountAmount = 0;
      if (discountType === '%') {
        discountAmount = (subTotal * parseFloat(discountVal || 0)) / 100;
      } else {
        discountAmount = parseFloat(discountVal || 0);
      }

      const total = subTotal - discountAmount;

      updates.push('discount_amount = ?', 'total = ?');
      values.push(discountAmount, total);

    } else if (updateFields.amount !== undefined || updateFields.total !== undefined || updateFields.sub_total !== undefined) {
      // If items are NOT updated but amount is updated directly (Manual Override)
      const providedTotal = parseFloat(updateFields.total || updateFields.amount || 0);
      const providedSubTotal = parseFloat(updateFields.sub_total || updateFields.amount || 0);

      let discountAmount = 0;
      const discountVal = updateFields.discount !== undefined ? updateFields.discount : currentEstimate.discount;
      const discountType = updateFields.discount_type !== undefined ? updateFields.discount_type : currentEstimate.discount_type;

      if (discountType === '%') {
        discountAmount = (providedSubTotal * parseFloat(discountVal || 0)) / 100;
      } else {
        discountAmount = parseFloat(discountVal || 0);
      }

      updates.push('sub_total = ?', 'discount_amount = ?', 'total = ?');
      values.push(providedSubTotal, discountAmount, providedTotal || (providedSubTotal - discountAmount));
    }

    if (updates.length > 0) {
      updates.push('updated_at = CURRENT_TIMESTAMP');
      values.push(id);

      await pool.execute(
        `UPDATE estimates SET ${updates.join(', ')} WHERE id = ?`,
        values
      );
    }

    // Get updated estimate
    const [updatedEstimates] = await pool.execute(
      `SELECT * FROM estimates WHERE id = ?`,
      [id]
    );

    // Get items
    const [items] = await pool.execute(
      `SELECT * FROM estimate_items WHERE estimate_id = ?`,
      [id]
    );
    updatedEstimates[0].items = items;

    res.json({
      success: true,
      data: updatedEstimates[0],
      message: 'Estimate updated successfully'
    });
  } catch (error) {
    console.error('Update estimate error:', error);
    console.error('Error details:', error.message);
    res.status(500).json({ success: false, error: 'Failed to update estimate', details: error.message });
  }
};

const deleteEstimate = async (req, res) => {
  try {
    const { id } = req.params;
    const [result] = await pool.execute(
      `UPDATE estimates SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        error: 'Estimate not found'
      });
    }

    res.json({ success: true, message: 'Estimate deleted successfully' });
  } catch (error) {
    console.error('Delete estimate error:', error);
    res.status(500).json({ success: false, error: 'Failed to delete estimate' });
  }
};

/**
 * Generate invoice number
 */
const generateInvoiceNumber = async (companyId) => {
  const [result] = await pool.execute(
    `SELECT COUNT(*) as count FROM invoices WHERE company_id = ?`,
    [companyId]
  );
  const nextNum = (result[0].count || 0) + 1;
  return `INV#${String(nextNum).padStart(3, '0')}`;
};

/**
 * Calculate invoice totals
 */

const calculateTotals = (items, discount, discountType) => {
  let subTotal = 0;

  for (const item of items) {
    // If amount is provided, use it. Otherwise calculate from quantity * unit_price
    let itemAmount = parseFloat(item.amount || 0);

    // If amount is 0 but we have valid quantity and unit price, calculate it
    // This fixes issues where frontend sends amount as 0 or undefined
    if (Math.abs(itemAmount) < 0.01) {
      const quantity = parseFloat(item.quantity || 1);
      const unitPrice = parseFloat(item.unit_price || 0);
      const taxRate = parseFloat(item.tax_rate || 0);

      itemAmount = quantity * unitPrice;
      if (taxRate > 0) {
        itemAmount += (itemAmount * taxRate / 100);
      }
    }

    subTotal += itemAmount;
  }

  let discountAmount = 0;
  if (discountType === '%') {
    discountAmount = (subTotal * parseFloat(discount || 0)) / 100;
  } else {
    discountAmount = parseFloat(discount || 0);
  }

  const total = subTotal - discountAmount;
  const taxAmount = 0; // Tax is included in item amounts

  return {
    sub_total: subTotal,
    discount_amount: discountAmount,
    tax_amount: taxAmount,
    total: total,
    unpaid: total
  };
};


/**
 * Convert estimate to invoice
 * POST /api/v1/estimates/:id/convert-to-invoice
 */
const convertToInvoice = async (req, res) => {
  try {
    const { id } = req.params;
    const { invoice_date, due_date, items: requestItems } = req.body;

    const companyId = req.query.company_id || req.body.company_id || 1;
    // Get estimate
    const [estimates] = await pool.execute(
      `SELECT * FROM estimates WHERE id = ? AND is_deleted = 0`,
      [id]
    );

    if (estimates.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Estimate not found'
      });
    }

    const estimate = estimates[0];

    let estimateItems = [];

    // If items are provided in request body, use those; otherwise get from database
    if (requestItems && requestItems.length > 0) {
      // Use items from request body
      estimateItems = requestItems;
    } else {
      // Get estimate items from database
      const [dbItems] = await pool.execute(
        `SELECT * FROM estimate_items WHERE estimate_id = ?`,
        [id]
      );
      estimateItems = dbItems;
    }

    if (estimateItems.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Estimate has no items. Please provide items in the request body or add items to the estimate first.'
      });
    }

    // Validation for invoice dates
    if (!invoice_date || !due_date) {
      return res.status(400).json({
        success: false,
        error: 'invoice_date and due_date are required'
      });
    }

    // Generate invoice number
    const invoice_number = await generateInvoiceNumber(companyId);

    // Convert estimate items to invoice items format
    const invoiceItems = estimateItems.map(item => {
      // Handle both database items (with item.item_name) and request items (already in correct format)
      const quantity = parseFloat(item.quantity || 1);
      const unitPrice = parseFloat(item.unit_price || 0);
      const taxRate = parseFloat(item.tax_rate || 0);

      // Calculate amount: (quantity * unit_price) + tax
      let amount = quantity * unitPrice;
      if (taxRate > 0) {
        amount += (amount * taxRate / 100);
      }

      // Use provided amount if available, otherwise use calculated amount
      const finalAmount = item.amount !== undefined && item.amount !== null
        ? parseFloat(item.amount)
        : amount;

      return {
        item_name: item.item_name,
        description: item.description || null,
        quantity: quantity,
        unit: item.unit || 'Pcs',
        unit_price: unitPrice,
        tax: item.tax || null,
        tax_rate: taxRate,
        file_path: item.file_path || null,
        amount: finalAmount
      };
    });

    // Calculate totals
    const totals = calculateTotals(invoiceItems, estimate.discount || 0, estimate.discount_type || '%');

    // If items were provided in request body, save them to the estimate
    if (requestItems && requestItems.length > 0) {
      // Delete existing items
      await pool.execute(`DELETE FROM estimate_items WHERE estimate_id = ?`, [id]);

      // Insert new items
      const itemValues = requestItems.map(item => {
        const quantity = parseFloat(item.quantity || 1);
        const unitPrice = parseFloat(item.unit_price || 0);
        const taxRate = parseFloat(item.tax_rate || 0);

        // Calculate amount: (quantity * unit_price) + tax
        let amount = quantity * unitPrice;
        if (taxRate > 0) {
          amount += (amount * taxRate / 100);
        }

        // Use provided amount if available, otherwise use calculated amount
        const finalAmount = item.amount !== undefined && item.amount !== null
          ? parseFloat(item.amount)
          : amount;

        return [
          id,
          item.item_name,
          item.description || null,
          quantity,
          item.unit || 'Pcs',
          unitPrice,
          item.tax || null,
          taxRate,
          item.file_path || null,
          finalAmount
        ];
      });

      await pool.query(
        `INSERT INTO estimate_items (
          estimate_id, item_name, description, quantity, unit, unit_price,
          tax, tax_rate, file_path, amount
        ) VALUES ?`,
        [itemValues]
      );

      // Update estimate totals
      await pool.execute(
        `UPDATE estimates SET 
          sub_total = ?, discount_amount = ?, tax_amount = ?, total = ?,
          updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [totals.sub_total, totals.discount_amount, totals.tax_amount, totals.total, id]
      );
    }

    // Get created_by from various sources - body, query, req.userId, or default to 1 (admin)
    const effectiveCreatedBy = req.body.user_id || req.query.user_id || req.userId || 1;

    // Create invoice
    const [invoiceResult] = await pool.execute(
      `INSERT INTO invoices (
        company_id, invoice_number, invoice_date, due_date, currency, exchange_rate,
        client_id, project_id, calculate_tax, note, terms,
        discount, discount_type, sub_total, discount_amount, tax_amount,
        total, unpaid, status, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        companyId,
        invoice_number,
        invoice_date,
        due_date,
        estimate.currency || 'USD',
        1.0,
        estimate.client_id,
        estimate.project_id ?? null,
        estimate.calculate_tax || 'After Discount',
        estimate.note ?? null,
        estimate.terms || 'Thank you for your business.',
        estimate.discount ?? 0,
        estimate.discount_type || '%',
        totals.sub_total,
        totals.discount_amount,
        totals.tax_amount,
        totals.total,
        totals.unpaid,
        'Unpaid',
        effectiveCreatedBy
      ]
    );

    const invoiceId = invoiceResult.insertId;

    // Insert invoice items
    const itemValues = invoiceItems.map(item => [
      invoiceId,
      item.item_name,
      item.description,
      item.quantity,
      item.unit,
      item.unit_price,
      item.tax,
      item.tax_rate,
      item.file_path,
      item.amount
    ]);

    await pool.query(
      `INSERT INTO invoice_items (
        invoice_id, item_name, description, quantity, unit, unit_price,
        tax, tax_rate, file_path, amount
      ) VALUES ?`,
      [itemValues]
    );

    // Update estimate status to 'Accepted'
    await pool.execute(
      `UPDATE estimates SET status = 'Accepted', updated_at = CURRENT_TIMESTAMP 
       WHERE id = ?`,
      [id]
    );

    // Get created invoice
    const [invoices] = await pool.execute(
      `SELECT * FROM invoices WHERE id = ?`,
      [invoiceId]
    );

    res.status(201).json({
      success: true,
      data: invoices[0],
      message: 'Estimate converted to invoice successfully'
    });
  } catch (error) {
    console.error('Convert estimate to invoice error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to convert estimate to invoice'
    });
  }
};

/**
 * Send estimate by email
 * POST /api/v1/estimates/:id/send-email
 */
const sendEmail = async (req, res) => {
  try {
    const { id } = req.params;
    const { to, subject, message, cc, bcc } = req.body;

    // Get estimate
    const [estimates] = await pool.execute(
      `SELECT e.*, c.company_name as client_name, c.email as client_email, comp.name as company_name
       FROM estimates e
       LEFT JOIN clients c ON e.client_id = c.id
       LEFT JOIN companies comp ON e.company_id = comp.id
       WHERE e.id = ? AND e.is_deleted = 0`,
      [id]
    );

    if (estimates.length === 0) {
      return res.status(404).json({ success: false, error: 'Estimate not found' });
    }

    const estimate = estimates[0];

    // Generate public URL
    const publicUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/public/estimates/${id}`;

    // Generate email HTML
    const { sendEmail: sendEmailUtil, generateEstimateEmailHTML } = require('../utils/emailService');

    // Use provided message or generate default HTML
    const emailHTML = message || generateEstimateEmailHTML(estimate, publicUrl);

    // Send email
    const recipientEmail = to || estimate.client_email;
    if (!recipientEmail) {
      return res.status(400).json({ success: false, error: 'Recipient email is required' });
    }

    await sendEmailUtil({
      to: recipientEmail,
      cc: cc,
      bcc: bcc,
      subject: subject || `Estimate ${estimate.estimate_number}`,
      html: emailHTML,
      text: `Please view the estimate at: ${publicUrl}`
    });

    // Update estimate status to 'Sent'
    await pool.execute(
      `UPDATE estimates SET status = 'Sent', sent_at = NOW() WHERE id = ?`,
      [id]
    );

    res.json({
      success: true,
      message: 'Estimate sent successfully',
      data: { email: recipientEmail }
    });
  } catch (error) {
    console.error('Send estimate email error:', error);
    res.status(500).json({ success: false, error: 'Failed to send estimate email' });
  }
};

/**
 * Get estimate PDF
 * GET /api/v1/estimates/:id/pdf
 */
const getPDF = async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.query.company_id || req.body.company_id || 1;

    const [estimates] = await pool.execute(
      `SELECT e.*, 
              c.company_name as client_name,
              p.project_name,
              comp.name as company_name,
              comp.address as company_address
       FROM estimates e
       LEFT JOIN clients c ON e.client_id = c.id
       LEFT JOIN projects p ON e.project_id = p.id
       LEFT JOIN companies comp ON e.company_id = comp.id
       WHERE e.id = ? AND e.company_id = ? AND e.is_deleted = 0`,
      [id, companyId]
    );

    if (estimates.length === 0) {
      return res.status(404).json({ success: false, error: 'Estimate not found' });
    }

    const estimate = estimates[0];

    // Get estimate items
    const [items] = await pool.execute(
      `SELECT * FROM estimate_items WHERE estimate_id = ?`,
      [id]
    );
    estimate.items = items || [];

    // For now, return JSON. In production, you would generate actual PDF using libraries like pdfkit or puppeteer
    if (req.query.download === '1') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename=estimate-${estimate.estimate_number || estimate.id}.json`);
    } else {
      res.setHeader('Content-Type', 'application/json');
    }

    res.json({
      success: true,
      data: estimate,
      message: 'PDF generation will be implemented with pdfkit or puppeteer'
    });
  } catch (error) {
    console.error('Get estimate PDF error:', error);
    res.status(500).json({ success: false, error: 'Failed to generate PDF' });
  }
};

module.exports = {
  getAll,
  getById,
  create,
  update,
  delete: deleteEstimate,
  convertToInvoice,
  sendEmail,
  getPDF
};

