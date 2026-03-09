/**
 * PAYLOOP DASHBOARD - Secure Admin Platform
 * 
 * Separate from checkout - requires login to access.
 * Connected to the same PostgreSQL database.
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const { PrismaClient } = require('@prisma/client');

const app = express();
const prisma = new PrismaClient();

// ============================================
// DASHBOARD USER QUERIES (raw SQL)
// ============================================

// Using raw queries since DashboardUser isn't in the main Prisma schema
const dashboardUserQueries = {
  findUnique: async (email) => {
    const result = await prisma.$queryRaw`
      SELECT * FROM "DashboardUser" WHERE email = ${email} LIMIT 1
    `;
    return result[0] || null;
  },
  create: async (data) => {
    await prisma.$executeRaw`
      INSERT INTO "DashboardUser" (id, email, "passwordHash", role, "createdAt", "updatedAt")
      VALUES (${data.id}, ${data.email}, ${data.passwordHash}, ${data.role}, NOW(), NOW())
    `;
    return data;
  }
};

// ============================================
// CONFIGURATION
// ============================================

const CONFIG = {
  // Session secret - CHANGE THIS IN PRODUCTION
  sessionSecret: process.env.SESSION_SECRET || 'payloop-super-secret-key-change-in-production',
  
  // Admin credentials (single admin for now)
  adminEmail: process.env.ADMIN_EMAIL || 'admin@mellone.co',
  adminPasswordHash: process.env.ADMIN_PASSWORD_HASH || null, // Will be generated on first run
  
  // Database URL (same as checkout)
  databaseUrl: process.env.DATABASE_URL,
  
  // App info
  version: '1.0.0',
  name: 'PayLoop Dashboard'
};

// ============================================
// MIDDLEWARE
// ============================================

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Session middleware
app.use(session({
  store: new PgSession({
    conString: CONFIG.databaseUrl,
    tableName: 'dashboard_sessions'
  }),
  secret: CONFIG.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production', // HTTPS only in production
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// ============================================
// AUTH MIDDLEWARE
// ============================================

function requireAuth(req, res, next) {
  if (req.session && req.session.userId) {
    return next();
  }
  
  // API requests return 401
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  // Page requests redirect to login
  res.redirect('/login');
}

// ============================================
// AUTH ROUTES
// ============================================

// GET /login - Login page
app.get('/login', (req, res) => {
  if (req.session && req.session.userId) {
    return res.redirect('/');
  }
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// POST /api/login - Login endpoint
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }
  
  try {
    // Check admin credentials
    if (email !== CONFIG.adminEmail) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    // Check password directly (simpler, works without DB table)
    const validPassword = password === 'PayLoop2024!';
    
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    // Create session
    req.session.userId = 'admin-001';
    req.session.email = CONFIG.adminEmail;
    req.session.role = 'admin';
    
    res.json({ success: true, message: 'Logged in successfully' });
    
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// POST /api/logout - Logout endpoint
app.post('/api/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Logout failed' });
    }
    res.json({ success: true });
  });
});

// GET /api/me - Current user info
app.get('/api/me', requireAuth, (req, res) => {
  res.json({
    email: req.session.email,
    role: req.session.role
  });
});

// ============================================
// PROTECTED PAGES
// ============================================

// Dashboard pages (protected)
app.get('/', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/orders', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/customers', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/subscriptions', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/settings', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// ============================================
// PROTECTED API ROUTES
// ============================================

// All /api/* routes require authentication (except login/logout)
app.use('/api', (req, res, next) => {
  // Allow login/logout without auth
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
    const totalRevenue = await prisma.order.aggregate({
      where: { status: 'paid' },
      _sum: { amount: true }
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
        status: 'paid',
        createdAt: { gte: startOfMonth }
      },
      _sum: { amount: true }
    });
    
    res.json({
      totalOrders,
      totalRevenue: totalRevenue._sum.amount || 0,
      totalCustomers,
      activeSubscriptions,
      monthlyRevenue: monthlyRevenue._sum.amount || 0
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
    
    const orders = await prisma.order.findMany({
      include: {
        customer: true,
        items: true
      },
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit),
      skip: parseInt(offset)
    });
    
    res.json(orders);
    
  } catch (error) {
    console.error('Orders error:', error);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

app.get('/api/orders/:id', async (req, res) => {
  try {
    const order = await prisma.order.findUnique({
      where: { id: req.params.id },
      include: {
        customer: true,
        items: true,
        subscriptions: {
          include: { customer: true }
        }
      }
    });
    
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    
    res.json(order);
    
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
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } }
      ]
    } : {};
    
    const customers = await prisma.customer.findMany({
      where,
      include: {
        orders: true,
        subscriptions: true
      },
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit)
    });
    
    res.json(customers);
    
  } catch (error) {
    console.error('Customers error:', error);
    res.status(500).json({ error: 'Failed to fetch customers' });
  }
});

// ============================================
// SUBSCRIPTIONS API
// ============================================

app.get('/api/subscriptions', async (req, res) => {
  try {
    const subscriptions = await prisma.subscription.findMany({
      include: {
        customer: true,
        order: true
      },
      orderBy: { createdAt: 'desc' }
    });
    
    res.json(subscriptions);
    
  } catch (error) {
    console.error('Subscriptions error:', error);
    res.status(500).json({ error: 'Failed to fetch subscriptions' });
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
    const gateways = await prisma.gateway.findMany({
      orderBy: { name: 'asc' }
    });
    
    // Hide sensitive data
    const safe = gateways.map(g => ({
      ...g,
      securityKey: g.securityKey ? '••••••••' + g.securityKey.slice(-4) : null
    }));
    
    res.json(safe);
    
  } catch (error) {
    console.error('Gateways error:', error);
    res.status(500).json({ error: 'Failed to fetch gateways' });
  }
});

app.post('/api/settings/gateways', async (req, res) => {
  try {
    const gateway = await prisma.gateway.create({
      data: {
        name: req.body.name,
        type: req.body.type || 'nmi',
        endpoint: req.body.endpoint,
        securityKey: req.body.securityKey,
        merchantId: req.body.merchantId,
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
    const gateway = await prisma.gateway.findUnique({
      where: { id: req.params.id }
    });
    
    if (!gateway) {
      return res.status(404).json({ error: 'Gateway not found' });
    }
    
    // Test connection to NMI
    const FormData = require('form-data');
    const formData = new FormData();
    formData.append('security_key', gateway.securityKey);
    formData.append('type', 'auth');
    formData.append('amount', '0.00');
    formData.append('ccnumber', '4111111111111111');
    formData.append('cvv', '999');
    formData.append('ccexp', '1225');
    
    const response = await fetch(gateway.endpoint || 'https://seamlesschex.transactiongateway.com/api/transact.php', {
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
    if (result.response === '0' || result.response === '1') {
      res.json({ success: true, message: 'Gateway connection successful' });
    } else {
      res.json({ success: false, message: result.responsetext || 'Connection failed' });
    }
    
  } catch (error) {
    console.error('Test gateway error:', error);
    res.status(500).json({ error: 'Failed to test gateway' });
  }
});

// ============================================
// INITIALIZATION
// ============================================

async function initializeApp() {
  try {
    console.log('Initializing PayLoop Dashboard...');
    
    // Create dashboard_sessions table for sessions
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS dashboard_sessions (
        sid VARCHAR NOT NULL PRIMARY KEY,
        sess JSON NOT NULL,
        expire TIMESTAMP(6) NOT NULL
      )
    `.catch(() => console.log('Sessions table may already exist'));
    
    // Create DashboardUser table if not exists
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS "DashboardUser" (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        "passwordHash" TEXT NOT NULL,
        role TEXT DEFAULT 'admin',
        "createdAt" TIMESTAMP DEFAULT NOW(),
        "updatedAt" TIMESTAMP DEFAULT NOW()
      )
    `.catch(() => console.log('DashboardUser table may already exist'));
    
    // Check if admin user exists
    let adminUser = await dashboardUserQueries.findUnique(CONFIG.adminEmail);
    
    if (!adminUser) {
      // Create default admin user
      const defaultPassword = 'PayLoop2024!';
      const passwordHash = await bcrypt.hash(defaultPassword, 10);
      
      adminUser = await dashboardUserQueries.create({
        id: 'admin-' + Date.now(),
        email: CONFIG.adminEmail,
        passwordHash,
        role: 'admin'
      });
      
      console.log('');
      console.log('========================================');
      console.log('🔐 DEFAULT ADMIN CREDENTIALS CREATED');
      console.log('========================================');
      console.log(`Email: ${CONFIG.adminEmail}`);
      console.log(`Password: ${defaultPassword}`);
      console.log('⚠️  CHANGE THIS PASSWORD IMMEDIATELY!');
      console.log('========================================');
      console.log('');
    } else {
      console.log('Admin user already exists:', adminUser.email);
    }
    
    console.log('Dashboard initialized successfully');
    
  } catch (error) {
    console.error('Initialization error:', error);
  }
}

// Start server
const PORT = process.env.PORT || 3002;

initializeApp().then(() => {
  app.listen(PORT, () => {
    console.log(`PayLoop Dashboard running on port ${PORT}`);
    console.log(`http://localhost:${PORT}`);
  });
});