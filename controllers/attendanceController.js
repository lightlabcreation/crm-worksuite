const pool = require('../config/db');

/**
 * Get all attendance records
 * GET /api/v1/attendance
 */
const getAll = async (req, res) => {
  try {
    const {
      company_id,
      employee_id,
      department_id,
      position_id,
      month,
      year,
      date_from,
      date_to
    } = req.query;

    const filterCompanyId = company_id || req.companyId;

    if (!filterCompanyId) {
      return res.status(400).json({
        success: false,
        error: 'company_id is required'
      });
    }

    let whereClause = 'WHERE a.company_id = ? AND a.is_deleted = 0';
    const params = [filterCompanyId];

    if (employee_id) {
      whereClause += ' AND a.employee_id = ?';
      params.push(employee_id);
    }

    if (department_id) {
      whereClause += ' AND e.department_id = ?';
      params.push(department_id);
    }

    if (position_id) {
      whereClause += ' AND e.position_id = ?';
      params.push(position_id);
    }

    if (month && year) {
      whereClause += ' AND MONTH(a.date) = ? AND YEAR(a.date) = ?';
      params.push(month, year);
    } else if (date_from && date_to) {
      whereClause += ' AND a.date BETWEEN ? AND ?';
      params.push(date_from, date_to);
    }

    const [attendance] = await pool.execute(
      `SELECT a.*,
              u.name as employee_name,
              u.email as employee_email,
              e.employee_number,
              d.name as department_name,
              p.name as position_name
       FROM attendance a
       JOIN employees e ON a.employee_id = e.id
       JOIN users u ON e.user_id = u.id
       LEFT JOIN departments d ON e.department_id = d.id
       LEFT JOIN positions p ON e.position_id = p.id
       ${whereClause}
       ORDER BY a.date DESC, u.name ASC`,
      params
    );

    res.json({
      success: true,
      data: attendance
    });
  } catch (error) {
    console.error('Get attendance error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch attendance records'
    });
  }
};

/**
 * Get attendance summary by month
 * GET /api/v1/attendance/summary
 */
const getSummary = async (req, res) => {
  try {
    const { company_id, month, year, department_id, position_id } = req.query;
    const filterCompanyId = company_id || req.companyId;

    if (!filterCompanyId || !month || !year) {
      return res.status(400).json({
        success: false,
        error: 'company_id, month, and year are required'
      });
    }

    // Get all employees
    let employeeWhere = 'WHERE u.company_id = ? AND u.is_deleted = 0';
    const employeeParams = [filterCompanyId];

    if (department_id) {
      employeeWhere += ' AND e.department_id = ?';
      employeeParams.push(department_id);
    }

    if (position_id) {
      employeeWhere += ' AND e.position_id = ?';
      employeeParams.push(position_id);
    }

    const [employees] = await pool.execute(
      `SELECT e.id as employee_id, e.user_id, e.employee_number,
              u.name, d.name as department_name, p.name as position_name
       FROM employees e
       JOIN users u ON e.user_id = u.id
       LEFT JOIN departments d ON e.department_id = d.id
       LEFT JOIN positions p ON e.position_id = p.id
       ${employeeWhere}
       ORDER BY u.name ASC`,
      employeeParams
    );

    // Get attendance for the month
    const [attendance] = await pool.execute(
      `SELECT a.employee_id, a.date, a.status
       FROM attendance a
       WHERE a.company_id = ? 
         AND MONTH(a.date) = ? 
         AND YEAR(a.date) = ?
         AND a.is_deleted = 0`,
      [filterCompanyId, month, year]
    );

    // Build attendance map
    const attendanceMap = {};
    attendance.forEach(record => {
      const key = `${record.employee_id}_${record.date.toISOString().split('T')[0]}`;
      attendanceMap[key] = record.status;
    });

    // Calculate days in month
    const daysInMonth = new Date(year, month, 0).getDate();

    // Build summary for each employee
    const summary = employees.map(emp => {
      const days = {};
      for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const key = `${emp.employee_id}_${dateStr}`;
        days[day] = attendanceMap[key] || null;
      }
      return {
        ...emp,
        attendance: days
      };
    });

    res.json({
      success: true,
      data: summary,
      meta: {
        month: parseInt(month),
        year: parseInt(year),
        daysInMonth
      }
    });
  } catch (error) {
    console.error('Get attendance summary error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch attendance summary'
    });
  }
};

