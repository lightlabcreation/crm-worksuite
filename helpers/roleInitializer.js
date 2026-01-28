/**
 * Role Initializer Helper
 * Initializes default roles and permissions for a new company
 */

const pool = require('../config/db');

/**
 * Initialize default roles for a company
 * @param {number} companyId - Company ID
 * @returns {Promise<Object>} Created roles
 */
const initializeDefaultRoles = async (companyId) => {
  try {
    // Default roles configuration
    const defaultRoles = [
      {
        role_name: 'ADMIN',
        description: 'Full access to all company features and settings',
        is_system_role: 1
      },
      {
        role_name: 'EMPLOYEE',
        description: 'Standard employee access to assigned tasks and projects',
        is_system_role: 1
      },
      {
        role_name: 'CLIENT',
        description: 'Client access to view projects, invoices, and make payments',
        is_system_role: 1
      },
      {
        role_name: 'MANAGER',
        description: 'Manager access with team oversight capabilities',
        is_system_role: 0
      }
    ];

    const createdRoles = [];

    for (const roleConfig of defaultRoles) {
      // Check if role already exists
      const [existing] = await pool.execute(
        `SELECT id FROM roles WHERE company_id = ? AND role_name = ? AND is_deleted = 0`,
        [companyId, roleConfig.role_name]
      );

      if (existing.length === 0) {
        // Create role
        const [result] = await pool.execute(
          `INSERT INTO roles (company_id, role_name, description, is_system_role)
           VALUES (?, ?, ?, ?)`,
          [companyId, roleConfig.role_name, roleConfig.description, roleConfig.is_system_role]
        );

        const roleId = result.insertId;
        createdRoles.push({ id: roleId, ...roleConfig });

        // Initialize default permissions based on role type
        await initializeDefaultPermissions(companyId, roleId, roleConfig.role_name);
      } else {
        createdRoles.push({ id: existing[0].id, ...roleConfig });
      }
    }

    return createdRoles;
  } catch (error) {
    console.error('Error initializing default roles:', error);
    throw error;
  }
};

/**
 * Initialize default permissions for a role
 * @param {number} companyId - Company ID
 * @param {number} roleId - Role ID
 * @param {string} roleName - Role name
 */
const initializeDefaultPermissions = async (companyId, roleId, roleName) => {
  try {
    // Get all active modules
    const [modules] = await pool.execute(
      `SELECT module_key FROM modules WHERE is_active = 1`
    );

    const moduleKeys = modules.map(m => m.module_key);

    // Default permissions based on role
    const defaultPermissions = getDefaultPermissionsForRole(roleName, moduleKeys);

    // Insert permissions
    for (const perm of defaultPermissions) {
      await pool.execute(
        `INSERT INTO role_permissions (role_id, module, can_view, can_add, can_edit, can_delete)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
         can_view = VALUES(can_view),
         can_add = VALUES(can_add),
         can_edit = VALUES(can_edit),
         can_delete = VALUES(can_delete)`,
        [
          roleId,
          perm.module,
          perm.can_view ? 1 : 0,
          perm.can_add ? 1 : 0,
          perm.can_edit ? 1 : 0,
          perm.can_delete ? 1 : 0
        ]
      );
    }
  } catch (error) {
    console.error('Error initializing default permissions:', error);
    throw error;
  }
};

/**
 * Get default permissions for a role
 * @param {string} roleName - Role name
 * @param {Array<string>} moduleKeys - Available module keys
 * @returns {Array<Object>} Permissions array
 */
