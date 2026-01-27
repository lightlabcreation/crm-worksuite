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
    
    // Handle project_id and client_id with OR logic when both are provided
    // This allows fetching tasks that match either client or project (useful for invoice/estimate detail pages)
    const hasClientId = req.query.client_id;
    const hasProjectId = project_id;
    
    if (hasClientId && hasProjectId) {
      // If both are provided, use OR logic to get tasks matching either
      whereClause += ' AND (t.client_id = ? OR t.project_id = ?)';
      params.push(req.query.client_id, project_id);
    } else {
      // If only one is provided, use AND logic as before
      if (hasProjectId) {
        whereClause += ' AND t.project_id = ?';
        params.push(project_id);
      }
      if (hasClientId) {
        whereClause += ' AND t.client_id = ?';
        params.push(req.query.client_id);
      }
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
      repeat_every,
      repeat_unit,
      cycles,
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
    
    // Handle new recurring fields
    const safeRepeatEvery = (is_recurring && repeat_every) ? parseInt(repeat_every) || 1 : null;
    const safeRepeatUnit = (is_recurring && repeat_unit) ? repeat_unit : null;
    const safeCycles = (is_recurring && cycles && cycles !== '') ? parseInt(cycles) : null;

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
    
    // Check if columns exist in database
    const [columns] = await pool.execute(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
       WHERE TABLE_NAME = 'tasks' AND TABLE_SCHEMA = DATABASE()`
    );
    const columnNames = columns.map(col => col.COLUMN_NAME);
    const hasRepeatEvery = columnNames.includes('repeat_every');
    const hasRepeatUnit = columnNames.includes('repeat_unit');
    const hasCycles = columnNames.includes('cycles');
    const hasIsRecurring = columnNames.includes('is_recurring');
    
    const code = await generateTaskCode(safeProjectId, companyId);

    // ===============================
    // INSERT TASK - Updated with new fields
    // ===============================
    // Build dynamic INSERT query based on available columns
    let insertFields = [
      'company_id', 'code', 'title', 'description', 'sub_description', 'task_category',
      'project_id', 'client_id', 'lead_id', 'start_date', 'due_date',
      'status', 'priority', 'estimated_time', 'created_by'
    ];
    let insertValues = [
      companyId ?? null, code, taskTitle ?? null, safeDescription ?? null,
      safeSubDescription ?? null, safeTaskCategory ?? null,
      safeProjectId ?? null, safeClientId ?? null, safeLeadId ?? null,
      safeStartDate ?? null, safeDeadline ?? null,
      safeStatus, safePriority || 'Medium', safeEstimatedTime ?? null,
      req.userId || req.body.user_id || 1
    ];
    
    // Add recurring fields if columns exist
    if (hasIsRecurring) {
      insertFields.push('is_recurring');
      insertValues.push(safeIsRecurring);
    }
    if (hasRepeatEvery && safeRepeatEvery) {
      insertFields.push('repeat_every');
      insertValues.push(safeRepeatEvery);
    }
    if (hasRepeatUnit && safeRepeatUnit) {
      insertFields.push('repeat_unit');
      insertValues.push(safeRepeatUnit);
    }
    if (hasCycles && safeCycles) {
      insertFields.push('cycles');
      insertValues.push(safeCycles);
    }
    
    const placeholders = insertFields.map(() => '?').join(', ');
    const [result] = await pool.execute(
      `INSERT INTO tasks (${insertFields.join(', ')}) VALUES (${placeholders})`,
      insertValues
    );

    const taskId = result.insertId;

    // ===============================
    // INSERT ASSIGNEES (Assign To + Collaborators)
    // ===============================
    const allAssignees = [];
    if (assign_to) {
      const uid = parseInt(assign_to);
      if (!isNaN(uid) && uid > 0) {
        allAssignees.push(uid);
      }
    }
    if (Array.isArray(collaborators) && collaborators.length > 0) {
      collaborators.forEach(userId => {
        const uid = parseInt(userId);
        if (!isNaN(uid) && uid > 0 && !allAssignees.includes(uid)) {
          allAssignees.push(uid);
        }
      });
    }
    if (Array.isArray(assigned_to) && assigned_to.length > 0) {
      assigned_to.forEach(userId => {
        const uid = parseInt(userId);
        if (!isNaN(uid) && uid > 0 && !allAssignees.includes(uid)) {
          allAssignees.push(uid);
        }
      });
    }

    // Validate that all user IDs exist in the users table before inserting
    if (allAssignees.length > 0) {
      const [validUsers] = await pool.execute(
        `SELECT id FROM users WHERE id IN (${allAssignees.map(() => '?').join(',')})`,
        allAssignees
      );
      const validUserIds = validUsers.map(u => u.id);
      const filteredAssignees = allAssignees.filter(uid => validUserIds.includes(uid));

      if (filteredAssignees.length > 0) {
        const assigneeValues = filteredAssignees.map(userId => [taskId, userId]);
        await pool.query(
          `INSERT INTO task_assignees (task_id, user_id) VALUES ?`,
          [assigneeValues]
        );
      }
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
    // CREATE RECURRING TASK INSTANCES
    // ===============================
    const createdTaskIds = [taskId]; // Include the original task
    
    if (safeIsRecurring && safeRepeatEvery && safeRepeatUnit && safeStartDate) {
      const startDate = new Date(safeStartDate);
      const totalCycles = safeCycles || 10; // Default to 10 if cycles not specified
      
      // Calculate duration between start_date and due_date for maintaining the same duration
      let durationDays = 0;
      if (safeDeadline) {
        const dueDate = new Date(safeDeadline);
        durationDays = Math.ceil((dueDate - startDate) / (1000 * 60 * 60 * 24));
      }
      
      // Create recurring instances
      for (let i = 1; i < totalCycles; i++) {
        let nextStartDate = new Date(startDate);
        let nextDueDate = safeDeadline ? new Date(safeDeadline) : null;
        
        // Calculate next date based on repeat_unit
        if (safeRepeatUnit === 'Day(s)') {
          nextStartDate.setDate(nextStartDate.getDate() + (safeRepeatEvery * i));
          if (nextDueDate) {
            nextDueDate.setDate(nextDueDate.getDate() + (safeRepeatEvery * i));
          }
        } else if (safeRepeatUnit === 'Week(s)') {
          nextStartDate.setDate(nextStartDate.getDate() + (safeRepeatEvery * 7 * i));
          if (nextDueDate) {
            nextDueDate.setDate(nextDueDate.getDate() + (safeRepeatEvery * 7 * i));
          }
        } else if (safeRepeatUnit === 'Month(s)') {
          nextStartDate.setMonth(nextStartDate.getMonth() + (safeRepeatEvery * i));
          if (nextDueDate) {
            nextDueDate.setMonth(nextDueDate.getMonth() + (safeRepeatEvery * i));
          }
        } else if (safeRepeatUnit === 'Year(s)') {
          nextStartDate.setFullYear(nextStartDate.getFullYear() + (safeRepeatEvery * i));
          if (nextDueDate) {
            nextDueDate.setFullYear(nextDueDate.getFullYear() + (safeRepeatEvery * i));
          }
        }
        
        // Generate code for recurring task
        const recurringCode = await generateTaskCode(safeProjectId, companyId);
        
        // Build insert fields and values for recurring task
        let recurringInsertFields = [
          'company_id', 'code', 'title', 'description', 'sub_description', 'task_category',
          'project_id', 'client_id', 'lead_id', 'start_date', 'due_date',
          'status', 'priority', 'estimated_time', 'created_by'
        ];
        let recurringInsertValues = [
          companyId ?? null, recurringCode, taskTitle ?? null, safeDescription ?? null,
          safeSubDescription ?? null, safeTaskCategory ?? null,
          safeProjectId ?? null, safeClientId ?? null, safeLeadId ?? null,
          nextStartDate.toISOString().split('T')[0], nextDueDate ? nextDueDate.toISOString().split('T')[0] : null,
          safeStatus, safePriority || 'Medium', safeEstimatedTime ?? null,
          req.userId || req.body.user_id || 1
        ];
        
        // Add recurring fields (but mark as non-recurring for instances)
        if (hasIsRecurring) {
          recurringInsertFields.push('is_recurring');
          recurringInsertValues.push(0); // Instances are not recurring themselves
        }
        
        const recurringPlaceholders = recurringInsertFields.map(() => '?').join(', ');
        const [recurringResult] = await pool.execute(
          `INSERT INTO tasks (${recurringInsertFields.join(', ')}) VALUES (${recurringPlaceholders})`,
          recurringInsertValues
        );
        
        const recurringTaskId = recurringResult.insertId;
        createdTaskIds.push(recurringTaskId);
        
        // Copy assignees to recurring task
        if (allAssignees.length > 0) {
          const recurringAssigneeValues = allAssignees.map(userId => [recurringTaskId, userId]);
          await pool.query(
            `INSERT INTO task_assignees (task_id, user_id) VALUES ?`,
            [recurringAssigneeValues]
          );
        }
        
        // Copy tags to recurring task
        if (allTags.length > 0) {
          const recurringTagValues = allTags.map(tag => [recurringTaskId, tag]);
          await pool.query(
            `INSERT INTO task_tags (task_id, tag) VALUES ?`,
            [recurringTagValues]
          );
        }
      }
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
      message: safeIsRecurring && safeCycles 
        ? `Task and ${safeCycles - 1} recurring instances created successfully`
        : "Task created successfully",
      created_count: createdTaskIds.length
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

      // Validate that all user IDs exist in the users table before inserting
      if (allAssignees.length > 0) {
        const [validUsers] = await pool.execute(
          `SELECT id FROM users WHERE id IN (${allAssignees.map(() => '?').join(',')})`,
          allAssignees
        );
        const validUserIds = validUsers.map(u => u.id);
        const filteredAssignees = allAssignees.filter(uid => validUserIds.includes(uid));

        if (filteredAssignees.length > 0) {
          const assigneeValues = filteredAssignees.map(userId => [id, userId]);
          await pool.query(
            `INSERT INTO task_assignees (task_id, user_id) VALUES ?`,
            [assigneeValues]
          );
        }
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
    const { comment, file_path, user_id, company_id } = req.body;

    // Get company_id from query, body, or req.companyId
    const companyId = req.query.company_id || company_id || req.companyId || req.user?.company_id;
    
    // Get user_id from body, req.userId, or req.user.id
    const userId = user_id || req.userId || req.user?.id;

    if (!companyId) {
      return res.status(400).json({
        success: false,
        error: 'company_id is required'
      });
    }

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'user_id is required'
      });
    }

    // Check if task exists
    const [tasks] = await pool.execute(
      `SELECT id FROM tasks WHERE id = ? AND company_id = ? AND is_deleted = 0`,
      [id, companyId]
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
      [id, userId, comment, file_path || null]
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
    console.error('Error details:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to add comment',
      details: error.message
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
    const companyId = req.query.company_id || req.body.company_id;

    // Build query with optional company_id filter
    let query = `
      SELECT tc.*, u.name as user_name, u.email as user_email, u.avatar
      FROM task_comments tc
      JOIN users u ON tc.user_id = u.id
      JOIN tasks t ON tc.task_id = t.id
      WHERE tc.task_id = ? AND tc.is_deleted = 0
    `;
    const params = [id];

    if (companyId) {
      query += ' AND t.company_id = ?';
      params.push(companyId);
    }

    query += ' ORDER BY tc.created_at ASC';

    const [comments] = await pool.execute(query, params);

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
    const { description, user_id, company_id } = req.body;

    // Get company_id from query, body, or req.companyId
    const companyId = req.query.company_id || company_id || req.companyId || req.user?.company_id;
    
    // Get user_id from body, req.userId, or req.user.id
    const userId = user_id || req.userId || req.user?.id;

    if (!companyId) {
      return res.status(400).json({
        success: false,
        error: 'company_id is required'
      });
    }

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'user_id is required'
      });
    }

    if (!file) {
      return res.status(400).json({
        success: false,
        error: 'File is required'
      });
    }

    // Check if task exists
    const [tasks] = await pool.execute(
      `SELECT id FROM tasks WHERE id = ? AND company_id = ? AND is_deleted = 0`,
      [id, companyId]
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
      [id, userId, filePath, fileName, fileSize, fileType, description || null]
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

/**
 * Send task by email
 * POST /api/v1/tasks/:id/send-email
 */
const sendEmail = async (req, res) => {
  try {
    const { id } = req.params;
    const { to, cc, bcc, subject, message } = req.body;
    const companyId = req.body.company_id || req.query.company_id || req.companyId || 1;

    // Get task with assignee details
    const [tasks] = await pool.execute(
      `SELECT t.*, p.project_name, comp.name as company_name
       FROM tasks t
       LEFT JOIN projects p ON t.project_id = p.id
       LEFT JOIN companies comp ON t.company_id = comp.id
       WHERE t.id = ? AND t.is_deleted = 0`,
      [id]
    );

    if (tasks.length === 0) {
      return res.status(404).json({ success: false, error: 'Task not found' });
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

    // Generate task URL
    const taskUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/app/admin/tasks?task=${id}`;

    // Use email template renderer
    const { renderEmailTemplate } = require('../utils/emailTemplateRenderer');
    const { sendEmail: sendEmailUtil } = require('../utils/emailService');

    // Build data object for template
    const assigneeNames = assignees.map(a => a.name || a.email).join(', ');
    const assigneeEmails = assignees.map(a => a.email).filter(Boolean).join(', ');
    
    const templateData = {
      TASK_TITLE: task.title || 'Task',
      TASK_URL: taskUrl,
      ASSIGNEE: assigneeNames || 'Unassigned',
      ASSIGNEE_EMAIL: assigneeEmails || '',
      DEADLINE: task.due_date ? new Date(task.due_date).toLocaleDateString() : 'No deadline',
      CONTACT_FIRST_NAME: assignees[0]?.name?.split(' ')[0] || assignees[0]?.email?.split('@')[0] || 'Team Member',
      COMPANY_NAME: task.company_name || 'Our Company',
      SIGNATURE: process.env.EMAIL_SIGNATURE || 'Best regards,<br>Your Team',
      LOGO_URL: ''
    };

    // Render template (or use provided message)
    let emailSubject, emailHTML;
    if (message) {
      // Use custom message if provided
      emailSubject = subject || `Task: ${task.title}`;
      emailHTML = message;
    } else {
      // Use template - try task_assigned first, fallback to task_general
      try {
        let rendered = await renderEmailTemplate('task_assigned', templateData, companyId);
        if (!rendered || !rendered.body) {
          // Fallback to task_general
          rendered = await renderEmailTemplate('task_general', templateData, companyId);
        }
        emailSubject = subject || rendered.subject || `Task: ${task.title}`;
        emailHTML = rendered.body || `<p>Task: ${task.title} - ${templateData.TASK_URL}</p>`;
      } catch (templateError) {
        console.warn('Template rendering error:', templateError.message);
        // Fallback to basic template
        emailSubject = subject || `Task: ${task.title}`;
        emailHTML = `<div style="padding: 20px; font-family: Arial, sans-serif;">
          <h2>Task: ${templateData.TASK_TITLE}</h2>
          <p>Hello ${templateData.CONTACT_FIRST_NAME},</p>
          <p>Please find task details below:</p>
          <p><strong>Task:</strong> ${templateData.TASK_TITLE}</p>
          ${templateData.DEADLINE !== 'No deadline' ? `<p><strong>Deadline:</strong> ${templateData.DEADLINE}</p>` : ''}
          <p><a href="${templateData.TASK_URL}">View Task</a></p>
          <p>${templateData.SIGNATURE}</p>
        </div>`;
      }
    }

    // Send email
    const recipientEmail = to || assigneeEmails || assignees[0]?.email;
    if (!recipientEmail) {
      return res.status(400).json({ success: false, error: 'Recipient email is required' });
    }

    // Handle CC and BCC from request body
    const emailOptions = {
      to: recipientEmail,
      cc: cc || undefined,
      bcc: bcc || undefined,
      subject: emailSubject,
      html: emailHTML,
      text: `Please view the task at: ${taskUrl}`
    };

    console.log('=== SENDING TASK EMAIL ===');
    console.log('Email options:', { ...emailOptions, html: emailOptions.html ? 'HTML provided' : 'No HTML' });

    const emailResult = await sendEmailUtil(emailOptions);

    if (!emailResult.success) {
      console.error('Email sending failed:', emailResult.error);
      return res.status(500).json({ 
        success: false, 
        error: emailResult.error || 'Failed to send task email',
        details: process.env.NODE_ENV === 'development' ? emailResult.message : undefined
      });
    }

    console.log('✅ Task email sent successfully');

    res.json({ 
      success: true, 
      message: 'Task sent successfully',
      data: { email: recipientEmail, messageId: emailResult.messageId }
    });
  } catch (error) {
    console.error('=== SEND TASK EMAIL ERROR ===');
    console.error('Error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to send task email',
      details: error.message
    });
  }
};

