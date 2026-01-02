// =====================================================
// Dashboard Routes
// =====================================================

const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboardController');

// ===== SINGLE COMPREHENSIVE DASHBOARD API =====
// GET /api/v1/dashboard - Returns ALL dashboard data in ONE response
router.get('/', dashboardController.getCompleteDashboard);

// Todo endpoints
router.post('/todo', dashboardController.saveTodo);
router.put('/todo/:id', dashboardController.updateTodo);
router.delete('/todo/:id', dashboardController.deleteTodo);

// Sticky note endpoint
router.post('/sticky-note', dashboardController.saveStickyNote);

// Legacy endpoints (for backward compatibility)
router.get('/admin', dashboardController.getAdminDashboard);
router.get('/employee', dashboardController.getEmployeeDashboard);
router.get('/client', dashboardController.getClientDashboard);
router.get('/client/work', dashboardController.getClientWork);
router.get('/client/finance', dashboardController.getClientFinance);
router.get('/client/announcements', dashboardController.getClientAnnouncements);
router.get('/client/activity', dashboardController.getClientActivity);

module.exports = router;