const getDefaultPermissionsForRole = (roleName, moduleKeys) => {
  const roleUpper = roleName.toUpperCase();
  const permissions = [];

  moduleKeys.forEach(moduleKey => {
    let perm = {
      module: moduleKey,
      can_view: false,
      can_add: false,
      can_edit: false,
      can_delete: false
    };

    // ADMIN: Full access to everything
    if (roleUpper === 'ADMIN') {
      perm = {
        module: moduleKey,
        can_view: true,
        can_add: true,
        can_edit: true,
        can_delete: true
      };
    }
    // EMPLOYEE: View and add for most modules, limited edit/delete
    else if (roleUpper === 'EMPLOYEE') {
      perm = {
        module: moduleKey,
        can_view: true,
        can_add: ['myTasks', 'myProjects', 'timeTracking', 'events', 'messages', 'tickets', 'documents', 'attendance', 'leaveRequests'].includes(moduleKey),
        can_edit: ['myTasks', 'myProjects', 'timeTracking', 'events', 'messages', 'tickets', 'documents'].includes(moduleKey),
        can_delete: ['messages', 'tickets', 'documents'].includes(moduleKey)
      };
    }
    // HR: Employee access with HR-specific permissions
    else if (roleUpper === 'HR' || roleUpper === 'HUMAN RESOURCES') {
      perm = {
        module: moduleKey,
        can_view: true,
        // HR can add: tasks, projects, time tracking, events, messages, tickets, documents, attendance, leave requests, employees
        can_add: ['myTasks', 'myProjects', 'timeTracking', 'events', 'messages', 'tickets', 'documents', 'attendance', 'leaveRequests', 'employees', 'tasks', 'projects'].includes(moduleKey),
        // HR can edit: tasks, projects, time tracking, events, messages, tickets, documents, employees, attendance
        can_edit: ['myTasks', 'myProjects', 'timeTracking', 'events', 'messages', 'tickets', 'documents', 'employees', 'attendance', 'tasks', 'projects'].includes(moduleKey),
        // HR can delete: messages, tickets, documents
        can_delete: ['messages', 'tickets', 'documents'].includes(moduleKey)
      };
    }
    // SALES: Employee access with sales-specific permissions
    else if (roleUpper === 'SALES' || roleUpper === 'SALES REP' || roleUpper === 'SALES REPRESENTATIVE') {
      perm = {
        module: moduleKey,
        can_view: true,
        // Sales can add: tasks, projects, time tracking, events, messages, tickets, documents, leads, clients, proposals, invoices
        can_add: ['myTasks', 'myProjects', 'timeTracking', 'events', 'messages', 'tickets', 'documents', 'leads', 'clients', 'proposals', 'invoices'].includes(moduleKey),
        // Sales can edit: tasks, projects, time tracking, events, messages, tickets, documents, leads, clients, proposals
        can_edit: ['myTasks', 'myProjects', 'timeTracking', 'events', 'messages', 'tickets', 'documents', 'leads', 'clients', 'proposals'].includes(moduleKey),
        // Sales can delete: messages, tickets, documents
        can_delete: ['messages', 'tickets', 'documents'].includes(moduleKey)
      };
    }
    // Other employee-type roles (STAFF, WORKER, etc.): Standard employee permissions
    else if (roleUpper.includes('EMPLOYEE') || roleUpper.includes('STAFF') || roleUpper.includes('WORKER') || roleUpper.includes('MEMBER')) {
      perm = {
        module: moduleKey,
        can_view: true,
        can_add: ['myTasks', 'myProjects', 'timeTracking', 'events', 'messages', 'tickets', 'documents', 'attendance', 'leaveRequests'].includes(moduleKey),
        can_edit: ['myTasks', 'myProjects', 'timeTracking', 'events', 'messages', 'tickets', 'documents'].includes(moduleKey),
        can_delete: ['messages', 'tickets', 'documents'].includes(moduleKey)
      };
    }
    // CLIENT: View only for most, limited add/edit
    else if (roleUpper === 'CLIENT') {
      perm = {
        module: moduleKey,
        can_view: ['dashboard', 'projects', 'proposals', 'invoices', 'payments', 'contracts', 'store', 'files', 'messages', 'tickets', 'notes', 'orders', 'subscriptions'].includes(moduleKey),
        can_add: ['payments', 'messages', 'tickets', 'notes'].includes(moduleKey),
        can_edit: ['messages', 'tickets', 'notes'].includes(moduleKey),
        can_delete: ['messages', 'tickets', 'notes'].includes(moduleKey)
      };
    }
    // MANAGER: Similar to employee but with more edit/delete permissions
    else if (roleUpper === 'MANAGER') {
      perm = {
        module: moduleKey,
        can_view: true,
        can_add: !['settings', 'reports'].includes(moduleKey),
        can_edit: !['settings', 'reports'].includes(moduleKey),
        can_delete: ['tasks', 'projects', 'messages', 'tickets', 'documents'].includes(moduleKey)
      };
    }

    permissions.push(perm);
  });

  return permissions;
};

/**
 * Assign role to user
 * @param {number} userId - User ID
 * @param {number} roleId - Role ID
 * @param {number} companyId - Company ID
 */
const assignRoleToUser = async (userId, roleId, companyId) => {
  try {
    // Check if already assigned
    const [existing] = await pool.execute(
      `SELECT id FROM user_roles WHERE user_id = ? AND role_id = ?`,
      [userId, roleId]
    );

    if (existing.length === 0) {
      // Assign role
      await pool.execute(
        `INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)`,
        [userId, roleId]
      );

      // Update user's role_id for backward compatibility
      await pool.execute(
        `UPDATE users SET role_id = ? WHERE id = ? AND company_id = ?`,
        [roleId, userId, companyId]
      );
    }
  } catch (error) {
    console.error('Error assigning role to user:', error);
    throw error;
  }
};

/**
 * Get role ID by name for a company
 * @param {number} companyId - Company ID
 * @param {string} roleName - Role name
 * @returns {Promise<number|null>} Role ID or null
 */
const getRoleIdByName = async (companyId, roleName) => {
  try {
    const [roles] = await pool.execute(
      `SELECT id FROM roles WHERE company_id = ? AND role_name = ? AND is_deleted = 0`,
      [companyId, roleName]
    );

    return roles.length > 0 ? roles[0].id : null;
  } catch (error) {
    console.error('Error getting role ID by name:', error);
    return null;
  }
};

module.exports = {
  initializeDefaultRoles,
  initializeDefaultPermissions,
  assignRoleToUser,
  getRoleIdByName,
  getDefaultPermissionsForRole
};

