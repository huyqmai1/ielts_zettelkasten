import React, { useMemo, useState } from 'react';
// import Tree from 'react-d3-tree';

export interface Note {
  error: string;
  correct: string;
  explanation: string;
  category: string;
}

// Tree node type for react-d3-tree
// interface TreeNode {
//   name: string;
//   children?: TreeNode[];
//   note?: Note; // Only for leaf nodes
// }

// Helper: Build a tree from notes
// function buildTree(notes: Note[]): TreeNode {
//   const root: TreeNode = { name: 'Mistakes', children: [] };
//   for (const note of notes) {
//     const categoryPath = note.category ? note.category.split('>').map(s => s.trim()) : ['Uncategorized'];
//     let current = root;
//     for (const cat of categoryPath) {
//       let child = current.children!.find(c => c.name === cat);
//       if (!child) {
//         child = { name: cat, children: [] };
//         current.children!.push(child);
//       }
//       current = child;
//     }
//     // Add the note as a leaf
//     current.children!.push({ name: note.error, note });
//   }
//   return root;
// }

export interface MistakeTreeProps {
  notes: Note[];
  range?: 'current' | '7days' | '30days';
}

// Define common IELTS mistake categories and subcategories
const mistakeMap: Record<string, string[]> = {
  'Grammar': [
    'Subject-Verb Agreement',
    'Tense Consistency',
    'Articles',
    'Prepositions',
    'Punctuation',
    'Sentence Fragments',
    'Run-on Sentences',
  ],
  'Vocabulary': [
    'Word Choice',
    'Collocations',
    'Register',
    'Spelling',
    'Repetition',
  ],
  'Structure': [
    'Paragraph Organization',
    'Coherence',
    'Cohesion',
    'Linking Words',
  ],
  'Task Achievement': [
    'Addressing All Parts',
    'Answer Relevance',
    'Task Response',
  ],
  'Tone & Register': [
    'Formality',
    'Appropriateness',
  ],
  'Other': [
    'Uncategorized',
  ],
};

// Count mistakes per subcategory
function getMistakeCounts(notes: Note[]) {
  const counts: Record<string, Record<string, number>> = {};
  for (const cat in mistakeMap) {
    counts[cat] = {};
    for (const sub of mistakeMap[cat]) {
      counts[cat][sub] = 0;
    }
  }
  for (const note of notes) {
    let matched = false;
    if (note.category) {
      const [catPart, subPart] = note.category.split('>').map(s => s.trim());
      if (catPart && subPart && counts[catPart] && counts[catPart][subPart] !== undefined) {
        counts[catPart][subPart] += 1;
        matched = true;
      } else if (catPart && counts[catPart]) {
        // If only category matches, increment Uncategorized in that category
        counts[catPart]['Uncategorized'] = (counts[catPart]['Uncategorized'] || 0) + 1;
        matched = true;
      }
    }
    if (!matched) {
      counts['Other']['Uncategorized'] += 1;
    }
  }
  return counts;
}

// Get notes for a given category/subcategory
function getNotesForCell(notes: Note[], cat: string, sub: string): Note[] {
  return notes.filter(note => {
    if (!note.category) return cat === 'Other' && sub === 'Uncategorized';
    const catMatch = note.category.toLowerCase().includes(cat.toLowerCase());
    const subMatch = note.category.toLowerCase().includes(sub.toLowerCase());
    return catMatch && subMatch;
  });
}

// Heat color scale (yellow to red)
function getHeatColor(count: number, max: number, selected: boolean) {
  if (selected) return '#ff7043'; // Highlight selected cell
  if (count === 0) return '#fffde7';
  const percent = Math.min(count / (max || 1), 1);
  // interpolate from yellow (#fffde7) to red (#d32f2f)
  const r = Math.round(255 * (1 - percent) + 211 * percent);
  const g = Math.round(253 * (1 - percent) + 47 * percent);
  const b = Math.round(231 * (1 - percent) + 47 * percent);
  return `rgb(${r},${g},${b})`;
}

