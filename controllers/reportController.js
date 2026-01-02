// =====================================================
// Report Controller - All Dynamic Data from Database
// =====================================================

const pool = require('../config/db');

/**
 * Get Sales Report - Dynamic data from invoices table
 * GET /api/v1/reports/sales
 */
const getSalesReport = async (req, res) => {
  try {
    const { start_date, end_date, company_id, client_id, employee_id, user_id } = req.query;
    const filterCompanyId = company_id || req.companyId || 1;
    
    let whereClause = 'WHERE i.company_id = ?';
    const params = [filterCompanyId];
    
    if (client_id) {
      whereClause += ' AND i.client_id = ?';
      params.push(client_id);
    }
    
    if (employee_id || user_id) {
      whereClause += ' AND i.created_by = ?';
      params.push(employee_id || user_id);
    }
    
    if (start_date) {
      whereClause += ' AND DATE(i.created_at) >= ?';
      params.push(start_date);
    }
    
    if (end_date) {
      whereClause += ' AND DATE(i.created_at) <= ?';
      params.push(end_date);
    }
    
    // Get sales data grouped by month from real invoice data
    const [sales] = await pool.execute(
      `SELECT 
        DATE_FORMAT(i.created_at, '%Y-%m') as month,
        DATE_FORMAT(i.created_at, '%b') as month_name,
        COUNT(*) as count,
        COALESCE(SUM(i.total), 0) as revenue,
        COALESCE(SUM(CASE WHEN i.status IN ('Paid', 'Fully Paid') THEN i.total ELSE i.paid END), 0) as paid,
        COALESCE(SUM(CASE WHEN i.status NOT IN ('Paid', 'Fully Paid') THEN i.total - COALESCE(i.paid, 0) ELSE 0 END), 0) as unpaid
       FROM invoices i
       ${whereClause}
       GROUP BY DATE_FORMAT(i.created_at, '%Y-%m'), DATE_FORMAT(i.created_at, '%b')
       ORDER BY month DESC
       LIMIT 12`,
      params
    );
    
    console.log('Sales Report Query Result:', sales);
    
    res.json({
      success: true,
      data: sales,
      total: {
        revenue: sales.reduce((sum, s) => sum + parseFloat(s.revenue || 0), 0),
        paid: sales.reduce((sum, s) => sum + parseFloat(s.paid || 0), 0),
        unpaid: sales.reduce((sum, s) => sum + parseFloat(s.unpaid || 0), 0),
        count: sales.reduce((sum, s) => sum + parseInt(s.count || 0), 0)
      }
    });
  } catch (error) {
    console.error('Get sales report error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch sales report'
    });
  }
};

/**
 * Get Revenue Report - Dynamic data from invoices table
 * GET /api/v1/reports/revenue
 */
const getRevenueReport = async (req, res) => {
  try {
    const { start_date, end_date, company_id, client_id, employee_id, user_id, period = 'monthly' } = req.query;
    const filterCompanyId = company_id || req.companyId || 1;
    
    let whereClause = 'WHERE i.company_id = ?';
    const params = [filterCompanyId];
    
    if (client_id) {
      whereClause += ' AND i.client_id = ?';
      params.push(client_id);
    }
    
    if (employee_id || user_id) {
      whereClause += ' AND i.created_by = ?';
      params.push(employee_id || user_id);
    }
    
    if (start_date) {
      whereClause += ' AND DATE(i.created_at) >= ?';
      params.push(start_date);
    }
    
    if (end_date) {
      whereClause += ' AND DATE(i.created_at) <= ?';
      params.push(end_date);
    }
    
    let groupBy = '';
    let selectPeriod = '';
    if (period === 'quarterly') {
      groupBy = `QUARTER(i.created_at), YEAR(i.created_at)`;
      selectPeriod = 'CONCAT("Q", QUARTER(i.created_at), " ", YEAR(i.created_at)) as period';
    } else if (period === 'yearly') {
      groupBy = `YEAR(i.created_at)`;
      selectPeriod = 'CAST(YEAR(i.created_at) AS CHAR) as period';
    } else {
      groupBy = `DATE_FORMAT(i.created_at, '%Y-%m')`;
      selectPeriod = 'DATE_FORMAT(i.created_at, "%b %Y") as period';
    }
    
    const [revenue] = await pool.execute(
      `SELECT 
        ${selectPeriod},
        COALESCE(SUM(i.total), 0) as total_revenue,
        COALESCE(SUM(CASE WHEN i.status IN ('Paid', 'Fully Paid') THEN i.total ELSE i.paid END), 0) as total_paid,
        COALESCE(SUM(CASE WHEN i.status NOT IN ('Paid', 'Fully Paid') THEN i.total - COALESCE(i.paid, 0) ELSE 0 END), 0) as total_unpaid,
        COUNT(*) as invoice_count
       FROM invoices i
       ${whereClause}
       GROUP BY ${groupBy}
       ORDER BY MIN(i.created_at) DESC
       LIMIT 12`,
      params
    );
    
    console.log('Revenue Report Query Result:', revenue);
    
    res.json({
      success: true,
      data: revenue,
      total: {
        revenue: revenue.reduce((sum, r) => sum + parseFloat(r.total_revenue || 0), 0),
        paid: revenue.reduce((sum, r) => sum + parseFloat(r.total_paid || 0), 0),
        unpaid: revenue.reduce((sum, r) => sum + parseFloat(r.total_unpaid || 0), 0),
        invoices: revenue.reduce((sum, r) => sum + parseInt(r.invoice_count || 0), 0)
      }
    });
  } catch (error) {
    console.error('Get revenue report error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch revenue report'
    });
  }
};

