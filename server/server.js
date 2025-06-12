const express = require('express');
const cors = require('cors');
const fs = require('fs-extra');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5001;

// Middleware
app.use(cors());
app.use(express.json());

// Ensure test_outputs directory exists
const testOutputsDir = path.join(__dirname, '..', 'test_outputs');
fs.ensureDirSync(testOutputsDir);

// API endpoint to save test results
app.post('/api/save-test-results', async (req, res) => {
  try {
    const { fileName, content } = req.body;
    
    if (!fileName || !content) {
      return res.status(400).json({ 
        error: 'Missing required fields: fileName and content' 
      });
    }
    
    // Sanitize filename to prevent directory traversal
    const sanitizedFileName = path.basename(fileName);
    const filePath = path.join(testOutputsDir, sanitizedFileName);
    
    // Write file to test_outputs directory
    await fs.writeFile(filePath, content, 'utf8');
    
    console.log(`Test results saved to: ${filePath}`);
    
    res.json({ 
      success: true, 
      message: `File saved successfully to test_outputs/${sanitizedFileName}`,
      filePath: path.relative(path.join(__dirname, '..'), filePath)
    });
    
  } catch (error) {
    console.error('Error saving test results:', error);
    res.status(500).json({ 
      error: 'Failed to save test results', 
      details: error.message 
    });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'Server is running', timestamp: new Date().toISOString() });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Test outputs will be saved to: ${testOutputsDir}`);
}); 