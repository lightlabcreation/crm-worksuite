// =====================================================
// Task Controller
// =====================================================

const pool = require('../config/db');

/**
 * Generate task code
 */
const generateTaskCode = async (projectId, companyId) => {
  if (!projectId) {
    const [result] = await pool.execute(
      `SELECT COUNT(*) as count FROM tasks WHERE company_id = ? AND project_id IS NULL`,
      [companyId]
    );
    const nextNum = (result[0].count || 0) + 1;
    return `TASK-${String(nextNum).padStart(4, '0')}`;
  }

  // Get project code
  const [projects] = await pool.execute(
    `SELECT short_code FROM projects WHERE id = ?`,
    [projectId]
  );

  if (projects.length === 0) {
    return `TASK-${Date.now()}`;
  }

  const projectCode = projects[0].short_code;

  // Get task count for this project
  const [result] = await pool.execute(
    `SELECT COUNT(*) as count FROM tasks WHERE project_id = ?`,
    [projectId]
  );

  const nextNum = (result[0].count || 0) + 1;
  return `${projectCode}-${nextNum}`;
};

/**
 * Get all tasks
 * GET /api/v1/tasks
 */

/**
 * Check and generate recurring tasks
 */
const checkRecurrence = async (companyId) => {
  try {
    // 1. Get all recurring task templates
    const [templates] = await pool.execute(
      `SELECT * FROM tasks WHERE company_id = ? AND is_recurring = 1 AND is_deleted = 0`,
      [companyId]
    );

    for (const template of templates) {
      if (!template.recurring_frequency) continue;

      // 2. Find the last executed task (including the template itself)
      const [lastTaskResult] = await pool.execute(
        `SELECT * FROM tasks 
         WHERE title = ? AND company_id = ?
         ORDER BY start_date DESC LIMIT 1`,
        [template.title, companyId]
      );

      const lastTask = lastTaskResult[0] || template;
      if (!lastTask.start_date) continue; // Skip if no start date to calculate from

      const lastDate = new Date(lastTask.start_date);
      const today = new Date();
      today.setHours(0, 0, 0, 0); // Normalize to start of day

      // 3. Calculate next run date
      let nextDate = new Date(lastDate);
      const freq = template.recurring_frequency;

      if (freq === 'daily') {
        nextDate.setDate(nextDate.getDate() + 1);
      } else if (freq === 'weekly') {
        nextDate.setDate(nextDate.getDate() + 7);
      } else if (freq === 'bi-weekly') {
        nextDate.setDate(nextDate.getDate() + 14);
      } else if (freq === 'monthly') {
        nextDate.setMonth(nextDate.getMonth() + 1);
      } else if (freq === 'quarterly') {
        nextDate.setMonth(nextDate.getMonth() + 3);
      } else if (freq === 'yearly') {
        nextDate.setFullYear(nextDate.getFullYear() + 1);
      } else if (freq.startsWith('custom_')) {
        const days = parseInt(freq.replace('custom_', '')) || 1;
        nextDate.setDate(nextDate.getDate() + days);
      }

      // Normalize nextDate
      nextDate.setHours(0, 0, 0, 0);

      // 4. If next date is today or in the past, create the task
      if (nextDate <= today && nextDate > lastDate) {
        // Calculate due date offset
        let deadline = null;
        if (template.due_date && template.start_date) {
          const originalStart = new Date(template.start_date);
          const originalDue = new Date(template.due_date);
          const duration = originalDue - originalStart;
          deadline = new Date(nextDate.getTime() + duration);
        }

        const taskCode = await generateTaskCode(template.project_id, companyId);

        const [result] = await pool.execute(
          `INSERT INTO tasks (
            company_id, code, title, description, sub_description, task_category,
            project_id, client_id, lead_id, start_date, due_date,
            status, priority, estimated_time, created_by, is_recurring, recurring_frequency
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Incomplete', ?, ?, ?, 0, null)`,
          [
            companyId, taskCode, template.title, template.description, template.sub_description, template.task_category,
            template.project_id, template.client_id, template.lead_id, nextDate, deadline,
            template.priority, template.estimated_time, template.created_by
          ]
        );

        const newTaskId = result.insertId;

        // Copy Assignees
        const [assignees] = await pool.execute('SELECT user_id FROM task_assignees WHERE task_id = ?', [template.id]);
        if (assignees.length > 0) {
          const assigneeValues = assignees.map(a => [newTaskId, a.user_id]);
          await pool.query('INSERT INTO task_assignees (task_id, user_id) VALUES ?', [assigneeValues]);
        }

        // Copy Tags
        const [tags] = await pool.execute('SELECT tag FROM task_tags WHERE task_id = ?', [template.id]);
        if (tags.length > 0) {
          const tagValues = tags.map(t => [newTaskId, t.tag]);
          await pool.query('INSERT INTO task_tags (task_id, tag) VALUES ?', [tagValues]);
        }

        console.log(`Generated recurring task: ${template.title} for date ${nextDate.toISOString()}`);
      }
    }
  } catch (error) {
    console.error('Error checking recurrence:', error);
  }
};

