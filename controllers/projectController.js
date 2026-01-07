// =====================================================
// Project Controller
// =====================================================

const pool = require('../config/db');

/**
 * Get all projects
 * GET /api/v1/projects
 * Supports: search, status, client_id, company_id, priority (label), project_type (category), 
 *           assigned_user_id, start_date, end_date, sort_by, sort_order
 */
const getAll = async (req, res) => {
  try {
    const {
      status,
      client_id,
      company_id,
      search,
      priority,
      project_type,
      project_category,
      assigned_user_id,
      project_manager_id,
      member_user_id,
      start_date,
      end_date,
      sort_by = 'created_at',
      sort_order = 'DESC',
      upcoming,
      progress_min,
      progress_max
    } = req.query;

    // Admin must provide company_id - required for filtering
    const filterCompanyId = company_id || req.query.company_id || req.body.company_id || req.companyId;

    if (!filterCompanyId) {
      return res.status(400).json({
        success: false,
        error: 'company_id is required'
      });
    }

    let whereClause = 'WHERE p.company_id = ? AND p.is_deleted = 0';
    const params = [filterCompanyId];

    // Status filter
    if (status && status !== 'All Projects' && status !== 'all') {
      if (status === 'Open Projects') {
        whereClause += ' AND (p.status = ? OR p.status = ?)';
        params.push('in progress', 'open');
      } else if (status === 'Completed') {
        whereClause += ' AND p.status = ?';
        params.push('completed');
      } else {
        whereClause += ' AND p.status = ?';
        params.push(status.toLowerCase());
      }
    }

    // Client filter - handle both client.id and user_id (owner_id)
    if (client_id) {
      // First check if this is a valid client.id
      const [directClient] = await pool.execute(
        'SELECT id FROM clients WHERE id = ? AND is_deleted = 0',
        [client_id]
      );

      if (directClient.length > 0) {
        // It's a valid client.id
        whereClause += ' AND p.client_id = ?';
        params.push(client_id);
      } else {
        // Try to find client by owner_id (user_id)
        const [clientByOwner] = await pool.execute(
          'SELECT id FROM clients WHERE owner_id = ? AND company_id = ? AND is_deleted = 0',
          [client_id, filterCompanyId]
        );

        if (clientByOwner.length > 0) {
          whereClause += ' AND p.client_id = ?';
          params.push(clientByOwner[0].id);
        } else {
          // No client found - show projects created by this user OR assigned to them
          whereClause += ' AND (p.created_by = ? OR p.client_id = ? OR p.project_manager_id = ?)';
          params.push(client_id, client_id, client_id);
        }
      }
    }

    // Priority filter (label)
    if (priority) {
      whereClause += ' AND p.label = ?';
      params.push(priority);
    }

    // Project type/category filter
    if (project_type || project_category) {
      whereClause += ' AND (p.project_category = ? OR p.project_sub_category = ?)';
      params.push(project_type || project_category, project_type || project_category);
    }

    // Member user filter - Only projects where user is a team member
    if (member_user_id) {
      whereClause += ` AND (p.project_manager_id = ? OR EXISTS (
        SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = ?
      ))`;
      params.push(member_user_id, member_user_id);
    }
    // Assigned user filter (project manager or team member)
    else if (assigned_user_id || project_manager_id) {
      const userId = assigned_user_id || project_manager_id;
      whereClause += ` AND (p.project_manager_id = ? OR EXISTS (
        SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = ?
      ))`;
      params.push(userId, userId);
    }

    // Date range filters
    if (start_date) {
      whereClause += ' AND DATE(p.start_date) >= ?';
      params.push(start_date);
    }
    if (end_date) {
      whereClause += ' AND DATE(p.deadline) <= ?';
      params.push(end_date);
    }

    // Upcoming filter (future start dates)
    if (upcoming === 'true' || upcoming === true) {
      whereClause += ' AND DATE(p.start_date) > CURDATE()';
    }

    // Progress range filters
    if (progress_min !== undefined) {
      whereClause += ' AND p.progress >= ?';
      params.push(progress_min);
    }
    if (progress_max !== undefined) {
      whereClause += ' AND p.progress <= ?';
      params.push(progress_max);
    }

    // Search filter (project name, code, client name)
    if (search) {
      whereClause += ` AND (
        p.project_name LIKE ? OR 
        p.short_code LIKE ? OR 
        c.company_name LIKE ? OR
        p.description LIKE ?
      )`;
      const searchPattern = `%${search}%`;
      params.push(searchPattern, searchPattern, searchPattern, searchPattern);
    }

    // Validate and set sort column
    const allowedSortColumns = {
      'id': 'p.id',
      'project_name': 'p.project_name',
      'short_code': 'p.short_code',
      'status': 'p.status',
      'start_date': 'p.start_date',
      'deadline': 'p.deadline',
      'progress': 'p.progress',
      'budget': 'p.budget',
      'created_at': 'p.created_at',
      'client_name': 'c.company_name',
      'company_name': 'comp.name'
    };

    const sortColumn = allowedSortColumns[sort_by] || 'p.created_at';
    const sortDirection = (sort_order || 'DESC').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    // Get all projects without pagination
    const [projects] = await pool.execute(
      `SELECT p.*, 
              c.company_name as client_name,
              comp.name as company_name,
              d.name as department_name,
              pm_user.name as project_manager_name,
              pm_user.email as project_manager_email,
              creator.name as created_by_name,
              CASE WHEN p.client_id IS NOT NULL THEN 'Client Project' ELSE 'Internal Project' END as project_type
       FROM projects p
       LEFT JOIN clients c ON p.client_id = c.id
       LEFT JOIN companies comp ON p.company_id = comp.id
       LEFT JOIN departments d ON p.department_id = d.id
       LEFT JOIN users pm_user ON p.project_manager_id = pm_user.id
       LEFT JOIN users creator ON p.created_by = creator.id
       ${whereClause}
       ORDER BY ${sortColumn} ${sortDirection}`,
      params
    );

    // Get members for each project
    for (let project of projects) {
      const [members] = await pool.execute(
        `SELECT u.id, u.name, u.email FROM project_members pm
         JOIN users u ON pm.user_id = u.id
         WHERE pm.project_id = ?`,
        [project.id]
      );
      project.members = members;
    }

    res.json({
      success: true,
      data: projects
    });
  } catch (error) {
    console.error('Get projects error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch projects'
    });
  }
};

