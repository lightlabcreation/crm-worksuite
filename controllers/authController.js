// =====================================================
// Authentication Controller
// =====================================================

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');

/**
 * Login user
 * POST /api/v1/auth/login
 */
const login = async (req, res) => {
  try {
    const { email, password, role } = req.body;

    console.log('Login attempt - email:', email, 'role:', role);

    // Validation
    if (!email || !password) {
      console.error('Login failed - email or password missing');
      return res.status(400).json({
        success: false,
        error: 'Email and password are required'
      });
    }

    if (!role) {
      console.error('Login failed - role missing');
      return res.status(400).json({
        success: false,
        error: 'Role is required (SUPERADMIN, ADMIN, EMPLOYEE, or CLIENT)'
      });
    }

    // Normalize role to uppercase for comparison
    const normalizedRole = role.toUpperCase();
    console.log('Normalized role:', normalizedRole);

    // Get user from database
    const [users] = await pool.execute(
      `SELECT id, company_id, name, email, password, role, status 
       FROM users 
       WHERE email = ? AND UPPER(role) = ? AND is_deleted = 0`,
      [email, normalizedRole]
    );

    if (users.length === 0) {
      // Check if user exists but with different role
      const [checkUser] = await pool.execute(
        `SELECT role FROM users WHERE email = ? AND is_deleted = 0`,
        [email]
      );
      
      if (checkUser.length > 0) {
        return res.status(401).json({
          success: false,
          error: `User exists but role mismatch. Expected: ${normalizedRole}, Found: ${checkUser[0].role}`
        });
      }
      
      return res.status(401).json({
        success: false,
        error: 'Invalid email, password, or role'
      });
    }

    const user = users[0];

    // Check if user is active
    if (user.status !== 'Active') {
      return res.status(403).json({
        success: false,
        error: 'User account is inactive'
      });
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        error: 'Invalid email, password, or role'
      });
    }

    // Generate JWT token
    const token = jwt.sign(
      { 
        userId: user.id,
        companyId: user.company_id,
        role: user.role 
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRE || '24h' }
    );

    // Remove password from response
    delete user.password;

    // Get company name if company_id exists
    let company_name = null;
    if (user.company_id) {
      try {
        const [companies] = await pool.execute(
          `SELECT name FROM companies WHERE id = ? AND is_deleted = 0`,
          [user.company_id]
        );
        if (companies.length > 0) {
          company_name = companies[0].name;
          console.log('Company name fetched:', company_name, 'for company_id:', user.company_id);
        } else {
          console.warn('Company not found for company_id:', user.company_id);
        }
      } catch (err) {
        console.error('Error fetching company name:', err);
      }
    } else {
      console.log('No company_id for user:', user.id);
    }

    // For CLIENT users, get their client_id from the clients table
    let client_id = null;
    if (normalizedRole === 'CLIENT') {
      try {
        const [clients] = await pool.execute(
          `SELECT id FROM clients WHERE owner_id = ? AND is_deleted = 0 LIMIT 1`,
          [user.id]
        );
        if (clients.length > 0) {
          client_id = clients[0].id;
          console.log('Client ID fetched:', client_id, 'for user_id:', user.id);
        } else {
          console.warn('No client record found for user_id:', user.id);
        }
      } catch (err) {
        console.error('Error fetching client ID:', err);
      }
    }

    const responseData = {
      success: true,
      token,
      user: {
        id: user.id,
        company_id: user.company_id,
        client_id: client_id,
        name: user.name,
        email: user.email,
        role: user.role,
        company_name: company_name
      }
    };

    console.log('Login successful - user:', user.email, 'company_id:', user.company_id, 'company_name:', company_name);
    res.json(responseData);
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      error: 'Login failed. Please try again.'
    });
  }
};

/**
 * Logout user (optional - mainly for token blacklisting in future)
 * POST /api/v1/auth/logout
 */
const logout = async (req, res) => {
  try {
    // In a production app, you might want to blacklist the token here
    // For now, we'll just return success
    res.json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({
      success: false,
      error: 'Logout failed'
    });
  }
};

/**
 * Get current user
 * GET /api/v1/auth/me
 */