/**
 * Get task notes
 * GET /api/v1/tasks/:id/notes
 */
const getNotes = async (req, res) => {
  try {
    const { id } = req.params;

    const [notes] = await pool.execute(
      `SELECT tn.*, u.name as user_name, u.email as user_email, u.avatar
       FROM task_notes tn
       JOIN users u ON tn.user_id = u.id
       WHERE tn.task_id = ? AND tn.is_deleted = 0
       ORDER BY tn.created_at DESC`,
      [id]
    );

    res.json({
      success: true,
      data: notes
    });
  } catch (error) {
    console.error('Get task notes error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch notes'
    });
  }
};

/**
 * Add note to task
 * POST /api/v1/tasks/:id/notes
 */
const addNote = async (req, res) => {
  try {
    const { id } = req.params;
    const { note, user_id, company_id } = req.body;

    // Get company_id from query, body, or req.companyId
    const companyId = req.query.company_id || company_id || req.companyId || req.user?.company_id;
    
    // Get user_id from body, req.userId, or req.user.id
    const userId = user_id || req.userId || req.user?.id;

    if (!companyId) {
      return res.status(400).json({
        success: false,
        error: 'company_id is required'
      });
    }

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'user_id is required'
      });
    }

    // Check if task exists
    const [tasks] = await pool.execute(
      `SELECT id FROM tasks WHERE id = ? AND company_id = ? AND is_deleted = 0`,
      [id, companyId]
    );

    if (tasks.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Task not found'
      });
    }

    if (!note || !note.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Note is required'
      });
    }

    // Insert note
    const [result] = await pool.execute(
      `INSERT INTO task_notes (task_id, user_id, note)
       VALUES (?, ?, ?)`,
      [id, userId, note.trim()]
    );

    // Get created note
    const [notes] = await pool.execute(
      `SELECT tn.*, u.name as user_name, u.email as user_email, u.avatar
       FROM task_notes tn
       JOIN users u ON tn.user_id = u.id
       WHERE tn.id = ?`,
      [result.insertId]
    );

    res.status(201).json({
      success: true,
      data: notes[0],
      message: 'Note added successfully'
    });
  } catch (error) {
    console.error('Add task note error:', error);
    console.error('Error details:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to add note',
      details: error.message
    });
  }
};

