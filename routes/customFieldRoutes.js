const express = require('express');
const router = express.Router();
const customFieldController = require('../controllers/customFieldController');

// No authentication required - all routes are public
router.get('/', customFieldController.getAll);
router.post('/', customFieldController.create);

module.exports = router;