/**
 * Get Project Status Report - Dynamic data from projects table
 * GET /api/v1/reports/projects
 */
const getProjectStatusReport = async (req, res) => {
  try {
    const { company_id, client_id, employee_id, user_id, start_date, end_date } = req.query;
    const filterCompanyId = company_id || req.companyId || 1;
    
    let whereClause = 'WHERE p.company_id = ?';
    const params = [filterCompanyId];
    
    if (client_id) {
      whereClause += ' AND p.client_id = ?';
      params.push(client_id);
    }
    
    if (start_date) {
      whereClause += ' AND DATE(p.created_at) >= ?';
      params.push(start_date);
    }
    
    if (end_date) {
      whereClause += ' AND DATE(p.created_at) <= ?';
      params.push(end_date);
    }
    
    // Get project count by status
    const [status] = await pool.execute(
      `SELECT 
        COALESCE(p.status, 'Not Started') as status,
        COUNT(*) as count,
        COALESCE(SUM(p.budget), 0) as total_budget
       FROM projects p
       ${whereClause}
       GROUP BY p.status
       ORDER BY count DESC`,
      params
    );
    
    // Get project list with details - use project_name column and proper client name
    const [projects] = await pool.execute(
      `SELECT 
        p.id,
        p.project_name,
        p.status,
        p.budget,
        p.start_date,
        p.deadline,
        COALESCE(u.name, c.company_name) as client_name,
        c.company_name as client_company_name
       FROM projects p
       LEFT JOIN clients c ON p.client_id = c.id
       LEFT JOIN users u ON c.owner_id = u.id
       ${whereClause}
       ORDER BY p.created_at DESC
       LIMIT 20`,
      params
    );
    
    console.log('Project Status Report Query Result:', status);
    
    res.json({
      success: true,
      data: status,
      projects: projects,
      total: {
        projects: status.reduce((sum, s) => sum + parseInt(s.count || 0), 0),
        budget: status.reduce((sum, s) => sum + parseFloat(s.total_budget || 0), 0)
      }
    });
  } catch (error) {
    console.error('Get project status report error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch project status report'
    });
  }
};

/**
 * Get Employee Performance Report - Dynamic data from users/employees table
 * GET /api/v1/reports/employees
 */
