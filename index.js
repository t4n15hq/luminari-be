const express = require('express');
const { PrismaClient } = require('@prisma/client');
const cors = require('cors');

const app = express();
const prisma = new PrismaClient();

app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ status: 'API is running' });
});

// Create a new document
app.post('/documents', async (req, res) => {
  try {
    const doc = await prisma.document.create({ data: req.body });
    res.status(201).json(doc);
  } catch (error) {
    console.error(error);
    res.status(400).json({ error: error.message });
  }
});

// Get all documents (with optional filters)
app.get('/documents', async (req, res) => {
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
app.get('/documents/:id', async (req, res) => {
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
app.put('/documents/:id', async (req, res) => {
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
app.delete('/documents/:id', async (req, res) => {
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
