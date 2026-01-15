const pool = require('../config/db');
const bcrypt = require('bcryptjs');

const getAll = async (req, res) => {
  try {
    const { status, department } = req.query;

    // Admin must provide company_id - required for filtering
    const filterCompanyId = req.query.company_id || req.body.company_id || req.companyId;

    if (!filterCompanyId) {
      return res.status(400).json({
        success: false,
        error: 'company_id is required'
      });
    }

    let whereClause = 'WHERE u.company_id = ? AND u.is_deleted = 0';
    const params = [filterCompanyId];

    if (status) {
      whereClause += ' AND u.status = ?';
      params.push(status);
    }
    if (department) {
      whereClause += ' AND e.department_id = ?';
      params.push(department);
    }

    console.log('=== GET EMPLOYEES REQUEST ===');
    console.log('Query params:', req.query);
    console.log('Filter company_id:', filterCompanyId);
    console.log('req.companyId:', req.companyId);
    console.log('Where clause:', whereClause);
    console.log('Params:', params);

    // Get all employees without pagination
    const [employees] = await pool.execute(
      `SELECT e.*, 
              u.name, u.email, u.phone, u.address, u.country, u.email_notifications, u.role as user_role, u.status,
              u.company_id,
              c.name as company_name,
              d.name as department_name, 
              p.name as position_name
       FROM employees e
       JOIN users u ON e.user_id = u.id
       LEFT JOIN companies c ON u.company_id = c.id
       LEFT JOIN departments d ON e.department_id = d.id
       LEFT JOIN positions p ON e.position_id = p.id
       ${whereClause}
       ORDER BY e.created_at DESC`,
      params
    );

    console.log('Total employees found:', employees.length);
    console.log('Employees:', JSON.stringify(employees, null, 2));

    res.json({
      success: true,
      data: employees
    });
  } catch (error) {
    console.error('Get employees error:', error);
    console.error('Error details:', {
      message: error.message,
      code: error.code,
      sqlState: error.sqlState,
      sqlMessage: error.sqlMessage
    });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch employees',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Create employee
 * POST /api/v1/employees
 */
const create = async (req, res) => {
  try {
    const {
      name, email, phone, password, role,
      company_id, department_id, position_id,
      employee_number, joining_date, salary, address, status
    } = req.body;

    console.log('=== CREATE EMPLOYEE REQUEST ===');
    console.log('Request body:', JSON.stringify(req.body, null, 2));

    // Validation
    if (!name || !email) {
      return res.status(400).json({
        success: false,
        error: 'Name and Email are required'
      });
    }

    // Use company_id from request body, fallback to req.companyId
    const finalCompanyId = company_id || req.companyId;

    if (!finalCompanyId) {
      return res.status(400).json({
        success: false,
        error: 'Company is required'
      });
    }

    // Check if user already exists
    const [existingUsers] = await pool.execute(
      `SELECT id FROM users WHERE email = ?`,
      [email]
    );

    if (existingUsers.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'User with this email already exists'
      });
    }

    // Generate default password if not provided
    const defaultPassword = password || Math.random().toString(36).slice(-8) + Math.random().toString(36).slice(-8).toUpperCase() + '123';

    // Start transaction
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      // Create user first
      const hashedPassword = await bcrypt.hash(defaultPassword, 10);
      const [userResult] = await connection.execute(
        `INSERT INTO users (company_id, name, email, phone, address, country, email_notifications, password, role, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          finalCompanyId,
          name,
          email,
          phone || null,
          address || null,
          req.body.country || null,
          req.body.email_notifications !== undefined ? req.body.email_notifications : 1,
          hashedPassword,
          role || 'EMPLOYEE',
          status || 'Active'
        ]
      );

      const userId = userResult.insertId;

      // Generate employee number if not provided
      let empNumber = employee_number;
      if (!empNumber) {
        const [countResult] = await connection.execute(
          `SELECT COUNT(*) as count FROM employees e
           JOIN users u ON e.user_id = u.id
           WHERE u.company_id = ?`,
          [finalCompanyId]
        );
        empNumber = `EMP-${String(countResult[0].count + 1).padStart(4, '0')}`;
      }

      // Create employee record
      const [employeeResult] = await connection.execute(
        `INSERT INTO employees (
          user_id, employee_number, department_id, position_id, role, joining_date, salary,
          salutation, date_of_birth, gender, reporting_to, language, about, hourly_rate, 
          slack_member_id, skills, probation_end_date, notice_period_start_date, 
          notice_period_end_date, employment_type, marital_status, business_address
        )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          userId,
          empNumber,
          department_id || null,
          position_id || null,
          role || null,
          joining_date || null,
          salary || null,
          req.body.salutation || null,
          req.body.date_of_birth || null,
          req.body.gender || 'Male',
          req.body.reporting_to || null,
          req.body.language || 'en',
          req.body.about || null,
          req.body.hourly_rate || null,
          req.body.slack_member_id || null,
          req.body.skills || null,
          req.body.probation_end_date || null,
          req.body.notice_period_start_date || null,
          req.body.notice_period_end_date || null,
          req.body.employment_type || 'Full Time',
          req.body.marital_status || 'Single',
          req.body.business_address || null
        ]
      );

      await connection.commit();

      // Get created employee with user details
      const [employees] = await pool.execute(
        `SELECT e.*, 
                u.name, u.email, u.phone, u.address, u.role as user_role, u.status,
                u.company_id,
                c.name as company_name,
                d.name as department_name, 
                p.name as position_name
         FROM employees e
         JOIN users u ON e.user_id = u.id
         LEFT JOIN companies c ON u.company_id = c.id
         LEFT JOIN departments d ON e.department_id = d.id
         LEFT JOIN positions p ON e.position_id = p.id
         WHERE e.id = ?`,
        [employeeResult.insertId]
      );

      console.log('Created employee:', JSON.stringify(employees[0], null, 2));

      res.status(201).json({
        success: true,
        data: employees[0],
        message: 'Employee created successfully'
      });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('Create employee error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to create employee',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

/**
 * Get employee by ID
 * GET /api/v1/employees/:id
 */
const getById = async (req, res) => {
  try {
    const { id } = req.params;

    const [employees] = await pool.execute(
      `SELECT e.*,
              u.name, u.email, u.phone, u.address, u.country, u.email_notifications, u.role as user_role, u.status, u.avatar,
              u.company_id,
              c.name as company_name,
              d.name as department_name,
              p.name as position_name,
              s.name as shift_name,
              u2.name as reporting_to_name
       FROM employees e
       JOIN users u ON e.user_id = u.id
       LEFT JOIN companies c ON u.company_id = c.id
       LEFT JOIN departments d ON e.department_id = d.id
       LEFT JOIN positions p ON e.position_id = p.id
       LEFT JOIN shifts s ON e.shift_id = s.id
       LEFT JOIN users u2 ON e.reporting_to = u2.id
       WHERE e.id = ? AND u.is_deleted = 0`,
      [id]
    );

    if (employees.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Employee not found'
      });
    }

    res.json({
      success: true,
      data: employees[0]
    });
  } catch (error) {
    console.error('Get employee by ID error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch employee'
    });
  }
};