const getAll = async (req, res) => {
  try {
    const { status, project_id, assigned_to, due_date, start_date, priority, search } = req.query;

    // Admin must provide company_id - required for filtering
    const filterCompanyId = req.query.company_id || req.body.company_id || req.companyId;

    if (!filterCompanyId) {
      return res.status(400).json({
        success: false,
        error: 'company_id is required'
      });
    }

    let whereClause = 'WHERE t.company_id = ? AND t.is_deleted = 0';
    const params = [filterCompanyId];

    // Check for recurring tasks to generate
    await checkRecurrence(filterCompanyId);

    if (status) {
      whereClause += ' AND t.status = ?';
      params.push(status);
    }
    if (project_id) {
      whereClause += ' AND t.project_id = ?';
      params.push(project_id);
    }
    if (req.query.client_id) {
      whereClause += ' AND t.client_id = ?';
      params.push(req.query.client_id);
    }
    if (req.query.lead_id) {
      whereClause += ' AND t.lead_id = ?';
      params.push(req.query.lead_id);
    }
    if (assigned_to) {
      whereClause += ` AND t.id IN (
        SELECT task_id FROM task_assignees WHERE user_id = ?
      )`;
      params.push(assigned_to);
    }
    if (due_date) {
      whereClause += ' AND DATE(t.due_date) = ?';
      params.push(due_date);
    }
    if (start_date) {
      whereClause += ' AND DATE(t.start_date) = ?';
      params.push(start_date);
    }
    if (priority) {
      whereClause += ' AND t.priority = ?';
      params.push(priority);
    }
    if (search) {
      whereClause += ' AND (t.title LIKE ? OR t.description LIKE ? OR t.code LIKE ?)';
      const searchPattern = `%${search}%`;
      params.push(searchPattern, searchPattern, searchPattern);
    }

    // Get all tasks without pagination
    const [tasks] = await pool.execute(
      `SELECT t.*, p.project_name, p.short_code as project_code, u.name as created_by_name
       FROM tasks t
       LEFT JOIN projects p ON t.project_id = p.id
       LEFT JOIN users u ON t.created_by = u.id
       ${whereClause}
       ORDER BY t.created_at DESC`,
      params
    );

    // Get assignees and tags for each task
    for (let task of tasks) {
      const [assignees] = await pool.execute(
        `SELECT u.id, u.name, u.email FROM task_assignees ta
         JOIN users u ON ta.user_id = u.id
         WHERE ta.task_id = ?`,
        [task.id]
      );
      task.assigned_to = assignees;

      const [tags] = await pool.execute(
        `SELECT tag FROM task_tags WHERE task_id = ?`,
        [task.id]
      );
      task.tags = tags.map(t => t.tag);
    }

    res.json({
      success: true,
      data: tasks
    });
  } catch (error) {
    console.error('Get tasks error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch tasks'
    });
  }
};

