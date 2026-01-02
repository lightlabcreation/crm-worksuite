// =====================================================
// Super Admin Controller
// =====================================================

const pool = require('../config/db');
const bcrypt = require('bcryptjs');

/**
 * Get all companies (Super Admin can see all companies)
 * GET /api/v1/superadmin/companies
 */
const getAllCompanies = async (req, res) => {
  try {
    const { search = '', status = '' } = req.query;

    let query = `
      SELECT 
        c.id,
        c.name,
        c.industry,
        c.website,
        c.address,
        c.notes,
        c.logo,
        c.currency,
        c.timezone,
        c.package_id,
        cp.package_name,
        c.created_at,
        c.updated_at,
        c.is_deleted,
        COUNT(DISTINCT u.id) as total_users,
        COUNT(DISTINCT cl.id) as total_clients,
        COUNT(DISTINCT p.id) as total_projects
      FROM companies c
      LEFT JOIN users u ON c.id = u.company_id AND u.is_deleted = 0
      LEFT JOIN clients cl ON c.id = cl.company_id AND cl.is_deleted = 0
      LEFT JOIN projects p ON c.id = p.company_id AND p.is_deleted = 0
      LEFT JOIN company_packages cp ON c.package_id = cp.id
      WHERE 1=1
    `;
    const queryParams = [];

    // By default, show only active (non-deleted) companies
    if (status === 'deleted') {
      query += ` AND c.is_deleted = 1`;
    } else {
      // Show active companies by default (when status is 'active' or not provided)
      query += ` AND c.is_deleted = 0`;
    }

    if (search) {
      query += ` AND (c.name LIKE ? OR c.industry LIKE ? OR c.website LIKE ?)`;
      queryParams.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    // No pagination - return all companies
    query += ` GROUP BY c.id ORDER BY c.created_at DESC`;

    const [companies] = await pool.execute(query, queryParams);

    res.json({
      success: true,
      data: companies
    });
  } catch (error) {
    console.error('Get all companies error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch companies'
    });
  }
};

/**
 * Get company by ID
 * GET /api/v1/superadmin/companies/:id
 */
const getCompanyById = async (req, res) => {
  try {
    const { id } = req.params;

    const [companies] = await pool.execute(
      `SELECT 
        c.*,
        COUNT(DISTINCT u.id) as total_users,
        COUNT(DISTINCT cl.id) as total_clients,
        COUNT(DISTINCT p.id) as total_projects
      FROM companies c
      LEFT JOIN users u ON c.id = u.company_id AND u.is_deleted = 0
      LEFT JOIN clients cl ON c.id = cl.company_id AND cl.is_deleted = 0
      LEFT JOIN projects p ON c.id = p.company_id AND p.is_deleted = 0
      WHERE c.id = ?
      GROUP BY c.id`,
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
      error: 'Failed to fetch company'
    });
  }
};

/**
 * Create company
 * POST /api/v1/superadmin/companies
 */