/**
 * Update employee
 * PUT /api/v1/employees/:id
 */
const update = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name, email, phone, address,
      company_id, department_id, position_id,
      employee_number, joining_date, salary, role, status
    } = req.body;

    console.log('=== UPDATE EMPLOYEE REQUEST ===');
    console.log('Employee ID:', id);
    console.log('Request body:', JSON.stringify(req.body, null, 2));

    // Get employee to find user_id
    const [existingEmployees] = await pool.execute(
      `SELECT e.user_id, u.company_id FROM employees e
       JOIN users u ON e.user_id = u.id
       WHERE e.id = ? AND u.is_deleted = 0`,
      [id]
    );

    if (existingEmployees.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Employee not found'
      });
    }

    const userId = existingEmployees[0].user_id;
    const currentCompanyId = existingEmployees[0].company_id;

    // Start transaction
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      // Update user fields
      const userUpdateFields = [];
      const userUpdateValues = [];

      if (name !== undefined) {
        userUpdateFields.push('name = ?');
        userUpdateValues.push(name);
      }
      if (email !== undefined) {
        // Check if email already exists for another user
        const [emailCheck] = await connection.execute(
          `SELECT id FROM users WHERE email = ? AND id != ?`,
          [email, userId]
        );
        if (emailCheck.length > 0) {
          await connection.rollback();
          return res.status(400).json({
            success: false,
            error: 'Email already exists for another user'
          });
        }
        userUpdateFields.push('email = ?');
        userUpdateValues.push(email);
      }
      if (phone !== undefined) {
        userUpdateFields.push('phone = ?');
        userUpdateValues.push(phone || null);
      }
      if (address !== undefined) {
        userUpdateFields.push('address = ?');
        userUpdateValues.push(address || null);
      }
      if (company_id !== undefined) {
        userUpdateFields.push('company_id = ?');
        userUpdateValues.push(company_id);
      }
      if (role !== undefined) {
        userUpdateFields.push('role = ?');
        userUpdateValues.push(role);
      }
      if (status !== undefined) {
        userUpdateFields.push('status = ?');
        userUpdateValues.push(status);
      }
      if (req.body.country !== undefined) {
        userUpdateFields.push('country = ?');
        userUpdateValues.push(req.body.country);
      }
      if (req.body.email_notifications !== undefined) {
        userUpdateFields.push('email_notifications = ?');
        userUpdateValues.push(req.body.email_notifications);
      }

      if (userUpdateFields.length > 0) {
        userUpdateValues.push(userId);
        await connection.execute(
          `UPDATE users SET ${userUpdateFields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          userUpdateValues
        );
      }

      // Update employee fields
      const empUpdateFields = [];
      const empUpdateValues = [];

      if (department_id !== undefined) {
        empUpdateFields.push('department_id = ?');
        empUpdateValues.push(department_id || null);
      }
      if (position_id !== undefined) {
        empUpdateFields.push('position_id = ?');
        empUpdateValues.push(position_id || null);
      }
      if (employee_number !== undefined) {
        empUpdateFields.push('employee_number = ?');
        empUpdateValues.push(employee_number || null);
      }
      if (joining_date !== undefined) {
        empUpdateFields.push('joining_date = ?');
        // Convert ISO date string to MySQL date format
        let formattedDate = null;
        if (joining_date) {
          formattedDate = joining_date.split('T')[0];
        }
        empUpdateValues.push(formattedDate);
      }
      if (salary !== undefined) {
        empUpdateFields.push('salary = ?');
        empUpdateValues.push(salary || null);
      }
      if (role !== undefined) {
        empUpdateFields.push('role = ?');
        empUpdateValues.push(role || null);
      }

      // New fields update
      const newFields = [
        'salutation', 'date_of_birth', 'gender', 'reporting_to', 'language', 'about',
        'hourly_rate', 'slack_member_id', 'skills', 'probation_end_date',
        'notice_period_start_date', 'notice_period_end_date', 'employment_type',
        'marital_status', 'business_address', 'contract_end_date', 'shift_id'
      ];

      newFields.forEach(field => {
        if (req.body[field] !== undefined) {
          empUpdateFields.push(`${field} = ?`);
          empUpdateValues.push(req.body[field] === '' ? null : req.body[field]);
        }
      });

      if (empUpdateFields.length > 0) {
        empUpdateValues.push(id);
        await connection.execute(
          `UPDATE employees SET ${empUpdateFields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          empUpdateValues
        );
      }

      await connection.commit();

      // Get updated employee
      const [updatedEmployees] = await pool.execute(
        `SELECT e.*, 
                u.name, u.email, u.phone, u.address, u.role as user_role, u.status,
                u.company_id,
                c.name as company_name,
                d.name as department_name, 
                p.name as position_name
         FROM employees e
         JOIN users u ON e.user_id = u.id
         LEFT JOIN companies c ON u.company_id = c.id
         LEFT JOIN departments d ON e.department_id = d.id
         LEFT JOIN positions p ON e.position_id = p.id
         WHERE e.id = ?`,
        [id]
      );

      res.json({
        success: true,
        data: updatedEmployees[0],
        message: 'Employee updated successfully'
      });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('Update employee error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to update employee'
    });
  }
};

