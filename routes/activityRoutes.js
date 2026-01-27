const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const { getAll, create } = require('../controllers/activityController');

// Get activities
router.get('/', verifyToken, getAll);

// Create activity
router.post('/', verifyToken, create);

module.exports = router;