const createCompany = async (req, res) => {
  try {
    const {
      name,
      industry,
      website,
      address,
      notes,
      logo,
      currency = 'USD',
      timezone = 'UTC',
      package_id = null
    } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        error: 'Company name is required'
      });
    }

    const [result] = await pool.execute(
      `INSERT INTO companies 
        (name, industry, website, address, notes, logo, currency, timezone, package_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [name, industry || null, website || null, address || null, notes || null, logo || null, currency, timezone, package_id]
    );

    const [newCompany] = await pool.execute(
      'SELECT * FROM companies WHERE id = ?',
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
      error: 'Failed to create company'
    });
  }
};

/**
 * Update company
 * PUT /api/v1/superadmin/companies/:id
 */
const updateCompany = async (req, res) => {
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
      package_id,
      is_deleted
    } = req.body;

    const updateFields = [];
    const updateValues = [];

    if (name !== undefined) {
      updateFields.push('name = ?');
      updateValues.push(name);
    }
    if (industry !== undefined) {
      updateFields.push('industry = ?');
      updateValues.push(industry);
    }
    if (website !== undefined) {
      updateFields.push('website = ?');
      updateValues.push(website);
    }
    if (address !== undefined) {
      updateFields.push('address = ?');
      updateValues.push(address);
    }
    if (notes !== undefined) {
      updateFields.push('notes = ?');
      updateValues.push(notes);
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
      updateValues.push(package_id);
    }
    if (is_deleted !== undefined) {
      updateFields.push('is_deleted = ?');
      updateValues.push(is_deleted ? 1 : 0);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No fields to update'
      });
    }

    updateFields.push('updated_at = NOW()');
    updateValues.push(id);

    await pool.execute(
      `UPDATE companies SET ${updateFields.join(', ')} WHERE id = ?`,
      updateValues
    );

    const [updatedCompany] = await pool.execute(
      'SELECT * FROM companies WHERE id = ?',
      [id]
    );

    res.json({
      success: true,
      data: updatedCompany[0],
      message: 'Company updated successfully'
    });
  } catch (error) {
    console.error('Update company error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update company'
    });
  }
};

/**
 * Delete company (soft delete)
 * DELETE /api/v1/superadmin/companies/:id
 */
const deleteCompany = async (req, res) => {
  try {
    const { id } = req.params;

    await pool.execute(
      'UPDATE companies SET is_deleted = 1, updated_at = NOW() WHERE id = ?',
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
      error: 'Failed to delete company'
    });
  }
};

/**
 * Get system statistics
 * GET /api/v1/superadmin/stats
 */
const getSystemStats = async (req, res) => {
  try {
    // Get basic counts with error handling
    let companyCount = [{ count: 0 }]
    let userCount = [{ count: 0 }]
    let clientCount = [{ count: 0 }]
    let projectCount = [{ count: 0 }]
    let invoiceCount = [{ count: 0 }]
    let paymentCount = [{ count: 0 }]
    let activeCompanyCount = [{ count: 0 }]
    let inactiveCompanyCount = [{ count: 0 }]
    let packageCount = [{ count: 0 }]

    try {
      const results = await Promise.allSettled([
        pool.execute('SELECT COUNT(*) as count FROM companies WHERE is_deleted = 0'),
        pool.execute('SELECT COUNT(*) as count FROM users WHERE is_deleted = 0'),
        pool.execute('SELECT COUNT(*) as count FROM clients WHERE is_deleted = 0'),
        pool.execute('SELECT COUNT(*) as count FROM projects WHERE is_deleted = 0'),
        pool.execute('SELECT COUNT(*) as count FROM invoices WHERE is_deleted = 0'),
        pool.execute('SELECT COUNT(*) as count FROM payments WHERE is_deleted = 0'),
        pool.execute('SELECT COUNT(*) as count FROM companies WHERE is_deleted = 0'),
        pool.execute('SELECT COUNT(*) as count FROM companies WHERE is_deleted = 1'),
        pool.execute('SELECT COUNT(*) as count FROM company_packages WHERE is_deleted = 0')
      ])

      if (results[0].status === 'fulfilled' && results[0].value && results[0].value[0]) companyCount = results[0].value[0]
      if (results[1].status === 'fulfilled' && results[1].value && results[1].value[0]) userCount = results[1].value[0]
      if (results[2].status === 'fulfilled' && results[2].value && results[2].value[0]) clientCount = results[2].value[0]
      if (results[3].status === 'fulfilled' && results[3].value && results[3].value[0]) projectCount = results[3].value[0]
      if (results[4].status === 'fulfilled' && results[4].value && results[4].value[0]) invoiceCount = results[4].value[0]
      if (results[5].status === 'fulfilled' && results[5].value && results[5].value[0]) paymentCount = results[5].value[0]
      if (results[6].status === 'fulfilled' && results[6].value && results[6].value[0]) activeCompanyCount = results[6].value[0]
      if (results[7].status === 'fulfilled' && results[7].value && results[7].value[0]) inactiveCompanyCount = results[7].value[0]
      if (results[8].status === 'fulfilled' && results[8].value && results[8].value[0]) packageCount = results[8].value[0]
      
      // Log any rejected promises for debugging
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          console.error(`Query ${index} failed:`, result.reason)
        }
      })
    } catch (error) {
      console.error('Error fetching basic counts:', error)
    }

    // Get license expired count (companies with expired packages or no package)
    let expiredLicenseCount = [{ count: 0 }]
    try {
      const [result] = await pool.execute(
        `SELECT COUNT(*) as count 
         FROM companies c
         LEFT JOIN company_packages cp ON c.package_id = cp.id
         WHERE c.is_deleted = 0 
         AND (cp.id IS NULL OR cp.is_deleted = 1)`
      )
      expiredLicenseCount = result
    } catch (error) {
      console.error('Error fetching expired license count:', error)
      try {
        const [result] = await pool.execute(
          `SELECT COUNT(*) as count 
           FROM companies c
           LEFT JOIN company_packages cp ON c.package_id = cp.id
           WHERE c.is_deleted = 0 AND cp.id IS NULL`
        )
        expiredLicenseCount = result
      } catch (err) {
        console.error('Error in fallback expired license query:', err)
      }
    }

    // Get package distribution
    let packageDistribution = []
    try {
      const [result] = await pool.execute(
        `SELECT 
          cp.package_name,
          COUNT(c.id) as companies_count
         FROM company_packages cp
         LEFT JOIN companies c ON c.package_id = cp.id AND c.is_deleted = 0
         WHERE cp.is_deleted = 0
         GROUP BY cp.id, cp.package_name
         ORDER BY companies_count DESC`
      )
      packageDistribution = result
    } catch (error) {
      console.error('Error fetching package distribution:', error)
    }

    // Get revenue data (from payments)
    let revenueData = []
    let totalRevenue = 0
    let currentMonthRevenue = 0
    let lastMonthRevenue = 0
    let revenueGrowth = 0

    try {
      const [result] = await pool.execute(
        `SELECT 
          DATE_FORMAT(payment_date, '%Y-%m') as month,
          SUM(amount) as total_revenue
         FROM payments
         WHERE is_deleted = 0 AND payment_date IS NOT NULL
         GROUP BY DATE_FORMAT(payment_date, '%Y-%m')
         ORDER BY month DESC
         LIMIT 6`
      )
      revenueData = result

      // Get current month and last month revenue
      const currentMonth = new Date().toISOString().slice(0, 7) // YYYY-MM
      const lastMonth = new Date(new Date().setMonth(new Date().getMonth() - 1)).toISOString().slice(0, 7)
      
      currentMonthRevenue = revenueData.find(r => r.month === currentMonth)?.total_revenue || 0
      lastMonthRevenue = revenueData.find(r => r.month === lastMonth)?.total_revenue || 0
      revenueGrowth = lastMonthRevenue > 0 
        ? parseFloat(((currentMonthRevenue - lastMonthRevenue) / lastMonthRevenue * 100).toFixed(0))
        : 0

      // Get total revenue from all payments
      const [totalRevenueResult] = await pool.execute(
        'SELECT SUM(amount) as total_revenue FROM payments WHERE is_deleted = 0'
      )
      totalRevenue = totalRevenueResult[0]?.total_revenue || 0
    } catch (error) {
      console.error('Error fetching revenue data:', error)
    }

    // Get companies growth over last 6 months
    let companiesGrowth = []
    try {
      const [result] = await pool.execute(
        `SELECT 
          DATE_FORMAT(created_at, '%Y-%m') as month,
          COUNT(*) as count
         FROM companies
         WHERE is_deleted = 0
         AND created_at >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
         GROUP BY DATE_FORMAT(created_at, '%Y-%m')
         ORDER BY month ASC`
      )
      companiesGrowth = result
    } catch (error) {
      console.error('Error fetching companies growth:', error)
    }

    // Get recent companies with package info
    let recentCompanies = []
    try {
      const [result] = await pool.execute(
        `SELECT 
          c.id, 
          c.name, 
          c.created_at, 
          c.is_deleted,
          c.logo,
          cp.package_name,
          (SELECT COUNT(*) FROM users u WHERE u.company_id = c.id AND u.is_deleted = 0) as total_users,
          (SELECT COUNT(*) FROM clients cl WHERE cl.company_id = c.id AND cl.is_deleted = 0) as total_clients
         FROM companies c
         LEFT JOIN company_packages cp ON c.package_id = cp.id
         WHERE 1=1
         ORDER BY c.created_at DESC 
         LIMIT 10`
      )
      recentCompanies = result
    } catch (error) {
      console.error('Error fetching recent companies:', error)
    }

    // Get recent users
    let recentUsers = []
    try {
      const [result] = await pool.execute(
        `SELECT u.id, u.name, u.email, u.role, u.status, u.created_at, c.name as company_name
         FROM users u
         LEFT JOIN companies c ON u.company_id = c.id
         WHERE u.is_deleted = 0
         ORDER BY u.created_at DESC
         LIMIT 10`
      )
      recentUsers = result
    } catch (error) {
      console.error('Error fetching recent users:', error)
    }

    res.json({
      success: true,
      data: {
        totals: {
          companies: companyCount[0]?.count || 0,
          users: userCount[0]?.count || 0,
          clients: clientCount[0]?.count || 0,
          projects: projectCount[0]?.count || 0,
          invoices: invoiceCount[0]?.count || 0,
          payments: paymentCount[0]?.count || 0,
          packages: packageCount[0]?.count || 0,
          active_companies: activeCompanyCount[0]?.count || 0,
          inactive_companies: inactiveCompanyCount[0]?.count || 0,
          license_expired: expiredLicenseCount[0]?.count || 0
        },
        revenue: {
          total: totalRevenue || 0,
          this_month: currentMonthRevenue || 0,
          last_month: lastMonthRevenue || 0,
          growth: revenueGrowth || 0
        },
        package_distribution: packageDistribution || [],
        companies_growth: companiesGrowth || [],
        revenue_over_time: revenueData || [],
        recent: {
          companies: recentCompanies || [],
          users: recentUsers || []
        }
      }
    });
  } catch (error) {
    console.error('Get system stats error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch system statistics',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Get all users across all companies
 * GET /api/v1/superadmin/users
 */
const getAllUsers = async (req, res) => {
  try {
    const { search = '', role = '', company_id = '' } = req.query;

    // Only show ADMIN users - filter out EMPLOYEE and CLIENT
    let query = `
      SELECT 
        u.id,
        u.company_id,
        u.name,
        u.email,
        u.role,
        u.status,
        u.avatar,
        u.phone,
        u.created_at,
        c.name as company_name
      FROM users u
      LEFT JOIN companies c ON u.company_id = c.id
      WHERE u.is_deleted = 0 AND u.role = 'ADMIN'
    `;
    const queryParams = [];

    if (search) {
      query += ` AND (u.name LIKE ? OR u.email LIKE ?)`;
      queryParams.push(`%${search}%`, `%${search}%`);
    }

    if (company_id) {
      query += ` AND u.company_id = ?`;
      queryParams.push(company_id);
    }

    // No pagination - return all ADMIN users only
    query += ` ORDER BY u.created_at DESC`;

    const [users] = await pool.execute(query, queryParams);

    res.json({
      success: true,
      data: users
    });
  } catch (error) {
    console.error('Get all users error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch users'
    });
  }
};

/**
 * Get user by ID
 * GET /api/v1/superadmin/users/:id
 */
const getUserById = async (req, res) => {
  try {
    const { id } = req.params;

    const [users] = await pool.execute(
      `SELECT 
        u.id,
        u.company_id,
        u.name,
        u.email,
        u.role,
        u.status,
        u.avatar,
        u.phone,
        u.created_at,
        c.name as company_name
      FROM users u
      LEFT JOIN companies c ON u.company_id = c.id
      WHERE u.id = ? AND u.is_deleted = 0`,
      [id]
    );

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    res.json({
      success: true,
      data: users[0]
    });
  } catch (error) {
    console.error('Get user by ID error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch user'
    });
  }
};

/**
 * Create user (SuperAdmin can assign to any company)
 * POST /api/v1/superadmin/users
 */
const createUser = async (req, res) => {
  try {
    const { name, email, password, role, company_id, status } = req.body;

    // Validation
    if (!name || !email || !password || !role) {
      return res.status(400).json({
        success: false,
        error: 'name, email, password, and role are required'
      });
    }

    // Validate role
    const validRoles = ['SUPERADMIN', 'ADMIN', 'EMPLOYEE', 'CLIENT'];
    if (!validRoles.includes(role.toUpperCase())) {
      return res.status(400).json({
        success: false,
        error: 'Invalid role. Must be SUPERADMIN, ADMIN, EMPLOYEE, or CLIENT'
      });
    }

    // Check if user already exists
    const [existingUsers] = await pool.execute(
      `SELECT id FROM users WHERE email = ? AND is_deleted = 0`,
      [email]
    );

    if (existingUsers.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'User with this email already exists'
      });
    }

    // If company_id is provided, verify company exists
    if (company_id) {
      const [companies] = await pool.execute(
        `SELECT id FROM companies WHERE id = ? AND is_deleted = 0`,
        [company_id]
      );
      if (companies.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Company not found'
        });
      }
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert user
    const [result] = await pool.execute(
      `INSERT INTO users (company_id, name, email, password, role, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        company_id || null,
        name.trim(),
        email.trim().toLowerCase(),
        hashedPassword,
        role.toUpperCase(),
        status || 'Active'
      ]
    );

    // Get created user (without password)
    const [users] = await pool.execute(
      `SELECT 
        u.id,
        u.company_id,
        u.name,
        u.email,
        u.role,
        u.status,
        u.avatar,
        u.phone,
        u.created_at,
        c.name as company_name
      FROM users u
      LEFT JOIN companies c ON u.company_id = c.id
      WHERE u.id = ?`,
      [result.insertId]
    );

    res.status(201).json({
      success: true,
      data: users[0],
      message: 'User created successfully'
    });
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create user'
    });
  }
};