/**
 * Delete employee (soft delete)
 * DELETE /api/v1/employees/:id
 */
const deleteEmployee = async (req, res) => {
  try {
    const { id } = req.params;

    // Get user_id from employee
    const [employees] = await pool.execute(
      `SELECT e.user_id FROM employees e
       JOIN users u ON e.user_id = u.id
       WHERE e.id = ? AND u.is_deleted = 0`,
      [id]
    );

    if (employees.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Employee not found'
      });
    }

    const userId = employees[0].user_id;

    // Soft delete user (which will cascade to employee via foreign key)
    await pool.execute(
      `UPDATE users SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [userId]
    );

    res.json({
      success: true,
      message: 'Employee deleted successfully'
    });
  } catch (error) {
    console.error('Delete employee error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete employee'
    });
  }
};

/**
 * Get employee profile by user_id (for employee dashboard)
 * GET /api/v1/employees/profile
 */
const getProfile = async (req, res) => {
  try {
    const userId = req.query.user_id || req.body.user_id || req.userId;
    const companyId = req.query.company_id || req.body.company_id || req.companyId;

    console.log('GET /employees/profile - userId:', userId, 'companyId:', companyId);

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'user_id is required'
      });
    }

    const [employees] = await pool.execute(
      `SELECT e.*, 
              u.name, u.email, u.phone, u.address, u.role as user_role, u.status, u.avatar,
              u.company_id,
              u.emergency_contact_name,
              u.emergency_contact_phone,
              u.emergency_contact_relation,
              u.bank_name,
              u.bank_account_number,
              u.bank_ifsc,
              u.bank_branch,
              c.name as company_name,
              d.name as department_name, 
              p.name as position_name
       FROM employees e
       JOIN users u ON e.user_id = u.id
       LEFT JOIN companies c ON u.company_id = c.id
       LEFT JOIN departments d ON e.department_id = d.id
       LEFT JOIN positions p ON e.position_id = p.id
       WHERE e.user_id = ? AND u.is_deleted = 0`,
      [userId]
    );

    if (employees.length === 0) {
      // Return user info even if no employee record exists
      const [users] = await pool.execute(
        `SELECT u.*, c.name as company_name
         FROM users u
         LEFT JOIN companies c ON u.company_id = c.id
         WHERE u.id = ? AND u.is_deleted = 0`,
        [userId]
      );

      if (users.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'User not found'
        });
      }

      return res.json({
        success: true,
        data: users[0]
      });
    }

    res.json({
      success: true,
      data: employees[0]
    });
  } catch (error) {
    console.error('Get employee profile error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch employee profile'
    });
  }
};

/**
 * Update employee profile (for employee dashboard)
 * PUT /api/v1/employees/profile
 */
const updateProfile = async (req, res) => {
  try {
    const userId = req.query.user_id || req.body.user_id || req.userId;
    const companyId = req.query.company_id || req.body.company_id || req.companyId;
    const {
      name, email, phone, address, avatar,
      emergency_contact_name, emergency_contact_phone, emergency_contact_relation,
      bank_name, bank_account_number, bank_ifsc, bank_branch
    } = req.body;

    console.log('PUT /employees/profile - userId:', userId, 'body:', req.body);

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'user_id is required'
      });
    }

    // Check if user exists
    const [users] = await pool.execute(
      `SELECT id FROM users WHERE id = ? AND is_deleted = 0`,
      [userId]
    );

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // Build update query for user
    const userUpdateFields = [];
    const userUpdateValues = [];

    if (name !== undefined) {
      userUpdateFields.push('name = ?');
      userUpdateValues.push(name);
    }
    if (email !== undefined) {
      // Check if email already exists for another user
      const [emailCheck] = await pool.execute(
        `SELECT id FROM users WHERE email = ? AND id != ?`,
        [email, userId]
      );
      if (emailCheck.length > 0) {
        return res.status(400).json({
          success: false,
          error: 'Email already exists for another user'
        });
      }
      userUpdateFields.push('email = ?');
      userUpdateValues.push(email);
    }
    if (phone !== undefined) {
      userUpdateFields.push('phone = ?');
      userUpdateValues.push(phone || null);
    }
    if (address !== undefined) {
      userUpdateFields.push('address = ?');
      userUpdateValues.push(address || null);
    }
    if (avatar !== undefined) {
      userUpdateFields.push('avatar = ?');
      userUpdateValues.push(avatar || null);
    }
    if (emergency_contact_name !== undefined) {
      userUpdateFields.push('emergency_contact_name = ?');
      userUpdateValues.push(emergency_contact_name || null);
    }
    if (emergency_contact_phone !== undefined) {
      userUpdateFields.push('emergency_contact_phone = ?');
      userUpdateValues.push(emergency_contact_phone || null);
    }
    if (emergency_contact_relation !== undefined) {
      userUpdateFields.push('emergency_contact_relation = ?');
      userUpdateValues.push(emergency_contact_relation || null);
    }
    if (bank_name !== undefined) {
      userUpdateFields.push('bank_name = ?');
      userUpdateValues.push(bank_name || null);
    }
    if (bank_account_number !== undefined) {
      userUpdateFields.push('bank_account_number = ?');
      userUpdateValues.push(bank_account_number || null);
    }
    if (bank_ifsc !== undefined) {
      userUpdateFields.push('bank_ifsc = ?');
      userUpdateValues.push(bank_ifsc || null);
    }
    if (bank_branch !== undefined) {
      userUpdateFields.push('bank_branch = ?');
      userUpdateValues.push(bank_branch || null);
    }

    if (userUpdateFields.length > 0) {
      userUpdateFields.push('updated_at = CURRENT_TIMESTAMP');
      userUpdateValues.push(userId);

      await pool.execute(
        `UPDATE users SET ${userUpdateFields.join(', ')} WHERE id = ?`,
        userUpdateValues
      );
    }

    // Fetch updated profile
    const [employees] = await pool.execute(
      `SELECT e.*, 
              u.name, u.email, u.phone, u.address, u.role as user_role, u.status, u.avatar,
              u.company_id,
              u.emergency_contact_name,
              u.emergency_contact_phone,
              u.emergency_contact_relation,
              u.bank_name,
              u.bank_account_number,
              u.bank_ifsc,
              u.bank_branch,
              c.name as company_name,
              d.name as department_name, 
              p.name as position_name
       FROM employees e
       JOIN users u ON e.user_id = u.id
       LEFT JOIN companies c ON u.company_id = c.id
       LEFT JOIN departments d ON e.department_id = d.id
       LEFT JOIN positions p ON e.position_id = p.id
       WHERE e.user_id = ?`,
      [userId]
    );

    let responseData;
    if (employees.length === 0) {
      const [updatedUsers] = await pool.execute(
        `SELECT u.*, c.name as company_name
         FROM users u
         LEFT JOIN companies c ON u.company_id = c.id
         WHERE u.id = ?`,
        [userId]
      );
      responseData = updatedUsers[0];
    } else {
      responseData = employees[0];
    }

    res.json({
      success: true,
      data: responseData,
      message: 'Profile updated successfully'
    });
  } catch (error) {
    console.error('Update employee profile error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to update employee profile'
    });
  }
};

/**
 * Get employee dashboard stats
 * GET /api/v1/employees/dashboard
 */
const getDashboardStats = async (req, res) => {
  try {
    const userId = req.query.user_id || req.body.user_id || req.userId;
    const companyId = req.query.company_id || req.body.company_id || req.companyId;

    console.log('GET /employees/dashboard - userId:', userId, 'companyId:', companyId);

    if (!userId || !companyId) {
      return res.status(400).json({
        success: false,
        error: 'user_id and company_id are required'
      });
    }

    const today = new Date().toISOString().split('T')[0];
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];

    // Helper function for safe query execution
    const safeQuery = async (query, params, defaultValue = 0) => {
      try {
        const [result] = await pool.execute(query, params);
        return result;
      } catch (err) {
        console.log('Query skipped (table may not exist or column error):', err.code, err.sqlMessage);
        return [{ total: defaultValue, total_hours: defaultValue, total_days: 0, present_days: 0 }];
      }
    };

    // Execute queries with error handling - Tasks
    const tasksCount = await safeQuery(
      `SELECT COUNT(*) as total FROM tasks t
       LEFT JOIN task_assignees ta ON t.id = ta.task_id
       WHERE t.company_id = ? AND t.is_deleted = 0 
       AND (t.assigned_to = ? OR ta.user_id = ?)`,
      [companyId, userId, userId]
    );

    const pendingTasks = await safeQuery(
      `SELECT COUNT(*) as total FROM tasks t
       LEFT JOIN task_assignees ta ON t.id = ta.task_id
       WHERE t.company_id = ? AND t.is_deleted = 0 
       AND t.status NOT IN ('Completed', 'Done')
       AND (t.assigned_to = ? OR ta.user_id = ?)`,
      [companyId, userId, userId]
    );

    const completedTasks = await safeQuery(
      `SELECT COUNT(*) as total FROM tasks t
       LEFT JOIN task_assignees ta ON t.id = ta.task_id
       WHERE t.company_id = ? AND t.is_deleted = 0 
       AND t.status IN ('Completed', 'Done')
       AND (t.assigned_to = ? OR ta.user_id = ?)`,
      [companyId, userId, userId]
    );

    // Projects - count projects where user has assigned tasks
    const projectsCount = await safeQuery(
      `SELECT COUNT(DISTINCT t.project_id) as total FROM tasks t
       LEFT JOIN task_assignees ta ON t.id = ta.task_id
       WHERE ta.user_id = ? AND t.company_id = ? AND t.is_deleted = 0 AND t.project_id IS NOT NULL`,
      [userId, companyId]
    );

    const activeProjects = await safeQuery(
      `SELECT COUNT(DISTINCT t.project_id) as total FROM tasks t
       LEFT JOIN task_assignees ta ON t.id = ta.task_id
       LEFT JOIN projects p ON t.project_id = p.id
       WHERE ta.user_id = ? AND t.company_id = ? AND t.is_deleted = 0 
       AND t.project_id IS NOT NULL AND p.is_deleted = 0 
       AND LOWER(p.status) = 'in progress'`,
      [userId, companyId]
    );

    // Time logs - using 'date' column as per timeTrackingController
    const timeLogsWeek = await safeQuery(
      `SELECT COALESCE(SUM(hours), 0) as total_hours FROM time_logs
       WHERE user_id = ? AND company_id = ? AND date >= ? AND is_deleted = 0`,
      [userId, companyId, weekAgo]
    );

    // Attendance - using 'date', 'status' as per attendanceController
    const attendanceMonth = await safeQuery(
      `SELECT 
         COUNT(*) as total_days,
         SUM(CASE WHEN status = 'Present' OR check_in IS NOT NULL THEN 1 ELSE 0 END) as present_days
       FROM attendance
       WHERE user_id = ? AND company_id = ? AND date >= ?`,
      [userId, companyId, monthStart]
    );

    // Leave requests - get employee_id first then query
    let leaveRequestsCount = 0;
    try {
      const [empResult] = await pool.execute(
        `SELECT id FROM employees WHERE user_id = ?`,
        [userId]
      );
      if (empResult.length > 0) {
        const employeeId = empResult[0].id;
        const leaveResult = await safeQuery(
          `SELECT COUNT(*) as total FROM leave_requests
           WHERE employee_id = ? AND company_id = ? AND is_deleted = 0`,
          [employeeId, companyId]
        );
        leaveRequestsCount = leaveResult[0]?.total || 0;
      }
    } catch (err) {
      console.log('Leave requests query error:', err.message);
    }

    // Upcoming events
    const upcomingEvents = await safeQuery(
      `SELECT COUNT(*) as total FROM events
       WHERE company_id = ? AND starts_on_date >= ? AND is_deleted = 0`,
      [companyId, today]
    );

    // Unread messages
    const unreadMessages = await safeQuery(
      `SELECT COUNT(*) as total FROM messages
       WHERE to_user_id = ? AND company_id = ? AND is_read = 0 AND is_deleted = 0`,
      [userId, companyId]
    );

    // My Documents count
    const documentsCount = await safeQuery(
      `SELECT COUNT(*) as total FROM documents
       WHERE company_id = ? AND uploaded_by = ? AND is_deleted = 0`,
      [companyId, userId]
    );

    // Calculate attendance percentage
    const totalDays = attendanceMonth[0]?.total_days || 0;
    const presentDays = attendanceMonth[0]?.present_days || 0;
    const attendancePercentage = totalDays > 0 ? Math.round((presentDays / totalDays) * 100) : 0;

    res.json({
      success: true,
      data: {
        my_tasks: tasksCount[0]?.total || 0,
        pending_tasks: pendingTasks[0]?.total || 0,
        completed_tasks: completedTasks[0]?.total || 0,
        my_projects: projectsCount[0]?.total || 0,
        active_projects: activeProjects[0]?.total || 0,
        time_logged_this_week: parseFloat(timeLogsWeek[0]?.total_hours) || 0,
        attendance_percentage: attendancePercentage,
        leave_requests: leaveRequestsCount,
        upcoming_events: upcomingEvents[0]?.total || 0,
        unread_messages: unreadMessages[0]?.total || 0,
        my_documents: documentsCount[0]?.total || 0
      }
    });
  } catch (error) {
    console.error('Get employee dashboard stats error:', error);
    console.error('Error details:', error.sqlMessage || error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch dashboard statistics',
      details: process.env.NODE_ENV === 'development' ? error.sqlMessage || error.message : undefined
    });
  }
};

module.exports = { getAll, getById, create, update, deleteEmployee, getProfile, updateProfile, getDashboardStats };