const getEmployeePerformanceReport = async (req, res) => {
  try {
    const { start_date, end_date, company_id, client_id, employee_id, user_id } = req.query;
    const filterCompanyId = company_id || req.companyId || 1;
    
    console.log('Employee Performance Report - Company ID:', filterCompanyId);
    
    // Get employees using the working pattern from employeeController
    let employees = [];
    
    try {
      // Use the same query pattern as employeeController that works
      // Join through users table to get company_id
      const [empResult] = await pool.execute(
        `SELECT 
          e.id,
          e.user_id,
          u.name,
          u.email,
          e.department_id,
          e.position_id,
          d.name as department_name,
          pos.name as position_name
         FROM employees e
         INNER JOIN users u ON e.user_id = u.id
         LEFT JOIN departments d ON e.department_id = d.id
         LEFT JOIN positions pos ON e.position_id = pos.id
         WHERE u.company_id = ? AND u.is_deleted = 0
         LIMIT 50`,
        [filterCompanyId]
      );
      employees = empResult.map(e => ({
        id: e.id,
        user_id: e.user_id,
        name: e.name || 'Employee',
        email: e.email || '',
        designation: e.position_name || '',
        department: e.department_name || ''
      }));
      console.log('Found employees from employees table:', employees.length);
    } catch (e) {
      console.log('Error querying employees table:', e.message);
    }
    
    // If no employees found, try users table
    if (employees.length === 0) {
      try {
        const [userResult] = await pool.execute(
          `SELECT 
            u.id,
            u.id as user_id,
            u.name,
            u.email,
            u.role as designation
           FROM users u
           WHERE u.company_id = ? AND u.role IN ('EMPLOYEE', 'employee', 'Employee', 'ADMIN', 'admin', 'Admin')
           LIMIT 50`,
          [filterCompanyId]
        );
        employees = userResult.map(u => ({
          id: u.id,
          user_id: u.user_id,
          name: u.name || 'Employee',
          email: u.email || '',
          designation: u.designation || '',
          department: ''
        }));
        console.log('Found users with employee role:', employees.length);
      } catch (e) {
        console.log('Error querying users table:', e.message);
      }
    }
    
    // Filter by specific employee if requested
    if ((employee_id || user_id) && employees.length > 0) {
      const targetId = parseInt(employee_id || user_id);
      employees = employees.filter(e => e.id === targetId || e.user_id === targetId);
    }
    
    // Get performance data for each employee
    const performanceData = await Promise.all(employees.map(async (emp) => {
      const userId = emp.user_id || emp.id;
      let tasksCompleted = 0;
      let tasksInProgress = 0;
      let tasksPending = 0;
      let totalTasks = 0;
      let projectsAssigned = 0;
      let hoursLogged = 0;
      
      // Get task counts from task_assignees junction table
      try {
        // Tasks completed (Done status)
        const [completedResult] = await pool.execute(
          `SELECT COUNT(DISTINCT ta.task_id) as count 
           FROM task_assignees ta
           JOIN tasks t ON ta.task_id = t.id
           WHERE ta.user_id = ? AND t.status IN ('Done', 'done', 'Completed', 'completed')`,
          [userId]
        );
        tasksCompleted = parseInt(completedResult[0]?.count || 0);
        
        // Tasks in progress
        const [inProgressResult] = await pool.execute(
          `SELECT COUNT(DISTINCT ta.task_id) as count 
           FROM task_assignees ta
           JOIN tasks t ON ta.task_id = t.id
           WHERE ta.user_id = ? AND t.status IN ('Doing', 'doing', 'In Progress', 'in progress', 'In progress')`,
          [userId]
        );
        tasksInProgress = parseInt(inProgressResult[0]?.count || 0);
        
        // Tasks pending
        const [pendingResult] = await pool.execute(
          `SELECT COUNT(DISTINCT ta.task_id) as count 
           FROM task_assignees ta
           JOIN tasks t ON ta.task_id = t.id
           WHERE ta.user_id = ? AND t.status IN ('Incomplete', 'incomplete', 'Pending', 'pending', 'To Do', 'to do')`,
          [userId]
        );
        tasksPending = parseInt(pendingResult[0]?.count || 0);
        
        totalTasks = tasksCompleted + tasksInProgress + tasksPending;
      } catch (e) {
        console.log('Error getting task counts:', e.message);
      }
      
      // Get project count
      try {
        const [projectResult] = await pool.execute(
          `SELECT COUNT(DISTINCT pm.project_id) as count 
           FROM project_members pm
           WHERE pm.user_id = ?`,
          [userId]
        );
        projectsAssigned = parseInt(projectResult[0]?.count || 0);
        
        // Also check created_by in projects
        if (projectsAssigned === 0) {
          const [createdProjects] = await pool.execute(
            `SELECT COUNT(*) as count FROM projects WHERE created_by = ?`,
            [userId]
          );
          projectsAssigned = parseInt(createdProjects[0]?.count || 0);
        }
      } catch (e) {
        console.log('Error getting project count:', e.message);
      }
      
      // Get hours logged from time_logs - use 'hours' column
      try {
        const [timeResult] = await pool.execute(
          `SELECT COALESCE(SUM(hours), 0) as total_hours 
           FROM time_logs 
           WHERE user_id = ? AND is_deleted = 0`,
          [userId]
        );
        hoursLogged = Math.round(parseFloat(timeResult[0]?.total_hours || 0) * 10) / 10;
      } catch (e) {
        console.log('Error getting time logs:', e.message);
      }
      
      // Calculate rating
      let rating = 'Average';
      if (tasksCompleted >= 20) rating = 'Excellent';
      else if (tasksCompleted >= 10) rating = 'Good';
      else if (tasksCompleted >= 5) rating = 'Fair';
      
      return {
        id: emp.id,
        user_id: userId,
        name: emp.name || 'Employee',
        email: emp.email || '',
        designation: emp.designation || '',
        department: emp.department || '',
        tasks_completed: tasksCompleted,
        tasks_in_progress: tasksInProgress,
        tasks_pending: tasksPending,
        total_tasks: totalTasks,
        projects_assigned: projectsAssigned,
        hours_logged: hoursLogged,
        rating
      };
    }));
    
    // Sort by tasks completed
    performanceData.sort((a, b) => b.tasks_completed - a.tasks_completed);
    
    // Calculate summary
    const summary = {
      total_employees: performanceData.length,
      excellent: performanceData.filter(e => e.rating === 'Excellent').length,
      good: performanceData.filter(e => e.rating === 'Good').length,
      fair: performanceData.filter(e => e.rating === 'Fair').length,
      average: performanceData.filter(e => e.rating === 'Average').length,
      total_tasks: performanceData.reduce((sum, e) => sum + e.total_tasks, 0),
      total_completed: performanceData.reduce((sum, e) => sum + e.tasks_completed, 0),
      total_projects: performanceData.reduce((sum, e) => sum + e.projects_assigned, 0),
      total_hours: performanceData.reduce((sum, e) => sum + e.hours_logged, 0)
    };
    
    console.log('Employee Performance Data:', performanceData.length, 'employees found');
    
    res.json({
      success: true,
      data: performanceData,
      summary
    });
  } catch (error) {
    console.error('Get employee performance report error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch employee performance report'
    });
  }
};

