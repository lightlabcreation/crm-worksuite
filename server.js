// =====================================================
// Worksuite CRM Backend Server
// =====================================================

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

// Import routes
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const leadRoutes = require('./routes/leadRoutes');
const clientRoutes = require('./routes/clientRoutes');
const projectRoutes = require('./routes/projectRoutes');
const taskRoutes = require('./routes/taskRoutes');
const invoiceRoutes = require('./routes/invoiceRoutes');
const estimateRoutes = require('./routes/estimateRoutes');
const proposalRoutes = require('./routes/proposalRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const expenseRoutes = require('./routes/expenseRoutes');
const contractRoutes = require('./routes/contractRoutes');
const subscriptionRoutes = require('./routes/subscriptionRoutes');
const employeeRoutes = require('./routes/employeeRoutes');
const attendanceRoutes = require('./routes/attendanceRoutes');
const timeTrackingRoutes = require('./routes/timeTrackingRoutes');
const eventRoutes = require('./routes/eventRoutes');
const departmentRoutes = require('./routes/departmentRoutes');
const positionRoutes = require('./routes/positionRoutes');
const messageRoutes = require('./routes/messageRoutes');
const ticketRoutes = require('./routes/ticketRoutes');
const customFieldRoutes = require('./routes/customFieldRoutes');
const settingsRoutes = require('./routes/settingsRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const companyPackageRoutes = require('./routes/companyPackageRoutes');
const companyRoutes = require('./routes/companyRoutes');
const documentRoutes = require('./routes/documentRoutes');
const socialMediaIntegrationRoutes = require('./routes/socialMediaIntegrationRoutes');
const reportRoutes = require('./routes/reportRoutes');
const emailTemplateRoutes = require('./routes/emailTemplateRoutes');
const financeTemplateRoutes = require('./routes/financeTemplateRoutes');
const creditNoteRoutes = require('./routes/creditNoteRoutes');
const superAdminRoutes = require('./routes/superAdminRoutes');
const bankAccountRoutes = require('./routes/bankAccountRoutes');
const auditLogRoutes = require('./routes/auditLogRoutes');
const leaveRequestRoutes = require('./routes/leaveRequestRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const noteRoutes = require('./routes/noteRoutes');
const orderRoutes = require('./routes/orderRoutes');
const itemRoutes = require('./routes/itemRoutes');

const app = express();
const PORT = process.env.PORT || 5000;
const API_VERSION = process.env.API_VERSION || 'v1';

// =====================================================
// Middleware
// =====================================================

// Security
app.use(helmet());

// CORS
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true
}));

// Body parser
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Logging
if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined'));
}

// Static files (for uploads)
app.use('/uploads', express.static('uploads'));

// =====================================================
// Routes
// =====================================================

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// API Routes
const apiBase = `/api/${API_VERSION}`;

app.use(`${apiBase}/auth`, authRoutes);
app.use(`${apiBase}/dashboard`, dashboardRoutes);
app.use(`${apiBase}/users`, userRoutes);
app.use(`${apiBase}/leads`, leadRoutes);
app.use(`${apiBase}/clients`, clientRoutes);
app.use(`${apiBase}/projects`, projectRoutes);
app.use(`${apiBase}/tasks`, taskRoutes);
app.use(`${apiBase}/invoices`, invoiceRoutes);
app.use(`${apiBase}/estimates`, estimateRoutes);
app.use(`${apiBase}/proposals`, proposalRoutes);
app.use(`${apiBase}/payments`, paymentRoutes);
app.use(`${apiBase}/expenses`, expenseRoutes);
app.use(`${apiBase}/contracts`, contractRoutes);
app.use(`${apiBase}/subscriptions`, subscriptionRoutes);
app.use(`${apiBase}/employees`, employeeRoutes);
app.use(`${apiBase}/attendance`, attendanceRoutes);
app.use(`${apiBase}/time-logs`, timeTrackingRoutes);
app.use(`${apiBase}/events`, eventRoutes);
app.use(`${apiBase}/departments`, departmentRoutes);
app.use(`${apiBase}/positions`, positionRoutes);
app.use(`${apiBase}/messages`, messageRoutes);
app.use(`${apiBase}/tickets`, ticketRoutes);
app.use(`${apiBase}/custom-fields`, customFieldRoutes);
app.use(`${apiBase}/settings`, settingsRoutes);
app.use(`${apiBase}/company-packages`, companyPackageRoutes);
app.use(`${apiBase}/companies`, companyRoutes);
app.use(`${apiBase}/documents`, documentRoutes);
app.use(`${apiBase}/social-media-integrations`, socialMediaIntegrationRoutes);
app.use(`${apiBase}/reports`, reportRoutes);
app.use(`${apiBase}/email-templates`, emailTemplateRoutes);
app.use(`${apiBase}/finance-templates`, financeTemplateRoutes);
app.use(`${apiBase}/credit-notes`, creditNoteRoutes);
app.use(`${apiBase}/superadmin`, superAdminRoutes);
app.use(`${apiBase}/bank-accounts`, bankAccountRoutes);
app.use(`${apiBase}/audit-logs`, auditLogRoutes);
app.use(`${apiBase}/leave-requests`, leaveRequestRoutes);
app.use(`${apiBase}/notifications`, notificationRoutes);
app.use(`${apiBase}/notes`, noteRoutes);
app.use(`${apiBase}/orders`, orderRoutes);
app.use(`${apiBase}/items`, itemRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Route not found'
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  
  res.status(err.status || 500).json({
    success: false,
    error: process.env.NODE_ENV === 'production' 
      ? 'Internal server error' 
      : err.message,
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack })
  });
});

// =====================================================
// Start Server
// =====================================================

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
  console.error('❌ Unhandled Promise Rejection:', err);
  // Don't exit, just log the error
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught Exception:', err);
  // Don't exit immediately, log and continue
});

const server = app.listen(PORT, () => {
  console.log(`🚀 Worksuite CRM Backend Server running on port ${PORT}`);
  console.log(`📡 API Base URL: http://localhost:${PORT}${apiBase}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
});

// Handle server errors
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`❌ Port ${PORT} is already in use. Please stop the other process or use a different port.`);
  } else {
    console.error('❌ Server error:', err);
  }
});

module.exports = app;