/**
 * Get task by ID
 * GET /api/v1/tasks/:id
 */
const getById = async (req, res) => {
  try {
    const { id } = req.params;

    const [tasks] = await pool.execute(
      `SELECT t.*, p.project_name, p.short_code as project_code
       FROM tasks t
       LEFT JOIN projects p ON t.project_id = p.id
       WHERE t.id = ? AND t.is_deleted = 0`,
      [id]
    );

    if (tasks.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Task not found'
      });
    }

    const task = tasks[0];

    // Get assignees
    const [assignees] = await pool.execute(
      `SELECT u.id, u.name, u.email FROM task_assignees ta
       JOIN users u ON ta.user_id = u.id
       WHERE ta.task_id = ?`,
      [task.id]
    );
    task.assigned_to = assignees;

    // Get tags
    const [tags] = await pool.execute(
      `SELECT tag FROM task_tags WHERE task_id = ?`,
      [task.id]
    );
    task.tags = tags.map(t => t.tag);

    // Get comments
    const [comments] = await pool.execute(
      `SELECT tc.*, u.name as user_name, u.email as user_email, u.avatar
       FROM task_comments tc
       JOIN users u ON tc.user_id = u.id
       WHERE tc.task_id = ? AND tc.is_deleted = 0
       ORDER BY tc.created_at ASC`,
      [task.id]
    );
    task.comments = comments;

    // Get files
    const [files] = await pool.execute(
      `SELECT tf.*, u.name as user_name
       FROM task_files tf
       JOIN users u ON tf.user_id = u.id
       WHERE tf.task_id = ? AND tf.is_deleted = 0
       ORDER BY tf.created_at DESC`,
      [task.id]
    );
    task.files = files;

    res.json({
      success: true,
      data: task
    });
  } catch (error) {
    console.error('Get task error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch task'
    });
  }
};

/**
 * Create task
 * POST /api/v1/tasks
 */