/**
 * Update task note
 * PUT /api/v1/tasks/:id/notes/:noteId
 */
const updateNote = async (req, res) => {
  try {
    const { id, noteId } = req.params;
    const { note, user_id, company_id } = req.body;

    // Get company_id from query, body, or req.companyId
    const companyId = req.query.company_id || company_id || req.companyId || req.user?.company_id;
    
    // Get user_id from body, req.userId, or req.user.id
    const userId = user_id || req.userId || req.user?.id;

    if (!note || !note.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Note is required'
      });
    }

    // Check if note exists and belongs to user
    const [notes] = await pool.execute(
      `SELECT tn.* FROM task_notes tn
       JOIN tasks t ON tn.task_id = t.id
       WHERE tn.id = ? AND tn.task_id = ? AND t.company_id = ? AND tn.is_deleted = 0`,
      [noteId, id, companyId]
    );

    if (notes.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Note not found'
      });
    }

    // Update note
    await pool.execute(
      `UPDATE task_notes SET note = ?, updated_at = NOW() WHERE id = ?`,
      [note.trim(), noteId]
    );

    // Get updated note
    const [updatedNotes] = await pool.execute(
      `SELECT tn.*, u.name as user_name, u.email as user_email, u.avatar
       FROM task_notes tn
       JOIN users u ON tn.user_id = u.id
       WHERE tn.id = ?`,
      [noteId]
    );

    res.json({
      success: true,
      data: updatedNotes[0],
      message: 'Note updated successfully'
    });
  } catch (error) {
    console.error('Update task note error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update note',
      details: error.message
    });
  }
};

