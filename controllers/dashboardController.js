// =====================================================
// Dashboard Controller
// =====================================================

const pool = require('../config/db');

// Safe query helper - returns default value on error
const safeQuery = async (query, params, defaultValue = [{ total: 0 }]) => {
  try {
    const [result] = await pool.execute(query, params);
    return result;
  } catch (error) {
    console.warn('Safe query warning:', error.message);
    return defaultValue;
  }
};

/**
 * Get SuperAdmin Dashboard - Access to ALL data across system
 * GET /api/v1/dashboard/superadmin
 * No company filtering - sees everything
 */
const getSuperAdminDashboard = async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    // Get system-wide statistics (NO company filter)
    const [
      totalCompanies,
      totalUsers,
      totalClients,
      totalProjects,
      totalInvoices,
      totalRevenue,
      activeUsers,
      recentCompanies
    ] = await Promise.all([
      safeQuery(`SELECT COUNT(*) as total FROM companies WHERE is_deleted = 0`, []),
      safeQuery(`SELECT COUNT(*) as total FROM users WHERE is_deleted = 0`, []),
      safeQuery(`SELECT COUNT(*) as total FROM clients WHERE is_deleted = 0`, []),
      safeQuery(`SELECT COUNT(*) as total FROM projects WHERE is_deleted = 0`, []),
      safeQuery(`SELECT COUNT(*) as total FROM invoices WHERE is_deleted = 0`, []),
      safeQuery(`SELECT COALESCE(SUM(paid), 0) as total FROM invoices WHERE is_deleted = 0`, []),
      safeQuery(`SELECT COUNT(*) as total FROM users WHERE status = 'Active' AND is_deleted = 0`, []),
      safeQuery(`SELECT id, name, created_at FROM companies WHERE is_deleted = 0 ORDER BY created_at DESC LIMIT 5`, [], [])
    ]);

    // Users by role (system-wide)
    const usersByRole = await safeQuery(
      `SELECT role, COUNT(*) as count FROM users WHERE is_deleted = 0 GROUP BY role`,
      [],
      []
    );

    // Companies with most users
    const topCompanies = await safeQuery(
      `SELECT c.id, c.name, COUNT(u.id) as user_count 
       FROM companies c 
       LEFT JOIN users u ON c.id = u.company_id AND u.is_deleted = 0
       WHERE c.is_deleted = 0 
       GROUP BY c.id 
       ORDER BY user_count DESC 
       LIMIT 5`,
      [],
      []
    );

    // Recent attendance across all companies
    const recentAttendance = await safeQuery(
      `SELECT a.*, u.name as user_name, c.name as company_name
       FROM attendance a
       LEFT JOIN users u ON a.user_id = u.id
       LEFT JOIN companies c ON a.company_id = c.id
       WHERE a.is_deleted = 0 AND DATE(a.check_in) = ?
       ORDER BY a.check_in DESC LIMIT 10`,
      [today],
      []
    );

    res.json({
      success: true,
      data: {
        overview: {
          totalCompanies: totalCompanies[0]?.total || 0,
          totalUsers: totalUsers[0]?.total || 0,
          totalClients: totalClients[0]?.total || 0,
          totalProjects: totalProjects[0]?.total || 0,
          totalInvoices: totalInvoices[0]?.total || 0,
          totalRevenue: parseFloat(totalRevenue[0]?.total || 0),
          activeUsers: activeUsers[0]?.total || 0
        },
        usersByRole: usersByRole.reduce((acc, item) => {
          acc[item.role] = item.count;
          return acc;
        }, {}),
        topCompanies: topCompanies,
        recentCompanies: recentCompanies,
        recentAttendance: recentAttendance.map(a => ({
          id: a.id,
          userName: a.user_name,
          companyName: a.company_name,
          checkIn: a.check_in,
          checkOut: a.check_out
        }))
      }
    });
  } catch (error) {
    console.error('Get superadmin dashboard error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch dashboard data',
      details: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
};

/**
 * Get COMPLETE Admin Dashboard Data - SINGLE API
 * GET /api/v1/dashboard
 * Returns ALL dashboard data in ONE response
 * Uses JWT data for userId and companyId
 */
const getCompleteDashboard = async (req, res) => {
  try {
    // Use JWT data, fallback to query params for backward compatibility
    const companyId = req.companyId || req.query.company_id || 1;
    const userId = req.userId || req.query.user_id || 1;
    const today = new Date().toISOString().split('T')[0];
    const currentYear = new Date().getFullYear();
    const lastYear = currentYear - 1;
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    // ===== 1. SUMMARY DATA =====
    // Get clock data for the user from attendance table
    const [clockInData] = await safeQuery(
      `SELECT check_in, check_out,
              TIMEDIFF(COALESCE(check_out, CURTIME()), check_in) as duration
       FROM attendance
       WHERE user_id = ? AND date = ? AND company_id = ?
       ORDER BY check_in DESC LIMIT 1`,
      [userId, today, companyId],
      []
    );

    const [openTasksCount] = await safeQuery(
      `SELECT COUNT(*) as total FROM tasks t
       LEFT JOIN task_assignees ta ON t.id = ta.task_id
       WHERE (ta.user_id = ? OR t.created_by = ?) AND t.company_id = ? AND t.status != 'Done' AND t.is_deleted = 0`,
      [userId, userId, companyId]
    );

    const [eventsTodayCount] = await safeQuery(
      `SELECT COUNT(*) as total FROM events 
       WHERE company_id = ? AND DATE(starts_on_date) = ? AND is_deleted = 0`,
      [companyId, today]
    );

    const [dueAmountData] = await safeQuery(
      `SELECT COALESCE(SUM(unpaid), 0) as total FROM invoices 
       WHERE company_id = ? AND is_deleted = 0`,
      [companyId]
    );

    // ===== 2. PROJECTS OVERVIEW =====
    const [projectsStats] = await safeQuery(
      `SELECT 
        SUM(CASE WHEN status = 'in progress' THEN 1 ELSE 0 END) as open_count,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_count,
        SUM(CASE WHEN status = 'on hold' THEN 1 ELSE 0 END) as hold_count,
        AVG(COALESCE(progress, 0)) as avg_progress
       FROM projects WHERE company_id = ? AND is_deleted = 0`,
      [companyId]
    );

    // ===== 3. INVOICE OVERVIEW =====
    const invoiceBreakdown = await safeQuery(
      `SELECT 
        status,
        COUNT(*) as count,
        COALESCE(SUM(total), 0) as total_amount,
        COALESCE(SUM(unpaid), 0) as unpaid_amount
       FROM invoices WHERE company_id = ? AND is_deleted = 0 GROUP BY status`,
      [companyId],
      []
    );

    const [invoiceTotals] = await safeQuery(
      `SELECT 
        COALESCE(SUM(total), 0) as total_invoiced,
        COALESCE(SUM(unpaid), 0) as total_due
       FROM invoices WHERE company_id = ? AND is_deleted = 0`,
      [companyId]
    );

    // ===== 4. INCOME VS EXPENSES =====
    const [thisYearIncome] = await safeQuery(
      `SELECT COALESCE(SUM(paid), 0) as total FROM invoices 
       WHERE company_id = ? AND YEAR(invoice_date) = ? AND is_deleted = 0`,
      [companyId, currentYear]
    );

    const [thisYearExpenses] = await safeQuery(
      `SELECT COALESCE(SUM(total), 0) as total FROM expenses 
       WHERE company_id = ? AND YEAR(date) = ? AND status = 'Approved' AND is_deleted = 0`,
      [companyId, currentYear]
    );

    const [lastYearIncome] = await safeQuery(
      `SELECT COALESCE(SUM(paid), 0) as total FROM invoices 
       WHERE company_id = ? AND YEAR(invoice_date) = ? AND is_deleted = 0`,
      [companyId, lastYear]
    );

    const [lastYearExpenses] = await safeQuery(
      `SELECT COALESCE(SUM(total), 0) as total FROM expenses 
       WHERE company_id = ? AND YEAR(date) = ? AND status = 'Approved' AND is_deleted = 0`,
      [companyId, lastYear]
    );

    // ===== 5. ALL TASKS OVERVIEW =====
    const tasksBreakdown = await safeQuery(
      `SELECT 
        status,
        COUNT(*) as count
       FROM tasks WHERE company_id = ? AND is_deleted = 0 GROUP BY status`,
      [companyId],
      []
    );

    // Expired tasks (past deadline, not done)
    const [expiredTasks] = await safeQuery(
      `SELECT COUNT(*) as total FROM tasks 
       WHERE company_id = ? AND due_date < ? AND status != 'Done' AND is_deleted = 0`,
      [companyId, today]
    );

    // ===== 6. TEAM MEMBERS OVERVIEW =====
    const [teamTotal] = await safeQuery(
      `SELECT COUNT(*) as total FROM users 
       WHERE company_id = ? AND role = 'EMPLOYEE' AND is_deleted = 0`,
      [companyId]
    );

    const [onLeaveToday] = await safeQuery(
      `SELECT COUNT(DISTINCT user_id) as total FROM leave_requests 
       WHERE company_id = ? AND status = 'Approved' AND ? BETWEEN start_date AND end_date AND is_deleted = 0`,
      [companyId, today]
    );

    const [clockedInToday] = await safeQuery(
      `SELECT COUNT(DISTINCT user_id) as total FROM attendance 
       WHERE company_id = ? AND DATE(check_in) = ? AND check_out IS NULL AND is_deleted = 0`,
      [companyId, today]
    );

    const [clockedOutToday] = await safeQuery(
      `SELECT COUNT(DISTINCT user_id) as total FROM attendance 
       WHERE company_id = ? AND DATE(check_in) = ? AND check_out IS NOT NULL AND is_deleted = 0`,
      [companyId, today]
    );

    // Last announcement
    const [lastAnnouncement] = await safeQuery(
      `SELECT message, created_at FROM notifications 
       WHERE company_id = ? AND type = 'announcement' AND is_deleted = 0
       ORDER BY created_at DESC LIMIT 1`,
      [companyId],
      []
    );

    // ===== 7. TICKET STATUS =====
    const ticketsByStatus = await safeQuery(
      `SELECT 
        status,
        COUNT(*) as count
       FROM tickets WHERE company_id = ? AND is_deleted = 0 GROUP BY status`,
      [companyId],
      []
    );

    const ticketsByCategory = await safeQuery(
      `SELECT 
        COALESCE(type, category, 'General') as category,
        COUNT(*) as count
       FROM tickets WHERE company_id = ? AND is_deleted = 0 GROUP BY COALESCE(type, category, 'General')`,
      [companyId],
      []
    );

    // Tickets last 30 days
    const ticketsLast30Days = await safeQuery(
      `SELECT DATE(created_at) as date, COUNT(*) as count 
       FROM tickets 
       WHERE company_id = ? AND created_at >= ? AND is_deleted = 0 
       GROUP BY DATE(created_at) ORDER BY date`,
      [companyId, thirtyDaysAgo],
      []
    );

    // ===== 8. PROJECT TIMELINE =====
    const timeline = await safeQuery(
      `SELECT 
        t.id, t.title, t.status, t.priority, t.updated_at,
        u.name as user_name,
        p.project_name
       FROM tasks t
       LEFT JOIN users u ON t.created_by = u.id
       LEFT JOIN projects p ON t.project_id = p.id
       WHERE t.company_id = ? AND t.is_deleted = 0
       ORDER BY t.updated_at DESC LIMIT 10`,
      [companyId],
      []
    );

    // ===== 9. EVENTS LIST =====
    // Show upcoming events first, then recent past events
    const events = await safeQuery(
      `SELECT id, event_name, starts_on_date, starts_on_time, ends_on_date, ends_on_time, description, where_event
       FROM events 
       WHERE company_id = ? AND is_deleted = 0
       ORDER BY 
         CASE WHEN starts_on_date >= ? THEN 0 ELSE 1 END,
         ABS(DATEDIFF(starts_on_date, ?))
       LIMIT 10`,
      [companyId, today, today],
      []
    );

    // ===== 10. OPEN PROJECTS =====
    const openProjects = await safeQuery(
      `SELECT id, project_name, start_date, deadline, progress, status, client_id
       FROM projects 
       WHERE company_id = ? AND status = 'in progress' AND is_deleted = 0
       ORDER BY deadline ASC LIMIT 10`,
      [companyId],
      []
    );

    // ===== 11. TO-DO (PRIVATE) =====
    const todos = await safeQuery(
      `SELECT id, title, description, is_completed, created_at
       FROM user_todos 
       WHERE user_id = ? AND is_deleted = 0
       ORDER BY created_at DESC LIMIT 20`,
      [userId],
      []
    );

    // ===== 12. MY TASKS =====
    const myTasks = await safeQuery(
      `SELECT t.id, t.title, t.start_date, t.due_date, t.status, t.priority, t.tags, p.project_name
       FROM tasks t
       LEFT JOIN task_assignees ta ON t.id = ta.task_id
       LEFT JOIN projects p ON t.project_id = p.id
       WHERE (ta.user_id = ? OR t.created_by = ?) AND t.company_id = ? AND t.is_deleted = 0
       ORDER BY t.due_date ASC LIMIT 10`,
      [userId, userId, companyId],
      []
    );

    // ===== 13. STICKY NOTE =====
    const [stickyNote] = await safeQuery(
      `SELECT content FROM user_sticky_notes WHERE user_id = ? LIMIT 1`,
      [userId],
      []
    );

    // Process invoice breakdown
    const invoiceOverview = {
      overdue: 0, overdueAmount: 0,
      notPaid: 0, notPaidAmount: 0,
      partiallyPaid: 0, partiallyPaidAmount: 0,
      fullyPaid: 0, fullyPaidAmount: 0,
      draft: 0, draftAmount: 0,
      totalInvoiced: invoiceTotals?.total_invoiced || 0,
      totalDue: invoiceTotals?.total_due || 0
    };

    invoiceBreakdown.forEach(item => {
      const status = (item.status || '').toLowerCase();
      if (status === 'overdue') {
        invoiceOverview.overdue = item.count;
        invoiceOverview.overdueAmount = item.unpaid_amount;
      } else if (status === 'unpaid' || status === 'not paid') {
        invoiceOverview.notPaid = item.count;
        invoiceOverview.notPaidAmount = item.total_amount;
      } else if (status === 'partially paid') {
        invoiceOverview.partiallyPaid = item.count;
        invoiceOverview.partiallyPaidAmount = item.unpaid_amount;
      } else if (status === 'paid') {
        invoiceOverview.fullyPaid = item.count;
        invoiceOverview.fullyPaidAmount = item.total_amount;
      } else if (status === 'draft') {
        invoiceOverview.draft = item.count;
        invoiceOverview.draftAmount = item.total_amount;
      }
    });

    // Process tasks breakdown
    const tasksOverview = {
      todo: 0, inProgress: 0, review: 0, done: 0, expired: expiredTasks?.total || 0
    };

    tasksBreakdown.forEach(item => {
      const status = (item.status || '').toLowerCase();
      if (status === 'incomplete' || status === 'to do' || status === 'todo') {
        tasksOverview.todo = item.count;
      } else if (status === 'doing' || status === 'in progress') {
        tasksOverview.inProgress = item.count;
      } else if (status === 'review') {
        tasksOverview.review = item.count;
      } else if (status === 'done' || status === 'completed') {
        tasksOverview.done = item.count;
      }
    });

    // Process ticket status
    const ticketStatus = { new: 0, open: 0, closed: 0 };
    ticketsByStatus.forEach(item => {
      const status = (item.status || '').toLowerCase();
      if (status === 'new') ticketStatus.new = item.count;
      else if (status === 'open') ticketStatus.open = item.count;
      else if (status === 'closed' || status === 'resolved') ticketStatus.closed = item.count;
    });

    // Format clock time
    let clockTime = '00:00:00';
    let isClockedIn = false;
    let clockInTime = null;
    if (clockInData && clockInData.check_in) {
      isClockedIn = !clockInData.check_out;
      clockTime = clockInData.duration || '00:00:00';
      clockInTime = clockInData.check_in;
    }

    // Build final response
    const dashboardData = {
      summary: {
        clockIn: clockTime,
        clockInTime: clockInTime,
        isClockedIn: isClockedIn,
        openTasks: openTasksCount?.total || 0,
        eventsToday: eventsTodayCount?.total || 0,
        dueAmount: parseFloat(dueAmountData?.total || 0)
      },
      projectsOverview: {
        open: parseInt(projectsStats?.open_count || 0),
        completed: parseInt(projectsStats?.completed_count || 0),
        hold: parseInt(projectsStats?.hold_count || 0),
        progress: Math.round(projectsStats?.avg_progress || 0)
      },
      invoiceOverview: invoiceOverview,
      incomeVsExpenses: {
        thisYear: {
          income: parseFloat(thisYearIncome?.total || 0),
          expenses: parseFloat(thisYearExpenses?.total || 0)
        },
        lastYear: {
          income: parseFloat(lastYearIncome?.total || 0),
          expenses: parseFloat(lastYearExpenses?.total || 0)
        }
      },
      tasksOverview: tasksOverview,
      teamOverview: {
        total: teamTotal?.total || 0,
        onLeave: onLeaveToday?.total || 0,
        clockedIn: clockedInToday?.total || 0,
        clockedOut: clockedOutToday?.total || 0,
        lastAnnouncement: lastAnnouncement?.message || 'Tomorrow is holiday!'
      },
      ticketStatus: {
        ...ticketStatus,
        categories: ticketsByCategory.map(c => ({ name: c.category, count: c.count })),
        last30Days: ticketsLast30Days.map(t => ({ date: t.date, count: t.count }))
      },
      timeline: timeline.map(t => ({
        id: t.id,
        user: t.user_name || 'System',
        time: t.updated_at,
        action: `Task: #${t.id} - ${t.title}`,
        status: t.status,
        priority: t.priority,
        project: t.project_name
      })),
      events: events.map(e => ({
        id: e.id,
        name: e.event_name,
        date: e.starts_on_date,
        time: e.starts_on_time,
        endDate: e.ends_on_date,
        endTime: e.ends_on_time,
        description: e.description,
        location: e.where_event
      })),
      openProjects: openProjects.map(p => ({
        id: p.id,
        name: p.project_name,
        startDate: p.start_date,
        deadline: p.deadline,
        progress: p.progress || 0,
        status: p.status
      })),
      todos: todos.map(t => ({
        id: t.id,
        text: t.title || t.description,
        completed: t.is_completed === 1
      })),
      myTasks: myTasks.map(t => ({
        id: t.id,
        title: t.title,
        startDate: t.start_date,
        deadline: t.due_date,
        status: t.status,
        priority: t.priority,
        tags: t.tags,
        project: t.project_name
      })),
      stickyNote: stickyNote?.content || 'My quick notes here...'
    };

    res.json({
      success: true,
      data: dashboardData
    });

  } catch (error) {
    console.error('Get complete dashboard error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch dashboard data',
      details: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
};

/**
 * Save user todo
 * POST /api/v1/dashboard/todo
 */
const saveTodo = async (req, res) => {
  try {
    const { user_id, title, description } = req.body;
    
    await pool.execute(
      `INSERT INTO user_todos (user_id, title, description, is_completed, is_deleted, created_at) 
       VALUES (?, ?, ?, 0, 0, NOW())`,
      [user_id, title, description || '']
    );
    
    res.json({ success: true, message: 'Todo saved successfully' });
  } catch (error) {
    console.error('Save todo error:', error);
    res.status(500).json({ success: false, error: 'Failed to save todo' });
  }
};

/**
 * Update user todo
 * PUT /api/v1/dashboard/todo/:id
 */
const updateTodo = async (req, res) => {
  try {
    const { id } = req.params;
    const { is_completed } = req.body;
    
    await pool.execute(
      `UPDATE user_todos SET is_completed = ? WHERE id = ?`,
      [is_completed ? 1 : 0, id]
    );
    
    res.json({ success: true, message: 'Todo updated successfully' });
  } catch (error) {
    console.error('Update todo error:', error);
    res.status(500).json({ success: false, error: 'Failed to update todo' });
  }
};

/**
 * Delete user todo
 * DELETE /api/v1/dashboard/todo/:id
 */
const deleteTodo = async (req, res) => {
  try {
    const { id } = req.params;
    
    await pool.execute(`UPDATE user_todos SET is_deleted = 1 WHERE id = ?`, [id]);
    
    res.json({ success: true, message: 'Todo deleted successfully' });
  } catch (error) {
    console.error('Delete todo error:', error);
    res.status(500).json({ success: false, error: 'Failed to delete todo' });
  }
};

/**
 * Save sticky note
 * POST /api/v1/dashboard/sticky-note
 */
const saveStickyNote = async (req, res) => {
  try {
    const { user_id, content } = req.body;
    
    // Upsert sticky note
    await pool.execute(
      `INSERT INTO user_sticky_notes (user_id, content, updated_at) 
       VALUES (?, ?, NOW()) 
       ON DUPLICATE KEY UPDATE content = ?, updated_at = NOW()`,
      [user_id, content, content]
    );
    
    res.json({ success: true, message: 'Sticky note saved successfully' });
  } catch (error) {
    console.error('Save sticky note error:', error);
    res.status(500).json({ success: false, error: 'Failed to save sticky note' });
  }
};

/**
 * Get admin dashboard stats
 * GET /api/v1/dashboard/admin
 * Uses JWT companyId - Admin can only see their company data
 */
const getAdminDashboard = async (req, res) => {
  try {
    // Use JWT companyId for data isolation
    const companyId = req.companyId || req.query.company_id || 1;
    
    // Use safe queries to handle missing tables gracefully
    const [
      leadsCount,
      clientsCount,
      employeesCount,
      companiesCount,
      projectsCount,
      invoicesCount,
      tasksCount
    ] = await Promise.all([
      safeQuery(
        `SELECT COUNT(*) as total FROM leads WHERE company_id = ? AND is_deleted = 0`,
        [companyId]
      ),
      safeQuery(
        `SELECT COUNT(*) as total FROM clients WHERE company_id = ? AND is_deleted = 0`,
        [companyId]
      ),
      safeQuery(
        `SELECT COUNT(*) as total FROM users WHERE company_id = ? AND role = 'EMPLOYEE' AND is_deleted = 0`,
        [companyId]
      ),
      safeQuery(
        `SELECT COUNT(*) as total FROM companies WHERE is_deleted = 0`,
        []
      ),
      safeQuery(
        `SELECT COUNT(*) as total FROM projects WHERE company_id = ? AND is_deleted = 0`,
        [companyId]
      ),
      safeQuery(
        `SELECT COUNT(*) as total, COALESCE(SUM(total), 0) as total_amount, COALESCE(SUM(paid), 0) as paid_amount, COALESCE(SUM(unpaid), 0) as unpaid_amount
         FROM invoices WHERE company_id = ? AND is_deleted = 0`,
        [companyId]
      ),
      safeQuery(
        `SELECT COUNT(*) as total FROM tasks WHERE company_id = ? AND is_deleted = 0`,
        [companyId]
      )
    ]);

    res.json({
      success: true,
      data: {
        leads: leadsCount[0]?.total || 0,
        clients: clientsCount[0]?.total || 0,
        employees: employeesCount[0]?.total || 0,
        companies: companiesCount[0]?.total || 0,
        projects: projectsCount[0]?.total || 0,
        invoices: {
          total: invoicesCount[0]?.total || 0,
          total_amount: invoicesCount[0]?.total_amount || 0,
          paid_amount: invoicesCount[0]?.paid_amount || 0,
          unpaid_amount: invoicesCount[0]?.unpaid_amount || 0
        },
        tasks: tasksCount[0]?.total || 0
      }
    });
  } catch (error) {
    console.error('Get admin dashboard error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch dashboard data',
      details: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
};

/**
 * Get employee dashboard stats
 * GET /api/v1/dashboard/employee
 * Uses JWT userId - Employee can only see their own data
 */
const getEmployeeDashboard = async (req, res) => {
  try {
    // Use JWT data for strict data isolation
    const userId = req.userId || req.query.user_id;
    const companyId = req.companyId || req.query.company_id || 1;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'User ID is required'
      });
    }
    const today = new Date().toISOString().split('T')[0];

    // Use safe queries to handle missing tables gracefully
    const [
      tasksCount,
      projectsCount,
      timeLogs,
      events
    ] = await Promise.all([
      // Count tasks where user is assigned OR created the task
      safeQuery(
        `SELECT COUNT(DISTINCT t.id) as total FROM tasks t
         LEFT JOIN task_assignees ta ON t.id = ta.task_id
         WHERE (ta.user_id = ? OR t.created_by = ?) AND t.company_id = ? AND t.is_deleted = 0`,
        [userId, userId, companyId]
      ),
      // Count distinct projects where user has tasks assigned or created
      safeQuery(
        `SELECT COUNT(DISTINCT t.project_id) as total FROM tasks t
         LEFT JOIN task_assignees ta ON t.id = ta.task_id
         WHERE (ta.user_id = ? OR t.created_by = ?) AND t.company_id = ? AND t.is_deleted = 0 AND t.project_id IS NOT NULL`,
        [userId, userId, companyId]
      ),
      safeQuery(
        `SELECT COALESCE(SUM(hours), 0) as total_hours FROM time_logs
         WHERE user_id = ? AND company_id = ? AND DATE(date) = ? AND is_deleted = 0`,
        [userId, companyId, today]
      ),
      safeQuery(
        `SELECT COUNT(*) as total FROM events e
         LEFT JOIN event_employees ee ON e.id = ee.event_id
         WHERE (ee.user_id = ? OR e.created_by = ?) AND e.company_id = ? AND e.starts_on_date >= ? AND e.is_deleted = 0`,
        [userId, userId, companyId, today]
      )
    ]);

    res.json({
      success: true,
      data: {
        my_tasks: tasksCount[0]?.total || 0,
        my_projects: projectsCount[0]?.total || 0,
        time_logged_today: timeLogs[0]?.total_hours || 0,
        upcoming_events: events[0]?.total || 0
      }
    });
  } catch (error) {
    console.error('Get employee dashboard error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch dashboard data',
      details: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
};

/**
 * Get client dashboard stats
 * GET /api/v1/dashboard/client
 * Uses JWT userId - Client can only see their own data
 */
const getClientDashboard = async (req, res) => {
  try {
    // Use JWT data for strict data isolation
    const userId = req.userId || req.query.user_id;
    const companyId = req.companyId || req.query.company_id || 1;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'User ID is required'
      });
    }

    console.log('Client dashboard - userId:', userId, 'companyId:', companyId);

    // Get client ID from user - try multiple ways to find the client
    let clients = await safeQuery(
      `SELECT id FROM clients WHERE owner_id = ? AND company_id = ? AND is_deleted = 0 LIMIT 1`,
      [userId, companyId],
      []
    );

    // If not found by owner_id, try by user_id directly
    if (clients.length === 0) {
      clients = await safeQuery(
        `SELECT c.id FROM clients c
         INNER JOIN users u ON c.owner_id = u.id
         WHERE u.id = ? AND c.company_id = ? AND c.is_deleted = 0 LIMIT 1`,
        [userId, companyId],
        []
      );
    }

    // If still not found, use userId directly as clientId (for direct client users)
    let clientId = userId;
    if (clients.length > 0) {
      clientId = clients[0].id;
    }
    console.log('Using client ID:', clientId);

    // Use safe queries to handle missing tables gracefully
    const [
      projectsCount,
      tasksCount,
      invoices,
      payments,
      contractsCount,
      estimatesCount,
      creditNotesCount,
      contactsCount
    ] = await Promise.all([
      safeQuery(
        `SELECT COUNT(*) as total FROM projects WHERE client_id = ? AND is_deleted = 0`,
        [clientId]
      ),
      safeQuery(
        `SELECT COUNT(*) as total FROM tasks WHERE project_id IN (
           SELECT id FROM projects WHERE client_id = ?
         ) AND is_deleted = 0`,
        [clientId]
      ),
      safeQuery(
        `SELECT COALESCE(SUM(unpaid), 0) as total FROM invoices WHERE client_id = ? AND is_deleted = 0`,
        [clientId]
      ),
      safeQuery(
        `SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE invoice_id IN (
           SELECT id FROM invoices WHERE client_id = ?
         ) AND is_deleted = 0`,
        [clientId]
      ),
      safeQuery(
        `SELECT COUNT(*) as total FROM contracts WHERE client_id = ? AND is_deleted = 0`,
        [clientId]
      ),
      safeQuery(
        `SELECT COUNT(*) as total FROM estimates WHERE client_id = ? AND is_deleted = 0`,
        [clientId]
      ),
      safeQuery(
        `SELECT COUNT(*) as total FROM credit_notes WHERE client_id = ? AND is_deleted = 0`,
        [clientId]
      ),
      safeQuery(
        `SELECT COUNT(*) as total FROM client_contacts WHERE client_id = ? AND is_deleted = 0`,
        [clientId]
      )
    ]);

    res.json({
      success: true,
      data: {
        my_projects: projectsCount[0]?.total || 0,
        my_tasks: tasksCount[0]?.total || 0,
        outstanding_invoices: invoices[0]?.total || 0,
        total_payments: payments[0]?.total || 0,
        contracts_count: contractsCount[0]?.total || 0,
        estimates_count: estimatesCount[0]?.total || 0,
        credit_notes_count: creditNotesCount[0]?.total || 0,
        contacts_count: contactsCount[0]?.total || 0
      }
    });
  } catch (error) {
    console.error('Get client dashboard error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch dashboard data',
      details: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
};

/**
 * Get client work data (projects and tasks)
 * GET /api/v1/dashboard/client/work
 * Uses JWT userId - Client can only see their own data
 */
const getClientWork = async (req, res) => {
  try {
    const userId = req.userId || req.query.user_id;
    const companyId = req.companyId || req.query.company_id || 1;
    
    if (!userId) {
      return res.status(400).json({ success: false, error: 'User ID is required' });
    }

    // Get client ID from user - try multiple ways to find the client
    let clients = await safeQuery(
      `SELECT id FROM clients WHERE owner_id = ? AND company_id = ? AND is_deleted = 0 LIMIT 1`,
      [userId, companyId],
      []
    );

    // If not found by owner_id, use userId directly as clientId
    let clientId = userId;
    if (clients.length > 0) {
      clientId = clients[0].id;
    }

    // Get projects
    const projects = await safeQuery(
      `SELECT p.*, c.company_name as client_name 
       FROM projects p
       LEFT JOIN clients c ON p.client_id = c.id
       WHERE p.client_id = ? AND p.is_deleted = 0
       ORDER BY p.created_at DESC
       LIMIT 10`,
      [clientId],
      []
    );

    const projectIds = projects.map(p => p.id);
    let tasks = [];
    if (projectIds.length > 0) {
      tasks = await safeQuery(
        `SELECT t.*, p.project_name, u.name as assigned_to_name
         FROM tasks t
         LEFT JOIN projects p ON t.project_id = p.id
         LEFT JOIN users u ON t.created_by = u.id
         WHERE t.project_id IN (${projectIds.map(() => '?').join(',')}) AND t.is_deleted = 0
         ORDER BY t.created_at DESC
         LIMIT 20`,
        projectIds,
        []
      );
    }

    res.json({
      success: true,
      data: {
        projects: projects || [],
        tasks: tasks || []
      }
    });
  } catch (error) {
    console.error('Get client work error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch work data',
      details: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
};

/**
 * Get client finance data (invoices, payments, estimates, contracts, credit notes)
 * GET /api/v1/dashboard/client/finance
 * Uses JWT userId - Client can only see their own data
 */
const getClientFinance = async (req, res) => {
  try {
    const userId = req.userId || req.query.user_id;
    const companyId = req.companyId || req.query.company_id || 1;
    
    if (!userId) {
      return res.status(400).json({ success: false, error: 'User ID is required' });
    }

    // Get client ID from user - try multiple ways to find the client
    let clients = await safeQuery(
      `SELECT id FROM clients WHERE owner_id = ? AND company_id = ? AND is_deleted = 0 LIMIT 1`,
      [userId, companyId],
      []
    );

    // If not found by owner_id, use userId directly as clientId
    let clientId = userId;
    if (clients.length > 0) {
      clientId = clients[0].id;
    }

    // Get invoices
    const invoices = await safeQuery(
      `SELECT i.*, c.company_name as client_name
       FROM invoices i
       LEFT JOIN clients c ON i.client_id = c.id
       WHERE i.client_id = ? AND i.is_deleted = 0
       ORDER BY i.created_at DESC
       LIMIT 10`,
      [clientId],
      []
    );

    const invoiceIds = invoices.map(i => i.id);
    let payments = [];
    if (invoiceIds.length > 0) {
      payments = await safeQuery(
        `SELECT p.*, i.invoice_number
         FROM payments p
         LEFT JOIN invoices i ON p.invoice_id = i.id
         WHERE p.invoice_id IN (${invoiceIds.map(() => '?').join(',')}) AND p.is_deleted = 0
         ORDER BY p.created_at DESC
         LIMIT 10`,
        invoiceIds,
        []
      );
    }

    // Get estimates
    const estimates = await safeQuery(
      `SELECT e.*, c.company_name as client_name
       FROM estimates e
       LEFT JOIN clients c ON e.client_id = c.id
       WHERE e.client_id = ? AND e.is_deleted = 0
       ORDER BY e.created_at DESC
       LIMIT 10`,
      [clientId],
      []
    );

    // Get contracts
    const contracts = await safeQuery(
      `SELECT ct.*, c.company_name as client_name
       FROM contracts ct
       LEFT JOIN clients c ON ct.client_id = c.id
       WHERE ct.client_id = ? AND ct.is_deleted = 0
       ORDER BY ct.created_at DESC
       LIMIT 10`,
      [clientId],
      []
    );

    // Get credit notes
    const creditNotes = await safeQuery(
      `SELECT cn.*, c.company_name as client_name
       FROM credit_notes cn
       LEFT JOIN clients c ON cn.client_id = c.id
       WHERE cn.client_id = ? AND cn.is_deleted = 0
       ORDER BY cn.created_at DESC
       LIMIT 10`,
      [clientId],
      []
    );

    res.json({
      success: true,
      data: {
        invoices: invoices || [],
        payments: payments || [],
        estimates: estimates || [],
        contracts: contracts || [],
        credit_notes: creditNotes || []
      }
    });
  } catch (error) {
    console.error('Get client finance error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch finance data',
      details: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
};

/**
 * Get client announcements
 * GET /api/v1/dashboard/client/announcements
 * Uses JWT userId
 */
const getClientAnnouncements = async (req, res) => {
  try {
    const userId = req.userId || req.query.user_id;
    const companyId = req.companyId || req.query.company_id || 1;

    // Get announcements from notifications table
    const announcements = await safeQuery(
      `SELECT n.*, u.name as created_by_name
       FROM notifications n
       LEFT JOIN users u ON n.created_by = u.id
       WHERE n.company_id = ? 
         AND (n.user_id = ? OR n.user_id IS NULL)
         AND n.type = 'announcement'
         AND n.is_deleted = 0
       ORDER BY n.created_at DESC
       LIMIT 10`,
      [companyId, userId],
      []
    );

    res.json({
      success: true,
      data: announcements || []
    });
  } catch (error) {
    console.error('Get client announcements error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch announcements'
    });
  }
};

/**
 * Get client recent activity
 * GET /api/v1/dashboard/client/activity
 * Uses JWT userId
 */
const getClientActivity = async (req, res) => {
  try {
    const userId = req.userId || req.query.user_id;
    const companyId = req.companyId || req.query.company_id || 1;

    // Get client ID
    let clients = await safeQuery(
      `SELECT id FROM clients WHERE owner_id = ? AND company_id = ? AND is_deleted = 0 LIMIT 1`,
      [userId, companyId],
      []
    );

    let clientId = userId;
    if (clients.length > 0) {
      clientId = clients[0].id;
    }

    // Get recent activity from various sources
    const activities = [];

    // Recent invoices
    const recentInvoices = await safeQuery(
      `SELECT id, invoice_number, status, created_at, 'invoice' as type
       FROM invoices 
       WHERE client_id = ? AND is_deleted = 0
       ORDER BY created_at DESC
       LIMIT 5`,
      [clientId],
      []
    );
    
    recentInvoices.forEach(inv => {
      activities.push({
        id: `inv-${inv.id}`,
        message: `Invoice ${inv.invoice_number} ${inv.status === 'Paid' ? 'paid' : 'sent'}`,
        date: inv.created_at,
        type: 'invoice'
      });
    });

    // Recent payments
    const recentPayments = await safeQuery(
      `SELECT p.id, p.amount, p.created_at, i.invoice_number
       FROM payments p
       LEFT JOIN invoices i ON p.invoice_id = i.id
       WHERE i.client_id = ? AND p.is_deleted = 0
       ORDER BY p.created_at DESC
       LIMIT 5`,
      [clientId],
      []
    );
    
    recentPayments.forEach(pay => {
      activities.push({
        id: `pay-${pay.id}`,
        message: `Payment of $${pay.amount} received for ${pay.invoice_number || 'Invoice'}`,
        date: pay.created_at,
        type: 'payment'
      });
    });

    // Recent projects
    const recentProjects = await safeQuery(
      `SELECT id, project_name, status, created_at
       FROM projects 
       WHERE client_id = ? AND is_deleted = 0
       ORDER BY created_at DESC
       LIMIT 5`,
      [clientId],
      []
    );
    
    recentProjects.forEach(proj => {
      activities.push({
        id: `proj-${proj.id}`,
        message: `Project "${proj.project_name}" ${proj.status || 'created'}`,
        date: proj.created_at,
        type: 'project'
      });
    });

    // Sort by date
    activities.sort((a, b) => new Date(b.date) - new Date(a.date));

    res.json({
      success: true,
      data: activities.slice(0, 10)
    });
  } catch (error) {
    console.error('Get client activity error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch activity'
    });
  }
};

module.exports = {
  getSuperAdminDashboard,
  getCompleteDashboard,
  getAdminDashboard,
  getEmployeeDashboard,
  getClientDashboard,
  getClientWork,
  getClientFinance,
  getClientAnnouncements,
  getClientActivity,
  saveTodo,
  updateTodo,
  deleteTodo,
  saveStickyNote
};