// Simple modal component
const Modal: React.FC<{ onClose: () => void; title: string; children: React.ReactNode }> = ({ onClose, title, children }) => (
  <div
    style={{
      position: 'fixed',
      top: 0,
      left: 0,
      width: '100vw',
      height: '100vh',
      background: 'rgba(0,0,0,0.25)',
      zIndex: 1000,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}
    onClick={onClose}
  >
    <div
      style={{ background: '#fffde7', border: '1px solid #fbc02d', borderRadius: 10, padding: 24, minWidth: 340, maxWidth: 480, boxShadow: '0 4px 32px #0002', position: 'relative' }}
      onClick={e => e.stopPropagation()}
    >
      <button onClick={onClose} style={{ position: 'absolute', top: 10, right: 14, background: 'none', border: 'none', fontSize: 22, color: '#e65100', cursor: 'pointer' }} title="Close">×</button>
      <div style={{ fontWeight: 700, color: '#e65100', marginBottom: 12, fontSize: 18 }}>{title}</div>
      <div>{children}</div>
    </div>
  </div>
);

// Helper to fetch mistakes by range from backend
export async function fetchMistakesByRange(range: 'current' | '7days' | '30days'): Promise<Note[]> {
  const res = await fetch(`/api/mistakes?range=${range}`);
  if (!res.ok) throw new Error('Failed to fetch mistakes');
  return await res.json();
}

export const MistakeTree: React.FC<MistakeTreeProps> = ({ notes }) => {
  // Compute mistake counts
  const counts = useMemo(() => getMistakeCounts(notes), [notes]);
  // Find the max count for color scaling
  const max = useMemo(() => {
    let m = 0;
    for (const cat in counts) {
      for (const sub in counts[cat]) {
        if (counts[cat][sub] > m) m = counts[cat][sub];
      }
    }
    return m;
  }, [counts]);

  // State for selected cell
  const [selected, setSelected] = useState<{cat: string, sub: string} | null>(null);
  const selectedNotes = useMemo(() => {
    if (!selected) return [];
    return getNotesForCell(notes, selected.cat, selected.sub);
  }, [selected, notes]);

  return (
    <div style={{ width: '100%', overflowX: 'auto' }}>
      <h3 style={{ margin: '16px 0 8px 0' }}>IELTS Mistake Heatmap</h3>
      <div style={{ display: 'flex', flexDirection: 'row', gap: 32, flexWrap: 'wrap' }}>
        {Object.entries(mistakeMap).map(([cat, subs]) => (
          <div key={cat} style={{ minWidth: 180 }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>{cat}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 8 }}>
              {subs.map(sub => {
                const isSelected = !!(selected && selected.cat === cat && selected.sub === sub);
                return (
                  <div
                    key={sub}
                    style={{
                      background: getHeatColor(counts[cat][sub], max, isSelected),
                      border: isSelected ? '2px solid #ff7043' : '1px solid #fbc02d',
                      borderRadius: 6,
                      padding: '8px 12px',
                      minWidth: 120,
                      minHeight: 32,
                      color: '#6d4c41',
                      fontWeight: 500,
                      boxShadow: counts[cat][sub] > 0 ? '0 2px 8px #fbc02d44' : undefined,
                      transition: 'background 0.3s, border 0.2s',
                      cursor: counts[cat][sub] > 0 ? 'pointer' : 'default',
                      outline: isSelected ? '2px solid #ff7043' : undefined,
                    }}
                    title={`Mistakes: ${counts[cat][sub]}`}
                    onClick={() => counts[cat][sub] > 0 ? setSelected({cat, sub}) : undefined}
                  >
                    {sub} {counts[cat][sub] > 0 && <b>({counts[cat][sub]})</b>}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      {max === 0 && <em style={{ color: '#aaa' }}>[No mistakes to visualize]</em>}
      {selected && selectedNotes.length > 0 && (
        <Modal
          onClose={() => setSelected(null)}
          title={`Mistakes for ${selected.cat} > ${selected.sub}`}
        >
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {selectedNotes.map((note, idx) => (
              <li key={idx} style={{ marginBottom: 8 }}>
                <div><b>Error:</b> <span style={{ color: '#b71c1c' }}>{note.error}</span></div>
                <div><b>Correct:</b> <span style={{ color: '#388e3c' }}>{note.correct}</span></div>
                <div><b>Explanation:</b> {note.explanation}</div>
              </li>
            ))}
          </ul>
        </Modal>
      )}
    </div>
  );
}; 