/**
 * Get project by ID
 * GET /api/v1/projects/:id
 */
const getById = async (req, res) => {
  try {
    const { id } = req.params;

    // Admin must provide company_id - required for filtering
    const companyId = req.query.company_id || req.body.company_id || req.companyId;

    if (!companyId) {
      return res.status(400).json({
        success: false,
        error: 'company_id is required'
      });
    }

    const [projects] = await pool.execute(
      `SELECT p.*, 
              c.company_name as client_name,
              comp.name as company_name,
              d.name as department_name,
              pm_user.name as project_manager_name,
              creator.name as created_by_name,
              CASE WHEN p.client_id IS NOT NULL THEN 'Client Project' ELSE 'Internal Project' END as project_type
       FROM projects p
       LEFT JOIN clients c ON p.client_id = c.id
       LEFT JOIN companies comp ON p.company_id = comp.id
       LEFT JOIN departments d ON p.department_id = d.id
       LEFT JOIN users pm_user ON p.project_manager_id = pm_user.id
       LEFT JOIN users creator ON p.created_by = creator.id
       WHERE p.id = ? AND p.company_id = ? AND p.is_deleted = 0`,
      [id, companyId]
    );

    if (projects.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Project not found'
      });
    }

    const project = projects[0];

    // Get members
    const [members] = await pool.execute(
      `SELECT u.id, u.name, u.email FROM project_members pm
       JOIN users u ON pm.user_id = u.id
       WHERE pm.project_id = ?`,
      [project.id]
    );
    project.members = members;

    res.json({
      success: true,
      data: project
    });
  } catch (error) {
    console.error('Get project error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch project'
    });
  }
};

/**
 * Generate unique project short code
 */
const generateShortCode = async (companyId) => {
  try {
    const [result] = await pool.execute(
      `SELECT short_code FROM projects 
       WHERE company_id = ? AND is_deleted = 0 
       ORDER BY id DESC LIMIT 1`,
      [companyId]
    );

    let nextNum = 1;
    if (result.length > 0 && result[0].short_code) {
      const match = result[0].short_code.match(/PRJ-?(\d+)/i);
      if (match && match[1]) {
        nextNum = parseInt(match[1], 10) + 1;
      }
    }

    return `PRJ${String(nextNum).padStart(3, '0')}`;
  } catch (error) {
    return `PRJ${Date.now().toString().slice(-6)}`;
  }
};

/**
 * Create project
 * POST /api/v1/projects
 */
