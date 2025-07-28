require('dotenv').config();
const express = require('express');
const { PrismaClient } = require('@prisma/client');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const prisma = new PrismaClient();

app.use(cors({
  origin: [
    'http://localhost:3000', 
    'http://127.0.0.1:3000',
    'https://luminari-frontend.vercel.app',
    /\.vercel\.app$/
  ],
  credentials: true
}));
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ status: 'API is running' });
});

// Auth middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
};

// Create user (for initial setup)
app.post('/auth/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const existingUser = await prisma.user.findUnique({ where: { username } });
    if (existingUser) {
      return res.status(400).json({ error: 'Username already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { username, password: hashedPassword }
    });

    res.status(201).json({ message: 'User created successfully', userId: user.id });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// Login endpoint
app.post('/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const user = await prisma.user.findUnique({ where: { username } });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { userId: user.id, username: user.username },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({ 
      message: 'Login successful', 
      token,
      user: { id: user.id, username: user.username }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// Verify token endpoint
app.get('/auth/verify', authenticateToken, (req, res) => {
  res.json({ valid: true, user: req.user });
});

// Create a new document
app.post('/documents', authenticateToken, async (req, res) => {
  try {
    const doc = await prisma.document.create({ data: req.body });
    res.status(201).json(doc);
  } catch (error) {
    console.error(error);
    res.status(400).json({ error: error.message });
  }
});

// Get all documents (with optional filters)
app.get('/documents', authenticateToken, async (req, res) => {
  try {
    const { type, country, region, disease, documentType } = req.query;
    const docs = await prisma.document.findMany({
      where: {
        type,
        country,
        region,
        disease,
        documentType,
      },
      orderBy: { createdAt: 'desc' }
    });
    res.json(docs);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// Get a document by ID
app.get('/documents/:id', authenticateToken, async (req, res) => {
  try {
    const doc = await prisma.document.findUnique({ where: { id: req.params.id } });
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    res.json(doc);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// Update a document by ID
app.put('/documents/:id', authenticateToken, async (req, res) => {
  try {
    const doc = await prisma.document.update({
      where: { id: req.params.id },
      data: req.body,
    });
    res.json(doc);
  } catch (error) {
    console.error(error);
    res.status(400).json({ error: error.message });
  }
});

// Delete a document by ID
app.delete('/documents/:id', authenticateToken, async (req, res) => {
  try {
    await prisma.document.delete({ where: { id: req.params.id } });
    res.json({ message: 'Document deleted' });
  } catch (error) {
    console.error(error);
    res.status(400).json({ error: error.message });
  }
});

// Start the server
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Backend API running on port ${PORT}`);
});