/**
 * Update user
 * PUT /api/v1/superadmin/users/:id
 */
const updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, password, role, company_id, status } = req.body;

    // Check if user exists
    const [existingUsers] = await pool.execute(
      `SELECT id FROM users WHERE id = ? AND is_deleted = 0`,
      [id]
    );

    if (existingUsers.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // If email is being changed, check if new email already exists
    if (email) {
      const [emailCheck] = await pool.execute(
        `SELECT id FROM users WHERE email = ? AND id != ? AND is_deleted = 0`,
        [email.trim().toLowerCase(), id]
      );
      if (emailCheck.length > 0) {
        return res.status(400).json({
          success: false,
          error: 'User with this email already exists'
        });
      }
    }

    // If company_id is provided, verify company exists
    if (company_id) {
      const [companies] = await pool.execute(
        `SELECT id FROM companies WHERE id = ? AND is_deleted = 0`,
        [company_id]
      );
      if (companies.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Company not found'
        });
      }
    }

    // Validate role if provided
    if (role) {
      const validRoles = ['SUPERADMIN', 'ADMIN', 'EMPLOYEE', 'CLIENT'];
      if (!validRoles.includes(role.toUpperCase())) {
        return res.status(400).json({
          success: false,
          error: 'Invalid role. Must be SUPERADMIN, ADMIN, EMPLOYEE, or CLIENT'
        });
      }
    }

    // Build update query dynamically
    const updates = [];
    const params = [];

    if (name) {
      updates.push('name = ?');
      params.push(name.trim());
    }
    if (email) {
      updates.push('email = ?');
      params.push(email.trim().toLowerCase());
    }
    if (password) {
      const hashedPassword = await bcrypt.hash(password, 10);
      updates.push('password = ?');
      params.push(hashedPassword);
    }
    if (role) {
      updates.push('role = ?');
      params.push(role.toUpperCase());
    }
    if (company_id !== undefined) {
      updates.push('company_id = ?');
      params.push(company_id || null);
    }
    if (status) {
      updates.push('status = ?');
      params.push(status);
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No fields to update'
      });
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    params.push(id);

    await pool.execute(
      `UPDATE users SET ${updates.join(', ')} WHERE id = ?`,
      params
    );

    // Get updated user
    const [users] = await pool.execute(
      `SELECT 
        u.id,
        u.company_id,
        u.name,
        u.email,
        u.role,
        u.status,
        u.avatar,
        u.phone,
        u.created_at,
        c.name as company_name
      FROM users u
      LEFT JOIN companies c ON u.company_id = c.id
      WHERE u.id = ?`,
      [id]
    );

    res.json({
      success: true,
      data: users[0],
      message: 'User updated successfully'
    });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update user'
    });
  }
};

