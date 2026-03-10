/**
 * PAYLOOP DASHBOARD - Secure Admin Platform
 * 
 * Simple auth - no sessions, just token-based.
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');

const app = express();
const prisma = new PrismaClient();

// ============================================
// CONFIGURATION
// ============================================

const CONFIG = {
  // Admin credentials (single admin)
  adminEmail: process.env.ADMIN_EMAIL || 'admin@mellone.co',
  adminPassword: process.env.ADMIN_PASSWORD || 'PayLoop2024!',
  
  // Auth token secret
  tokenSecret: process.env.TOKEN_SECRET || 'payloop-secret-change-in-production',
  
  // App info
  version: '1.0.0',
  name: 'PayLoop Dashboard'
};

// Store valid tokens in memory (simple approach)
const validTokens = new Map();

// ============================================
// MIDDLEWARE
// ============================================

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ============================================
// AUTH MIDDLEWARE
// ============================================

function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '') || req.cookies?.auth_token;
  
  if (!token || !validTokens.has(token)) {
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    return res.redirect('/login');
  }
  
  // Add user info to request
  req.user = validTokens.get(token);
  next();
}

// ============================================
// AUTH ROUTES
// ============================================

// GET /login - Login page
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// GET / - Dashboard page (root)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// POST /api/login - Login endpoint
app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  
  // Simple credential check
  if (email === CONFIG.adminEmail && password === CONFIG.adminPassword) {
    // Generate token
    const token = crypto.randomBytes(32).toString('hex');
    
    // Store token with user info
    validTokens.set(token, {
      email: CONFIG.adminEmail,
      role: 'admin'
    });
    
    res.json({ 
      success: true, 
      token,
      email: CONFIG.adminEmail 
    });
  } else {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

// POST /api/logout - Logout endpoint
app.post('/api/logout', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token) {
    validTokens.delete(token);
  }
  res.json({ success: true });
});

// GET /api/me - Current user info
app.get('/api/me', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  
  if (!token || !validTokens.has(token)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  res.json(validTokens.get(token));
});

// ============================================
// PROTECTED API ROUTES
// ============================================

// All /api/* routes require auth (except login/logout)
app.use('/api', (req, res, next) => {
  if (req.path === '/login' || req.path === '/logout') {
    return next();
  }
  requireAuth(req, res, next);
});

// ============================================
// STATS API
// ============================================

app.get('/api/stats', async (req, res) => {
  try {
    const totalOrders = await prisma.order.count();
    const approvedOrders = await prisma.order.count({
      where: { status: 'approved' }
    });
    const totalRevenue = await prisma.order.aggregate({
      where: { status: 'approved' },
      _sum: { total: true }
    });
    const totalCustomers = await prisma.customer.count();
    const activeSubscriptions = await prisma.subscription.count({
      where: { status: 'active' }
    });
    
    // This month's revenue
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    
    const monthlyRevenue = await prisma.order.aggregate({
      where: {
        status: 'approved',
        createdAt: { gte: startOfMonth }
      },
      _sum: { total: true }
    });
    
    res.json({
      totalOrders,
      approvedOrders,
      declinedOrders: totalOrders - approvedOrders,
      totalRevenue: totalRevenue._sum.total || 0,
      totalCustomers,
      activeSubscriptions,
      monthlyRevenue: monthlyRevenue._sum.total || 0,
      approvalRate: totalOrders > 0 ? ((approvedOrders / totalOrders) * 100).toFixed(1) : '0'
    });
    
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// ============================================
// ORDERS API
// ============================================

app.get('/api/orders', async (req, res) => {
  try {
    const { limit = 50, offset = 0 } = req.query;
    
    console.log('Fetching orders...');
    
    const orders = await prisma.order.findMany({
      include: {
        customer: true
      },
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit),
      skip: parseInt(offset)
    });
    
    console.log(`Found ${orders.length} orders`);
    res.json(orders);
    
  } catch (error) {
    console.error('Orders error:', error);
    res.status(500).json({ error: 'Failed to fetch orders', details: error.message });
  }
});

app.get('/api/orders/:id', async (req, res) => {
  try {
    console.log('Fetching order:', req.params.id);
    
    const order = await prisma.order.findUnique({
      where: { id: req.params.id },
      include: {
        customer: true
      }
    });
    
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    
    // Get subscriptions for this customer
    let subscriptions = [];
    try {
      subscriptions = await prisma.subscription.findMany({
        where: { customerId: order.customerId }
      });
    } catch (e) {
      console.log('Could not fetch subscriptions:', e.message);
    }
    
    // Parse items JSON string
    let items = [];
    try {
      items = JSON.parse(order.items || '[]');
    } catch (e) {
      items = [];
    }
    
    // Return with parsed items and subscriptions
    res.json({
      ...order,
      itemsParsed: items,
      subscriptions: subscriptions
    });
    
  } catch (error) {
    console.error('Order error:', error);
    res.status(500).json({ error: 'Failed to fetch order' });
  }
});

// ============================================
// CUSTOMERS API
// ============================================

app.get('/api/customers', async (req, res) => {
  try {
    const { limit = 50, search } = req.query;
    
    const where = search ? {
      OR: [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } }
      ]
    } : {};
    
    console.log('Fetching customers with where:', JSON.stringify(where));
    
    const customers = await prisma.customer.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit)
    });
    
    console.log(`Found ${customers.length} customers`);
    res.json(customers);
    
  } catch (error) {
    console.error('Customers error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ error: 'Failed to fetch customers', details: error.message });
  }
});

// ============================================
// SUBSCRIPTIONS API
// ============================================

app.get('/api/subscriptions', async (req, res) => {
  try {
    console.log('Fetching subscriptions...');
    
    const subscriptions = await prisma.subscription.findMany({
      include: {
        customer: true
      },
      orderBy: { createdAt: 'desc' }
    });
    
    console.log(`Found ${subscriptions.length} subscriptions`);
    res.json(subscriptions);
    
  } catch (error) {
    console.error('Subscriptions error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ error: 'Failed to fetch subscriptions', details: error.message });
  }
});

app.patch('/api/subscriptions/:id', async (req, res) => {
  try {
    const { price, status } = req.body;
    
    const subscription = await prisma.subscription.update({
      where: { id: req.params.id },
      data: { 
        ...(price !== undefined && { price: parseFloat(price) }),
        ...(status && { status })
      }
    });
    
    res.json(subscription);
    
  } catch (error) {
    console.error('Update subscription error:', error);
    res.status(500).json({ error: 'Failed to update subscription' });
  }
});

// ============================================
// GATEWAYS API
// ============================================

app.get('/api/settings/gateways', async (req, res) => {
  try {
    const gateways = await prisma.paymentGateway.findMany({
      orderBy: { name: 'asc' }
    });
    
    // Hide sensitive data
    const safe = gateways.map(g => ({
      ...g,
      nmiSecurityKey: g.nmiSecurityKey ? '••••••••' + g.nmiSecurityKey.slice(-4) : null
    }));
    
    res.json(safe);
    
  } catch (error) {
    console.error('Gateways error:', error);
    res.status(500).json({ error: 'Failed to fetch gateways' });
  }
});

app.post('/api/settings/gateways', async (req, res) => {
  try {
    const gateway = await prisma.paymentGateway.create({
      data: {
        name: req.body.name,
        displayName: req.body.displayName || req.body.name,
        type: req.body.type || 'nmi',
        nmiEndpoint: req.body.endpoint,
        nmiSecurityKey: req.body.securityKey,
        nmiMerchantId: req.body.merchantId,
        isActive: req.body.isActive ?? true,
        isDefault: req.body.isDefault ?? false
      }
    });
    
    res.json(gateway);
    
  } catch (error) {
    console.error('Create gateway error:', error);
    res.status(500).json({ error: 'Failed to create gateway' });
  }
});

app.post('/api/settings/gateways/:id/test', async (req, res) => {
  try {
    const gateway = await prisma.paymentGateway.findUnique({
      where: { id: req.params.id }
    });
    
    if (!gateway) {
      return res.status(404).json({ error: 'Gateway not found' });
    }
    
    // Test connection to NMI
    const FormData = require('form-data');
    const formData = new FormData();
    formData.append('security_key', gateway.nmiSecurityKey);
    formData.append('type', 'auth');
    formData.append('amount', '1.00');
    formData.append('ccnumber', '4111111111111111');
    formData.append('cvv', '999');
    formData.append('ccexp', '1225');
    formData.append('firstname', 'Test');
    formData.append('lastname', 'Connection');
    
    const response = await fetch(gateway.nmiEndpoint || 'https://seamlesschex.transactiongateway.com/api/transact.php', {
      method: 'POST',
      body: formData,
      headers: formData.getHeaders()
    });
    
    const text = await response.text();
    const result = {};
    text.split('&').forEach(pair => {
      const [key, value] = pair.split('=');
      if (key) result[key] = value;
    });
    
    // 0 = approved, 1 = declined, 2 = error (but connection works)
    // 3 = activity limit exceeded (also means credentials are valid)
    if (result.response === '0' || result.response === '1' || result.response === '2' || result.response === '3') {
      res.json({ success: true, message: 'Gateway connection successful', response: result.responsetext });
    } else {
      res.json({ success: false, message: result.responsetext || 'Connection failed' });
    }
    
  } catch (error) {
    console.error('Test gateway error:', error);
    res.status(500).json({ error: 'Failed to test gateway' });
  }
});

// ============================================
// START SERVER
// ============================================

const PORT = process.env.PORT || 3002;

app.listen(PORT, () => {
  console.log('');
  console.log('========================================');
  console.log('🦀 PayLoop Dashboard');
  console.log('========================================');
  console.log(`Running on port ${PORT}`);
  console.log(`Login: admin@mellone.co`);
  console.log(`Password: PayLoop2024!`);
  console.log('========================================');
  console.log('');
});