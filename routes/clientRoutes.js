// =====================================================
// Client Routes
// =====================================================

const express = require('express');
const router = express.Router();
const clientController = require('../controllers/clientController');

// No authentication required - all routes are public
// IMPORTANT: Specific routes must come before parameterized routes
router.get('/overview', clientController.getOverview);
router.get('/contacts/all', clientController.getAllContacts);

// Label management - MUST be before /:id routes
router.get('/labels', clientController.getAllLabels);
router.post('/labels', clientController.createLabel);
router.delete('/labels/:label', clientController.deleteLabel);
router.get('/groups', clientController.getAllGroups);
router.put('/:id/labels', clientController.updateClientLabels);
router.get('/', clientController.getAll);
router.get('/:id', clientController.getById);
router.post('/', clientController.create);
router.put('/:id', clientController.update);
router.delete('/:id', clientController.delete);
router.post('/:id/contacts', clientController.addContact);
router.get('/:id/contacts', clientController.getContacts);
router.put('/:id/contacts/:contactId', clientController.updateContact);
router.delete('/:id/contacts/:contactId', clientController.deleteContact);

module.exports = router;

