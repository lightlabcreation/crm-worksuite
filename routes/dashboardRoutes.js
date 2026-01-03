// =====================================================
// Dashboard Routes
// =====================================================

const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboardController');
const { verifyToken, requireRole, ROLES } = require('../middleware/auth');

// All dashboard routes require authentication
router.use(verifyToken);

// ===== ROLE-BASED DASHBOARD APIs =====

// SuperAdmin Dashboard - Access to ALL data across system
router.get('/superadmin', requireRole(ROLES.SUPERADMIN), dashboardController.getSuperAdminDashboard);

// Admin Dashboard - Access to company data only
router.get('/admin', requireRole([ROLES.SUPERADMIN, ROLES.ADMIN]), dashboardController.getAdminDashboard);

// Employee Dashboard - Access to own data only
router.get('/employee', requireRole([ROLES.SUPERADMIN, ROLES.ADMIN, ROLES.EMPLOYEE]), dashboardController.getEmployeeDashboard);

// Client Dashboard - Access to own data only
router.get('/client', requireRole([ROLES.SUPERADMIN, ROLES.ADMIN, ROLES.CLIENT]), dashboardController.getClientDashboard);
router.get('/client/work', requireRole([ROLES.SUPERADMIN, ROLES.ADMIN, ROLES.CLIENT]), dashboardController.getClientWork);
router.get('/client/finance', requireRole([ROLES.SUPERADMIN, ROLES.ADMIN, ROLES.CLIENT]), dashboardController.getClientFinance);
router.get('/client/announcements', requireRole([ROLES.SUPERADMIN, ROLES.ADMIN, ROLES.CLIENT]), dashboardController.getClientAnnouncements);
router.get('/client/activity', requireRole([ROLES.SUPERADMIN, ROLES.ADMIN, ROLES.CLIENT]), dashboardController.getClientActivity);

// Generic dashboard - redirects based on role
router.get('/', dashboardController.getCompleteDashboard);

// Todo endpoints (user-specific)
router.post('/todo', dashboardController.saveTodo);
router.put('/todo/:id', dashboardController.updateTodo);
router.delete('/todo/:id', dashboardController.deleteTodo);

// Sticky note endpoint (user-specific)
router.post('/sticky-note', dashboardController.saveStickyNote);

module.exports = router;

