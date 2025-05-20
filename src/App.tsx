import React, { useState, useEffect } from 'react';
import './App.css';
import { MistakeTree, fetchMistakesByRange } from './MistakeTree';
import { quizQuestions, QuizQuestion } from './QuizQuestions';
import AudioRecorder from './AudioRecorder';

function parseNotesFromAnalysis(analysis: string): Note[] {
  // Simple parser for AI output. Assumes a consistent format like:
  // "1. Error: ...\nCorrect: ...\nExplanation: ...\nCategory: ...\n"
  // This can be improved with more structured AI output.
  const noteBlocks = analysis.split(/\n\s*\d+\. /g).filter(Boolean);
  const notes: Note[] = [];
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

interface Note {
  error: string;
  correct: string;
  explanation: string;
  category: string;
}

interface Question { id: string; question: string; }

function getTopMistakeSubcategories(notes: Note[], n: number): { category: string, subcategory: string }[] {
  const freq: Record<string, number> = {};
  for (const note of notes) {
    if (note.category) {
      const key = note.category.trim();
      freq[key] = (freq[key] || 0) + 1;
    }
  }
  // Sort by frequency
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([cat]) => {
      const [category, subcategory] = cat.split('>').map(s => s.trim());
      return { category, subcategory };
    });
}

function getRandomQuestionForSubcategory(category: string, subcategory: string): QuizQuestion | null {
  const filtered = quizQuestions.filter(q => q.category === category && q.subcategory === subcategory);
  if (filtered.length === 0) return null;
  return filtered[Math.floor(Math.random() * filtered.length)];
}

