// =====================================================
// Task Label Controller
// Manages task labels/tags
// =====================================================

const pool = require('../config/db');

/**
 * Get all labels for a company
 * GET /api/v1/task-labels
 */
const getAll = async (req, res) => {
    try {
        const companyId = req.companyId || req.query.company_id || req.body.company_id;

        if (!companyId) {
            return res.status(400).json({ 
                success: false, 
                error: 'company_id is required' 
            });
        }

        const [labels] = await pool.execute(
            `SELECT * FROM task_labels 
             WHERE company_id = ? AND is_active = 1
             ORDER BY name ASC`,
            [companyId]
        );

        // If no labels exist, create default labels
        if (labels.length === 0) {
            const defaultLabels = [
                { name: 'Bug', color: '#ef4444' },
                { name: 'Design', color: '#3b82f6' },
                { name: 'Enhancement', color: '#22c55e' },
                { name: 'Feedback', color: '#f97316' }
            ];

            for (const label of defaultLabels) {
                await pool.execute(
                    `INSERT INTO task_labels (company_id, name, color, created_by) 
                     VALUES (?, ?, ?, ?)`,
                    [companyId, label.name, label.color, req.userId || null]
                );
            }

            // Fetch again after creating defaults
            const [newLabels] = await pool.execute(
                `SELECT * FROM task_labels 
                 WHERE company_id = ? AND is_active = 1
                 ORDER BY name ASC`,
                [companyId]
            );
            return res.json({ success: true, data: newLabels });
        }

        res.json({ success: true, data: labels });
    } catch (error) {
        console.error('Get task labels error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
};

/**
 * Create new label
 * POST /api/v1/task-labels
 */
const create = async (req, res) => {
    try {
        const { name, color, description } = req.body;
        const companyId = req.companyId || req.body.company_id || req.query.company_id;

        if (!companyId) {
            return res.status(400).json({ 
                success: false, 
                error: 'company_id is required' 
            });
        }

        if (!name || !name.trim()) {
            return res.status(400).json({ 
                success: false, 
                error: 'name is required' 
            });
        }

        // Check if label already exists
        const [existing] = await pool.execute(
            `SELECT id FROM task_labels 
             WHERE company_id = ? AND name = ?`,
            [companyId, name.trim()]
        );

        if (existing.length > 0) {
            return res.status(400).json({ 
                success: false, 
                error: 'Label with this name already exists' 
            });
        }

        const [result] = await pool.execute(
            `INSERT INTO task_labels (company_id, name, color, description, created_by) 
             VALUES (?, ?, ?, ?, ?)`,
            [
                companyId, 
                name.trim(), 
                color || '#22c55e', 
                description || null,
                req.userId || null
            ]
        );

        const [newLabel] = await pool.execute(
            `SELECT * FROM task_labels WHERE id = ?`,
            [result.insertId]
        );

        res.status(201).json({
            success: true,
            data: newLabel[0],
            message: 'Label created successfully'
        });
    } catch (error) {
        console.error('Create task label error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
};

/**
 * Update label
 * PUT /api/v1/task-labels/:id
 */
const update = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, color, description, is_active } = req.body;
        const companyId = req.companyId || req.body.company_id || req.query.company_id;

        if (!companyId) {
            return res.status(400).json({ 
                success: false, 
                error: 'company_id is required' 
            });
        }

        // Verify label exists and belongs to company
        const [labels] = await pool.execute(
            `SELECT id FROM task_labels WHERE id = ? AND company_id = ?`,
            [id, companyId]
        );

        if (labels.length === 0) {
            return res.status(404).json({ 
                success: false, 
                error: 'Label not found' 
            });
        }

        const updates = [];
        const params = [];

        if (name !== undefined) {
            updates.push('name = ?');
            params.push(name.trim());
        }
        if (color !== undefined) {
            updates.push('color = ?');
            params.push(color);
        }
        if (description !== undefined) {
            updates.push('description = ?');
            params.push(description);
        }
        if (is_active !== undefined) {
            updates.push('is_active = ?');
            params.push(is_active ? 1 : 0);
        }

        if (updates.length === 0) {
            return res.status(400).json({ 
                success: false, 
                error: 'No fields to update' 
            });
        }

        params.push(id, companyId);

        await pool.execute(
            `UPDATE task_labels 
             SET ${updates.join(', ')}, updated_at = NOW()
             WHERE id = ? AND company_id = ?`,
            params
        );

        const [updatedLabel] = await pool.execute(
            `SELECT * FROM task_labels WHERE id = ?`,
            [id]
        );

        res.json({
            success: true,
            data: updatedLabel[0],
            message: 'Label updated successfully'
        });
    } catch (error) {
        console.error('Update task label error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
};

/**
 * Delete label
 * DELETE /api/v1/task-labels/:id
 */
const deleteLabel = async (req, res) => {
    try {
        const { id } = req.params;
        const companyId = req.companyId || req.query.company_id || req.body.company_id;

        if (!companyId) {
            return res.status(400).json({ 
                success: false, 
                error: 'company_id is required' 
            });
        }

        // Soft delete (set is_active = 0)
        await pool.execute(
            `UPDATE task_labels 
             SET is_active = 0, updated_at = NOW()
             WHERE id = ? AND company_id = ?`,
            [id, companyId]
        );

        res.json({
            success: true,
            message: 'Label deleted successfully'
        });
    } catch (error) {
        console.error('Delete task label error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
};

module.exports = {
    getAll,
    create,
    update,
    delete: deleteLabel
};

