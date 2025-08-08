require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const prisma = require('./lib/prisma');

const app = express();

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
const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;

// Claude API Configuration
const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_CONFIG = {
  model: "claude-sonnet-4-20250514",
  max_tokens: 4096,
  temperature: 0.3
};

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

    const existingUser = await withRetry(async () => {
      return await prisma.user.findUnique({ where: { username } });
    });
    
    if (existingUser) {
      return res.status(400).json({ error: 'Username already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await withRetry(async () => {
      return await prisma.user.create({
        data: { username, password: hashedPassword }
      });
    });

    res.status(201).json({ message: 'User created successfully', userId: user.id });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// Database operation with retry logic and connection cleanup
async function withRetry(operation, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const result = await operation();
      return result;
    } catch (error) {
      console.log(`Database operation failed (attempt ${i + 1}/${maxRetries}):`, error.message);
      
      // If it's a prepared statement error, try to clean up
      if (error.message.includes('prepared statement') && error.message.includes('already exists')) {
        try {
          await prisma.$executeRaw`DEALLOCATE ALL`;
          console.log('Cleaned up prepared statements');
        } catch (cleanupError) {
          console.log('Cleanup failed:', cleanupError.message);
        }
      }
      
      if (i === maxRetries - 1) throw error;
      
      // Wait before retry with exponential backoff
      await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, i)));
    }
  }
}

// Login endpoint
app.post('/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const user = await withRetry(async () => {
      return await prisma.user.findUnique({ where: { username } });
    });
    
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
    console.error('Login error:', error);
    res.status(500).json({ error: 'Authentication service temporarily unavailable' });
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

// ============================================================================
// CLAUDE API ENDPOINTS - TIER 1 ENHANCEMENTS
// ============================================================================

// Helper function to call Claude API
const callClaudeAPI = async (systemPrompt, userMessage, maxTokens = 4096) => {
  if (!CLAUDE_API_KEY) {
    throw new Error('Claude API key not configured');
  }

  try {
    const response = await axios.post(CLAUDE_API_URL, {
      ...CLAUDE_CONFIG,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{
        role: "user",
        content: userMessage
      }]
    }, {
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01'
      }
    });

    // Remove markdown formatting for cleaner output
    let cleanText = response.data.content[0].text;
    
    // Remove markdown headers (# ## ### etc at start of lines)
    cleanText = cleanText.replace(/^#{1,6}\s+/gm, '');
    
    // Remove bold formatting **text**
    cleanText = cleanText.replace(/\*\*(.*?)\*\*/g, '$1');
    
    // Remove inline code `text`
    cleanText = cleanText.replace(/`([^`]+)`/g, '$1');
    
    // Remove code blocks ```text```
    cleanText = cleanText.replace(/```[\s\S]*?```/g, '');
    
    return cleanText;
  } catch (error) {
    console.error('Claude API Error:', error.response?.data || error.message);
    throw new Error(`Claude API failed: ${error.response?.data?.error?.message || error.message}`);
  }
};

// Extract confidence score from Claude's response
const extractConfidence = (text) => {
  const confidenceMatch = text.match(/CONFIDENCE SCORE:\s*(\d+)%/i);
  if (confidenceMatch) {
    return parseFloat(confidenceMatch[1]) / 100; // Convert to decimal (0-1)
  }
  return null; // Return null if no confidence found
};

// TIER 1 ENHANCEMENT 1: Enhanced Free Text Processing
app.post('/claude/text-processing', authenticateToken, async (req, res) => {
  try {
    const { clinicalText, extractionType = 'comprehensive' } = req.body;

    if (!clinicalText) {
      return res.status(400).json({ error: 'Clinical text is required' });
    }

    const systemPrompt = `You are a medical AI specialist with expertise in clinical text analysis and medical entity extraction.

Your task is to analyze clinical text and extract structured medical information with high precision.

EXTRACTION CAPABILITIES:
- Patient demographics and medical history
- Medications (name, dosage, frequency, route)
- Laboratory values with reference ranges
- Symptoms and clinical findings
- Diagnoses and differential diagnoses
- Treatment plans and recommendations
- Timeline of medical events
- Clinical decision rationale

ENHANCED PROCESSING REQUIREMENTS:
- Extract specific numerical values (lab results, vital signs, dosages)
- Identify medical terminology and map to standard codes where possible
- Capture temporal relationships (onset, duration, frequency)
- Note uncertainty levels and clinical confidence
- Identify missing information that would be clinically relevant
- Provide structured JSON output for easy integration