function App() {
  const [essay, setEssay] = useState('');
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [selectedQuestionId, setSelectedQuestionId] = useState<string | null>(null);
  const [quizAnswers, setQuizAnswers] = useState<Record<string, number | null>>({});
  const [quizFeedback, setQuizFeedback] = useState<Record<string, boolean | null>>({});
  const [mistakeRange, setMistakeRange] = useState<'current' | '7days' | '30days'>('current');
  const [visualizationNotes, setVisualizationNotes] = useState<Note[]>([]);
  const [mode, setMode] = useState<'writing' | 'speaking'>('writing');
  const [audioBase64, setAudioBase64] = useState<string | null>(null);

  // Fetch questions on mount or when mode changes
  useEffect(() => {
    fetch(`/api/questions?mode=${mode}`)
      .then(res => res.json())
      .then((data: Question[]) => {
        setQuestions(data);
        if (data.length > 0) {
          // Pick a random question on load
          const randomIdx = Math.floor(Math.random() * data.length);
          setSelectedQuestionId(data[randomIdx].id);
        }
      });
    // Reset UI on mode change
    setEssay('');
    setAnalysis(null);
    setNotes([]);
    setError(null);
    setQuizAnswers({});
    setQuizFeedback({});
    setAudioBase64(null);
  }, [mode]);

  useEffect(() => {
    fetchMistakesByRange(mistakeRange)
      .then(setVisualizationNotes)
      .catch(() => setVisualizationNotes([]));
  }, [mistakeRange]);

  const selectedQuestion = questions.find(q => q.id === selectedQuestionId);

  const handleRandomQuestion = () => {
    if (questions.length > 0) {
      let newIdx = Math.floor(Math.random() * questions.length);
      // Avoid picking the same question
      if (questions.length > 1 && questions[newIdx].id === selectedQuestionId) {
        newIdx = (newIdx + 1) % questions.length;
      }
      setSelectedQuestionId(questions[newIdx].id);
      setEssay('');
      setAnalysis(null);
      setNotes([]);
      setError(null);
    }
  };

  const handleAnalyze = async () => {
    setLoading(true);
    setError(null);
    setAnalysis(null);
    setNotes([]);
    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ essay, questionId: selectedQuestionId }),
      });
      if (!response.ok) throw new Error('Failed to analyze essay');
      const data = await response.json();
      setAnalysis(data.analysis);
      // Parse notes from analysis
      const parsedNotes = parseNotesFromAnalysis(data.analysis);
      setNotes(parsedNotes);
      // Refresh visualization if showing current attempt
      if (mistakeRange === 'current') {
        fetchMistakesByRange('current')
          .then(setVisualizationNotes)
          .catch(() => setVisualizationNotes([]));
      }
    } catch (err: any) {
      setError(err.message || 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const handleAnalyzeSpeaking = async () => {
    setLoading(true);
    setError(null);
    setAnalysis(null);
    setNotes([]);
    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionId: selectedQuestionId, mode: 'speaking', audioBase64 }),
      });
      if (!response.ok) throw new Error('Failed to analyze speaking answer');
      const data = await response.json();
      setAnalysis(data.analysis);
      // Parse notes from analysis
      const parsedNotes = parseNotesFromAnalysis(data.analysis);
      setNotes(parsedNotes);
      // Refresh visualization if showing current attempt
      if (mistakeRange === 'current') {
        fetchMistakesByRange('current')
          .then(setVisualizationNotes)
          .catch(() => setVisualizationNotes([]));
      }
    } catch (err: any) {
      setError(err.message || 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  // Compute top 3 mistake subcategories
  const topMistakes = getTopMistakeSubcategories(notes, 3);
  // Pick 1 question for each
  const quizSet = topMistakes
    .map(({ category, subcategory }) => getRandomQuestionForSubcategory(category, subcategory))
    .filter(Boolean) as QuizQuestion[];

  const handleQuizAnswer = (qid: string, idx: number, correctIdx: number) => {
    setQuizAnswers(prev => ({ ...prev, [qid]: idx }));
    setQuizFeedback(prev => ({ ...prev, [qid]: idx === correctIdx }));
  };

  const handleAudioRecordingComplete = (blob: Blob, base64: string) => {
    setAudioBase64(base64);
  };

  return (
    <div className="App" style={{ maxWidth: 900, margin: '0 auto', padding: 24, fontFamily: 'sans-serif' }}>
      <header style={{ marginBottom: 32 }}>
        <h1>IELTS Zettelkasten</h1>
        <p style={{ color: '#555' }}>Personalized IELTS Writing Practice & Knowledge Base</p>
        <div style={{ marginTop: 16 }}>
          <label style={{ fontWeight: 500, marginRight: 8 }}>Mode:</label>
          <select value={mode} onChange={e => setMode(e.target.value as any)}>
            <option value="writing">Writing</option>
            <option value="speaking">Speaking</option>
          </select>
        </div>
      </header>
      <main>
        <section style={{ marginBottom: 32 }}>
          <h2>1. Question</h2>
          <div style={{ background: '#f5f5f5', padding: 16, borderRadius: 8 }}>
            {selectedQuestion ? (
              <div>
                <div style={{ marginBottom: 8 }}>{selectedQuestion.question}</div>
                <button onClick={handleRandomQuestion} style={{ fontSize: 14, padding: '4px 12px' }} disabled={loading}>
                  New Question
                </button>
              </div>
            ) : (
              <em>Loading questions...</em>
            )}
          </div>
        </section>
        <section style={{ marginBottom: 32 }}>
          <h2>2. {mode === 'writing' ? 'Essay Input' : 'Speaking Input'}</h2>
          {mode === 'writing' ? (
            <>
              <textarea
                style={{ width: '100%', minHeight: 120, fontSize: 16, padding: 8 }}
                placeholder="Write your essay here..."
                value={essay}
                onChange={e => setEssay(e.target.value)}
                disabled={loading}
              />
              <div style={{ marginTop: 12 }}>
                <button
                  style={{ padding: '8px 24px', fontSize: 16 }}
                  onClick={handleAnalyze}
                  disabled={loading || !essay.trim()}
                >
                  {loading ? 'Analyzing...' : 'Analyze Essay'}
                </button>
              </div>
            </>
          ) : (
            <>
              <AudioRecorder onRecordingComplete={handleAudioRecordingComplete} />
              <div style={{ marginTop: 12 }}>
                <button
                  style={{ padding: '8px 24px', fontSize: 16 }}
                  onClick={handleAnalyzeSpeaking}
                  disabled={loading || !audioBase64}
                >
                  {loading ? 'Analyzing...' : 'Analyze Speaking'}
                </button>
              </div>
            </>
          )}
        </section>
        <section style={{ marginBottom: 32 }}>
          <h2>3. Analysis</h2>
          <div style={{ background: '#e3f2fd', padding: 16, borderRadius: 8, minHeight: 60 }}>
            {error && <div style={{ color: 'red' }}>{error}</div>}
            {analysis ? (
              <pre style={{ whiteSpace: 'pre-wrap', textAlign: 'left' }}>{analysis}</pre>
            ) : !loading ? (
              <em>[AI feedback and categorized mistakes will appear here]</em>
            ) : null}
          </div>
        </section>
        <section style={{ marginBottom: 32 }}>
          <h2>4. Notes (Zettelkasten)</h2>
          <div style={{ background: '#fffde7', padding: 16, borderRadius: 8, minHeight: 80 }}>
            {notes.length === 0 ? (
              <em>[Mistake notes and connections will appear here]</em>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
                {notes.map((note, idx) => (
                  <div key={idx} style={{ background: '#fff', border: '1px solid #fbc02d', borderRadius: 8, padding: 16, minWidth: 260, maxWidth: 320, boxShadow: '0 2px 8px #fbc02d22' }}>
                    <div style={{ fontWeight: 600, marginBottom: 8, color: '#e65100' }}>Mistake Note #{idx + 1}</div>
                    <div><b>Error:</b> <span style={{ color: '#b71c1c' }}>{note.error}</span></div>
                    <div><b>Correct:</b> <span style={{ color: '#388e3c' }}>{note.correct}</span></div>
                    <div><b>Explanation:</b> <span>{note.explanation}</span></div>
                    <div style={{ marginTop: 8 }}>
                      <span style={{ background: '#ffe082', color: '#6d4c41', borderRadius: 4, padding: '2px 8px', fontSize: 13 }}>
                        {note.category || 'Uncategorized'}
                      </span>
                    </div>
                    {/* Placeholder for future: connections, tags, links */}
                    <div style={{ marginTop: 8, fontSize: 12, color: '#aaa' }}>
                      <em>[Connections, tags, and links coming soon]</em>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
        <section style={{ marginBottom: 32 }}>
          <h2>5. Visualization</h2>
          <div style={{ background: '#f3e5f5', padding: 16, borderRadius: 8 }}>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontWeight: 500, marginRight: 8 }}>Show mistakes from:</label>
              <select value={mistakeRange} onChange={e => setMistakeRange(e.target.value as any)}>
                <option value="current">Current Attempt</option>
                <option value="7days">Last 7 Days</option>
                <option value="30days">Last 30 Days</option>
              </select>
            </div>
            <MistakeTree notes={visualizationNotes} range={mistakeRange} />
          </div>
        </section>
        <section style={{ marginBottom: 32 }}>
          <h2>6. Resources</h2>
          <div style={{ background: '#e8f5e9', padding: 16, borderRadius: 8 }}>
            {quizSet.length === 0 ? (
              <em>[Targeted learning resources will appear here]</em>
            ) : (
              <div>
                <h3>Practice: Common Mistake Quiz</h3>
                {quizSet.map((q, i) => (
                  <div key={q.id} style={{ marginBottom: 24, padding: 12, background: '#fff', borderRadius: 8, border: '1px solid #c8e6c9' }}>
                    <div style={{ fontWeight: 600, marginBottom: 6, color: '#388e3c' }}>Q{i + 1}: {q.question}</div>
                    <div style={{ marginBottom: 8, fontSize: 13, color: '#888' }}>{q.category} &gt; {q.subcategory}</div>
                    <div>
                      {q.options.map((opt, idx) => (
                        <button
                          key={idx}
                          onClick={() => handleQuizAnswer(q.id, idx, q.correctIndex)}
                          disabled={quizAnswers[q.id] !== undefined}
                          style={{
                            display: 'block',
                            width: '100%',
                            textAlign: 'left',
                            marginBottom: 6,
                            padding: '6px 12px',
                            borderRadius: 6,
                            border: quizAnswers[q.id] === idx ? '2px solid #388e3c' : '1px solid #bdbdbd',
                            background: quizAnswers[q.id] === idx ? (quizFeedback[q.id] ? '#c8e6c9' : '#ffcdd2') : '#fafafa',
                            color: '#333',
                            cursor: quizAnswers[q.id] !== undefined ? 'not-allowed' : 'pointer',
                          }}
                        >
                          {opt}
                        </button>
                      ))}
                    </div>
                    {quizAnswers[q.id] !== undefined && (
                      <div style={{ marginTop: 8, fontWeight: 500, color: quizFeedback[q.id] ? '#388e3c' : '#d32f2f' }}>
                        {quizFeedback[q.id] ? 'Correct!' : `Incorrect. Correct answer: ${q.options[q.correctIndex]}`}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;
