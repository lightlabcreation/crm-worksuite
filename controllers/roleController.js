const pool = require('../config/db');

/**
 * Get all roles for a company
 * GET /api/v1/roles
 */
const getRoles = async (req, res) => {
    try {
        const companyId = req.companyId || req.query.company_id || req.body.company_id;
        
        if (!companyId) {
            return res.status(400).json({ 
                success: false, 
                error: 'company_id is required' 
            });
        }

        const [roles] = await pool.execute(
            `SELECT id, role_name, description, is_system_role, created_at, updated_at 
             FROM roles 
             WHERE company_id = ? AND is_deleted = 0 
             ORDER BY is_system_role DESC, role_name ASC`,
            [companyId]
        );

        // Get user count for each role
        for (const role of roles) {
            const [userCount] = await pool.execute(
                `SELECT COUNT(*) as count FROM user_roles WHERE role_id = ?`,
                [role.id]
            );
            role.user_count = userCount[0]?.count || 0;
        }

        res.json({ success: true, data: roles });
    } catch (error) {
        console.error('Get roles error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * Get role by ID with permissions
 * GET /api/v1/roles/:id
 */
const getRoleById = async (req, res) => {
    try {
        const { id } = req.params;
        const companyId = req.companyId || req.query.company_id;

        const [roles] = await pool.execute(
            `SELECT * FROM roles WHERE id = ? AND company_id = ? AND is_deleted = 0`,
            [id, companyId]
        );

        if (roles.length === 0) {
            return res.status(404).json({ success: false, error: 'Role not found' });
        }

        const role = roles[0];

        // Get permissions
        const [permissions] = await pool.execute(
            `SELECT * FROM role_permissions WHERE role_id = ?`,
            [id]
        );

        role.permissions = permissions;

        res.json({ success: true, data: role });
    } catch (error) {
        console.error('Get role by ID error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * Get all available modules (dynamic)
 * GET /api/v1/roles/modules
 */
const getModules = async (req, res) => {
    try {
        const { type } = req.query; // 'ADMIN', 'EMPLOYEE', 'CLIENT', or 'ALL'

        let query = `SELECT * FROM modules WHERE is_active = 1`;
        const params = [];

        if (type && type !== 'ALL') {
            query += ` AND (module_type = ? OR module_type = 'ALL')`;
            params.push(type);
        }

        query += ` ORDER BY sort_order ASC, module_name ASC`;

        const [modules] = await pool.execute(query, params);

        res.json({ success: true, data: modules });
    } catch (error) {
        console.error('Get modules error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * Get role permissions
 * GET /api/v1/roles/:id/permissions
 */
const getRolePermissions = async (req, res) => {
    try {
        const { id } = req.params;
        const companyId = req.companyId || req.query.company_id;

        // Verify role exists and belongs to company
        const [roles] = await pool.execute(
            `SELECT id FROM roles WHERE id = ? AND company_id = ? AND is_deleted = 0`,
            [id, companyId]
        );

        if (roles.length === 0) {
            return res.status(404).json({ success: false, error: 'Role not found' });
        }

        // Check if 'module' column exists, otherwise order by id
        let orderClause = 'ORDER BY id ASC';
        try {
            const [columns] = await pool.execute(
                `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
                 WHERE TABLE_NAME = 'role_permissions' 
                 AND TABLE_SCHEMA = DATABASE() 
                 AND COLUMN_NAME = 'module'`
            );
            if (columns.length > 0) {
                orderClause = 'ORDER BY module ASC';
            }
        } catch (e) {
            // If check fails, use default ordering
            console.warn('Could not check for module column, using default order:', e);
        }

        const [perms] = await pool.execute(
            `SELECT * FROM role_permissions WHERE role_id = ? ${orderClause}`,
            [id]
        );

        res.json({ success: true, data: perms });
    } catch (error) {
        console.error('Get role permissions error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * Update role permissions
 * PUT /api/v1/roles/:id/permissions
 */
const updateRolePermissions = async (req, res) => {
    try {
        const { id } = req.params;
        const { permissions } = req.body; // array of { module, can_view, can_add, can_edit, can_delete }
        const companyId = req.companyId || req.body.company_id || req.query.company_id;

        if (!companyId) {
            return res.status(400).json({ success: false, error: 'company_id is required' });
        }

        // Verify role exists and belongs to company
        const [roles] = await pool.execute(
            `SELECT id FROM roles WHERE id = ? AND company_id = ? AND is_deleted = 0`,
            [id, companyId]
        );

        if (roles.length === 0) {
            return res.status(404).json({ success: false, error: 'Role not found' });
        }

        if (!Array.isArray(permissions)) {
            return res.status(400).json({ success: false, error: "Permissions must be an array" });
        }

        // Filter and validate permissions - remove duplicates and empty modules
        const validPermissions = [];
        const seenModules = new Set();
        
        for (const p of permissions) {
            // Skip if module is missing, empty, or not a string
            if (!p.module || typeof p.module !== 'string' || !p.module.trim()) {
                continue;
            }
            
            const module = p.module.trim();
            
            // Skip if we've already seen this module (avoid duplicates)
            if (seenModules.has(module)) {
                continue;
            }
            
            seenModules.add(module);
            validPermissions.push({
                module: module,
                can_view: p.can_view ? 1 : 0,
                can_add: p.can_add ? 1 : 0,
                can_edit: p.can_edit ? 1 : 0,
                can_delete: p.can_delete ? 1 : 0
            });
        }

        if (validPermissions.length === 0) {
            return res.status(400).json({ success: false, error: "No valid permissions provided" });
        }

        // Ensure role_permissions table has module-based schema (not old permission_id schema)
        const [columns] = await pool.execute(
            `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'role_permissions'`
        );
        const columnNames = (columns || []).map(c => c.COLUMN_NAME);
        const hasModule = columnNames.includes('module');
        const hasPermissionId = columnNames.includes('permission_id');
        if (!hasModule || hasPermissionId) {
            return res.status(503).json({
                success: false,
                error: "Role permissions table uses old schema (permission_id). Please run migration: backend-12-crm/migrations/alter_role_permissions_to_module_based.sql",
                code: "ROLE_PERMISSIONS_SCHEMA_MIGRATION_REQUIRED"
            });
        }

        // Get connection for transaction
        const connection = await pool.getConnection();
        
        try {
            // Start transaction
            await connection.beginTransaction();

            // Use INSERT ... ON DUPLICATE KEY UPDATE to handle duplicates gracefully
            for (const p of validPermissions) {
                await connection.execute(
                    `INSERT INTO role_permissions (role_id, module, can_view, can_add, can_edit, can_delete)
                     VALUES (?, ?, ?, ?, ?, ?)
                     ON DUPLICATE KEY UPDATE
                         can_view = VALUES(can_view),
                         can_add = VALUES(can_add),
                         can_edit = VALUES(can_edit),
                         can_delete = VALUES(can_delete)`,
                    [
                        id, 
                        p.module, 
                        p.can_view, 
                        p.can_add, 
                        p.can_edit, 
                        p.can_delete
                    ]
                );
            }

            await connection.commit();
            connection.release();
            res.json({ success: true, message: 'Permissions updated successfully' });
        } catch (error) {
            await connection.rollback();
            connection.release();
            throw error;
        }
    } catch (error) {
        console.error('Update role permissions error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * Create new role
 * POST /api/v1/roles
 */
const addRole = async (req, res) => {
    try {
        const { role_name, description, is_system_role } = req.body;
        // Get companyId from multiple sources (middleware sets req.companyId from user.company_id)
        const companyId = req.companyId || req.user?.company_id || req.body.company_id || req.query.company_id;

        if (!companyId) {
            console.error('Add role error: company_id missing', {
                reqCompanyId: req.companyId,
                userCompanyId: req.user?.company_id,
                bodyCompanyId: req.body.company_id,
                queryCompanyId: req.query.company_id
            });
            return res.status(400).json({ 
                success: false, 
                error: 'company_id is required. Please ensure you are logged in and have a company assigned.' 
            });
        }

        if (!role_name || !role_name.trim()) {
            return res.status(400).json({ success: false, error: 'role_name is required' });
        }

        // Check if role already exists for this company
        const [existing] = await pool.execute(
            `SELECT id FROM roles WHERE company_id = ? AND role_name = ? AND is_deleted = 0`,
            [companyId, role_name.trim()]
        );

        if (existing.length > 0) {
            return res.status(400).json({ success: false, error: 'Role with this name already exists' });
        }

        const [result] = await pool.execute(
            'INSERT INTO roles (company_id, role_name, description, is_system_role) VALUES (?, ?, ?, ?)',
            [companyId, role_name.trim(), description || '', is_system_role ? 1 : 0]
        );

        const roleId = result.insertId;

        // Initialize default permissions for the new role
        try {
            const { initializeDefaultPermissions } = require('../helpers/roleInitializer');
            await initializeDefaultPermissions(companyId, roleId, role_name.trim());
            console.log(`✅ Default permissions initialized for role: ${role_name}`);
        } catch (permError) {
            console.error('⚠️ Error initializing default permissions (non-fatal):', permError);
            // Don't fail role creation if permissions initialization fails
        }

        const [newRole] = await pool.execute(
            'SELECT * FROM roles WHERE id = ?',
            [roleId]
        );

        res.status(201).json({ 
            success: true, 
            data: newRole[0],
            message: 'Role created successfully with default permissions' 
        });
    } catch (error) {
        console.error('Add role error:', error);
        console.error('Error details:', {
            message: error.message,
            code: error.code,
            sqlState: error.sqlState,
            sqlMessage: error.sqlMessage,
            stack: error.stack
        });
        
        // Provide more detailed error message
        let errorMessage = 'Failed to create role';
        
        if (error.code === 'ER_DUP_ENTRY') {
            errorMessage = 'Role with this name already exists for this company';
        } else if (error.code === 'ER_NO_REFERENCED_ROW_2' || error.code === 'ER_NO_REFERENCED_ROW') {
            errorMessage = 'Invalid company_id. Company does not exist.';
        } else if (error.sqlMessage) {
            errorMessage = error.sqlMessage;
        } else if (error.message) {
            errorMessage = error.message;
        }
        
        res.status(500).json({ 
            success: false, 
            error: errorMessage,
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Update role
 * PUT /api/v1/roles/:id
 */
const updateRole = async (req, res) => {
    try {
        const { id } = req.params;
        const { role_name, description } = req.body;
        const companyId = req.companyId || req.body.company_id || req.query.company_id;

        if (!companyId) {
            return res.status(400).json({ success: false, error: 'company_id is required' });
        }

        // Verify role exists and belongs to company
        const [roles] = await pool.execute(
            `SELECT id, is_system_role FROM roles WHERE id = ? AND company_id = ? AND is_deleted = 0`,
            [id, companyId]
        );

        if (roles.length === 0) {
            return res.status(404).json({ success: false, error: 'Role not found' });
        }

        // System roles cannot be renamed
        if (roles[0].is_system_role && role_name) {
            return res.status(400).json({ success: false, error: 'System roles cannot be renamed' });
        }

        const updates = [];
        const params = [];

        if (role_name) {
            // Check if new name already exists
            const [existing] = await pool.execute(
                `SELECT id FROM roles WHERE company_id = ? AND role_name = ? AND id != ? AND is_deleted = 0`,
                [companyId, role_name.trim(), id]
            );

            if (existing.length > 0) {
                return res.status(400).json({ success: false, error: 'Role with this name already exists' });
            }

            updates.push('role_name = ?');
            params.push(role_name.trim());
        }

        if (description !== undefined) {
            updates.push('description = ?');
            params.push(description || '');
        }

        if (updates.length === 0) {
            return res.status(400).json({ success: false, error: 'No fields to update' });
        }

        updates.push('updated_at = NOW()');
        params.push(id);

        await pool.execute(
            `UPDATE roles SET ${updates.join(', ')} WHERE id = ?`,
            params
        );

        const [updatedRole] = await pool.execute(
            'SELECT * FROM roles WHERE id = ?',
            [id]
        );

        res.json({ 
            success: true, 
            data: updatedRole[0],
            message: 'Role updated successfully' 
        });
    } catch (error) {
        console.error('Update role error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * Delete role (soft delete)
 * DELETE /api/v1/roles/:id
 */
const deleteRole = async (req, res) => {
    try {
        const { id } = req.params;
        const companyId = req.companyId || req.query.company_id;

        if (!companyId) {
            return res.status(400).json({ success: false, error: 'company_id is required' });
        }

        // Verify role exists and belongs to company
        const [roles] = await pool.execute(
            `SELECT id, is_system_role FROM roles WHERE id = ? AND company_id = ? AND is_deleted = 0`,
            [id, companyId]
        );

        if (roles.length === 0) {
            return res.status(404).json({ success: false, error: 'Role not found' });
        }

        // System roles cannot be deleted
        if (roles[0].is_system_role) {
            return res.status(400).json({ success: false, error: 'System roles cannot be deleted' });
        }

        // Check if role is assigned to any users
        const [userRoles] = await pool.execute(
            `SELECT COUNT(*) as count FROM user_roles WHERE role_id = ?`,
            [id]
        );

        if (userRoles[0]?.count > 0) {
            return res.status(400).json({ 
                success: false, 
                error: `Cannot delete role. It is assigned to ${userRoles[0].count} user(s). Please reassign users first.` 
            });
        }

        await pool.execute(
            'UPDATE roles SET is_deleted = 1, updated_at = NOW() WHERE id = ?',
            [id]
        );

        res.json({ success: true, message: 'Role deleted successfully' });
    } catch (error) {
        console.error('Delete role error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * Assign role to user
 * POST /api/v1/roles/:id/assign
 */
const assignRoleToUser = async (req, res) => {
    try {
        const { id } = req.params; // role_id
        const { user_id } = req.body;
        const companyId = req.companyId || req.body.company_id || req.query.company_id;

        if (!companyId) {
            return res.status(400).json({ success: false, error: 'company_id is required' });
        }

        if (!user_id) {
            return res.status(400).json({ success: false, error: 'user_id is required' });
        }

        // Verify role exists
        const [roles] = await pool.execute(
            `SELECT id FROM roles WHERE id = ? AND company_id = ? AND is_deleted = 0`,
            [id, companyId]
        );

        if (roles.length === 0) {
            return res.status(404).json({ success: false, error: 'Role not found' });
        }

        // Verify user exists and belongs to company
        const [users] = await pool.execute(
            `SELECT id FROM users WHERE id = ? AND company_id = ? AND is_deleted = 0`,
            [user_id, companyId]
        );

        if (users.length === 0) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }

        // Check if already assigned
        const [existing] = await pool.execute(
            `SELECT id FROM user_roles WHERE user_id = ? AND role_id = ?`,
            [user_id, id]
        );

        if (existing.length > 0) {
            return res.status(400).json({ success: false, error: 'Role already assigned to this user' });
        }

        // Assign role
        await pool.execute(
            'INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)',
            [user_id, id]
        );

        // Update user's role_id for backward compatibility
        await pool.execute(
            'UPDATE users SET role_id = ? WHERE id = ?',
            [id, user_id]
        );

        res.json({ success: true, message: 'Role assigned successfully' });
    } catch (error) {
        console.error('Assign role to user error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * Remove role from user
 * DELETE /api/v1/roles/:id/assign/:user_id
 */
const removeRoleFromUser = async (req, res) => {
    try {
        const { id, user_id } = req.params; // role_id, user_id
        const companyId = req.companyId || req.query.company_id;

        if (!companyId) {
            return res.status(400).json({ success: false, error: 'company_id is required' });
        }

        // Verify role exists
        const [roles] = await pool.execute(
            `SELECT id FROM roles WHERE id = ? AND company_id = ? AND is_deleted = 0`,
            [id, companyId]
        );

        if (roles.length === 0) {
            return res.status(404).json({ success: false, error: 'Role not found' });
        }

        // Remove role assignment
        await pool.execute(
            'DELETE FROM user_roles WHERE user_id = ? AND role_id = ?',
            [user_id, id]
        );

        // Update user's role_id to NULL if it was this role
        await pool.execute(
            'UPDATE users SET role_id = NULL WHERE id = ? AND role_id = ?',
            [user_id, id]
        );

        res.json({ success: true, message: 'Role removed successfully' });
    } catch (error) {
        console.error('Remove role from user error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * Get users with a specific role
 * GET /api/v1/roles/:id/users
 */
const getRoleUsers = async (req, res) => {
    try {
        const { id } = req.params;
        const companyId = req.companyId || req.query.company_id;

        if (!companyId) {
            return res.status(400).json({ success: false, error: 'company_id is required' });
        }

        // Verify role exists
        const [roles] = await pool.execute(
            `SELECT id FROM roles WHERE id = ? AND company_id = ? AND is_deleted = 0`,
            [id, companyId]
        );

        if (roles.length === 0) {
            return res.status(404).json({ success: false, error: 'Role not found' });
        }

        const [users] = await pool.execute(
            `SELECT u.id, u.name, u.email, u.role, u.status, u.avatar, ur.created_at as assigned_at
             FROM users u
             INNER JOIN user_roles ur ON u.id = ur.user_id
             WHERE ur.role_id = ? AND u.company_id = ? AND u.is_deleted = 0
             ORDER BY u.name ASC`,
            [id, companyId]
        );

        res.json({ success: true, data: users });
    } catch (error) {
        console.error('Get role users error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * Get user's permissions (all roles combined)
 * GET /api/v1/roles/user-permissions
 */
const getUserPermissions = async (req, res) => {
    try {
        const userId = req.userId || req.query.user_id || req.body.user_id;
        const companyId = req.companyId || req.query.company_id || req.body.company_id || req.user?.company_id;

        if (!userId) {
            return res.status(400).json({ 
                success: false, 
                error: 'user_id is required' 
            });
        }

        if (!companyId) {
            return res.status(400).json({ 
                success: false, 
                error: 'company_id is required' 
            });
        }

        // Get user's roles
        const [userRoles] = await pool.execute(
            `SELECT role_id FROM user_roles WHERE user_id = ?`,
            [userId]
        );

        if (userRoles.length === 0) {
            // No roles assigned, return empty permissions
            return res.json({
                success: true,
                data: {
                    roles: [],
                    permissions: {}
                }
            });
        }

        const roleIds = userRoles.map(ur => ur.role_id);
        const placeholders = roleIds.map(() => '?').join(',');

        // Get all permissions for user's roles
        // If user has multiple roles, combine permissions (OR logic - if any role has permission, user has it)
        const [permissions] = await pool.execute(
            `SELECT module, 
                    MAX(can_view) as can_view,
                    MAX(can_add) as can_add,
                    MAX(can_edit) as can_edit,
                    MAX(can_delete) as can_delete
             FROM role_permissions
             WHERE role_id IN (${placeholders})
             GROUP BY module`,
            roleIds
        );

        // Get role names
        const [roles] = await pool.execute(
            `SELECT id, role_name, description FROM roles WHERE id IN (${placeholders}) AND is_deleted = 0`,
            roleIds
        );

        // Convert permissions to object format
        const permissionsMap = {};
        permissions.forEach(p => {
            permissionsMap[p.module] = {
                can_view: !!p.can_view,
                can_add: !!p.can_add,
                can_edit: !!p.can_edit,
                can_delete: !!p.can_delete
            };
        });

        res.json({
            success: true,
            data: {
                roles: roles,
                permissions: permissionsMap
            }
        });
    } catch (error) {
        console.error('Get user permissions error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
};

module.exports = { 
    getRoles, 
    getRoleById,
    getModules,
    getRolePermissions, 
    updateRolePermissions, 
    addRole,
    updateRole,
    deleteRole,
    assignRoleToUser,
    removeRoleFromUser,
    getRoleUsers,
    getUserPermissions
};
