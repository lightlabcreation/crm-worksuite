// =====================================================
// Authentication Middleware
// =====================================================

const jwt = require('jsonwebtoken');
const pool = require('../config/db');

/**
 * Verify JWT token
 */
const verifyToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'No token provided. Authorization header must be: Bearer <token>'
      });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'No token provided'
      });
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Get user from database
    const [users] = await pool.execute(
      'SELECT id, company_id, name, email, role, status FROM users WHERE id = ? AND is_deleted = 0',
      [decoded.userId]
    );

    if (users.length === 0) {
      return res.status(401).json({
        success: false,
        error: 'Invalid token. User not found.'
      });
    }

    const user = users[0];

    if (user.status !== 'Active') {
      return res.status(403).json({
        success: false,
        error: 'User account is inactive'
      });
    }

    // Attach user to request
    req.user = user;
    req.userId = user.id;
    req.companyId = user.company_id;

    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        error: 'Invalid token'
      });
    }
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: 'Token expired'
      });
    }

    console.error('Auth middleware error:', error);
    return res.status(500).json({
      success: false,
      error: 'Authentication error'
    });
  }
};

/**
 * Require specific role(s)
 * @param {string|string[]} roles - Role(s) allowed
 */
const requireRole = (roles) => {
  const allowedRoles = Array.isArray(roles) ? roles : [roles];

  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: `Access denied. Required role: ${allowedRoles.join(' or ')}`
      });
    }

    next();
  };
};

/**
 * Optional authentication - doesn't fail if no token
 * Sets default companyId if not provided (for faster API calls without token)
 */
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const [users] = await pool.execute(
          'SELECT id, company_id, name, email, role, status FROM users WHERE id = ? AND is_deleted = 0',
          [decoded.userId]
        );

        if (users.length > 0 && users[0].status === 'Active') {
          req.user = users[0];
          req.userId = users[0].id;
          req.companyId = users[0].company_id;
        }
      } catch (error) {
        // Token invalid, but continue without auth
      }
    }

    // Set default companyId if not provided (for faster API calls)
    // Use company_id from query or default to 1
    if (!req.companyId) {
      req.companyId = req.query.company_id || req.body.company_id || 1;
    }
    
    // Set default userId if not provided
    if (!req.userId) {
      req.userId = req.query.user_id || req.body.user_id || null;
    }

    next();
  } catch (error) {
    // Set defaults even on error
    if (!req.companyId) {
      req.companyId = req.query.company_id || req.body.company_id || 1;
    }
    next();
  }
};

module.exports = {
  verifyToken,
  requireRole,
  optionalAuth
};

