const express = require('express');
const router = express.Router();
const emailTemplateController = require('../controllers/emailTemplateController');

// No authentication required - all routes are public
router.get('/', emailTemplateController.getAll);
router.get('/:id', emailTemplateController.getById);
router.post('/', emailTemplateController.create);
router.put('/:id', emailTemplateController.update);
router.delete('/:id', emailTemplateController.delete);

module.exports = router;

