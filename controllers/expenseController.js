const pool = require('../config/db');

/**
 * Generate expense number
 */
const generateExpenseNumber = async (companyId) => {
  // Get max expense number including deleted ones to avoid duplicates
  const [result] = await pool.execute(
    `SELECT MAX(CAST(SUBSTRING(expense_number, 5) AS UNSIGNED)) as max_num FROM expenses WHERE expense_number LIKE 'EXP#%'`,
    []
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

    // Get all expenses with client, project, and employee information
    let expenses = [];
    try {
      const [expensesResult] = await pool.execute(
        `SELECT e.*, 
                c.company_name as client_name,
                p.project_name as project_name,
                u.name as employee_name
         FROM expenses e
         LEFT JOIN clients c ON e.client_id = c.id
         LEFT JOIN projects p ON e.project_id = p.id
         LEFT JOIN users u ON e.employee_id = u.id
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
      company_id, expense_date, category, amount, title, description,
      client_id, project_id, employee_id, tax, second_tax, is_recurring
    } = req.body;

    const companyId = req.body.company_id || req.companyId || 1;

    // Generate expense number
    const expense_number = await generateExpenseNumber(companyId);

    // Insert expense with new fields
    const [result] = await pool.execute(
      `INSERT INTO expenses (
        company_id, expense_number, expense_date, category, amount, title, description,
        client_id, project_id, employee_id, tax, second_tax, is_recurring,
        total, status, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        companyId,
        expense_number,
        expense_date || new Date().toISOString().split('T')[0],
        category ?? null,
        parseFloat(amount) || 0,
        title ?? null,
        description ?? null,
        client_id ?? null,
        project_id ?? null,
        employee_id ?? null,
        tax ?? null,
        second_tax ?? null,
        is_recurring ?? 0,
        parseFloat(amount) || 0,
        'Pending',
        req.userId || req.body.user_id || req.query.user_id || 1
      ]
    );

    const expenseId = result.insertId;

    // Get created expense
    const [expenses] = await pool.execute(
      `SELECT * FROM expenses WHERE id = ?`,
      [expenseId]
    );

    res.status(201).json({
      success: true,
      data: expenses[0],
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
      company_id, expense_date, category, amount, title, description,
      client_id, project_id, employee_id, tax, second_tax, is_recurring
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

    // Update expense with new fields
    await pool.execute(
      `UPDATE expenses SET
        expense_date = ?, category = ?, amount = ?, title = ?, description = ?,
        client_id = ?, project_id = ?, employee_id = ?, tax = ?, second_tax = ?,
        is_recurring = ?, total = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        expense_date || new Date().toISOString().split('T')[0],
        category ?? null,
        parseFloat(amount) || 0,
        title ?? null,
        description ?? null,
        client_id ?? null,
        project_id ?? null,
        employee_id ?? null,
        tax ?? null,
        second_tax ?? null,
        is_recurring ?? 0,
        parseFloat(amount) || 0,
        id
      ]
    );

    // Get updated expense
    const [expenses] = await pool.execute(
      `SELECT * FROM expenses WHERE id = ?`,
      [id]
    );

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
