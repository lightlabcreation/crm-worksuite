const pool = require('../config/db');

/**
 * Generate expense number
 */
const generateExpenseNumber = async (companyId) => {
  const [result] = await pool.execute(
    `SELECT MAX(CAST(SUBSTRING(expense_number, 5) AS UNSIGNED)) as max_num FROM expenses WHERE company_id = ? AND expense_number LIKE 'EXP#%'`,
    [companyId]
  );
  const nextNum = (result[0].max_num || 0) + 1;
  return `EXP#${String(nextNum).padStart(3, '0')}`;
};

/**
 * Calculate expense totals
 */
const calculateTotals = (items, discount, discountType) => {
  let subTotal = 0;
  
  for (const item of items) {
    subTotal += parseFloat(item.amount || 0);
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
    total: total
  };
};

const getAll = async (req, res) => {
  try {
    const { status } = req.query;

    // Only filter by company_id if explicitly provided in query params or req.companyId exists
    const filterCompanyId = req.query.company_id || req.body.company_id || 1;
    
    let whereClause = 'WHERE e.is_deleted = 0';
    const params = [];

    if (filterCompanyId) {
      whereClause += ' AND e.company_id = ?';
      params.push(filterCompanyId);
    }

    if (status) {
      whereClause += ' AND e.status = ?';
      params.push(status);
    }

    // Get all expenses with lead information
    let expenses = [];
    try {
      const [expensesResult] = await pool.execute(
        `SELECT e.*, 
                l.name as lead_name, 
                l.company_name as lead_company_name,
                l.email as lead_email
         FROM expenses e
         LEFT JOIN leads l ON e.lead_id = l.id
         ${whereClause}
         ORDER BY e.created_at DESC`,
        params
      );
      expenses = expensesResult || [];
    } catch (joinError) {
      // If JOIN fails, try without JOIN
      console.warn('Error with JOIN, trying without:', joinError.message);
      const [expensesResult] = await pool.execute(
        `SELECT e.* FROM expenses e ${whereClause} ORDER BY e.created_at DESC`,
        params
      );
      expenses = expensesResult || [];
    }

    // Get items for each expense
    for (let expense of expenses) {
      try {
        const [items] = await pool.execute(
          `SELECT * FROM expense_items WHERE expense_id = ?`,
          [expense.id]
        );
        expense.items = items || [];
      } catch (itemError) {
        console.warn(`Error fetching items for expense ${expense.id}:`, itemError.message);
        expense.items = [];
      }
      
      // Set lead_contact from lead information - prioritize company_name
      if (expense.lead_company_name || expense.lead_name) {
        expense.lead_contact = expense.lead_company_name || expense.lead_name || expense.lead_email || 'N/A';
      } else {
        expense.lead_contact = expense.lead_contact || 'N/A';
      }
    }

    res.json({
      success: true,
      data: expenses
    });
  } catch (error) {
    console.error('Get expenses error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch expenses',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

const create = async (req, res) => {
  try {
    const {
      company_id, lead_id, deal_id, deal_name, valid_till, currency, calculate_tax, description,
      note, terms, discount, discount_type, require_approval, items = []
    } = req.body;

    // Removed required validations - allow empty data
    const companyId = req.body.company_id || req.companyId || 1;
    
    // Handle deal_id - if deal_name is provided but deal_id is not, set deal_id to null
    // (deal_name is just for display, we store deal_id)
    const effectiveDealId = deal_id || null;

    // Generate expense number
    const expense_number = await generateExpenseNumber(companyId);

    // Calculate totals
    const totals = calculateTotals(items, discount || 0, discount_type || '%');

    // Insert expense - convert undefined to null for SQL
    const [result] = await pool.execute(
      `INSERT INTO expenses (
        company_id, expense_number, lead_id, deal_id, valid_till, currency,
        calculate_tax, description, note, terms, discount, discount_type,
        sub_total, discount_amount, tax_amount, total, require_approval,
        status, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        companyId,
        expense_number,
        lead_id ?? null,
        effectiveDealId,
        valid_till ?? null,
        currency || 'USD',
        calculate_tax || 'After Discount',
        description ?? null,
        note ?? null,
        terms || 'Thank you for your business.',
        discount ?? 0,
        discount_type || '%',
        totals.sub_total,
        totals.discount_amount,
        totals.tax_amount,
        totals.total,
        require_approval ?? 1,
        'Pending',
        req.userId || req.body.user_id || req.query.user_id || 1
      ]
    );

    const expenseId = result.insertId;

    // Insert items - calculate amount if not provided
    if (items.length > 0) {
      const itemValues = items.map(item => {
        const quantity = parseFloat(item.quantity || 1);
        const unitPrice = parseFloat(item.unit_price || 0);
        
        // Extract tax rate from tax string (e.g., "GST 10%" -> 10)
        let taxRate = 0;
        if (item.tax) {
          const taxMatch = item.tax.match(/(\d+(?:\.\d+)?)/);
          if (taxMatch) {
            taxRate = parseFloat(taxMatch[1]);
          }
        }
        
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
          expenseId,
          item.item_name || item.itemName || item.description || 'Expense Item',
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

      // Insert items one by one (mysql2 doesn't support VALUES ? syntax)
      for (const itemValue of itemValues) {
        await pool.execute(
          `INSERT INTO expense_items (
            expense_id, item_name, description, quantity, unit, unit_price,
            tax, tax_rate, file_path, amount
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          itemValue
        );
      }
    }

    // Get created expense with items
    const [expenses] = await pool.execute(
      `SELECT * FROM expenses WHERE id = ?`,
      [expenseId]
    );

    const [expenseItems] = await pool.execute(
      `SELECT * FROM expense_items WHERE expense_id = ?`,
      [expenseId]
    );

    const expense = expenses[0];
    expense.items = expenseItems;

    res.status(201).json({
      success: true,
      data: expense,
      message: 'Expense created successfully'
    });
  } catch (error) {
    console.error('Create expense error:', error);
    console.error('Error stack:', error.stack);
    console.error('Error message:', error.message);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to create expense',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Approve expense
 * POST /api/v1/expenses/:id/approve
 */
const approve = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if expense exists
    const [expenses] = await pool.execute(
      `SELECT id, status FROM expenses WHERE id = ? AND company_id = ? AND is_deleted = 0`,
      [id, req.companyId]
    );

    if (expenses.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Expense not found'
      });
    }

    const expense = expenses[0];

    // Check if already approved
    if (expense.status === 'Approved') {
      return res.status(400).json({
        success: false,
        error: 'Expense is already approved'
      });
    }

    // Update expense status to Approved
    await pool.execute(
      `UPDATE expenses 
       SET status = 'Approved', updated_at = CURRENT_TIMESTAMP 
       WHERE id = ? AND company_id = ?`,
      [id, req.companyId]
    );

    // Get updated expense
    const [updatedExpenses] = await pool.execute(
      `SELECT * FROM expenses WHERE id = ?`,
      [id]
    );

    res.json({
      success: true,
      data: updatedExpenses[0],
      message: 'Expense approved successfully'
    });
  } catch (error) {
    console.error('Approve expense error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to approve expense'
    });
  }
};

