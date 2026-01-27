// =====================================================
// Activity Controller
// Tracks all system activities/actions
// =====================================================

const pool = require('../config/db');

/**
 * Get activities for a module/item
 * GET /api/v1/activities
 */
const getAll = async (req, res) => {
    try {
        const { 
            company_id, 
            module, 
            module_id, 
            related_to_type, 
            related_to_id,
            user_id,
            limit = 50,
            offset = 0
        } = req.query;

        const companyId = company_id || req.companyId || req.body.company_id;

        if (!companyId) {
            return res.status(400).json({ 
                success: false, 
                error: 'company_id is required' 
            });
        }

        let whereClause = 'WHERE company_id = ?';
        const params = [companyId];

        if (module) {
            whereClause += ' AND module = ?';
            params.push(module);
        }

        if (module_id) {
            whereClause += ' AND module_id = ?';
            params.push(module_id);
        }

        if (related_to_type) {
            whereClause += ' AND related_to_type = ?';
            params.push(related_to_type);
        }

        if (related_to_id) {
            whereClause += ' AND related_to_id = ?';
            params.push(related_to_id);
        }

        if (user_id) {
            whereClause += ' AND user_id = ?';
            params.push(user_id);
        }

        const [activities] = await pool.execute(
            `SELECT * FROM activities 
             ${whereClause}
             ORDER BY created_at DESC 
             LIMIT ? OFFSET ?`,
            [...params, parseInt(limit), parseInt(offset)]
        );

        const [countResult] = await pool.execute(
            `SELECT COUNT(*) as total FROM activities ${whereClause}`,
            params
        );

        res.json({
            success: true,
            data: activities,
            total: countResult[0]?.total || 0
        });
    } catch (error) {
        console.error('Get activities error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
};

/**
 * Create activity log
 * POST /api/v1/activities
 */
const create = async (req, res) => {
    try {
        const {
            company_id,
            user_id,
            user_name,
            module,
            module_id,
            action,
            description,
            related_to_type,
            related_to_id,
            old_value,
            new_value
        } = req.body;

        const companyId = company_id || req.companyId || req.body.company_id;
        const userId = user_id || req.userId || req.body.user_id;
        const userName = user_name || req.user?.name || req.body.user_name;
        const ipAddress = req.ip || req.connection.remoteAddress;

        if (!companyId) {
            return res.status(400).json({ 
                success: false, 
                error: 'company_id is required' 
            });
        }

        if (!module || !action || !description) {
            return res.status(400).json({ 
                success: false, 
                error: 'module, action, and description are required' 
            });
        }

        const [result] = await pool.execute(
            `INSERT INTO activities (
                company_id, user_id, user_name, module, module_id, 
                action, description, related_to_type, related_to_id,
                old_value, new_value, ip_address
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                companyId, userId, userName, module, module_id || null,
                action, description, related_to_type || null, related_to_id || null,
                old_value || null, new_value || null, ipAddress || null
            ]
        );

        res.status(201).json({
            success: true,
            data: { id: result.insertId },
            message: 'Activity logged successfully'
        });
    } catch (error) {
        console.error('Create activity error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
};

/**
 * Helper function to log activity (can be used by other controllers)
 */
const logActivity = async (data) => {
    try {
        const {
            company_id,
            user_id,
            user_name,
            module,
            module_id,
            action,
            description,
            related_to_type,
            related_to_id,
            old_value,
            new_value,
            ip_address
        } = data;

        if (!company_id || !module || !action || !description) {
            console.warn('Activity log skipped: missing required fields', data);
            return;
        }

        await pool.execute(
            `INSERT INTO activities (
                company_id, user_id, user_name, module, module_id, 
                action, description, related_to_type, related_to_id,
                old_value, new_value, ip_address
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                company_id, user_id || null, user_name || null, module, module_id || null,
                action, description, related_to_type || null, related_to_id || null,
                old_value || null, new_value || null, ip_address || null
            ]
        );
    } catch (error) {
        console.error('Log activity error:', error);
        // Don't throw - activity logging should not break main operations
    }
};

module.exports = {
    getAll,
    create,
    logActivity
};