const getCurrentUser = async (req, res) => {
  try {
    // Get userId from JWT token (req.userId set by auth middleware) or from query/body
    // DO NOT default to 1 - this was causing the bug!
    const userId = req.userId || req.query.user_id || req.body.user_id;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'User ID is required. Please login again.'
      });
    }
    
    console.log('getCurrentUser - userId:', userId);
    
    const [users] = await pool.execute(
      `SELECT u.id, u.company_id, u.name, u.email, u.role, u.status, u.avatar, u.phone, u.address,
              u.emergency_contact_name, u.emergency_contact_phone, u.emergency_contact_relation,
              u.bank_name, u.bank_account_number, u.bank_ifsc, u.bank_branch,
              u.billing_address, u.billing_city, u.billing_state, u.billing_country, u.billing_postal_code,
              u.created_at,
              e.department_id, e.position_id,
              d.name as department_name,
              p.name as position_name,
              c.name as company_name
       FROM users u
       LEFT JOIN employees e ON u.id = e.user_id
       LEFT JOIN departments d ON e.department_id = d.id
       LEFT JOIN positions p ON e.position_id = p.id
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

    const user = users[0];
    
    // For CLIENT users, get their client_id from the clients table
    let client_id = null;
    if (user.role && user.role.toUpperCase() === 'CLIENT') {
      try {
        const [clients] = await pool.execute(
          `SELECT id FROM clients WHERE owner_id = ? AND is_deleted = 0 LIMIT 1`,
          [user.id]
        );
        if (clients.length > 0) {
          client_id = clients[0].id;
        }
      } catch (err) {
        console.error('Error fetching client ID:', err);
      }
    }
    
    // Format response
    const userData = {
      id: user.id,
      company_id: user.company_id,
      client_id: client_id,
      name: user.name,
      email: user.email,
      role: user.role,
      status: user.status,
      avatar: user.avatar,
      phone: user.phone,
      address: user.address,
      emergency_contact_name: user.emergency_contact_name,
      emergency_contact_phone: user.emergency_contact_phone,
      emergency_contact_relation: user.emergency_contact_relation,
      bank_name: user.bank_name,
      bank_account_number: user.bank_account_number,
      bank_ifsc: user.bank_ifsc,
      bank_branch: user.bank_branch,
      billing_address: user.billing_address,
      billing_city: user.billing_city,
      billing_state: user.billing_state,
      billing_country: user.billing_country,
      billing_postal_code: user.billing_postal_code,
      department_id: user.department_id,
      department: user.department_name,
      position_id: user.position_id,
      position: user.position_name,
      company_name: user.company_name,
      created_at: user.created_at
    };

    res.json({
      success: true,
      data: userData
    });
  } catch (error) {
    console.error('Get current user error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get user information'
    });
  }
};

/**
 * Update current user profile
 * PUT /api/v1/auth/me
 */
const updateCurrentUser = async (req, res) => {
  try {
    const { 
      name, email, phone, address,
      emergency_contact_name, emergency_contact_phone, emergency_contact_relation,
      bank_name, bank_account_number, bank_ifsc, bank_branch,
      billing_address, billing_city, billing_state, billing_country, billing_postal_code
    } = req.body;

    // Build update fields
    const updateFields = [];
    const updateValues = [];

    if (name !== undefined) {
      updateFields.push('name = ?');
      updateValues.push(name);
    }
    if (email !== undefined) {
      const userId = req.query.user_id || req.body.user_id || 1;
      const companyId = req.query.company_id || req.body.company_id || 1;
      // Check if email already exists for another user
      const [existingUsers] = await pool.execute(
        `SELECT id FROM users WHERE email = ? AND id != ? AND company_id = ?`,
        [email, userId, companyId]
      );
      if (existingUsers.length > 0) {
        return res.status(400).json({
          success: false,
          error: 'Email already exists'
        });
      }
      updateFields.push('email = ?');
      updateValues.push(email);
    }
    if (phone !== undefined) {
      updateFields.push('phone = ?');
      updateValues.push(phone || null);
    }
    if (address !== undefined) {
      updateFields.push('address = ?');
      updateValues.push(address || null);
    }
    if (emergency_contact_name !== undefined) {
      updateFields.push('emergency_contact_name = ?');
      updateValues.push(emergency_contact_name || null);
    }
    if (emergency_contact_phone !== undefined) {
      updateFields.push('emergency_contact_phone = ?');
      updateValues.push(emergency_contact_phone || null);
    }
    if (emergency_contact_relation !== undefined) {
      updateFields.push('emergency_contact_relation = ?');
      updateValues.push(emergency_contact_relation || null);
    }
    if (bank_name !== undefined) {
      updateFields.push('bank_name = ?');
      updateValues.push(bank_name || null);
    }
    if (bank_account_number !== undefined) {
      updateFields.push('bank_account_number = ?');
      updateValues.push(bank_account_number || null);
    }
    if (bank_ifsc !== undefined) {
      updateFields.push('bank_ifsc = ?');
      updateValues.push(bank_ifsc || null);
    }
    if (bank_branch !== undefined) {
      updateFields.push('bank_branch = ?');
      updateValues.push(bank_branch || null);
    }
    if (billing_address !== undefined) {
      updateFields.push('billing_address = ?');
      updateValues.push(billing_address || null);
    }
    if (billing_city !== undefined) {
      updateFields.push('billing_city = ?');
      updateValues.push(billing_city || null);
    }
    if (billing_state !== undefined) {
      updateFields.push('billing_state = ?');
      updateValues.push(billing_state || null);
    }
    if (billing_country !== undefined) {
      updateFields.push('billing_country = ?');
      updateValues.push(billing_country || null);
    }
    if (billing_postal_code !== undefined) {
      updateFields.push('billing_postal_code = ?');
      updateValues.push(billing_postal_code || null);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No fields to update'
      });
    }

    updateValues.push(userId);

    await pool.execute(
      `UPDATE users SET ${updateFields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      updateValues
    );

    // Get updated user
    const [users] = await pool.execute(
      `SELECT u.id, u.company_id, u.name, u.email, u.role, u.status, u.avatar, u.phone, u.address,
              u.emergency_contact_name, u.emergency_contact_phone, u.emergency_contact_relation,
              u.bank_name, u.bank_account_number, u.bank_ifsc, u.bank_branch, u.created_at,
              e.department_id, e.position_id,
              d.name as department_name,
              p.name as position_name
       FROM users u
       LEFT JOIN employees e ON u.id = e.user_id
       LEFT JOIN departments d ON e.department_id = d.id
       LEFT JOIN positions p ON e.position_id = p.id
       WHERE u.id = ? AND u.is_deleted = 0`,
      [userId]
    );

    const user = users[0];
    const userData = {
      id: user.id,
      company_id: user.company_id,
      name: user.name,
      email: user.email,
      role: user.role,
      status: user.status,
      avatar: user.avatar,
      phone: user.phone,
      address: user.address,
      emergency_contact_name: user.emergency_contact_name,
      emergency_contact_phone: user.emergency_contact_phone,
      emergency_contact_relation: user.emergency_contact_relation,
      bank_name: user.bank_name,
      bank_account_number: user.bank_account_number,
      bank_ifsc: user.bank_ifsc,
      bank_branch: user.bank_branch,
      department_id: user.department_id,
      department: user.department_name,
      position_id: user.position_id,
      position: user.position_name,
      created_at: user.created_at
    };

    res.json({
      success: true,
      data: userData,
      message: 'Profile updated successfully'
    });
  } catch (error) {
    console.error('Update current user error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update profile'
    });
  }
};

/**
 * Change password
 * PUT /api/v1/auth/change-password
 */
const changePassword = async (req, res) => {
  try {
    const { current_password, new_password, user_id } = req.body;
    const userId = user_id || req.query.user_id || 1;

    if (!current_password || !new_password) {
      return res.status(400).json({
        success: false,
        error: 'Current password and new password are required'
      });
    }

    if (new_password.length < 6) {
      return res.status(400).json({
        success: false,
        error: 'New password must be at least 6 characters long'
      });
    }

    // Get current user password
    const [users] = await pool.execute(
      `SELECT password FROM users WHERE id = ? AND is_deleted = 0`,
      [userId]
    );

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // Verify current password
    const isPasswordValid = await bcrypt.compare(current_password, users[0].password);
    if (!isPasswordValid) {
      return res.status(400).json({
        success: false,
        error: 'Current password is incorrect'
      });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(new_password, 10);

    // Update password
    await pool.execute(
      `UPDATE users SET password = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [hashedPassword, userId]
    );

    res.json({
      success: true,
      message: 'Password changed successfully'
    });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to change password'
    });
  }
};

module.exports = {
  login,
  logout,
  getCurrentUser,
  updateCurrentUser,
  changePassword
};