/**
 * Get All Reports Summary - Dynamic data from all tables
 * GET /api/v1/reports/summary
 */
const getReportsSummary = async (req, res) => {
  try {
    const { company_id } = req.query;
    const filterCompanyId = company_id || req.companyId || 1;
    
    // Get invoice summary
    const [invoices] = await pool.execute(
      `SELECT 
        COUNT(*) as total,
        COALESCE(SUM(total), 0) as total_revenue,
        COALESCE(SUM(paid), 0) as total_paid,
        COALESCE(SUM(total - COALESCE(paid, 0)), 0) as total_unpaid
       FROM invoices
       WHERE company_id = ?`,
      [filterCompanyId]
    );
    
    // Get project summary
    const [projects] = await pool.execute(
      `SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN status IN ('Active', 'active', 'In Progress', 'in progress') THEN 1 END) as active,
        COUNT(CASE WHEN status IN ('Completed', 'completed', 'Done', 'done') THEN 1 END) as completed,
        COUNT(CASE WHEN status IN ('On Hold', 'on hold', 'Hold') THEN 1 END) as on_hold
       FROM projects
       WHERE company_id = ?`,
      [filterCompanyId]
    );
    
    // Get task summary
    const [tasks] = await pool.execute(
      `SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN status IN ('Done', 'done', 'Completed', 'completed') THEN 1 END) as completed,
        COUNT(CASE WHEN status IN ('Doing', 'doing', 'In Progress', 'in progress') THEN 1 END) as in_progress,
        COUNT(CASE WHEN status IN ('Incomplete', 'incomplete', 'Pending', 'pending', 'To Do') THEN 1 END) as pending
       FROM tasks
       WHERE company_id = ?`,
      [filterCompanyId]
    );
    
    // Get lead summary
    const [leads] = await pool.execute(
      `SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN status IN ('Won', 'won', 'Converted', 'converted') THEN 1 END) as won,
        COUNT(CASE WHEN status IN ('Lost', 'lost') THEN 1 END) as lost
       FROM leads
       WHERE company_id = ?`,
      [filterCompanyId]
    );
    
    // Get employee count
    const [employees] = await pool.execute(
      `SELECT COUNT(*) as total FROM employees WHERE company_id = ?`,
      [filterCompanyId]
    );
    
    // Get client count
    const [clients] = await pool.execute(
      `SELECT COUNT(*) as total FROM clients WHERE company_id = ?`,
      [filterCompanyId]
    );
    
    res.json({
      success: true,
      data: {
        invoices: invoices[0] || { total: 0, total_revenue: 0, total_paid: 0, total_unpaid: 0 },
        projects: projects[0] || { total: 0, active: 0, completed: 0, on_hold: 0 },
        tasks: tasks[0] || { total: 0, completed: 0, in_progress: 0, pending: 0 },
        leads: leads[0] || { total: 0, won: 0, lost: 0 },
        employees: employees[0] || { total: 0 },
        clients: clients[0] || { total: 0 }
      }
    });
  } catch (error) {
    console.error('Get reports summary error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch reports summary'
    });
  }
};

module.exports = {
  getSalesReport,
  getRevenueReport,
  getProjectStatusReport,
  getEmployeePerformanceReport,
  getReportsSummary
};