/**
 * Delete task note
 * DELETE /api/v1/tasks/:id/notes/:noteId
 */
const deleteNote = async (req, res) => {
  try {
    const { id, noteId } = req.params;
    const companyId = req.query.company_id || req.body.company_id || req.companyId || req.user?.company_id;

    // Check if note exists
    const [notes] = await pool.execute(
      `SELECT tn.* FROM task_notes tn
       JOIN tasks t ON tn.task_id = t.id
       WHERE tn.id = ? AND tn.task_id = ? AND t.company_id = ? AND tn.is_deleted = 0`,
      [noteId, id, companyId]
    );

    if (notes.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Note not found'
      });
    }

    // Soft delete note
    await pool.execute(
      `UPDATE task_notes SET is_deleted = 1, updated_at = NOW() WHERE id = ?`,
      [noteId]
    );

    res.json({
      success: true,
      message: 'Note deleted successfully'
    });
  } catch (error) {
    console.error('Delete task note error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete note',
      details: error.message
    });
  }
};

/**
 * Get task subtasks
 * GET /api/v1/tasks/:id/subtasks
 */
const getSubtasks = async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.query.company_id || req.body.company_id || req.companyId;

    const [subtasks] = await pool.execute(
      `SELECT ts.*, u.name as assigned_to_name, u.email as assigned_to_email
       FROM task_subtasks ts
       LEFT JOIN users u ON ts.assign_to = u.id
       WHERE ts.task_id = ? AND ts.is_deleted = 0
       ORDER BY ts.created_at DESC`,
      [id]
    );

    res.json({
      success: true,
      data: subtasks
    });
  } catch (error) {
    console.error('Get task subtasks error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch subtasks'
    });
  }
};

