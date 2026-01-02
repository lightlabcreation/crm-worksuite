const express = require('express');
const router = express.Router();
const proposalController = require('../controllers/proposalController');

// No authentication required - all routes are public
router.get('/filters', proposalController.getFilters);
router.get('/', proposalController.getAll);
router.get('/:id', proposalController.getById);
router.get('/:id/pdf', proposalController.getPDF);
router.post('/', proposalController.create);
router.post('/:id/duplicate', proposalController.duplicate);
router.post('/:id/convert-to-invoice', proposalController.convertToInvoice);
router.post('/:id/send-email', proposalController.sendEmail);
router.put('/:id', proposalController.update);
router.put('/:id/status', proposalController.updateStatus);
router.delete('/:id', proposalController.delete);

module.exports = router;

