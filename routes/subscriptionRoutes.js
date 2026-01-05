const express = require('express');
const router = express.Router();
const subscriptionController = require('../controllers/subscriptionController');

// No authentication required - all routes are public
router.get('/', subscriptionController.getAll);
router.post('/', subscriptionController.create);
router.put('/:id/cancel', subscriptionController.cancel);
router.put('/:id', subscriptionController.update);
router.delete('/:id', subscriptionController.delete);

module.exports = router;

