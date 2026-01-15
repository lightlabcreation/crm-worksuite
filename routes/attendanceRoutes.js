const express = require('express');
const router = express.Router();
const attendanceController = require('../controllers/attendanceController');

// Get all attendance records
router.get('/', attendanceController.getAll);

// Get attendance summary (calendar view)
router.get('/summary', attendanceController.getSummary);

// Get employee attendance for a month
router.get('/employee/:employeeId', attendanceController.getEmployeeAttendance);

// Get attendance by ID
router.get('/:id', attendanceController.getById);

// Mark attendance (create or update)
router.post('/', attendanceController.markAttendance);

// Bulk mark attendance
router.post('/bulk', attendanceController.bulkMarkAttendance);

// Delete attendance
router.delete('/:id', attendanceController.deleteAttendance);

module.exports = router;
