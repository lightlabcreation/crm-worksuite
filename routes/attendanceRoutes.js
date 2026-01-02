const express = require('express');
const router = express.Router();
const attendanceController = require('../controllers/attendanceController');

// No authentication required - all routes are public
router.get('/calendar', attendanceController.getMonthlyCalendar);
router.get('/percentage', attendanceController.getAttendancePercentage);
router.get('/today', attendanceController.getTodayStatus);
router.get('/', attendanceController.getAll);
router.get('/:id', attendanceController.getById);
router.post('/check-in', attendanceController.checkIn);
router.post('/check-out', attendanceController.checkOut);

module.exports = router;

