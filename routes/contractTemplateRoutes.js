const express = require('express');
const router = express.Router();
const contractTemplateController = require('../controllers/contractTemplateController');

// Contract template routes
router.get('/', contractTemplateController.getAll);
router.get('/:id', contractTemplateController.getById);
router.post('/', contractTemplateController.create);
router.put('/:id', contractTemplateController.update);
router.delete('/:id', contractTemplateController.delete);
router.post('/:id/render', contractTemplateController.renderTemplate);

module.exports = router;