/**
 * Delete user (soft delete)
 * DELETE /api/v1/superadmin/users/:id
 */
const deleteUser = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if user exists
    const [users] = await pool.execute(
      `SELECT id FROM users WHERE id = ? AND is_deleted = 0`,
      [id]
    );

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // Soft delete
    await pool.execute(
      `UPDATE users SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [id]
    );

    res.json({
      success: true,
      message: 'User deleted successfully'
    });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete user'
    });
  }
};

/**
 * Get all packages (Super Admin can see all packages)
 * GET /api/v1/superadmin/packages
 */
const getAllPackages = async (req, res) => {
  try {
    const { search = '', status = '' } = req.query;

    let query = `
      SELECT 
        cp.*,
        COUNT(DISTINCT c.id) as companies_count,
        GROUP_CONCAT(DISTINCT c.name ORDER BY c.name SEPARATOR ', ') as assigned_companies
      FROM company_packages cp
      LEFT JOIN companies c ON c.package_id = cp.id AND c.is_deleted = 0
      WHERE cp.is_deleted = 0
    `;
    const queryParams = [];

    if (search) {
      query += ` AND cp.package_name LIKE ?`;
      queryParams.push(`%${search}%`);
    }

    if (status) {
      query += ` AND cp.status = ?`;
      queryParams.push(status);
    }

    // No pagination - return all packages
    query += ` GROUP BY cp.id ORDER BY cp.created_at DESC`;

    const [packages] = await pool.execute(query, queryParams);

    res.json({
      success: true,
      data: packages
    });
  } catch (error) {
    console.error('Get all packages error:', error);
    console.error('Error details:', {
      message: error.message,
      code: error.code,
      sqlState: error.sqlState,
      sqlMessage: error.sqlMessage,
      stack: error.stack
    });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch packages',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      errorCode: error.code,
      sqlMessage: process.env.NODE_ENV === 'development' ? error.sqlMessage : undefined
    });
  }
};

/**
 * Create package
 * POST /api/v1/superadmin/packages
 */
const createPackage = async (req, res) => {
  try {
    const {
      package_name,
      price,
      billing_cycle = 'Monthly',
      features = [],
      status = 'Active',
      company_id = null
    } = req.body;

    if (!package_name || price === undefined || price === null) {
      return res.status(400).json({
        success: false,
        error: 'Package name and price are required'
      });
    }

    // For superadmin packages, company_id should be NULL (system-wide packages)
    // Allow NULL for system-wide packages
    let finalCompanyId = company_id || null;

    const featuresJson = JSON.stringify(Array.isArray(features) ? features : []);

    const [result] = await pool.execute(
      `INSERT INTO company_packages 
        (company_id, package_name, price, billing_cycle, features, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [finalCompanyId, package_name, parseFloat(price), billing_cycle, featuresJson, status]
    );

    const [newPackage] = await pool.execute(
      'SELECT * FROM company_packages WHERE id = ?',
      [result.insertId]
    );

    res.status(201).json({
      success: true,
      data: newPackage[0],
      message: 'Package created successfully'
    });
  } catch (error) {
    console.error('Create package error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create package'
    });
  }
};

