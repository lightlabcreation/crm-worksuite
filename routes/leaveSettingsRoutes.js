const express = require('express');
const router = express.Router();
const leaveSettingsController = require('../controllers/leaveSettingsController');
const { verifyToken, requireRole, ROLES } = require('../middleware/auth');

// All routes require Admin authentication
router.use(verifyToken);
router.use(requireRole(ROLES.ADMIN));

// ================================================
// LEAVE TYPES ROUTES
// ================================================

// GET /api/leave-settings/leave-types - Get all leave types
router.get('/leave-types', leaveSettingsController.getAllLeaveTypes);

// GET /api/leave-settings/leave-types/:id - Get single leave type
router.get('/leave-types/:id', leaveSettingsController.getLeaveTypeById);

// POST /api/leave-settings/leave-types - Create new leave type
router.post('/leave-types', leaveSettingsController.createLeaveType);

// PUT /api/leave-settings/leave-types/:id - Update leave type
router.put('/leave-types/:id', leaveSettingsController.updateLeaveType);

// DELETE /api/leave-settings/leave-types/:id - Delete leave type
router.delete('/leave-types/:id', leaveSettingsController.deleteLeaveType);

// POST /api/leave-settings/leave-types/:id/archive - Archive leave type
router.post('/leave-types/:id/archive', leaveSettingsController.archiveLeaveType);

// POST /api/leave-settings/leave-types/:id/restore - Restore archived leave type
router.post('/leave-types/:id/restore', leaveSettingsController.restoreLeaveType);

// ================================================
// LEAVE GENERAL SETTINGS ROUTES
// ================================================

// GET /api/leave-settings/general-settings - Get leave general settings
router.get('/general-settings', leaveSettingsController.getGeneralSettings);

// POST /api/leave-settings/general-settings - Update leave general settings
router.post('/general-settings', leaveSettingsController.updateGeneralSettings);

module.exports = router;