const create = async (req, res) => {
  try {
    const {
      company_id, short_code, project_name, description, start_date, deadline, no_deadline,
      budget, project_category, project_sub_category, department_id, client_id,
      project_manager_id, project_summary, notes, public_gantt_chart, public_task_board,
      task_approval, label, project_members = [], status, progress
    } = req.body;

    // Validate company_id is required
    if (!company_id) {
      return res.status(400).json({
        success: false,
        error: 'company_id is required'
      });
    }

    // Validate project_name is required
    if (!project_name || !project_name.trim()) {
      return res.status(400).json({
        success: false,
        error: 'project_name is required'
      });
    }

    // Validate client_id if provided
    let validClientId = null;
    let createdByUserId = req.userId || req.user?.id || null;

    if (client_id) {
      // First try to find by client.id
      const [clients] = await pool.execute(
        'SELECT id FROM clients WHERE id = ? AND is_deleted = 0',
        [client_id]
      );
      if (clients.length > 0) {
        validClientId = clients[0].id;
      } else {
        // Try to find by owner_id (user_id)
        const [clientsByOwner] = await pool.execute(
          'SELECT id FROM clients WHERE owner_id = ? AND company_id = ? AND is_deleted = 0 LIMIT 1',
          [client_id, company_id]
        );
        if (clientsByOwner.length > 0) {
          validClientId = clientsByOwner[0].id;
        } else {
          // If client_id is a user_id but no client record exists, store it anyway
          // This allows the project to be found later when fetching by created_by or client_id
          console.log('Client ID not found in clients table, storing as-is:', client_id);
          validClientId = client_id; // Store the user_id as client_id so it can be found
          createdByUserId = client_id; // Also set as created_by
        }
      }
    }

    // Validate project_manager_id if provided
    let validManagerId = null;
    if (project_manager_id) {
      const [users] = await pool.execute(
        'SELECT id FROM users WHERE id = ? AND is_deleted = 0',
        [project_manager_id]
      );
      if (users.length > 0) {
        validManagerId = users[0].id;
      }
    }

    // Generate short_code if not provided
    const projectShortCode = short_code || await generateShortCode(company_id);

    // Get default start date if not provided
    const projectStartDate = start_date || new Date().toISOString().split('T')[0];

    // Insert project
    const [result] = await pool.execute(
      `INSERT INTO projects (
        company_id, short_code, project_name, description, start_date, deadline, no_deadline,
        budget, project_category, project_sub_category, department_id, client_id,
        project_manager_id, project_summary, notes, public_gantt_chart, public_task_board,
        task_approval, label, status, progress, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        company_id ?? null, projectShortCode, project_name || null, description || null, projectStartDate, deadline || null,
        no_deadline || 0, budget || null, project_category || null, project_sub_category || null,
        department_id || null, validClientId || null, validManagerId || null, project_summary || null, notes || null,
        public_gantt_chart || 'enable', public_task_board || 'enable',
        task_approval || 'disable', label || null, status || 'not started',
        progress || 0, createdByUserId || req.userId || req.user?.id || validManagerId || 1
      ]
    );

    const projectId = result.insertId;

    // Insert members
    if (project_members.length > 0) {
      const memberValues = project_members.map(userId => [projectId, userId]);
      await pool.query(
        `INSERT INTO project_members (project_id, user_id) VALUES ?`,
        [memberValues]
      );
    }

    // Get created project with joins
    const [projects] = await pool.execute(
      `SELECT p.*, 
              c.company_name as client_name,
              comp.name as company_name,
              d.name as department_name,
              pm_user.name as project_manager_name,
              creator.name as created_by_name
       FROM projects p
       LEFT JOIN clients c ON p.client_id = c.id
       LEFT JOIN companies comp ON p.company_id = comp.id
       LEFT JOIN departments d ON p.department_id = d.id
       LEFT JOIN users pm_user ON p.project_manager_id = pm_user.id
       LEFT JOIN users creator ON p.created_by = creator.id
       WHERE p.id = ?`,
      [projectId]
    );

    res.status(201).json({
      success: true,
      data: projects[0],
      message: 'Project created successfully'
    });
  } catch (error) {
    console.error('Create project error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create project',
      details: error.message
    });
  }
};

/**
 * Update project
 * PUT /api/v1/projects/:id
 */
const update = async (req, res) => {
  try {
    const { id } = req.params;
    const updateFields = req.body;

    // Check if project exists
    const [projects] = await pool.execute(
      `SELECT id FROM projects WHERE id = ? AND is_deleted = 0`,
      [id]
    );

    if (projects.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Project not found'
      });
    }

    // Build update query
    const allowedFields = [
      'company_id', 'project_name', 'description', 'start_date', 'deadline', 'no_deadline',
      'budget', 'project_category', 'project_sub_category', 'department_id', 'client_id',
      'project_manager_id', 'project_summary', 'notes', 'public_gantt_chart', 'public_task_board',
      'task_approval', 'label', 'status', 'progress'
    ];

    const updates = [];
    const values = [];

    for (const field of allowedFields) {
      if (updateFields.hasOwnProperty(field)) {
        updates.push(`${field} = ?`);
        values.push(updateFields[field]);
      }
    }

    if (updates.length > 0) {
      updates.push('updated_at = CURRENT_TIMESTAMP');
      values.push(id);

      await pool.execute(
        `UPDATE projects SET ${updates.join(', ')} WHERE id = ?`,
        values
      );
    } else {
      // If no fields to update, still return success
      return res.json({
        success: true,
        data: projects[0],
        message: 'Project updated successfully'
      });
    }

    // Update members if provided
    if (updateFields.project_members) {
      await pool.execute(`DELETE FROM project_members WHERE project_id = ?`, [id]);
      if (updateFields.project_members.length > 0) {
        const memberValues = updateFields.project_members.map(userId => [id, userId]);
        await pool.query(
          `INSERT INTO project_members (project_id, user_id) VALUES ?`,
          [memberValues]
        );
      }
    }

    // Get updated project with joins
    const [updatedProjects] = await pool.execute(
      `SELECT p.*, 
              c.company_name as client_name,
              comp.name as company_name,
              d.name as department_name,
              pm_user.name as project_manager_name
       FROM projects p
       LEFT JOIN clients c ON p.client_id = c.id
       LEFT JOIN companies comp ON p.company_id = comp.id
       LEFT JOIN departments d ON p.department_id = d.id
       LEFT JOIN users pm_user ON p.project_manager_id = pm_user.id
       WHERE p.id = ?`,
      [id]
    );

    res.json({
      success: true,
      data: updatedProjects[0],
      message: 'Project updated successfully'
    });
  } catch (error) {
    console.error('Update project error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update project'
    });
  }
};

/**
 * Delete project (soft delete)
 * DELETE /api/v1/projects/:id
 */
const deleteProject = async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.query.company_id || req.body.company_id || req.companyId;

    // Check if project exists and belongs to company
    const [projects] = await pool.execute(
      `SELECT id FROM projects WHERE id = ? AND company_id = ? AND is_deleted = 0`,
      [id, companyId]
    );

    if (projects.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Project not found'
      });
    }

    // Soft delete project
    const [result] = await pool.execute(
      `UPDATE projects SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND company_id = ?`,
      [id, companyId]
    );

    res.json({
      success: true,
      message: 'Project deleted successfully'
    });
  } catch (error) {
    console.error('Delete project error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete project'
    });
  }
};

/**
 * Get filter options for projects
 * GET /api/v1/projects/filters
 */
const getFilters = async (req, res) => {
  try {
    const companyId = req.query.company_id || req.companyId;

    let whereClause = 'WHERE p.is_deleted = 0';
    const params = [];

    if (companyId) {
      whereClause += ' AND p.company_id = ?';
      params.push(companyId);
    }

    // Get unique statuses
    const [statuses] = await pool.execute(
      `SELECT DISTINCT p.status FROM projects p ${whereClause} ORDER BY p.status`,
      params
    );

    // Get unique priorities/labels
    const [priorities] = await pool.execute(
      `SELECT DISTINCT p.label FROM projects p ${whereClause} AND p.label IS NOT NULL AND p.label != '' ORDER BY p.label`,
      params
    );

    // Get unique project categories
    const [categories] = await pool.execute(
      `SELECT DISTINCT p.project_category FROM projects p ${whereClause} AND p.project_category IS NOT NULL AND p.project_category != '' ORDER BY p.project_category`,
      params
    );

    // Get clients
    const [clients] = await pool.execute(
      `SELECT DISTINCT c.id, c.company_name 
       FROM clients c
       INNER JOIN projects p ON c.id = p.client_id
       ${whereClause}
       ORDER BY c.company_name`,
      params
    );

    // Get assigned users (project managers and team members)
    // Get assigned users (project managers and team members)
    // whereClause is used twice in the subquery (UNION), so we need to duplicate the params
    const userParams = [...params, ...params];

    const [users] = await pool.execute(
      `SELECT DISTINCT u.id, u.name, u.email
       FROM users u
       WHERE u.id IN (
         SELECT DISTINCT p.project_manager_id FROM projects p ${whereClause}
         UNION
         SELECT DISTINCT pm.user_id FROM project_members pm
         INNER JOIN projects p ON pm.project_id = p.id ${whereClause}
       )
       ORDER BY u.name`,
      userParams
    );

    res.json({
      success: true,
      data: {
        statuses: statuses.map(s => s.status),
        priorities: priorities.map(p => p.label),
        categories: categories.map(c => c.project_category),
        clients: clients,
        assigned_users: users
      }
    });
  } catch (error) {
    console.error('Get filters error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch filter options'
    });
  }
};

/**
 * Upload file to project
 * POST /api/v1/projects/:id/upload
 */
const uploadFile = async (req, res) => {
  try {
    const { id } = req.params;
    const file = req.file;
    const { description } = req.body;

    if (!file) {
      return res.status(400).json({
        success: false,
        error: 'File is required'
      });
    }

    // Check if project exists
    const [projects] = await pool.execute(
      `SELECT id FROM projects WHERE id = ? AND is_deleted = 0`,
      [id]
    );

    if (projects.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Project not found'
      });
    }

    const path = require('path');
    const filePath = `/uploads/${file.filename}`;
    const fileName = file.originalname;
    const fileSize = file.size;
    const fileType = path.extname(fileName).toLowerCase();

    // Insert into documents table (more reliable)
    const companyId = req.query.company_id || req.body.company_id || 1;

    const [result] = await pool.execute(
      `INSERT INTO documents (company_id, project_id, title, file_name, file_path, file_size, file_type, description, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [companyId, id, fileName, fileName, filePath, fileSize, fileType, description || null]
    );

    res.status(201).json({
      success: true,
      data: {
        id: result.insertId,
        file_path: filePath,
        file_name: fileName,
        name: fileName,
        file_size: fileSize,
        file_type: fileType,
        project_id: id
      },
      message: 'File uploaded successfully'
    });
  } catch (error) {
    console.error('Upload project file error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to upload file',
      details: error.message
    });
  }
};

