const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const { 
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
} = require('../controllers/roleController');

// Get all modules (dynamic)
router.get('/modules', verifyToken, getModules);

// Get all roles
router.get('/', verifyToken, getRoles);

// Create new role
router.post('/', verifyToken, addRole);

// Get role by ID
router.get('/:id', verifyToken, getRoleById);

// Update role
router.put('/:id', verifyToken, updateRole);

// Delete role
router.delete('/:id', verifyToken, deleteRole);

// Get role permissions
router.get('/:id/permissions', verifyToken, getRolePermissions);

// Update role permissions
router.put('/:id/permissions', verifyToken, updateRolePermissions);

// Get users with this role
router.get('/:id/users', verifyToken, getRoleUsers);

// Assign role to user
router.post('/:id/assign', verifyToken, assignRoleToUser);

// Remove role from user
router.delete('/:id/assign/:user_id', verifyToken, removeRoleFromUser);

// Get user's permissions (all roles combined)
router.get('/user-permissions', verifyToken, getUserPermissions);

module.exports = router;
