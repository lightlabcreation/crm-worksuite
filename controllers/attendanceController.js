const pool = require('../config/db');

// Ensure attendance table exists
const ensureTableExists = async () => {
  try {
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS attendance (
        id INT AUTO_INCREMENT PRIMARY KEY,
        company_id INT NOT NULL,
        user_id INT NOT NULL,
        date DATE NOT NULL,
        check_in TIME,
        check_out TIME,
        status VARCHAR(50) DEFAULT 'Present',
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_user_date (user_id, date),
        INDEX idx_company (company_id),
        INDEX idx_user (user_id),
        INDEX idx_date (date)
      )
    `);
  } catch (error) {
    console.error('Error ensuring attendance table exists:', error);
  }
};

// Call once on module load
ensureTableExists();

const getAll = async (req, res) => {
  try {
    const { user_id, month, year } = req.query;
    
    const companyId = req.query.company_id || req.body.company_id || 1;
    let whereClause = 'WHERE a.company_id = ?';
    const params = [companyId];
    
    // Filter by user_id if provided (for employee dashboard)
    if (user_id) {
      whereClause += ' AND a.user_id = ?';
      params.push(user_id);
    } else if (req.user && req.user.role === 'EMPLOYEE') {
      // For employees, only show their own attendance
      whereClause += ' AND a.user_id = ?';
      params.push(req.userId);
    }
    
    // Filter by month and year if provided
    if (month && year) {
      const monthNum = parseInt(month);
      const yearNum = parseInt(year);
      const startDate = `${yearNum}-${String(monthNum).padStart(2, '0')}-01`;
      const lastDay = new Date(yearNum, monthNum, 0).getDate();
      const endDate = `${yearNum}-${String(monthNum).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
      whereClause += ' AND a.date >= ? AND a.date <= ?';
      params.push(startDate, endDate);
    }

    // Get all attendance without pagination
    const [attendance] = await pool.execute(
      `SELECT 
        a.id,
        a.company_id,
        a.user_id,
        DATE_FORMAT(a.date, '%Y-%m-%d') as date,
        TIME_FORMAT(a.check_in, '%H:%i') as check_in,
        TIME_FORMAT(a.check_out, '%H:%i') as check_out,
        a.status,
        a.notes,
        a.created_at,
        a.updated_at,
        u.name as employee_name,
        u.email as employee_email,
        CASE 
          WHEN a.check_in IS NOT NULL AND a.check_out IS NOT NULL 
          THEN ROUND(TIMESTAMPDIFF(MINUTE, a.check_in, a.check_out) / 60, 1)
          ELSE NULL
        END as total_hours
      FROM attendance a
      LEFT JOIN users u ON a.user_id = u.id
      ${whereClause}
      ORDER BY a.date DESC`,
      params
    );
    res.json({ 
      success: true, 
      data: attendance
    });
  } catch (error) {
    console.error('Get attendance error:', error);
    console.error('Error details:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch attendance' });
  }
};

/**
 * Get monthly calendar attendance
 * GET /api/v1/attendance/calendar?month=12&year=2025
 */
