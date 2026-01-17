/**
 * Module Settings Routes
 * Controls sidebar menu visibility for Client and Employee dashboards
 */

const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const {
  getModuleSettings,
  updateModuleSettings,
  resetModuleSettings,
} = require('../controllers/moduleSettingsController');

// All routes require authentication
router.use(verifyToken);

// GET /api/v1/module-settings - Get module settings for company
router.get('/', getModuleSettings);

// PUT /api/v1/module-settings - Update module settings
router.put('/', updateModuleSettings);

// POST /api/v1/module-settings/reset - Reset to defaults
router.post('/reset', resetModuleSettings);

module.exports = router;