/**
 * Reject expense
 * POST /api/v1/expenses/:id/reject
 */
const reject = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    // Check if expense exists
    const [expenses] = await pool.execute(
      `SELECT id, status FROM expenses WHERE id = ? AND company_id = ? AND is_deleted = 0`,
      [id, req.companyId]
    );

    if (expenses.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Expense not found'
      });
    }

    const expense = expenses[0];

    // Check if already rejected
    if (expense.status === 'Rejected') {
      return res.status(400).json({
        success: false,
        error: 'Expense is already rejected'
      });
    }

    // Update expense status to Rejected
    await pool.execute(
      `UPDATE expenses 
       SET status = 'Rejected', note = COALESCE(?, note), updated_at = CURRENT_TIMESTAMP 
       WHERE id = ? AND company_id = ?`,
      [reason || null, id, req.companyId]
    );

    // Get updated expense
    const [updatedExpenses] = await pool.execute(
      `SELECT * FROM expenses WHERE id = ?`,
      [id]
    );

    res.json({
      success: true,
      data: updatedExpenses[0],
      message: 'Expense rejected successfully'
    });
  } catch (error) {
    console.error('Reject expense error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to reject expense'
    });
  }
};

/**
 * Get expense by ID
 * GET /api/v1/expenses/:id
 */
