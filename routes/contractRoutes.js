const express = require('express');
const router = express.Router();
const contractController = require('../controllers/contractController');

// No authentication required - all routes are public
router.get('/', contractController.getAll);
router.get('/:id', contractController.getById);
router.get('/:id/pdf', contractController.getPDF);
router.post('/', contractController.create);
router.put('/:id', contractController.update);
router.put('/:id/status', contractController.updateStatus);
router.delete('/:id', contractController.delete);

module.exports = router;

