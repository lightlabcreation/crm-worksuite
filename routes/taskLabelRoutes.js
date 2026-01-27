const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const { getAll, create, update, delete: deleteLabel } = require('../controllers/taskLabelController');

// Get all labels
router.get('/', verifyToken, getAll);

// Create label
router.post('/', verifyToken, create);

// Update label
router.put('/:id', verifyToken, update);

// Delete label
router.delete('/:id', verifyToken, deleteLabel);

module.exports = router;

