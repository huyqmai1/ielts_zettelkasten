const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const OpenAI = require('openai');
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const tmp = require('tmp');

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Load IELTS questions database
const questionsPath = path.join(__dirname, './ielts_questions.json');
let questions = [];
try {
  questions = JSON.parse(fs.readFileSync(questionsPath, 'utf-8'));
} catch (e) {
  console.error('Failed to load IELTS questions database:', e);
}

// Load IELTS mistake categories database
const mistakeCategoriesPath = path.join(__dirname, './mistake_categories.json');
let mistakeCategories = [];
try {
  mistakeCategories = JSON.parse(fs.readFileSync(mistakeCategoriesPath, 'utf-8'));
} catch (e) {
  console.error('Failed to load mistake categories database:', e);
}

// Load IELTS speaking questions database
const speakingQuestionsPath = path.join(__dirname, './ielts_speaking_questions.json');
let speakingQuestions = [];
try {
  speakingQuestions = JSON.parse(fs.readFileSync(speakingQuestionsPath, 'utf-8'));
} catch (e) {
  console.error('Failed to load IELTS speaking questions database:', e);
}

// Path for user data (single user for now)
const userDataPath = path.join(__dirname, './user_data.json');

// Helper: Load user data
function loadUserData() {
  try {
    return JSON.parse(fs.readFileSync(userDataPath, 'utf-8'));
  } catch (e) {
    return { attempts: [] };
  }
}
// Helper: Save user data
function saveUserData(data) {
  fs.writeFileSync(userDataPath, JSON.stringify(data, null, 2), 'utf-8');
}

// Helper: Get mistakes from attempts in a date range
function getMistakesByDateRange(attempts, fromDate, toDate) {
  return attempts
    .filter(a => a.timestamp >= fromDate && a.timestamp <= toDate)
    .flatMap(a => a.mistakes.map(m => ({ ...m, attemptTimestamp: a.timestamp })));
}

// Helper: Analyze writing
async function analyzeWriting({ essay, questionText, mistakeCategories }) {
  const prompt = `You are an IELTS writing coach. Analyze the following essay for:
- Grammatical errors (subject-verb agreement, tense consistency, etc.)
- Vocabulary issues (word choice, collocations, academic language)
- Structural problems (paragraph organization, coherence, cohesion)
- Task achievement (addressing all parts of the question)
- Tone and register appropriateness

Essay Question:
"""
${questionText}
"""

Here is a list of mistake categories and subcategories you MUST use to classify each mistake:
${mistakeCategories.map(cat => `- ${cat.category} > ${cat.subcategory}: ${cat.description || ''}`).join('\n')}

For each mistake you find, output it in the following format (one after another, numbered):

1. Error: <the error, with context>
Correct: <the correct version>
Explanation: <explanation of the rule/principle violated>
Category: <choose the closest match from the list above, e.g., Grammar > Subject-Verb Agreement>

After listing all mistakes, add a section:

Strengths:
- <list strengths>

Summary:
<overall summary>

Essay:
"""
${essay}
"""

Respond ONLY in the above format. Do not add extra commentary or formatting.`;

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: 'You are an expert IELTS writing coach.' },
      { role: 'user', content: prompt },
    ],
    max_tokens: 800,
    temperature: 0.1,
  });
  return completion.choices[0].message.content;
}

// Helper: Analyze speaking
async function analyzeSpeaking({ audioBase64, questionText, mistakeCategories }) {
  const fs = require('fs');
  const tmp = require('tmp');
  // Decode base64 to buffer
  const audioBuffer = Buffer.from(audioBase64, 'base64');
  // Write buffer to a temporary file
  const tmpFile = tmp.fileSync({ postfix: '.webm' });
  fs.writeFileSync(tmpFile.name, audioBuffer);
  // Transcribe audio using whisper-1
  const transcription = await openai.audio.transcriptions.create({
    file: fs.createReadStream(tmpFile.name),
    model: 'whisper-1',
    response_format: 'text',
    language: 'en',
  });
  const transcript = transcription;
  tmpFile.removeCallback();

  const prompt = `You are an IELTS speaking coach. Analyze the following spoken answer for:
- Grammatical errors (subject-verb agreement, tense consistency, etc.)
- Vocabulary issues (word choice, collocations, academic language)
- Structural problems (organization, coherence, cohesion)
- Task achievement (addressing all parts of the question)
- Tone and register appropriateness

Speaking Question:
"""
${questionText}
"""

Here is a list of mistake categories and subcategories you MUST use to classify each mistake:
${mistakeCategories.map(cat => `- ${cat.category} > ${cat.subcategory}: ${cat.description || ''}`).join('\n')}

For each mistake you find, output it in the following format (one after another, numbered):

1. Error: <the error, with context>
Correct: <the correct version>
Explanation: <explanation of the rule/principle violated>
Category: <choose the closest match from the list above, e.g., Grammar > Subject-Verb Agreement>

After listing all mistakes, add a section:

Strengths:
- <list strengths>

Summary:
<overall summary>

Spoken answer:
"""
${transcript}
"""

Respond ONLY in the above format. Do not add extra commentary or formatting.`;

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: 'You are an expert IELTS speaking coach.' },
      { role: 'user', content: prompt },
    ],
    max_tokens: 800,
    temperature: 0.1,
  });
  return { analysis: completion.choices[0].message.content, transcript };
}