/**
 * Update package
 * PUT /api/v1/superadmin/packages/:id
 */
const updatePackage = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      package_name,
      price,
      billing_cycle,
      features,
      status
    } = req.body;

    // Check if package exists
    const [existing] = await pool.execute(
      'SELECT id FROM company_packages WHERE id = ? AND is_deleted = 0',
      [id]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Package not found'
      });
    }

    // Build update query dynamically
    const updates = [];
    const params = [];

    if (package_name !== undefined) {
      updates.push('package_name = ?');
      params.push(package_name);
    }
    if (price !== undefined) {
      updates.push('price = ?');
      params.push(price);
    }
    if (billing_cycle !== undefined) {
      updates.push('billing_cycle = ?');
      params.push(billing_cycle);
    }
    if (features !== undefined) {
      updates.push('features = ?');
      params.push(JSON.stringify(features));
    }
    if (status !== undefined) {
      updates.push('status = ?');
      params.push(status);
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No fields to update'
      });
    }

    updates.push('updated_at = NOW()');
    params.push(id);

    await pool.execute(
      `UPDATE company_packages SET ${updates.join(', ')} WHERE id = ?`,
      params
    );

    const [updatedPackage] = await pool.execute(
      'SELECT * FROM company_packages WHERE id = ?',
      [id]
    );

    res.json({
      success: true,
      data: updatedPackage[0],
      message: 'Package updated successfully'
    });
  } catch (error) {
    console.error('Update package error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update package'
    });
  }
};

/**
 * Delete package (soft delete)
 * DELETE /api/v1/superadmin/packages/:id
 */
const deletePackage = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if package exists
    const [existing] = await pool.execute(
      'SELECT id FROM company_packages WHERE id = ? AND is_deleted = 0',
      [id]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Package not found'
      });
    }

    // Check if package is assigned to any company
    const [companies] = await pool.execute(
      'SELECT COUNT(*) as count FROM companies WHERE package_id = ? AND is_deleted = 0',
      [id]
    );

    if (companies[0].count > 0) {
      return res.status(400).json({
        success: false,
        error: 'Cannot delete package. It is assigned to one or more companies.'
      });
    }

    // Soft delete
    await pool.execute(
      'UPDATE company_packages SET is_deleted = 1, updated_at = NOW() WHERE id = ?',
      [id]
    );

    res.json({
      success: true,
      message: 'Package deleted successfully'
    });
  } catch (error) {
    console.error('Delete package error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete package'
    });
  }
};

/**
 * Get package by ID
 * GET /api/v1/superadmin/packages/:id
 */