const create = async (req, res) => {
  try {
    console.log('=== CREATE TASK REQUEST ===');
    console.log('Request body:', JSON.stringify(req.body, null, 2));
    console.log('Content-Type:', req.headers['content-type']);
    console.log('File:', req.file ? req.file.originalname : 'No file');

    // Parse JSON strings from FormData (multipart/form-data sends arrays as strings)
    const parseJSON = (value, defaultValue = []) => {
      if (Array.isArray(value)) return value;
      if (typeof value === 'string') {
        try {
          return JSON.parse(value);
        } catch (e) {
          return defaultValue;
        }
      }
      return defaultValue;
    };

    const {
      title,
      description,
      sub_description,
      task_category,
      project_id,
      client_id,
      lead_id,
      related_to_type, // project, client, lead
      points,
      assign_to,
      start_date,
      due_date,
      deadline,
      status,
      priority,
      estimated_time,
      is_recurring,
      recurring_frequency,
    } = req.body;

    // Parse arrays that might come as JSON strings from FormData
    const collaborators = parseJSON(req.body.collaborators, []);
    const labels = parseJSON(req.body.labels, []);
    const tags = parseJSON(req.body.tags, []);
    const assigned_to = parseJSON(req.body.assigned_to, []);

    // Provide default title if not provided (title column is NOT NULL in database)
    const taskTitle = title?.trim() || `Task-${Date.now()}`;

    // ===============================
    // SAFE NULL HANDLING - All 13 Fields
    // ===============================
    const safeSubDescription = sub_description ?? null;
    const safeTaskCategory = task_category ?? null;
    const safeDescription = description ?? null;

    // Related To - determine based on type
    let safeProjectId = project_id ?? null;
    let safeClientId = client_id ?? null;
    let safeLeadId = lead_id ?? null;

    if (related_to_type) {
      if (related_to_type === 'project' && req.body.related_to) {
        safeProjectId = req.body.related_to;
      } else if (related_to_type === 'client' && req.body.related_to) {
        safeClientId = req.body.related_to;
      } else if (related_to_type === 'lead' && req.body.related_to) {
        safeLeadId = req.body.related_to;
      }
    }

    const safePoints = points || 1;
    const safeStartDate = start_date ?? null;
    const safeDeadline = deadline ?? (due_date ?? null);
    const safeDueDate = deadline ?? (due_date ?? null);
    const safePriority = priority || 'Medium';
    const safeEstimatedTime = estimated_time ?? null;
    // Map status to valid ENUM values: 'Incomplete', 'Doing', 'Done'
    const statusMap = {
      'To do': 'Incomplete',
      'to do': 'Incomplete',
      'todo': 'Incomplete',
      'pending': 'Incomplete',
      'Pending': 'Incomplete',
      'incomplete': 'Incomplete',
      'Incomplete': 'Incomplete',
      'In Progress': 'Doing',
      'in progress': 'Doing',
      'doing': 'Doing',
      'Doing': 'Doing',
      'working': 'Doing',
      'Done': 'Done',
      'done': 'Done',
      'completed': 'Done',
      'Completed': 'Done',
      'complete': 'Done'
    };
    const safeStatus = statusMap[status] || 'Incomplete';
    const safeIsRecurring = is_recurring ? 1 : 0;
    const safeRecurringFrequency = recurring_frequency ?? null;

    // ===============================
    // GENERATE TASK CODE
    // ===============================
    const companyId = req.body.company_id || req.companyId;
    if (!companyId) {
      return res.status(400).json({
        success: false,
        error: "company_id is required"
      });
    }
    const code = await generateTaskCode(safeProjectId, companyId);

    // ===============================
    // INSERT TASK - Updated with new fields
    // ===============================
    const [result] = await pool.execute(
      `
      INSERT INTO tasks (
        company_id,
        code,
        title,
        description,
        sub_description,
        task_category,
        project_id,
        client_id,
        lead_id,
        start_date,
        due_date,
        status,
        priority,
        estimated_time,
        created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        companyId ?? null,
        code,
        taskTitle ?? null,
        safeDescription ?? null,
        safeSubDescription ?? null,
        safeTaskCategory ?? null,
        safeProjectId ?? null,
        safeClientId ?? null,
        safeLeadId ?? null,
        safeStartDate ?? null,
        safeDeadline ?? null,
        safeStatus,
        safePriority || 'Medium',
        safeEstimatedTime ?? null,
        req.userId || req.body.user_id || 1
      ]
    );

    const taskId = result.insertId;

    // ===============================
    // INSERT ASSIGNEES (Assign To + Collaborators)
    // ===============================
    const allAssignees = [];
    if (assign_to) {
      allAssignees.push(parseInt(assign_to));
    }
    if (Array.isArray(collaborators) && collaborators.length > 0) {
      collaborators.forEach(userId => {
        const uid = parseInt(userId);
        if (!allAssignees.includes(uid)) {
          allAssignees.push(uid);
        }
      });
    }
    if (Array.isArray(assigned_to) && assigned_to.length > 0) {
      assigned_to.forEach(userId => {
        const uid = parseInt(userId);
        if (!allAssignees.includes(uid)) {
          allAssignees.push(uid);
        }
      });
    }

    if (allAssignees.length > 0) {
      const assigneeValues = allAssignees.map(userId => [taskId, userId]);
      await pool.query(
        `INSERT INTO task_assignees (task_id, user_id) VALUES ?`,
        [assigneeValues]
      );
    }

    // ===============================
    // INSERT TAGS/LABELS
    // ===============================
    const allTags = [];
    if (Array.isArray(labels) && labels.length > 0) {
      allTags.push(...labels);
    }
    if (Array.isArray(tags) && tags.length > 0) {
      allTags.push(...tags);
    }

    if (allTags.length > 0) {
      const tagValues = allTags.map(tag => [taskId, tag]);
      await pool.query(
        `INSERT INTO task_tags (task_id, tag) VALUES ?`,
        [tagValues]
      );
    }

    // ===============================
    // HANDLE FILE UPLOAD (if present)
    // ===============================
    if (req.file) {
      const file = req.file;
      await pool.execute(
        `INSERT INTO task_files (task_id, user_id, file_name, file_path, file_size, file_type)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          taskId,
          req.userId || req.body.user_id || 1,
          file.originalname,
          file.path,
          file.size,
          file.mimetype
        ]
      );
    }

    // ===============================
    // FETCH CREATED TASK
    // ===============================
    const [tasks] = await pool.execute(
      `SELECT * FROM tasks WHERE id = ?`,
      [taskId]
    );

    res.status(201).json({
      success: true,
      data: tasks[0],
      message: "Task created successfully"
    });

  } catch (error) {
    console.error("Create task error:", error);
    console.error("Error details:", {
      message: error.message,
      sqlMessage: error.sqlMessage,
      code: error.code
    });
    res.status(500).json({
      success: false,
      error: error.sqlMessage || error.message || "Failed to create task"
    });
  }
};