/**
 * Create or update attendance (Mark Attendance)
 * POST /api/v1/attendance
 */
const markAttendance = async (req, res) => {
  try {
    const {
      company_id,
      employee_id,
      date,
      status,
      clock_in,
      clock_out,
      late_reason,
      work_from,
      notes
    } = req.body;

    const finalCompanyId = company_id || req.companyId;
    const markedBy = req.userId;

    if (!finalCompanyId || !employee_id || !date || !status) {
      return res.status(400).json({
        success: false,
        error: 'company_id, employee_id, date, and status are required'
      });
    }

    // Get user_id from employee
    const [empCheck] = await pool.execute(
      `SELECT user_id FROM employees WHERE id = ?`,
      [employee_id]
    );

    if (empCheck.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Employee not found'
      });
    }

    const userId = empCheck[0].user_id;

    // Check if attendance exists for this date
    const [existing] = await pool.execute(
      `SELECT id FROM attendance WHERE employee_id = ? AND date = ? AND is_deleted = 0`,
      [employee_id, date]
    );

    if (existing.length > 0) {
      // Update existing
      await pool.execute(
        `UPDATE attendance 
         SET status = ?, clock_in = ?, clock_out = ?, late_reason = ?, 
             work_from = ?, notes = ?, marked_by = ?, updated_at = NOW()
         WHERE id = ?`,
        [status, clock_in || null, clock_out || null, late_reason || null,
          work_from || 'office', notes || null, markedBy || null, existing[0].id]
      );

      res.json({
        success: true,
        message: 'Attendance updated successfully',
        data: { id: existing[0].id }
      });
    } else {
      // Create new - try simpler query first
      console.log('Creating new attendance record:', {
        company_id: finalCompanyId,
        employee_id,
        user_id: userId,
        date,
        status
      });

      // Check if user_id column exists
      let insertQuery;
      let insertParams;

      try {
        const [colCheck] = await pool.execute(
          `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'attendance' AND COLUMN_NAME = 'user_id'`
        );

        if (colCheck.length > 0) {
          // user_id column exists
          insertQuery = `INSERT INTO attendance 
           (company_id, employee_id, user_id, date, status, clock_in, clock_out, 
            late_reason, work_from, notes, marked_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
          insertParams = [finalCompanyId, employee_id, userId, date, status,
            clock_in || null, clock_out || null, late_reason || null,
            work_from || 'office', notes || null, markedBy || null];
        } else {
          // No user_id column
          insertQuery = `INSERT INTO attendance 
           (company_id, employee_id, date, status, clock_in, clock_out, 
            late_reason, work_from, notes, marked_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
          insertParams = [finalCompanyId, employee_id, date, status,
            clock_in || null, clock_out || null, late_reason || null,
            work_from || 'office', notes || null, markedBy || null];
        }

        const [result] = await pool.execute(insertQuery, insertParams);

        res.status(201).json({
          success: true,
          message: 'Attendance marked successfully',
          data: { id: result.insertId }
        });
      } catch (insertError) {
        console.error('Insert error details:', insertError);
        throw insertError;
      }
    }
  } catch (error) {
    console.error('Mark attendance error:', error);
    console.error('Error details:', {
      message: error.message,
      code: error.code,
      sql: error.sql,
      sqlMessage: error.sqlMessage,
      stack: error.stack
    });
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({
        success: false,
        error: 'Attendance already exists for this date'
      });
    }
    res.status(500).json({
      success: false,
      error: 'Failed to mark attendance',
      details: error.message
    });
  }
};

/**
 * Bulk mark attendance
 * POST /api/v1/attendance/bulk
 */