const getPackageById = async (req, res) => {
  try {
    const { id } = req.params;

    const [packages] = await pool.execute(
      `SELECT cp.*, COUNT(DISTINCT c.id) as companies_count
       FROM company_packages cp
       LEFT JOIN companies c ON c.package_id = cp.id AND c.is_deleted = 0
       WHERE cp.id = ? AND cp.is_deleted = 0
       GROUP BY cp.id`,
      [id]
    );

    if (packages.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Package not found'
      });
    }

    res.json({
      success: true,
      data: packages[0]
    });
  } catch (error) {
    console.error('Get package by ID error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch package'
    });
  }
};

/**
 * Get billing information
 * GET /api/v1/superadmin/billing
 */
const getBillingInfo = async (req, res) => {
  try {
    const { company_id, start_date, end_date } = req.query;

    let query = `
      SELECT 
        c.id as company_id,
        c.name as company_name,
        cp.package_name,
        cp.price,
        cp.billing_cycle,
        c.created_at as subscription_start,
        COUNT(DISTINCT u.id) as total_users,
        COUNT(DISTINCT cl.id) as total_clients
      FROM companies c
      LEFT JOIN company_packages cp ON c.package_id = cp.id
      LEFT JOIN users u ON c.id = u.company_id AND u.is_deleted = 0
      LEFT JOIN clients cl ON c.id = cl.company_id AND cl.is_deleted = 0
      WHERE c.is_deleted = 0
    `;
    const params = [];

    if (company_id) {
      query += ` AND c.id = ?`;
      params.push(company_id);
    }

    query += ` GROUP BY c.id ORDER BY c.created_at DESC`;

    const [billingData] = await pool.execute(query, params);

    // Calculate totals
    const totals = {
      total_companies: billingData.length,
      total_revenue: billingData.reduce((sum, item) => sum + (parseFloat(item.price) || 0), 0),
      total_users: billingData.reduce((sum, item) => sum + (item.total_users || 0), 0),
      total_clients: billingData.reduce((sum, item) => sum + (item.total_clients || 0), 0)
    };

    res.json({
      success: true,
      data: {
        billing: billingData,
        totals
      }
    });
  } catch (error) {
    console.error('Get billing info error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch billing information'
    });
  }
};

/**
 * Get all offline requests
 * GET /api/v1/superadmin/offline-requests
 */
const getOfflineRequests = async (req, res) => {
  try {
    const { status = '', search = '', company_id = '' } = req.query;

    let whereClause = 'WHERE offline_req.is_deleted = 0';
    const params = [];

    if (status) {
      whereClause += ' AND offline_req.status = ?';
      params.push(status);
    }

    if (search) {
      whereClause += ' AND (offline_req.company_name LIKE ? OR offline_req.request_type LIKE ? OR offline_req.contact_name LIKE ?)';
      const searchPattern = `%${search}%`;
      params.push(searchPattern, searchPattern, searchPattern);
    }

    if (company_id) {
      whereClause += ' AND offline_req.company_id = ?';
      params.push(company_id);
    }

    // No pagination - return all requests
    const [requests] = await pool.execute(
      `SELECT offline_req.*, c.name as company_name_from_db, cp.package_name
       FROM offline_requests offline_req
       LEFT JOIN companies c ON offline_req.company_id = c.id
       LEFT JOIN company_packages cp ON offline_req.package_id = cp.id
       ${whereClause}
       ORDER BY offline_req.created_at DESC`,
      params
    );

    res.json({
      success: true,
      data: requests
    });
  } catch (error) {
    console.error('Get offline requests error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch offline requests'
    });
  }
};

/**
 * Get offline request by ID
 * GET /api/v1/superadmin/offline-requests/:id
 */
const getOfflineRequestById = async (req, res) => {
  try {
    const { id } = req.params;

    const [requests] = await pool.execute(
      `SELECT offline_req.*, c.name as company_name_from_db
       FROM offline_requests offline_req
       LEFT JOIN companies c ON offline_req.company_id = c.id
       WHERE offline_req.id = ? AND offline_req.is_deleted = 0`,
      [id]
    );

    if (requests.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Offline request not found'
      });
    }

    res.json({
      success: true,
      data: requests[0]
    });
  } catch (error) {
    console.error('Get offline request error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch offline request'
    });
  }
};

/**
 * Create offline request
 * POST /api/v1/superadmin/offline-requests
 */
const createOfflineRequest = async (req, res) => {
  try {
    const {
      company_id,
      company_name,
      request_type,
      contact_name,
      contact_email,
      contact_phone,
      amount,
      currency = 'USD',
      payment_method,
      description,
      status = 'Pending',
      notes,
      package_id
    } = req.body;

    // Improved validation with specific error messages
    const missingFields = [];
    if (!company_name || company_name.trim() === '') {
      missingFields.push('company_name');
    }
    if (!request_type || request_type.trim() === '') {
      missingFields.push('request_type');
    }
    if (!contact_name || contact_name.trim() === '') {
      missingFields.push('contact_name');
    }

    if (missingFields.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Missing required fields: ${missingFields.join(', ')}`,
        missing_fields: missingFields
      });
    }

    const [result] = await pool.execute(
      `INSERT INTO offline_requests (
        company_id, package_id, company_name, request_type, contact_name, contact_email,
        contact_phone, amount, currency, payment_method, description,
        status, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [
        company_id || null, package_id || null, company_name, request_type, contact_name, contact_email || null,
        contact_phone || null, amount || null, currency, payment_method || null, description || null,
        status, notes || null
      ]
    );

    const [newRequest] = await pool.execute(
      'SELECT * FROM offline_requests WHERE id = ?',
      [result.insertId]
    );

    res.status(201).json({
      success: true,
      data: newRequest[0],
      message: 'Offline request created successfully'
    });
  } catch (error) {
    console.error('Create offline request error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create offline request'
    });
  }
};