app.post('/api/analyze', async (req, res) => {
  const { essay, questionId, mode = 'writing', audioBase64 } = req.body;
  if (!questionId) {
    return res.status(400).json({ error: 'questionId is required.' });
  }
  let questionObj = null;
  let questionText = '';
  if (mode === 'speaking') {
    questionObj = speakingQuestions.find(q => q.id === questionId);
  } else {
    questionObj = questions.find(q => q.id === questionId);
  }
  if (!questionObj) {
    return res.status(400).json({ error: 'Invalid questionId.' });
  }
  questionText = questionObj.question;
  try {
    let analysis = '';
    let transcript = essay;
    if (mode === 'speaking') {
      if (!audioBase64) {
        return res.status(400).json({ error: 'audioBase64 is required for speaking mode.' });
      }
      const result = await analyzeSpeaking({ audioBase64, questionText, mistakeCategories });
      analysis = result.analysis;
      transcript = result.transcript;
    } else {
      analysis = await analyzeWriting({ essay, questionText, mistakeCategories });
    }
    // Parse mistakes from analysis (reuse frontend logic here for now)
    function parseNotesFromAnalysis(analysis) {
      const noteBlocks = analysis.split(/\n\s*\d+\. /g).filter(Boolean);
      const notes = [];
      for (const block of noteBlocks) {
        const errorMatch = block.match(/Error:(.*?)(\n|$)/i);
        const correctMatch = block.match(/Correct:(.*?)(\n|$)/i);
        const explanationMatch = block.match(/Explanation:(.*?)(\n|$)/i);
        const categoryMatch = block.match(/Category:(.*?)(\n|$)/i);
        if (errorMatch || correctMatch || explanationMatch || categoryMatch) {
          notes.push({
            error: errorMatch ? errorMatch[1].trim() : '',
            correct: correctMatch ? correctMatch[1].trim() : '',
            explanation: explanationMatch ? explanationMatch[1].trim() : '',
            category: categoryMatch ? categoryMatch[1].trim() : '',
          });
        }
      }
      return notes;
    }
    const mistakes = parseNotesFromAnalysis(analysis);
    // Log attempt to user_data.json
    const userData = loadUserData();
    const attempt = {
      timestamp: Date.now(),
      essay: transcript,
      questionId,
      analysis,
      mistakes,
      mode,
    };
    userData.attempts.push(attempt);
    saveUserData(userData);
    res.json({ analysis });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to analyze answer.' });
  }
});

// Endpoint to get all IELTS questions (writing or speaking)
app.get('/api/questions', (req, res) => {
  const mode = req.query.mode || 'writing';
  if (mode === 'speaking') {
    return res.json(speakingQuestions.map(q => ({ id: q.id, question: q.question })));
  }
  res.json(questions.map(q => ({ id: q.id, question: q.question })));
});

// Endpoint: Get mistakes by date range
app.get('/api/mistakes', (req, res) => {
  const { range } = req.query; // 'current', '7days', '30days'
  const userData = loadUserData();
  const attempts = userData.attempts || [];
  if (range === 'current') {
    if (attempts.length === 0) return res.json([]);
    return res.json(attempts[attempts.length - 1].mistakes.map(m => ({ ...m, attemptTimestamp: attempts[attempts.length - 1].timestamp })));
  }
  const now = Date.now();
  let fromDate = 0;
  if (range === '7days') fromDate = now - 7 * 24 * 60 * 60 * 1000;
  if (range === '30days') fromDate = now - 30 * 24 * 60 * 60 * 1000;
  const filtered = getMistakesByDateRange(attempts, fromDate, now);
  res.json(filtered);
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
}); 

// Serve static files from the React app
app.use(express.static(path.join(__dirname, 'build')));

// All other GET requests not handled before will return the React app
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'build', 'index.html'));
});