const bulkMarkAttendance = async (req, res) => {
  try {
    const { company_id, records } = req.body;
    const finalCompanyId = company_id || req.companyId;
    const markedBy = req.userId;

    if (!finalCompanyId || !records || !Array.isArray(records)) {
      return res.status(400).json({
        success: false,
        error: 'company_id and records array are required'
      });
    }

    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      let successCount = 0;
      let errorCount = 0;

      for (const record of records) {
        try {
          const { employee_id, date, status } = record;

          // Get user_id from employee
          const [empCheck] = await connection.execute(
            `SELECT user_id FROM employees WHERE id = ?`,
            [employee_id]
          );

          if (empCheck.length === 0) {
            errorCount++;
            continue;
          }

          const userId = empCheck[0].user_id;

          // Upsert attendance
          await connection.execute(
            `INSERT INTO attendance (company_id, employee_id, user_id, date, status, marked_by)
             VALUES (?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE status = VALUES(status), marked_by = VALUES(marked_by), updated_at = NOW()`,
            [finalCompanyId, employee_id, userId, date, status, markedBy]
          );

          successCount++;
        } catch (err) {
          errorCount++;
        }
      }

      await connection.commit();

      res.json({
        success: true,
        message: `Attendance marked: ${successCount} success, ${errorCount} errors`,
        data: { successCount, errorCount }
      });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('Bulk mark attendance error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to bulk mark attendance'
    });
  }
};

/**
 * Get attendance by ID
 * GET /api/v1/attendance/:id
 */
const getById = async (req, res) => {
  try {
    const { id } = req.params;

    const [records] = await pool.execute(
      `SELECT a.*,
              u.name as employee_name,
              e.employee_number,
              d.name as department_name,
              p.name as position_name
       FROM attendance a
       JOIN employees e ON a.employee_id = e.id
       JOIN users u ON e.user_id = u.id
       LEFT JOIN departments d ON e.department_id = d.id
       LEFT JOIN positions p ON e.position_id = p.id
       WHERE a.id = ? AND a.is_deleted = 0`,
      [id]
    );

    if (records.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Attendance record not found'
      });
    }

    res.json({
      success: true,
      data: records[0]
    });
  } catch (error) {
    console.error('Get attendance by ID error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch attendance record'
    });
  }
};

/**
 * Delete attendance
 * DELETE /api/v1/attendance/:id
 */
const deleteAttendance = async (req, res) => {
  try {
    const { id } = req.params;

    const [result] = await pool.execute(
      `UPDATE attendance SET is_deleted = 1 WHERE id = ?`,
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        error: 'Attendance record not found'
      });
    }

    res.json({
      success: true,
      message: 'Attendance record deleted successfully'
    });
  } catch (error) {
    console.error('Delete attendance error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete attendance record'
    });
  }
};

/**
 * Get employee attendance for a specific month
 * GET /api/v1/attendance/employee/:employeeId
 */
const getEmployeeAttendance = async (req, res) => {
  try {
    const { employeeId } = req.params;
    const { month, year } = req.query;

    if (!month || !year) {
      return res.status(400).json({
        success: false,
        error: 'month and year are required'
      });
    }

    const [attendance] = await pool.execute(
      `SELECT a.*, 
              u.name as employee_name,
              e.employee_number
       FROM attendance a
       JOIN employees e ON a.employee_id = e.id
       JOIN users u ON e.user_id = u.id
       WHERE a.employee_id = ? 
         AND MONTH(a.date) = ? 
         AND YEAR(a.date) = ?
         AND a.is_deleted = 0
       ORDER BY a.date ASC`,
      [employeeId, month, year]
    );

    // Build day-wise map
    const daysInMonth = new Date(year, month, 0).getDate();
    const dayMap = {};

    for (let day = 1; day <= daysInMonth; day++) {
      dayMap[day] = null;
    }

    attendance.forEach(record => {
      const day = new Date(record.date).getDate();
      dayMap[day] = record;
    });

    res.json({
      success: true,
      data: attendance,
      summary: dayMap,
      meta: {
        month: parseInt(month),
        year: parseInt(year),
        daysInMonth,
        totalPresent: attendance.filter(a => a.status === 'present').length,
        totalAbsent: attendance.filter(a => a.status === 'absent').length,
        totalLate: attendance.filter(a => a.status === 'late').length,
        totalHalfDay: attendance.filter(a => a.status === 'half_day').length,
        totalLeave: attendance.filter(a => a.status === 'on_leave').length
      }
    });
  } catch (error) {
    console.error('Get employee attendance error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch employee attendance'
    });
  }
};

module.exports = {
  getAll,
  getSummary,
  markAttendance,
  bulkMarkAttendance,
  getById,
  deleteAttendance,
  getEmployeeAttendance
};