/**
 * Update offline request
 * PUT /api/v1/superadmin/offline-requests/:id
 */
const updateOfflineRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      company_id,
      company_name,
      request_type,
      contact_name,
      contact_email,
      contact_phone,
      amount,
      currency,
      payment_method,
      description,
      status,
      notes,
      package_id
    } = req.body;

    // Check if request exists
    const [existing] = await pool.execute(
      'SELECT id FROM offline_requests WHERE id = ? AND is_deleted = 0',
      [id]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Offline request not found'
      });
    }

    // Build update query
    const updates = [];
    const params = [];

    if (company_id !== undefined) {
      updates.push('company_id = ?');
      params.push(company_id);
    }
    if (company_name !== undefined) {
      updates.push('company_name = ?');
      params.push(company_name);
    }
    if (request_type !== undefined) {
      updates.push('request_type = ?');
      params.push(request_type);
    }
    if (contact_name !== undefined) {
      updates.push('contact_name = ?');
      params.push(contact_name);
    }
    if (contact_email !== undefined) {
      updates.push('contact_email = ?');
      params.push(contact_email);
    }
    if (contact_phone !== undefined) {
      updates.push('contact_phone = ?');
      params.push(contact_phone);
    }
    if (amount !== undefined) {
      updates.push('amount = ?');
      params.push(amount);
    }
    if (currency !== undefined) {
      updates.push('currency = ?');
      params.push(currency);
    }
    if (payment_method !== undefined) {
      updates.push('payment_method = ?');
      params.push(payment_method);
    }
    if (description !== undefined) {
      updates.push('description = ?');
      params.push(description);
    }
    if (status !== undefined) {
      updates.push('status = ?');
      params.push(status);
    }
    if (notes !== undefined) {
      updates.push('notes = ?');
      params.push(notes);
    }
    if (package_id !== undefined) {
      updates.push('package_id = ?');
      params.push(package_id);
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No fields to update'
      });
    }

    updates.push('updated_at = NOW()');
    params.push(id);

    await pool.execute(
      `UPDATE offline_requests SET ${updates.join(', ')} WHERE id = ?`,
      params
    );

    const [updatedRequest] = await pool.execute(
      'SELECT * FROM offline_requests WHERE id = ?',
      [id]
    );

    res.json({
      success: true,
      data: updatedRequest[0],
      message: 'Offline request updated successfully'
    });
  } catch (error) {
    console.error('Update offline request error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update offline request'
    });
  }
};

/**
 * Accept company request and create company
 * POST /api/v1/superadmin/offline-requests/:id/accept
 */
