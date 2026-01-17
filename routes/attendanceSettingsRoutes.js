const express = require('express');
const router = express.Router();
const attendanceSettingsController = require('../controllers/attendanceSettingsController');
const { verifyToken, requireRole, ROLES } = require('../middleware/auth');

// All routes require Admin authentication
router.use(verifyToken);
router.use(requireRole(ROLES.ADMIN));

// ================================================
// ATTENDANCE SETTINGS ROUTES
// ================================================

// GET /api/admin/attendance-settings - Get attendance settings
router.get('/', attendanceSettingsController.getAttendanceSettings);

// PUT /api/admin/attendance-settings - Update attendance settings
router.put('/', attendanceSettingsController.updateAttendanceSettings);

// ================================================
// SHIFT ROUTES
// ================================================

// GET /api/admin/attendance-settings/shifts - Get all shifts
router.get('/shifts', attendanceSettingsController.getAllShifts);

// GET /api/admin/attendance-settings/shifts/:id - Get single shift
router.get('/shifts/:id', attendanceSettingsController.getShiftById);

// POST /api/admin/attendance-settings/shifts - Create new shift
router.post('/shifts', attendanceSettingsController.createShift);

// PUT /api/admin/attendance-settings/shifts/:id - Update shift
router.put('/shifts/:id', attendanceSettingsController.updateShift);

// DELETE /api/admin/attendance-settings/shifts/:id - Delete shift
router.delete('/shifts/:id', attendanceSettingsController.deleteShift);

// POST /api/admin/attendance-settings/shifts/:id/set-default - Set default shift
router.post('/shifts/:id/set-default', attendanceSettingsController.setDefaultShift);

// ================================================
// SHIFT ROTATION ROUTES
// ================================================

// GET /api/admin/attendance-settings/shift-rotations - Get all rotations
router.get('/shift-rotations', attendanceSettingsController.getAllRotations);

// POST /api/admin/attendance-settings/shift-rotations - Create rotation
router.post('/shift-rotations', attendanceSettingsController.createRotation);

// DELETE /api/admin/attendance-settings/shift-rotations/:id - Delete rotation
router.delete('/shift-rotations/:id', attendanceSettingsController.deleteRotation);

// POST /api/admin/attendance-settings/shift-rotations/run - Run rotation
router.post('/shift-rotations/run', attendanceSettingsController.runRotation);

module.exports = router;