const getMonthlyCalendar = async (req, res) => {
  try {
    const { month, year, user_id, company_id } = req.query;
    const userId = user_id || req.userId;
    const companyId = company_id || req.companyId;
    
    if (!month || !year) {
      return res.status(400).json({
        success: false,
        error: 'Month and year are required'
      });
    }

    if (!companyId || !userId) {
      return res.status(400).json({
        success: false,
        error: 'company_id and user_id are required'
      });
    }

    const monthNum = parseInt(month);
    const yearNum = parseInt(year);
    const startDate = `${yearNum}-${String(monthNum).padStart(2, '0')}-01`;
    const lastDay = new Date(yearNum, monthNum, 0).getDate();
    const endDate = `${yearNum}-${String(monthNum).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    const [attendance] = await pool.execute(
      `SELECT 
        DATE_FORMAT(a.date, '%Y-%m-%d') as date,
        TIME_FORMAT(a.check_in, '%H:%i') as check_in,
        TIME_FORMAT(a.check_out, '%H:%i') as check_out,
        a.status,
        CASE 
          WHEN a.check_in IS NOT NULL AND a.check_out IS NOT NULL 
          THEN ROUND(TIMESTAMPDIFF(MINUTE, a.check_in, a.check_out) / 60, 1)
          ELSE NULL
        END as total_hours
      FROM attendance a
      WHERE a.company_id = ? AND a.user_id = ? AND a.date >= ? AND a.date <= ?
      ORDER BY a.date ASC`,
      [companyId, userId, startDate, endDate]
    );

    // Calculate attendance percentage
    const totalDays = lastDay;
    const presentDays = attendance.filter(a => a.status === 'Present').length;
    const attendancePercentage = totalDays > 0 ? ((presentDays / totalDays) * 100).toFixed(2) : 0;

    res.json({
      success: true,
      data: {
        calendar: attendance,
        attendance_percentage: parseFloat(attendancePercentage),
        total_days: totalDays,
        present_days: presentDays,
        absent_days: totalDays - presentDays
      }
    });
  } catch (error) {
    console.error('Get monthly calendar error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch monthly calendar'
    });
  }
};

/**
 * Get attendance percentage
 * GET /api/v1/attendance/percentage?month=12&year=2025
 */
const getAttendancePercentage = async (req, res) => {
  try {
    const { month, year, user_id, company_id } = req.query;
    const userId = user_id || req.userId;
    const companyId = company_id || req.companyId;
    
    if (!month || !year) {
      return res.status(400).json({
        success: false,
        error: 'Month and year are required'
      });
    }

    if (!companyId || !userId) {
      return res.status(400).json({
        success: false,
        error: 'company_id and user_id are required'
      });
    }

    const monthNum = parseInt(month);
    const yearNum = parseInt(year);
    const startDate = `${yearNum}-${String(monthNum).padStart(2, '0')}-01`;
    const lastDay = new Date(yearNum, monthNum, 0).getDate();
    const endDate = `${yearNum}-${String(monthNum).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    const [stats] = await pool.execute(
      `SELECT 
        COUNT(*) as total_days,
        SUM(CASE WHEN status = 'Present' THEN 1 ELSE 0 END) as present_days,
        SUM(CASE WHEN status = 'Absent' THEN 1 ELSE 0 END) as absent_days,
        SUM(CASE WHEN status = 'Late' THEN 1 ELSE 0 END) as late_days,
        SUM(CASE WHEN status = 'Half Day' THEN 1 ELSE 0 END) as half_days
      FROM attendance
      WHERE company_id = ? AND user_id = ? AND date >= ? AND date <= ?`,
      [companyId, userId, startDate, endDate]
    );

    const totalDays = lastDay;
    const presentDays = stats[0].present_days || 0;
    const attendancePercentage = totalDays > 0 ? ((presentDays / totalDays) * 100).toFixed(2) : 0;

    res.json({
      success: true,
      data: {
        attendance_percentage: parseFloat(attendancePercentage),
        total_days: totalDays,
        present_days: presentDays,
        absent_days: stats[0].absent_days || 0,
        late_days: stats[0].late_days || 0,
        half_days: stats[0].half_days || 0
      }
    });
  } catch (error) {
    console.error('Get attendance percentage error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch attendance percentage'
    });
  }
};

const checkIn = async (req, res) => {
  try {
    const companyId = req.body.company_id || req.query.company_id || req.companyId;
    const userId = req.body.user_id || req.query.user_id || req.userId;
    
    if (!companyId || !userId) {
      return res.status(400).json({
        success: false,
        error: 'company_id and user_id are required'
      });
    }
    
    const today = new Date().toISOString().split('T')[0];
    await pool.execute(
      `INSERT INTO attendance (company_id, user_id, date, check_in, status)
       VALUES (?, ?, ?, NOW(), 'Present')
       ON DUPLICATE KEY UPDATE check_in = NOW(), status = 'Present'`,
      [companyId, userId, today]
    );
    res.json({ success: true, message: 'Checked in successfully' });
  } catch (error) {
    console.error('Check in error:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to check in' });
  }
};