const acceptCompanyRequest = async (req, res) => {
  try {
    const { id } = req.params;

    // Get request details
    const [requests] = await pool.execute(
      `SELECT * FROM offline_requests WHERE id = ? AND is_deleted = 0`,
      [id]
    );

    if (requests.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Request not found'
      });
    }

    const request = requests[0];

    if (request.request_type !== 'Company Request') {
      return res.status(400).json({
        success: false,
        error: 'This endpoint is only for Company Request type'
      });
    }

    if (request.status === 'Approved' || request.status === 'Completed') {
      return res.status(400).json({
        success: false,
        error: 'Request already processed'
      });
    }

    // Create company
    const [companyResult] = await pool.execute(
      `INSERT INTO companies 
        (name, industry, website, address, notes, currency, timezone, package_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [
        request.company_name,
        null, // industry
        null, // website
        null, // address
        request.description || null, // notes
        'USD', // currency
        'UTC', // timezone
        request.package_id || null // package_id
      ]
    );

    const companyId = companyResult.insertId;

    // Update request status and link to company
    await pool.execute(
      `UPDATE offline_requests 
       SET status = 'Approved', company_id = ?, updated_at = NOW() 
       WHERE id = ?`,
      [companyId, id]
    );

    // Get created company
    const [newCompany] = await pool.execute(
      'SELECT * FROM companies WHERE id = ?',
      [companyId]
    );

    res.json({
      success: true,
      data: {
        company: newCompany[0],
        request: { ...request, status: 'Approved', company_id: companyId }
      },
      message: 'Company request accepted and company created successfully'
    });
  } catch (error) {
    console.error('Accept company request error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to accept company request'
    });
  }
};

/**
 * Reject company request
 * POST /api/v1/superadmin/offline-requests/:id/reject
 */
const rejectCompanyRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const { rejection_reason } = req.body;

    // Get request details
    const [requests] = await pool.execute(
      `SELECT * FROM offline_requests WHERE id = ? AND is_deleted = 0`,
      [id]
    );

    if (requests.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Request not found'
      });
    }

    const request = requests[0];

    if (request.status === 'Approved' || request.status === 'Completed') {
      return res.status(400).json({
        success: false,
        error: 'Request already processed'
      });
    }

    // Update request status
    await pool.execute(
      `UPDATE offline_requests 
       SET status = 'Rejected', notes = ?, updated_at = NOW() 
       WHERE id = ?`,
      [rejection_reason || 'Request rejected', id]
    );

    const [updatedRequest] = await pool.execute(
      'SELECT * FROM offline_requests WHERE id = ?',
      [id]
    );

    res.json({
      success: true,
      data: updatedRequest[0],
      message: 'Company request rejected successfully'
    });
  } catch (error) {
    console.error('Reject company request error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to reject company request'
    });
  }
};

/**
 * Delete offline request (soft delete)
 * DELETE /api/v1/superadmin/offline-requests/:id
 */
const deleteOfflineRequest = async (req, res) => {
  try {
    const { id } = req.params;

    const [existing] = await pool.execute(
      'SELECT id FROM offline_requests WHERE id = ? AND is_deleted = 0',
      [id]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Offline request not found'
      });
    }

    await pool.execute(
      'UPDATE offline_requests SET is_deleted = 1, updated_at = NOW() WHERE id = ?',
      [id]
    );

    res.json({
      success: true,
      message: 'Offline request deleted successfully'
    });
  } catch (error) {
    console.error('Delete offline request error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete offline request'
    });
  }
};

/**
 * Get support tickets (all tickets across all companies)
 * GET /api/v1/superadmin/support-tickets
 */
const getSupportTickets = async (req, res) => {
  try {
    const { status = '', priority = '' } = req.query;

    let query = `
      SELECT 
        t.*,
        c.name as company_name,
        cl.company_name as client_name,
        u.name as assigned_to_name,
        creator.name as created_by_name
      FROM tickets t
      LEFT JOIN companies c ON t.company_id = c.id
      LEFT JOIN clients cl ON t.client_id = cl.id
      LEFT JOIN users u ON t.assigned_to_id = u.id
      LEFT JOIN users creator ON t.created_by = creator.id
      WHERE t.is_deleted = 0
    `;
    const params = [];

    if (status) {
      query += ` AND t.status = ?`;
      params.push(status);
    }

    if (priority) {
      query += ` AND t.priority = ?`;
      params.push(priority);
    }

    // No pagination - return all tickets
    query += ` ORDER BY t.created_at DESC`;

    const [tickets] = await pool.execute(query, params);

    res.json({
      success: true,
      data: tickets
    });
  } catch (error) {
    console.error('Get support tickets error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch support tickets'
    });
  }
};

/**
 * Get system settings
 * GET /api/v1/superadmin/settings
 */
const getSystemSettings = async (req, res) => {
  try {
    // Get settings from system_settings table or return defaults
    const [settings] = await pool.execute(
      `SELECT * FROM system_settings 
       WHERE company_id IS NULL 
       AND (setting_key LIKE 'system_%' OR setting_key LIKE 'email_%' OR setting_key LIKE 'backup_%')`
    );

    const settingsObj = {};
    settings.forEach(setting => {
      settingsObj[setting.setting_key] = setting.setting_value;
    });

    // Default settings if not found
    const defaultSettings = {
      system_name: settingsObj.system_name || 'Worksuite CRM',
      default_currency: settingsObj.default_currency || 'USD',
      default_timezone: settingsObj.default_timezone || 'UTC',
      session_timeout: settingsObj.session_timeout || '30',
      max_file_size: settingsObj.max_file_size || '10',
      allowed_file_types: settingsObj.allowed_file_types || 'pdf,doc,docx,xls,xlsx,jpg,jpeg,png',
      email_from: settingsObj.email_from || 'noreply@worksuite.com',
      email_from_name: settingsObj.email_from_name || 'Worksuite CRM',
      smtp_host: settingsObj.smtp_host || '',
      smtp_port: settingsObj.smtp_port || '587',
      smtp_username: settingsObj.smtp_username || '',
      smtp_password: settingsObj.smtp_password || '',
      backup_frequency: settingsObj.backup_frequency || 'daily',
      enable_audit_log: settingsObj.enable_audit_log === 'true' || true,
    };

    res.json({
      success: true,
      data: defaultSettings
    });
  } catch (error) {
    console.error('Get system settings error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch system settings'
    });
  }
};

/**
 * Update system settings
 * PUT /api/v1/superadmin/settings
 */
const updateSystemSettings = async (req, res) => {
  try {
    const settings = req.body;

    // Update or insert each setting in system_settings table (company_id = NULL for system-wide settings)
    for (const [key, value] of Object.entries(settings)) {
      const settingValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
      
      await pool.execute(
        `INSERT INTO system_settings (company_id, setting_key, setting_value, updated_at)
         VALUES (NULL, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE setting_value = ?, updated_at = NOW()`,
        [key, settingValue, settingValue]
      );
    }

    res.json({
      success: true,
      message: 'System settings updated successfully'
    });
  } catch (error) {
    console.error('Update system settings error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update system settings',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

module.exports = {
  getAllCompanies,
  getCompanyById,
  createCompany,
  updateCompany,
  deleteCompany,
  getSystemStats,
  getAllUsers,
  getUserById,
  createUser,
  updateUser,
  deleteUser,
  getAllPackages,
  getPackageById,
  createPackage,
  updatePackage,
  deletePackage,
  getBillingInfo,
  getOfflineRequests,
  getOfflineRequestById,
  createOfflineRequest,
  updateOfflineRequest,
  deleteOfflineRequest,
  acceptCompanyRequest,
  rejectCompanyRequest,
  getSupportTickets,
  getSystemSettings,
  updateSystemSettings
};

