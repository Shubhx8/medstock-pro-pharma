const express = require('express');
const router = express.Router();

const authRoutes = require('./authRoutes');
const manufacturerRoutes = require('./manufacturerRoutes');
const categoryRoutes = require('./categoryRoutes');
const supplierRoutes = require('./supplierRoutes');
const customerRoutes = require('./customerRoutes');
const medicineRoutes = require('./medicineRoutes');
const batchRoutes = require('./batchRoutes');
const saleRoutes = require('./saleRoutes');
const alertRoutes = require('./alertRoutes');
const disposalRoutes = require('./disposalRoutes');
const dashboardRoutes = require('./dashboardRoutes');

router.use('/auth', authRoutes);
router.use('/users', authRoutes);
router.use('/manufacturers', manufacturerRoutes);
router.use('/categories', categoryRoutes);
router.use('/suppliers', supplierRoutes);
router.use('/customers', customerRoutes);
router.use('/medicines', medicineRoutes);
router.use('/batches', batchRoutes);
router.use('/sales', saleRoutes);
router.use('/alerts', alertRoutes);
router.use('/disposals', disposalRoutes);
router.use('/dashboard', dashboardRoutes);

module.exports = router;
