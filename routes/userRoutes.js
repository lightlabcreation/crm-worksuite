const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');

// No authentication required - all routes are public
router.get('/', userController.getAll);
router.post('/', userController.create);
router.post('/:id/reset-password', userController.resetPassword);

module.exports = router;