/**
 * Get project members
 * GET /api/v1/projects/:id/members
 */
const getMembers = async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.query.company_id || req.companyId;

    if (!companyId) {
      return res.status(400).json({
        success: false,
        error: 'company_id is required'
      });
    }

    // Check if project exists
    const [projects] = await pool.execute(
      `SELECT id FROM projects WHERE id = ? AND company_id = ? AND is_deleted = 0`,
      [id, companyId]
    );

    if (projects.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Project not found'
      });
    }

    // Get members
    const [members] = await pool.execute(
      `SELECT u.id, u.name, u.email, u.avatar, u.role
       FROM project_members pm
       JOIN users u ON pm.user_id = u.id
       WHERE pm.project_id = ?
       ORDER BY u.name`,
      [id]
    );

    res.json({
      success: true,
      data: members
    });
  } catch (error) {
    console.error('Get project members error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch project members'
    });
  }
};

/**
 * Get project tasks
 * GET /api/v1/projects/:id/tasks
 */
const getTasks = async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.query.company_id || req.companyId;
    const { status, assigned_to, priority } = req.query;

    if (!companyId) {
      return res.status(400).json({
        success: false,
        error: 'company_id is required'
      });
    }

    // Check if project exists
    const [projects] = await pool.execute(
      `SELECT id FROM projects WHERE id = ? AND company_id = ? AND is_deleted = 0`,
      [id, companyId]
    );

    if (projects.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Project not found'
      });
    }

    let whereClause = 'WHERE t.project_id = ? AND t.company_id = ? AND t.is_deleted = 0';
    const params = [id, companyId];

    if (status) {
      whereClause += ' AND t.status = ?';
      params.push(status);
    }
    if (priority) {
      whereClause += ' AND t.priority = ?';
      params.push(priority);
    }
    if (assigned_to) {
      whereClause += ` AND t.id IN (SELECT task_id FROM task_assignees WHERE user_id = ?)`;
      params.push(assigned_to);
    }

    // Get tasks
    const [tasks] = await pool.execute(
      `SELECT t.*, p.project_name
       FROM tasks t
       LEFT JOIN projects p ON t.project_id = p.id
       ${whereClause}
       ORDER BY t.created_at DESC`,
      params
    );

    // Get assignees for each task
    for (let task of tasks) {
      const [assignees] = await pool.execute(
        `SELECT u.id, u.name, u.email FROM task_assignees ta
         JOIN users u ON ta.user_id = u.id
         WHERE ta.task_id = ?`,
        [task.id]
      );
      task.assigned_to = assignees;
    }

    res.json({
      success: true,
      data: tasks
    });
  } catch (error) {
    console.error('Get project tasks error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch project tasks'
    });
  }
};