/**
 * Update task
 * PUT /api/v1/tasks/:id
 */
const update = async (req, res) => {
  try {
    const { id } = req.params;
    // Ensure updateFields is a plain object to avoid hasOwnProperty errors
    const rawFields = req.body && typeof req.body === 'object' ? { ...req.body } : {};

    // Sanitize all fields - remove any NaN values
    const updateFields = {};
    for (const [key, value] of Object.entries(rawFields)) {
      // Skip NaN number values
      if (typeof value === 'number' && isNaN(value)) {
        console.log(`Skipping NaN value for field: ${key}`);
        continue;
      }
      // Convert string 'NaN', 'null', 'undefined' to null
      if (value === 'NaN' || value === 'null' || value === 'undefined') {
        updateFields[key] = null;
        continue;
      }
      // For numeric fields, validate they're not NaN after parsing
      if (['project_id', 'client_id', 'lead_id', 'company_id', 'points', 'assign_to'].includes(key)) {
        if (value === null || value === '' || value === undefined) {
          updateFields[key] = null;
          continue;
        }
        const parsed = parseInt(value);
        if (isNaN(parsed)) {
          console.log(`Skipping invalid numeric value for field: ${key}, value: ${value}`);
          continue;
        }
        updateFields[key] = parsed;
        continue;
      }
      updateFields[key] = value;
    }

    // Check if task exists
    const [tasks] = await pool.execute(
      `SELECT id FROM tasks WHERE id = ? AND is_deleted = 0`,
      [id]
    );

    if (tasks.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Task not found'
      });
    }

    // Build update query - Updated with new fields
    const allowedFields = [
      'title', 'description', 'sub_description', 'task_category', 'project_id',
      'company_id', 'start_date', 'due_date', 'status', 'priority',
      'estimated_time', 'completed_on'
    ];

    const updates = [];
    const values = [];

    // Status mapping for valid ENUM values
    const statusMap = {
      'To do': 'Incomplete',
      'to do': 'Incomplete',
      'todo': 'Incomplete',
      'pending': 'Incomplete',
      'Pending': 'Incomplete',
      'incomplete': 'Incomplete',
      'Incomplete': 'Incomplete',
      'In Progress': 'Doing',
      'in progress': 'Doing',
      'doing': 'Doing',
      'Doing': 'Doing',
      'working': 'Doing',
      'Done': 'Done',
      'done': 'Done',
      'completed': 'Done',
      'Completed': 'Done',
      'complete': 'Done'
    };

    for (const field of allowedFields) {
      if (updateFields.hasOwnProperty(field)) {
        let value = updateFields[field];
        // Skip NaN values
        if (typeof value === 'number' && isNaN(value)) {
          continue;
        }
        // Convert string 'NaN' to null
        if (value === 'NaN' || value === 'null' || value === 'undefined') {
          value = null;
        }
        // Map status to valid ENUM values
        if (field === 'status' && value) {
          value = statusMap[value] || value;
        }
        updates.push(`${field} = ?`);
        values.push(value);
      }
    }

    // Map deadline to due_date if provided
    if (updateFields.hasOwnProperty('deadline') && !updateFields.hasOwnProperty('due_date')) {
      updates.push('due_date = ?');
      values.push(updateFields['deadline']);
    }

    if (updates.length > 0) {
      updates.push('updated_at = CURRENT_TIMESTAMP');
      values.push(id);

      await pool.execute(
        `UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`,
        values
      );
    }

    // Update assignees if provided (assign_to + collaborators)
    if (updateFields.assign_to || updateFields.collaborators || updateFields.assigned_to) {
      await pool.execute(`DELETE FROM task_assignees WHERE task_id = ?`, [id]);

      const allAssignees = [];
      if (updateFields.assign_to) {
        const assignToId = parseInt(updateFields.assign_to);
        if (!isNaN(assignToId) && assignToId > 0) {
          allAssignees.push(assignToId);
        }
      }
      if (Array.isArray(updateFields.collaborators) && updateFields.collaborators.length > 0) {
        updateFields.collaborators.forEach(userId => {
          const uid = parseInt(userId);
          if (!isNaN(uid) && uid > 0 && !allAssignees.includes(uid)) {
            allAssignees.push(uid);
          }
        });
      }
      if (Array.isArray(updateFields.assigned_to) && updateFields.assigned_to.length > 0) {
        updateFields.assigned_to.forEach(userId => {
          const uid = parseInt(userId);
          if (!isNaN(uid) && uid > 0 && !allAssignees.includes(uid)) {
            allAssignees.push(uid);
          }
        });
      }

      if (allAssignees.length > 0) {
        const assigneeValues = allAssignees.map(userId => [id, userId]);
        await pool.query(
          `INSERT INTO task_assignees (task_id, user_id) VALUES ?`,
          [assigneeValues]
        );
      }
    }

    // Update tags/labels if provided
    if (updateFields.tags || updateFields.labels) {
      await pool.execute(`DELETE FROM task_tags WHERE task_id = ?`, [id]);

      const allTags = [];
      if (Array.isArray(updateFields.labels) && updateFields.labels.length > 0) {
        allTags.push(...updateFields.labels);
      }
      if (Array.isArray(updateFields.tags) && updateFields.tags.length > 0) {
        allTags.push(...updateFields.tags);
      }

      if (allTags.length > 0) {
        const tagValues = allTags.map(tag => [id, tag]);
        await pool.query(
          `INSERT INTO task_tags (task_id, tag) VALUES ?`,
          [tagValues]
        );
      }
    }

    // Get updated task
    const [updatedTasks] = await pool.execute(
      `SELECT * FROM tasks WHERE id = ?`,
      [id]
    );

    res.json({
      success: true,
      data: updatedTasks[0],
      message: 'Task updated successfully'
    });
  } catch (error) {
    console.error('Update task error:', error);
    console.error('Error details:', {
      message: error.message,
      sqlMessage: error.sqlMessage
    });
    res.status(500).json({
      success: false,
      error: error.sqlMessage || error.message || 'Failed to update task'
    });
  }
};