const getById = async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.query.company_id || req.body.company_id || 1;

    const [expenses] = await pool.execute(
      `SELECT e.* FROM expenses e
       WHERE e.id = ? AND e.company_id = ? AND e.is_deleted = 0`,
      [id, companyId]
    );

    if (expenses.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Expense not found'
      });
    }

    // Get items
    const [items] = await pool.execute(
      `SELECT * FROM expense_items WHERE expense_id = ?`,
      [id]
    );
    expenses[0].items = items;

    res.json({
      success: true,
      data: expenses[0]
    });
  } catch (error) {
    console.error('Get expense by ID error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch expense'
    });
  }
};

/**
 * Update expense
 * PUT /api/v1/expenses/:id
 */
const update = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      company_id, lead_id, deal_id, valid_till, currency, calculate_tax, description,
      note, terms, discount, discount_type, require_approval, items = []
    } = req.body;

    const companyId = company_id || req.query.company_id || 1;

    // Check if expense exists
    const [existing] = await pool.execute(
      `SELECT id FROM expenses WHERE id = ? AND company_id = ? AND is_deleted = 0`,
      [id, companyId]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Expense not found'
      });
    }

    // Calculate totals
    const totals = calculateTotals(items, discount || 0, discount_type || '%');

    // Update expense
    await pool.execute(
      `UPDATE expenses SET
        lead_id = ?, deal_id = ?, valid_till = ?, currency = ?,
        calculate_tax = ?, description = ?, note = ?, terms = ?,
        discount = ?, discount_type = ?, require_approval = ?,
        sub_total = ?, discount_amount = ?, tax_amount = ?, total = ?,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        lead_id ?? null,
        deal_id ?? null,
        valid_till,
        currency || 'USD',
        calculate_tax || 'After Discount',
        description ?? null,
        note ?? null,
        terms ?? null,
        discount ?? 0,
        discount_type || '%',
        require_approval ?? 1,
        totals.sub_total,
        totals.discount_amount,
        totals.tax_amount,
        totals.total,
        id
      ]
    );

    // Update items - delete old and insert new
    if (items && items.length > 0) {
      await pool.execute(`DELETE FROM expense_items WHERE expense_id = ?`, [id]);
      
      const itemValues = items.map(item => [
        id,
        item.item_name || item.description || '',
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
        `INSERT INTO expense_items (
          expense_id, item_name, description, quantity, unit, unit_price, tax, tax_rate, file_path, amount
        ) VALUES ?`,
        [itemValues]
      );
    }

    // Get updated expense
    const [expenses] = await pool.execute(
      `SELECT * FROM expenses WHERE id = ?`,
      [id]
    );

    const [expenseItems] = await pool.execute(
      `SELECT * FROM expense_items WHERE expense_id = ?`,
      [id]
    );
    expenses[0].items = expenseItems;

    res.json({
      success: true,
      data: expenses[0],
      message: 'Expense updated successfully'
    });
  } catch (error) {
    console.error('Update expense error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update expense'
    });
  }
};

/**
 * Delete expense (soft delete)
 * DELETE /api/v1/expenses/:id
 */
const deleteExpense = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if expense exists (without company_id check for flexibility)
    const [existing] = await pool.execute(
      `SELECT id FROM expenses WHERE id = ? AND is_deleted = 0`,
      [id]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Expense not found or already deleted'
      });
    }

    // Soft delete
    const [result] = await pool.execute(
      `UPDATE expenses SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        error: 'Expense not found'
      });
    }

    res.json({
      success: true,
      message: 'Expense deleted successfully'
    });
  } catch (error) {
    console.error('Delete expense error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete expense'
    });
  }
};

module.exports = { getAll, getById, create, update, delete: deleteExpense, approve, reject };