/**
 * Get project files
 * GET /api/v1/projects/:id/files
 */
const getFiles = async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.query.company_id || req.companyId;

    if (!companyId) {
      return res.status(400).json({
        success: false,
        error: 'company_id is required'
      });
    }

    // Check if project exists
    const [projects] = await pool.execute(
      `SELECT id FROM projects WHERE id = ? AND company_id = ? AND is_deleted = 0`,
      [id, companyId]
    );

    if (projects.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Project not found'
      });
    }

    // Try project_files table first, fallback to documents table
    try {
      const [files] = await pool.execute(
        `SELECT pf.*, u.name as user_name
         FROM project_files pf
         LEFT JOIN users u ON pf.user_id = u.id
         WHERE pf.project_id = ? AND (pf.is_deleted = 0 OR pf.is_deleted IS NULL)
         ORDER BY pf.created_at DESC`,
        [id]
      );

      res.json({
        success: true,
        data: files
      });
    } catch (tableError) {
      if (tableError.code === 'ER_NO_SUCH_TABLE') {
        // Fallback to documents table
        const [files] = await pool.execute(
          `SELECT d.*, u.name as user_name
           FROM documents d
           LEFT JOIN users u ON d.created_by = u.id
           WHERE d.related_id = ? AND d.related_type = 'project' AND d.is_deleted = 0
           ORDER BY d.created_at DESC`,
          [id]
        );

        res.json({
          success: true,
          data: files
        });
      } else {
        throw tableError;
      }
    }
  } catch (error) {
    console.error('Get project files error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch project files'
    });
  }
};