/**
 * Delete task (soft delete)
 * DELETE /api/v1/tasks/:id
 */
const deleteTask = async (req, res) => {
  try {
    const { id } = req.params;

    const [result] = await pool.execute(
      `UPDATE tasks SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        error: 'Task not found'
      });
    }

    res.json({
      success: true,
      message: 'Task deleted successfully'
    });
  } catch (error) {
    console.error('Delete task error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete task'
    });
  }
};

/**
 * Add comment to task
 * POST /api/v1/tasks/:id/comments
 */
const addComment = async (req, res) => {
  try {
    const { id } = req.params;
    const { comment, file_path } = req.body;

    // Check if task exists
    const [tasks] = await pool.execute(
      `SELECT id FROM tasks WHERE id = ? AND company_id = ? AND is_deleted = 0`,
      [id, req.companyId]
    );

    if (tasks.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Task not found'
      });
    }

    if (!comment) {
      return res.status(400).json({
        success: false,
        error: 'Comment is required'
      });
    }

    // Insert comment
    const [result] = await pool.execute(
      `INSERT INTO task_comments (task_id, user_id, comment, file_path)
       VALUES (?, ?, ?, ?)`,
      [id, req.userId, comment, file_path || null]
    );

    // Get created comment
    const [comments] = await pool.execute(
      `SELECT tc.*, u.name as user_name, u.email as user_email
       FROM task_comments tc
       JOIN users u ON tc.user_id = u.id
       WHERE tc.id = ?`,
      [result.insertId]
    );

    res.status(201).json({
      success: true,
      data: comments[0],
      message: 'Comment added successfully'
    });
  } catch (error) {
    console.error('Add task comment error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to add comment'
    });
  }
};

/**
 * Get task comments
 * GET /api/v1/tasks/:id/comments
 */
const getComments = async (req, res) => {
  try {
    const { id } = req.params;

    const [comments] = await pool.execute(
      `SELECT tc.*, u.name as user_name, u.email as user_email, u.avatar
       FROM task_comments tc
       JOIN users u ON tc.user_id = u.id
       WHERE tc.task_id = ? AND tc.is_deleted = 0
       ORDER BY tc.created_at ASC`,
      [id]
    );

    res.json({
      success: true,
      data: comments
    });
  } catch (error) {
    console.error('Get task comments error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch comments'
    });
  }
};

/**
 * Upload file to task
 * POST /api/v1/tasks/:id/files
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

    // Check if task exists
    const [tasks] = await pool.execute(
      `SELECT id FROM tasks WHERE id = ? AND company_id = ? AND is_deleted = 0`,
      [id, req.companyId]
    );

    if (tasks.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Task not found'
      });
    }

    const path = require('path');
    const filePath = file.path;
    const fileName = file.originalname;
    const fileSize = file.size;
    const fileType = path.extname(fileName).toLowerCase();

    // Insert file
    const [result] = await pool.execute(
      `INSERT INTO task_files (task_id, user_id, file_path, file_name, file_size, file_type, description)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, req.userId, filePath, fileName, fileSize, fileType, description || null]
    );

    // Get created file
    const [files] = await pool.execute(
      `SELECT tf.*, u.name as user_name
       FROM task_files tf
       JOIN users u ON tf.user_id = u.id
       WHERE tf.id = ?`,
      [result.insertId]
    );

    res.status(201).json({
      success: true,
      data: files[0],
      message: 'File uploaded successfully'
    });
  } catch (error) {
    console.error('Upload task file error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to upload file'
    });
  }
};

/**
 * Get task files
 * GET /api/v1/tasks/:id/files
 */
const getFiles = async (req, res) => {
  try {
    const { id } = req.params;

    const [files] = await pool.execute(
      `SELECT tf.*, u.name as user_name
       FROM task_files tf
       JOIN users u ON tf.user_id = u.id
       WHERE tf.task_id = ? AND tf.is_deleted = 0
       ORDER BY tf.created_at DESC`,
      [id]
    );

    res.json({
      success: true,
      data: files
    });
  } catch (error) {
    console.error('Get task files error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch files'
    });
  }
};

module.exports = {
  getAll,
  getById,
  create,
  update,
  delete: deleteTask,
  addComment,
  getComments,
  uploadFile,
  getFiles
};

