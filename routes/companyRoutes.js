// =====================================================
// Company Routes
// =====================================================

const express = require('express');
const router = express.Router();
const companyController = require('../controllers/companyController');

// No authentication required - all routes are public
router.get('/', companyController.getAll);
router.post('/', companyController.create);
router.get('/:id', companyController.getById);
router.put('/:id', companyController.update);
router.delete('/:id', companyController.deleteCompany);

module.exports = router;

