const express = require('express');
const router = express.Router();
const reportController = require('../controllers/reportController');

// No authentication required - all routes are public
router.get('/sales', reportController.getSalesReport);
router.get('/revenue', reportController.getRevenueReport);
router.get('/projects', reportController.getProjectStatusReport);
router.get('/employees', reportController.getEmployeePerformanceReport);
router.get('/summary', reportController.getReportsSummary);

module.exports = router;