/**
 * Add subtask to task
 * POST /api/v1/tasks/:id/subtasks
 */
const addSubtask = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, start_date, due_date, deadline, assign_to, status, priority, user_id, company_id } = req.body;

    // Get company_id from query, body, or req.companyId
    const companyId = req.query.company_id || company_id || req.companyId || req.user?.company_id;
    
    // Get user_id from body, req.userId, or req.user.id
    const userId = user_id || req.userId || req.user?.id;

    if (!companyId) {
      return res.status(400).json({
        success: false,
        error: 'company_id is required'
      });
    }

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'user_id is required'
      });
    }

    // Check if task exists
    const [tasks] = await pool.execute(
      `SELECT id FROM tasks WHERE id = ? AND company_id = ? AND is_deleted = 0`,
      [id, companyId]
    );

    if (tasks.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Task not found'
      });
    }

    if (!title || !title.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Title is required'
      });
    }

    // Insert subtask
    const [result] = await pool.execute(
      `INSERT INTO task_subtasks (task_id, title, description, start_date, due_date, deadline, assign_to, status, priority, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        title.trim(),
        description || null,
        start_date || null,
        due_date || null,
        deadline || due_date || null,
        assign_to || null,
        status || 'Incomplete',
        priority || 'Medium',
        userId
      ]
    );

    // Get created subtask
    const [subtasks] = await pool.execute(
      `SELECT ts.*, u.name as assigned_to_name, u.email as assigned_to_email
       FROM task_subtasks ts
       LEFT JOIN users u ON ts.assign_to = u.id
       WHERE ts.id = ?`,
      [result.insertId]
    );

    res.status(201).json({
      success: true,
      data: subtasks[0],
      message: 'Subtask added successfully'
    });
  } catch (error) {
    console.error('Add task subtask error:', error);
    console.error('Error details:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to add subtask',
      details: error.message
    });
  }
};

/**
 * Update task subtask
 * PUT /api/v1/tasks/:id/subtasks/:subtaskId
 */
const updateSubtask = async (req, res) => {
  try {
    const { id, subtaskId } = req.params;
    const { title, description, start_date, due_date, deadline, assign_to, status, priority, company_id } = req.body;

    const companyId = req.query.company_id || company_id || req.companyId || req.user?.company_id;

    if (!title || !title.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Title is required'
      });
    }

    // Check if subtask exists
    const [subtasks] = await pool.execute(
      `SELECT ts.* FROM task_subtasks ts
       JOIN tasks t ON ts.task_id = t.id
       WHERE ts.id = ? AND ts.task_id = ? AND t.company_id = ? AND ts.is_deleted = 0`,
      [subtaskId, id, companyId]
    );

    if (subtasks.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Subtask not found'
      });
    }

    // Update subtask
    await pool.execute(
      `UPDATE task_subtasks 
       SET title = ?, description = ?, start_date = ?, due_date = ?, deadline = ?, 
           assign_to = ?, status = ?, priority = ?, updated_at = NOW()
       WHERE id = ?`,
      [
        title.trim(),
        description || null,
        start_date || null,
        due_date || null,
        deadline || due_date || null,
        assign_to || null,
        status || 'Incomplete',
        priority || 'Medium',
        subtaskId
      ]
    );

    // Get updated subtask
    const [updatedSubtasks] = await pool.execute(
      `SELECT ts.*, u.name as assigned_to_name, u.email as assigned_to_email
       FROM task_subtasks ts
       LEFT JOIN users u ON ts.assign_to = u.id
       WHERE ts.id = ?`,
      [subtaskId]
    );

    res.json({
      success: true,
      data: updatedSubtasks[0],
      message: 'Subtask updated successfully'
    });
  } catch (error) {
    console.error('Update task subtask error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update subtask',
      details: error.message
    });
  }
};

/**
 * Delete task subtask
 * DELETE /api/v1/tasks/:id/subtasks/:subtaskId
 */
const deleteSubtask = async (req, res) => {
  try {
    const { id, subtaskId } = req.params;
    const companyId = req.query.company_id || req.body.company_id || req.companyId || req.user?.company_id;

    // Check if subtask exists
    const [subtasks] = await pool.execute(
      `SELECT ts.* FROM task_subtasks ts
       JOIN tasks t ON ts.task_id = t.id
       WHERE ts.id = ? AND ts.task_id = ? AND t.company_id = ? AND ts.is_deleted = 0`,
      [subtaskId, id, companyId]
    );

    if (subtasks.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Subtask not found'
      });
    }

    // Soft delete subtask
    await pool.execute(
      `UPDATE task_subtasks SET is_deleted = 1, updated_at = NOW() WHERE id = ?`,
      [subtaskId]
    );

    res.json({
      success: true,
      message: 'Subtask deleted successfully'
    });
  } catch (error) {
    console.error('Delete task subtask error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete subtask',
      details: error.message
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
  getFiles,
  sendEmail,
  getNotes,
  addNote,
  updateNote,
  deleteNote,
  getSubtasks,
  addSubtask,
  updateSubtask,
  deleteSubtask
};