const checkOut = async (req, res) => {
  try {
    const companyId = req.body.company_id || req.query.company_id || req.companyId;
    const userId = req.body.user_id || req.query.user_id || req.userId;
    
    if (!companyId || !userId) {
      return res.status(400).json({
        success: false,
        error: 'company_id and user_id are required'
      });
    }
    
    const today = new Date().toISOString().split('T')[0];
    const currentTime = new Date().toTimeString().split(' ')[0]; // HH:MM:SS format
    
    await pool.execute(
      `UPDATE attendance SET check_out = ? WHERE company_id = ? AND user_id = ? AND date = ?`,
      [currentTime, companyId, userId, today]
    );
    
    // Get the updated record to return hours worked
    const [record] = await pool.execute(
      `SELECT check_in, check_out,
              TIMESTAMPDIFF(MINUTE, check_in, check_out) as total_minutes
       FROM attendance WHERE company_id = ? AND user_id = ? AND date = ?`,
      [companyId, userId, today]
    );
    
    const totalMinutes = record[0]?.total_minutes || 0;
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    
    res.json({ 
      success: true, 
      message: 'Checked out successfully',
      data: {
        check_out: currentTime.substring(0, 5),
        total_hours: `${hours}h ${minutes}m`,
        date: today
      }
    });
  } catch (error) {
    console.error('Check out error:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to check out' });
  }
};

/**
 * Get attendance by ID
 * GET /api/v1/attendance/:id
 */
const getById = async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.query.company_id || req.companyId;
    const userId = req.query.user_id || req.userId;

    if (!companyId) {
      return res.status(400).json({
        success: false,
        error: 'company_id is required'
      });
    }

    let whereClause = 'WHERE a.id = ? AND a.company_id = ?';
    const params = [id, companyId];

    // If user_id is provided, filter by it
    if (userId) {
      whereClause += ' AND a.user_id = ?';
      params.push(userId);
    }

    const [attendance] = await pool.execute(
      `SELECT 
        a.id,
        a.company_id,
        a.user_id,
        a.date,
        a.check_in,
        a.check_out,
        a.status,
        a.notes,
        a.created_at,
        a.updated_at,
        u.name as employee_name,
        u.email as employee_email,
        TIMESTAMPDIFF(HOUR, CONCAT(a.date, ' ', a.check_in), CONCAT(a.date, ' ', COALESCE(a.check_out, NOW()))) as total_hours
      FROM attendance a
      JOIN users u ON a.user_id = u.id
      ${whereClause}`,
      params
    );

    if (attendance.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Attendance record not found'
      });
    }

    res.json({
      success: true,
      data: attendance[0]
    });
  } catch (error) {
    console.error('Get attendance by ID error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch attendance'
    });
  }
};

/**
 * Get today's attendance status
 * GET /api/v1/attendance/today
 */
const getTodayStatus = async (req, res) => {
  try {
    const companyId = req.query.company_id || req.companyId;
    const userId = req.query.user_id || req.userId;

    if (!companyId || !userId) {
      return res.status(400).json({
        success: false,
        error: 'company_id and user_id are required'
      });
    }

    const today = new Date().toISOString().split('T')[0];

    const [attendance] = await pool.execute(
      `SELECT * FROM attendance WHERE company_id = ? AND user_id = ? AND date = ?`,
      [companyId, userId, today]
    );

    if (attendance.length === 0) {
      return res.json({
        success: true,
        data: {
          checked_in: false,
          checked_out: false,
          check_in: null,
          check_out: null
        }
      });
    }

    const record = attendance[0];
    res.json({
      success: true,
      data: {
        checked_in: !!record.check_in,
        checked_out: !!record.check_out,
        check_in: record.check_in,
        check_out: record.check_out,
        status: record.status
      }
    });
  } catch (error) {
    console.error('Get today status error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch today status'
    });
  }
};

module.exports = { 
  getAll, 
  getById,
  checkIn, 
  checkOut, 
  getMonthlyCalendar, 
  getAttendancePercentage,
  getTodayStatus
};

