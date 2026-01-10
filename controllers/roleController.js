const pool = require('../config/db');

const getRoles = async (req, res) => {
    try {
        const companyId = req.companyId || req.query.company_id || 1;
        const [roles] = await pool.execute(
            `SELECT id, role_name, description FROM roles WHERE company_id = ? AND is_deleted = 0`,
            [companyId]
        );
        res.json({ success: true, data: roles });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

const getRolePermissions = async (req, res) => {
    try {
        const { id } = req.params;
        const [perms] = await pool.execute('SELECT * FROM role_permissions WHERE role_id = ?', [id]);
        res.json({ success: true, data: perms });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

const updateRolePermissions = async (req, res) => {
    try {
        const { id } = req.params;
        const { permissions } = req.body; // array

        if (!Array.isArray(permissions)) {
            return res.status(400).json({ success: false, error: "Permissions must be an array" });
        }

        for (const p of permissions) {
            const [exists] = await pool.execute(
                'SELECT id FROM role_permissions WHERE role_id = ? AND module = ?',
                [id, p.module]
            );

            if (exists.length > 0) {
                await pool.execute(
                    `UPDATE role_permissions SET 
                 can_view = ?, can_add = ?, can_edit = ?, can_delete = ? 
                 WHERE id = ?`,
                    [p.can_view ? 1 : 0, p.can_add ? 1 : 0, p.can_edit ? 1 : 0, p.can_delete ? 1 : 0, exists[0].id]
                );
            } else {
                await pool.execute(
                    `INSERT INTO role_permissions (role_id, module, can_view, can_add, can_edit, can_delete)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                    [id, p.module, p.can_view ? 1 : 0, p.can_add ? 1 : 0, p.can_edit ? 1 : 0, p.can_delete ? 1 : 0]
                );
            }
        }

        res.json({ success: true, message: 'Permissions updated' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: error.message });
    }
};

const addRole = async (req, res) => {
    try {
        const { roleName, description } = req.body;
        const companyId = req.companyId || req.body.company_id || 1;

        const [result] = await pool.execute(
            'INSERT INTO roles (company_id, role_name, description) VALUES (?, ?, ?)',
            [companyId, roleName, description || '']
        );

        res.json({ success: true, data: { id: result.insertId, role_name: roleName } });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

const deleteRole = async (req, res) => {
    try {
        const { id } = req.params;
        await pool.execute('UPDATE roles SET is_deleted = 1 WHERE id = ?', [id]);
        res.json({ success: true, message: 'Role deleted' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

module.exports = { getRoles, getRolePermissions, updateRolePermissions, addRole, deleteRole };