OUTPUT FORMAT:
Return a structured analysis using plain text without markdown formatting (no #, *, \`, etc.). Use clear section headings in CAPS and simple bullet points with dashes (-). 

IMPORTANT: End your response with "CONFIDENCE SCORE: X%" where X is your confidence level (0-100) in the accuracy and completeness of this analysis.`;

    const userMessage = `Analyze this clinical text and extract structured medical information:

${clinicalText}

Extraction Type: ${extractionType}

Please provide comprehensive extraction with reasoning for each identified entity.`;

    const extractedData = await callClaudeAPI(systemPrompt, userMessage);
    const confidence = extractConfidence(extractedData);

    res.json({
      extractedData,
      confidence: confidence,
      processingType: extractionType,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Text processing error:', error);
    res.status(500).json({ error: error.message });
  }
});

// TIER 1 ENHANCEMENT 2: Pattern Recognition
app.post('/claude/pattern-analysis', authenticateToken, async (req, res) => {
  try {
    const { dataSet, analysisType = 'correlation' } = req.body;

    if (!dataSet) {
      return res.status(400).json({ error: 'Data set is required' });
    }

    const systemPrompt = `You are a clinical data scientist with expertise in medical pattern recognition and statistical analysis.

Your task is to analyze medical/clinical data to identify meaningful patterns, correlations, and insights.

PATTERN RECOGNITION CAPABILITIES:
- Treatment efficacy patterns across patient populations
- Disease progression correlations
- Medication response patterns
- Regulatory approval trends
- Patient similarity clustering
- Risk factor identification
- Outcome prediction patterns
- Clinical decision tree analysis

ANALYSIS REQUIREMENTS:
- Identify statistically significant patterns
- Provide confidence levels for each finding
- Suggest clinical implications of discovered patterns
- Recommend actionable insights for clinical practice
- Note any potential biases or limitations in the data
- Prioritize findings by clinical relevance and impact

OUTPUT REQUIREMENTS:
- Clear pattern descriptions with supporting evidence
- Clinical interpretation and significance
- Recommendations for further investigation
- Statistical confidence where applicable

FORMAT: Use plain text without markdown formatting (no #, *, \`, etc.). Use clear section headings in CAPS and simple bullet points with dashes (-).

IMPORTANT: End your response with "CONFIDENCE SCORE: X%" where X is your confidence level (0-100) in the reliability of these pattern findings.`;

    const userMessage = `Analyze this medical data for patterns and correlations:

${JSON.stringify(dataSet, null, 2)}

Analysis Type: ${analysisType}

Please identify meaningful patterns and provide clinical insights with reasoning.`;

    const patterns = await callClaudeAPI(systemPrompt, userMessage);
    const confidence = extractConfidence(patterns);

    res.json({
      patterns,
      analysisType,
      confidence: confidence,
      recommendations: [],
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Pattern analysis error:', error);
    res.status(500).json({ error: error.message });
  }
});

// TIER 1 ENHANCEMENT 3: Decision Transparency and Reasoning
app.post('/claude/reasoning-generation', authenticateToken, async (req, res) => {
  try {
    const { prompt, context = '', decisionType = 'clinical' } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    const systemPrompt = `You are a medical expert specializing in transparent clinical decision-making and evidence-based reasoning.

Your task is to provide comprehensive responses with clear, detailed reasoning for every recommendation or decision.

DECISION TRANSPARENCY REQUIREMENTS:
- Explain the reasoning process step-by-step
- Identify key factors that influenced the decision
- Discuss alternatives that were considered
- Provide evidence or precedents supporting the choice  
- Note any assumptions or limitations
- Include confidence levels and uncertainty bounds
- Explain potential risks and mitigation strategies
- Reference relevant guidelines, studies, or best practices

REASONING STRUCTURE:
1. DECISION SUMMARY: Clear statement of the recommendation
2. PRIMARY RATIONALE: Main reasons supporting this choice
3. SUPPORTING EVIDENCE: Research, guidelines, or precedents
4. ALTERNATIVES CONSIDERED: Other options and why they were not chosen
5. RISK ASSESSMENT: Potential risks and mitigation strategies
6. CONFIDENCE LEVEL: How certain you are about this decision
7. MONITORING PLAN: How to track if the decision is working
8. CLINICAL IMPLICATIONS: What this means for patient care

TRANSPARENCY PRINCIPLES:
- Be explicit about uncertainty where it exists
- Acknowledge when evidence is limited
- Explain complex medical concepts in understandable terms
- Provide both technical and patient-friendly explanations when relevant

OUTPUT FORMAT:
- Use plain text without markdown formatting (no #, *, \`, etc.)
- Use clear section headings in CAPS
- Use simple bullet points with dashes (-)
- Write in clear, professional medical language

IMPORTANT: End your response with "CONFIDENCE SCORE: X%" where X is your confidence level (0-100) in this clinical recommendation.`;

    const userMessage = `Generate a response with comprehensive reasoning:

PROMPT: ${prompt}
CONTEXT: ${context}
DECISION TYPE: ${decisionType}

Please provide your response with detailed reasoning and transparency as specified.`;

    const decision = await callClaudeAPI(systemPrompt, userMessage);

    // Parse the structured response to extract key sections
    const parseReasoning = (text) => {
      const sections = {
        summary: extractSection(text, ['DECISION SUMMARY', 'SUMMARY', 'RECOMMENDATION']),
        rationale: extractSection(text, ['PRIMARY RATIONALE', 'RATIONALE', 'REASONING']),
        evidence: extractSection(text, ['SUPPORTING EVIDENCE', 'EVIDENCE', 'RESEARCH']),
        alternatives: extractSection(text, ['ALTERNATIVES CONSIDERED', 'ALTERNATIVES', 'OTHER OPTIONS']),
        risks: extractSection(text, ['RISK ASSESSMENT', 'RISKS', 'SAFETY'])
      };
      
      return sections;
    };

    const extractSection = (text, headings) => {
      for (const heading of headings) {
        const regex = new RegExp(`${heading}:?\\s*([\\s\\S]*?)(?=\\n\\n[A-Z\\s]+:|$)`, 'i');
        const match = text.match(regex);
        if (match && match[1]) {
          return match[1].trim(); // Remove truncation - show full section
        }
      }
      return "See full analysis above";
    };

    const reasoning = parseReasoning(decision);
    const confidence = extractConfidence(decision);

    res.json({
      decision,
      reasoning: {
        ...reasoning,
        confidence: confidence
      },
      decisionType,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Reasoning generation error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Database connection test
async function testDatabaseConnection() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    console.log('✅ Database connection successful');
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Received SIGINT, closing Prisma connection...');
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('Received SIGTERM, closing Prisma connection...');
  await prisma.$disconnect();
  process.exit(0);
});

// Start the server
const PORT = process.env.PORT || 4000;
app.listen(PORT, async () => {
  console.log(`Backend API running on port ${PORT}`);
  await testDatabaseConnection();
});