/**
 * Get all project labels
 * GET /api/v1/projects/labels
 */
const getAllLabels = async (req, res) => {
  try {
    const companyId = req.query.company_id || req.body.company_id || req.companyId;

    if (!companyId) {
      return res.status(400).json({
        success: false,
        error: 'company_id is required'
      });
    }

    const [labels] = await pool.execute(
      `SELECT * FROM project_labels WHERE company_id = ? AND is_deleted = 0 ORDER BY name ASC`,
      [companyId]
    );

    res.json({
      success: true,
      data: labels
    });
  } catch (error) {
    console.error('Get project labels error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch project labels'
    });
  }
};

/**
 * Create a new project label
 * POST /api/v1/projects/labels
 */
const createLabel = async (req, res) => {
  try {
    const { name, color } = req.body;
    const companyId = req.query.company_id || req.body.company_id || req.companyId;

    if (!name || !companyId) {
      return res.status(400).json({
        success: false,
        error: 'Label name and company_id are required'
      });
    }

    // Check if exists
    const [existing] = await pool.execute(
      'SELECT id FROM project_labels WHERE company_id = ? AND name = ? AND is_deleted = 0',
      [companyId, name]
    );

    if (existing.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'Label already exists'
      });
    }

    const [result] = await pool.execute(
      'INSERT INTO project_labels (company_id, name, color) VALUES (?, ?, ?)',
      [companyId, name, color || '#3b82f6']
    );

    res.status(201).json({
      success: true,
      message: 'Label created successfully',
      data: {
        id: result.insertId,
        name,
        color: color || '#3b82f6'
      }
    });
  } catch (error) {
    console.error('Create project label error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create project label'
    });
  }
};

/**
 * Delete a project label
 * DELETE /api/v1/projects/labels/:id
 */
const deleteLabel = async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.query.company_id || req.body.company_id || req.companyId;

    await pool.execute(
      'UPDATE project_labels SET is_deleted = 1 WHERE id = ? AND company_id = ?',
      [id, companyId]
    );

    res.json({
      success: true,
      message: 'Label deleted successfully'
    });
  } catch (error) {
    console.error('Delete project label error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete project label'
    });
  }
};

module.exports = {
  getAll,
  getById,
  create,
  update,
  deleteProject,
  getFilters,
  uploadFile,
  getMembers,
  getTasks,
  getFiles,
  getAllLabels,
  createLabel,
  deleteLabel
};
