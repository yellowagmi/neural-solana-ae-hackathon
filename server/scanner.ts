// Neural graph scanner — adapted from neural-gen/src/doc-scan.mjs for server use.
// Accepts markdown content strings instead of file paths.

const STOPWORDS = new Set([
  'the','a','an','and','or','but','in','on','at','to','for','of','with','as',
  'is','are','was','were','it','its','this','that','be','been','have','has',
  'from','by','not','we','you','they','he','she','will','can','should','would',
  'could','may','might','must','shall','do','does','did','i','my','your','our',
  'their','if','then','else','when','where','which','who','what','how','why',
  'also','more','some','all','any','each','no','so','than','about','into',
  'use','using','used','make','makes','made','get','gets','set','run','runs',
  'via','per','see','note','example','used','new','first','next','last','etc',
  'one','two','three','only','just','very','most','other','these','those',
  'after','before','while','during','between','within','without',
]);

interface Section {
  level: number;
  rawTitle: string;
  title: string;
  lines: string[];
  startLine: number;
}

interface GraphNode {
  id: string;
  label: string;
  path: string;
  type: string;
  subtype: string;
  tier: string;
  cluster: string;
  shared: boolean;
  anchor: boolean;
  size: number;
  degree: number;
  modified: number;
  keywords: string[];
  description: string;
  [key: string]: any;
}

interface GraphEdge {
  source: string;
  target: string;
  type: string;
  weight: number;
}

export interface GraphResult {
  _links?: any[];
  meta: {
    project: string;
    anchorFile: string;
    linkedFiles: string[];
    mode: string;
    generated: string;
    nodeCount: number;
    edgeCount: number;
    fileCount: number;
    sharedNodes: number;
    generator: string;
  };
  nodes: GraphNode[];
  edges: GraphEdge[];
}

let _nid = 0;
const nid = () => `n${_nid++}`;

function resetIds() { _nid = 0; }

function parseMarkdown(raw: string): { sections: Section[]; preambleLines: string[] } {
  const lines = raw.split('\n');
  const sections: Section[] = [];
  let current: Section | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      if (current) sections.push(current);
      current = {
        level: headingMatch[1].length,
        rawTitle: headingMatch[2].trim(),
        title: cleanText(headingMatch[2]),
        lines: [],
        startLine: i,
      };
    } else if (current) {
      const stripped = line.trim();
      if (stripped) current.lines.push(stripped);
    }
  }
  if (current) sections.push(current);

  const preambleLines: string[] = [];
  for (const line of lines) {
    if (line.match(/^#{1,6}\s/)) break;
    if (line.trim()) preambleLines.push(line.trim());
  }

  return { sections, preambleLines };
}

function cleanText(s: string): string {
  return s
    .replace(/`[^`]*`/g, m => m.slice(1, -1))
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[#`*_>~]/g, '')
    .trim();
}

function extractEntities(text: string): string[] {
  const entities = new Set<string>();

  const codeRefs = text.match(/`([^`\n]{2,40})`/g) || [];
  codeRefs.forEach(r => {
    const clean = r.slice(1, -1).trim();
    if (clean.length >= 2 && clean.length <= 40) entities.add(clean);
  });

  const quoted = text.match(/["']([A-Z][a-zA-Z0-9\s_-]{2,30})["']/g) || [];
  quoted.forEach(r => {
    const clean = r.slice(1, -1).trim();
    if (clean) entities.add(clean);
  });

  const capPhrases = text.match(/(?<![.!?]\s)(?<!\n)\b([A-Z][a-z]{1,15})(\s[A-Z][a-z]{1,15}){0,2}\b/g) || [];
  capPhrases.forEach(p => {
    const clean = p.trim();
    if (clean.length >= 4 && !STOPWORDS.has(clean.toLowerCase())) entities.add(clean);
  });

  const acronyms = text.match(/\b[A-Z]{2,10}\b/g) || [];
  acronyms.forEach(a => entities.add(a));

  const camel = text.match(/\b[a-z][a-zA-Z0-9]{3,30}\b/g) || [];
  camel.forEach(c => {
    if (/[A-Z]/.test(c) && !STOPWORDS.has(c.toLowerCase())) entities.add(c);
  });

  const hyphenated = text.match(/\b[a-z]{2,15}-[a-z]{2,15}(?:-[a-z]{2,15})?\b/g) || [];
  hyphenated.forEach(h => {
    if (!STOPWORDS.has(h.split('-')[0])) entities.add(h);
  });

  return [...entities].filter(e => e.length >= 2 && e.length <= 50);
}

function extractFrequentTerms(allText: string, topN = 30): Array<{ word: string; count: number }> {
  const words = allText.toLowerCase().match(/\b[a-z][a-z0-9_-]{3,20}\b/g) || [];
  const freq: Record<string, number> = {};
  words.forEach(w => {
    if (!STOPWORDS.has(w)) freq[w] = (freq[w] || 0) + 1;
  });
  return Object.entries(freq)
    .filter(([, c]) => c >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([word, count]) => ({ word, count }));
}

function toSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|(?<=\n)[-*•]\s*|[\n]{2,}/)
    .map(s => s.trim())
    .filter(s => s.length > 10);
}

function textFromLines(lines: string[]): string {
  return lines
    .map(l => l.replace(/^[-*•]\s*/, '').replace(/^\d+\.\s*/, ''))
    .join(' ');
}

function extractLinkedFilenames(raw: string): string[] {
  const found = new Set<string>();

  function addFile(path: string) {
    const name = path.split('#')[0].split('?')[0].trim().split('/').pop();
    if (name && name.endsWith('.md')) found.add(name);
  }

  // Pattern 1: Markdown links [text](path.md)
  let m;
  const linkRe = /\[([^\]]*)\]\(([^)]+\.md[^)]*)\)/gi;
  while ((m = linkRe.exec(raw)) !== null) {
    addFile(m[2]);
  }

  // Pattern 2: Plain text mentions - "See FILENAME.md", "Read FILENAME.md", etc.
  const plainRe1 = /(?:See|Read|Follow|Check|Refer to|Open|see|read|follow|check|refer to|open)\s+([^\s,]+\.md)/gi;
  while ((m = plainRe1.exec(raw)) !== null) {
    addFile(m[1]);
  }

  // Pattern 3: Preposition-style mentions - "according to FILENAME.md", etc.
  const plainRe2 = /\b(?:according to|as shown in|based on|described in|documented in|from|given in|listed in|mentioned in|provided in|referenced in|shown in|specified in|stated in|defined in|outlined in|covered in)\s+([^\s,]+\.md)\b/gi;
  while ((m = plainRe2.exec(raw)) !== null) {
    addFile(m[1]);
  }

  // Pattern 4: Simple .md filename mentions anywhere
  const plainRe3 = /\b([A-Za-z][A-Za-z0-9_\-\/]*\.md)\b/g;
  while ((m = plainRe3.exec(raw)) !== null) {
    addFile(m[1]);
  }

  return [...found];
}

interface EntityKey {
  key: string;
  id: string;
  label: string;
}

function scanFileContent(
  filename: string,
  raw: string,
  fileNodeId: string,
  clusterName: string,
): { nodes: GraphNode[]; edges: GraphEdge[]; entityKeys: EntityKey[] } {
  const { sections, preambleLines } = parseMarkdown(raw);
  const frequentTerms = extractFrequentTerms(raw);

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const sectionNodeMap: Record<number, string> = {};
  const sectionEntityMap: Record<number, Set<string>> = {};

  const now = Math.floor(Date.now() / 1000);

  // section nodes
  sections.forEach((sec, idx) => {
    const secText = textFromLines(sec.lines);
    const secSize = Math.max(2, Math.min(12, Math.ceil(sec.lines.length / 2)));
    const id = nid();
    sectionNodeMap[idx] = id;

    nodes.push({
      id,
      label: sec.title.length > 40 ? sec.title.slice(0, 38) + '...' : sec.title,
      path: `${filename}#${sec.rawTitle.toLowerCase().replace(/\s+/g, '-')}`,
      type: sec.level <= 3 ? 'doc' : 'code',
      subtype: 'section',
      tier: 'section',
      cluster: clusterName,
      shared: false,
      anchor: false,
      size: secSize,
      degree: 0,
      modified: now,
      keywords: extractFrequentTerms(secText, 5).map(t => t.word),
      description: `Section in ${filename} — ${sec.lines.length} lines`,
      level: sec.level,
    });

    sectionEntityMap[idx] = new Set(extractEntities(sec.rawTitle + '\n' + secText));

    if (sec.level <= 2) {
      edges.push({ source: fileNodeId, target: id, type: 'contains', weight: 0.5 });
    } else {
      let parentId = fileNodeId;
      for (let pi = idx - 1; pi >= 0; pi--) {
        if (sections[pi].level < sec.level && sectionNodeMap[pi]) {
          parentId = sectionNodeMap[pi];
          break;
        }
      }
      edges.push({ source: parentId, target: id, type: 'contains', weight: 0.4 });
    }
  });

  // entity map
  const globalEntityMap: Record<string, { id: string; label: string; sections: Set<number>; count: number }> = {};

  sections.forEach((sec, idx) => {
    const entities = sectionEntityMap[idx] || new Set();
    entities.forEach(entity => {
      const key = entity.toLowerCase();
      if (!globalEntityMap[key]) {
        globalEntityMap[key] = { id: nid(), label: entity, sections: new Set(), count: 0 };
      }
      globalEntityMap[key].sections.add(idx);
      globalEntityMap[key].count++;
    });
  });

  if (preambleLines.length) {
    extractEntities(preambleLines.join(' ')).forEach(entity => {
      const key = entity.toLowerCase();
      if (!globalEntityMap[key]) {
        globalEntityMap[key] = { id: nid(), label: entity, sections: new Set([-1]), count: 1 };
      }
    });
  }

  const freqTermSet = new Set(frequentTerms.map(t => t.word));

  const keptEntities = Object.entries(globalEntityMap).filter(([key, data]) => {
    if (data.label.startsWith('`') || /^[A-Z]{2,}$/.test(data.label)) return true;
    if (data.sections.size >= 2) return true;
    if (freqTermSet.has(key)) return true;
    if (data.label.includes('-')) return true;
    if (/[A-Z]/.test(data.label[0]) && data.label.length >= 4) return true;
    return false;
  });

  const topEntities = keptEntities
    .sort((a, b) => (b[1].sections.size - a[1].sections.size) || (b[1].count - a[1].count))
    .slice(0, 60);

  topEntities.forEach(([key, data]) => {
    const isFrequent = freqTermSet.has(key);
    const isTechnical = /`/.test(data.label) || data.label.includes('-') || /^[A-Z]{2,}$/.test(data.label);

    nodes.push({
      id: data.id,
      label: data.label.length > 35 ? data.label.slice(0, 33) + '...' : data.label,
      path: `${filename}::${data.label}`,
      type: isTechnical ? 'config' : (isFrequent ? 'shell' : 'config'),
      subtype: 'entity',
      tier: 'entity',
      cluster: clusterName,
      shared: false,
      anchor: false,
      size: Math.max(1, Math.min(8, data.sections.size * 2 + 1)),
      degree: 0,
      modified: now,
      keywords: [],
      description: `Appears in ${data.sections.size} section(s) of ${filename}`,
      sectionCount: data.sections.size,
    });

    data.sections.forEach(secIdx => {
      const secNodeId = secIdx === -1 ? fileNodeId : sectionNodeMap[secIdx];
      if (secNodeId && secNodeId !== data.id) {
        edges.push({
          source: data.id,
          target: secNodeId,
          type: 'mention',
          weight: Math.min(1.0, 0.3 + data.sections.size * 0.15),
        });
      }
    });
  });

  // co-occurrence edges
  sections.forEach((sec) => {
    const sentences = toSentences(textFromLines(sec.lines));
    sentences.forEach(sentence => {
      const present = topEntities.filter(([key, data]) =>
        sentence.toLowerCase().includes(key) || sentence.includes(data.label)
      );
      for (let i = 0; i < present.length; i++) {
        for (let j = i + 1; j < present.length; j++) {
          const aId = present[i][1].id;
          const bId = present[j][1].id;
          if (aId === bId) continue;
          const exists = edges.some(e =>
            (e.source === aId && e.target === bId) ||
            (e.source === bId && e.target === aId)
          );
          if (!exists) edges.push({ source: aId, target: bId, type: 'similarity', weight: 0.2 });
        }
      }
    });
  });

  // frequent term nodes
  const existingLabels = new Set(nodes.map(n => n.label.toLowerCase()));
  frequentTerms.slice(0, 20).forEach(({ word, count }) => {
    if (existingLabels.has(word)) return;
    const termId = nid();
    nodes.push({
      id: termId,
      label: word,
      path: `${filename}::term::${word}`,
      type: 'shell',
      subtype: 'term',
      tier: 'term',
      cluster: clusterName,
      shared: false,
      anchor: false,
      size: Math.max(1, Math.min(6, Math.ceil(count / 3))),
      degree: 0,
      modified: now,
      keywords: [],
      description: `Appears ${count} times in ${filename}`,
      frequency: count,
    });

    let connectedTo = 0;
    sections.forEach((sec, idx) => {
      if (connectedTo >= 3) return;
      const secText = (sec.rawTitle + ' ' + textFromLines(sec.lines)).toLowerCase();
      const termCount = (secText.match(new RegExp(`\\b${word}\\b`, 'g')) || []).length;
      if (termCount >= 2 && sectionNodeMap[idx]) {
        edges.push({
          source: termId,
          target: sectionNodeMap[idx],
          type: 'mention',
          weight: Math.min(0.5, 0.2 + termCount * 0.05),
        });
        connectedTo++;
      }
    });

    if (connectedTo === 0) {
      edges.push({ source: fileNodeId, target: termId, type: 'anchor', weight: 0.1 });
    }
    existingLabels.add(word);
  });

  const entityKeys = topEntities.map(([key, data]) => ({ key, id: data.id, label: data.label }));
  return { nodes, edges, entityKeys };
}

/**
 * Generate a knowledge graph from markdown content.
 * @param files - Map of filename → markdown content. First entry is the anchor.
 */
export function generateGraph(files: Record<string, string>): GraphResult {
  resetIds();

  const filenames = Object.keys(files);
  if (filenames.length === 0) throw new Error('No files provided');

  const anchorFilename = filenames[0];
  const anchorRaw = files[anchorFilename];
  const { sections: anchorSections } = parseMarkdown(anchorRaw);
  const firstH1 = anchorSections.find(s => s.level === 1);
  const anchorTitle = firstH1 ? firstH1.title : anchorFilename.replace(/\.md$/i, '');

  // Find linked files referenced in anchor that are also in the input
  const linkedNames = extractLinkedFilenames(anchorRaw);
  const additionalFiles = filenames.slice(1);
  // Include files that are either linked from anchor or provided alongside it
  const linkedFiles = additionalFiles.length > 0
    ? additionalFiles
    : linkedNames.filter(n => files[n]);

  const allNodes: GraphNode[] = [];
  const allEdges: GraphEdge[] = [];

  // Anchor node
  const anchorNodeId = nid();
  allNodes.push({
    id: anchorNodeId,
    label: anchorTitle,
    path: anchorFilename,
    type: 'doc',
    subtype: 'anchor',
    tier: 'anchor',
    cluster: anchorFilename,
    shared: false,
    anchor: true,
    size: 50,
    degree: 0,
    modified: Math.floor(Date.now() / 1000),
    keywords: extractFrequentTerms(anchorRaw, 6).map(t => t.word),
    description: `Core anchor: ${anchorFilename}`,
  });

  // Scan anchor
  const anchorResult = scanFileContent(anchorFilename, anchorRaw, anchorNodeId, anchorFilename);
  allNodes.push(...anchorResult.nodes);
  allEdges.push(...anchorResult.edges);

  // Scan linked files
  const fileResults: Record<string, ReturnType<typeof scanFileContent>> = {};

  for (const filename of linkedFiles) {
    const raw = files[filename];
    if (!raw) continue;

    const fileNodeId = nid();
    const result = scanFileContent(filename, raw, fileNodeId, filename);
    fileResults[filename] = result;
    allNodes.push(...result.nodes);
    allEdges.push(...result.edges);

    const { sections } = parseMarkdown(raw);
    const h1 = sections.find(s => s.level === 1);
    const fileLabel = h1 ? h1.title : filename.replace(/\.md$/i, '');
    const fileEdgeCount = (result.edges?.length || 0) + 1;

    allNodes.push({
      id: fileNodeId,
      label: fileLabel,
      path: filename,
      type: 'doc',
      subtype: 'file',
      tier: 'file',
      cluster: filename,
      shared: false,
      anchor: false,
      size: Math.max(30, Math.min(80, 20 + fileEdgeCount)),
      degree: 0,
      modified: Math.floor(Date.now() / 1000),
      keywords: extractFrequentTerms(raw, 6).map(t => t.word),
      description: `Linked file: ${filename} (${fileEdgeCount} connections)`,
    });

    allEdges.push({ source: anchorNodeId, target: fileNodeId, type: 'references', weight: 0.8 });
  }

  // Detect shared entities across files
  const labelToAppearances: Record<string, Array<{ cluster: string; id: string }>> = {};

  const registerEntities = (entityKeys: EntityKey[], clusterName: string) => {
    entityKeys.forEach(({ key, id }) => {
      if (!labelToAppearances[key]) labelToAppearances[key] = [];
      labelToAppearances[key].push({ cluster: clusterName, id });
    });
  };

  registerEntities(anchorResult.entityKeys, anchorFilename);
  Object.entries(fileResults).forEach(([filename, result]) => {
    registerEntities(result.entityKeys, filename);
  });

  const crossEdgeSet = new Set<string>();

  Object.entries(labelToAppearances).forEach(([, appearances]) => {
    if (appearances.length < 2) return;

    appearances.forEach(({ id }) => {
      const node = allNodes.find(n => n.id === id);
      if (node) {
        node.shared = true;
        node.size = Math.min(14, node.size + 3);
        node.description += ' [shared across files]';
      }
    });

    for (let i = 0; i < appearances.length; i++) {
      for (let j = i + 1; j < appearances.length; j++) {
        const a = appearances[i].id;
        const b = appearances[j].id;
        const edgeKey = [a, b].sort().join('--') + 'cross';
        if (!crossEdgeSet.has(edgeKey)) {
          crossEdgeSet.add(edgeKey);
          allEdges.push({ source: a, target: b, type: 'cross-file', weight: 0.6 });
        }
      }
    }
  });

  // Compute degree
  const degree: Record<string, number> = {};
  allNodes.forEach(n => degree[n.id] = 0);
  allEdges.forEach(e => {
    degree[e.source] = (degree[e.source] || 0) + 1;
    degree[e.target] = (degree[e.target] || 0) + 1;
  });
  allNodes.forEach(n => n.degree = degree[n.id] || 0);

  // Deduplicate edges
  const edgeSet = new Set<string>();
  const cleanEdges = allEdges.filter(e => {
    const key = [e.source, e.target].sort().join('--') + e.type;
    if (edgeSet.has(key)) return false;
    edgeSet.add(key);
    return true;
  });

  // Remove disconnected nodes
  const connected = new Set(cleanEdges.flatMap(e => [e.source, e.target]));
  connected.add(anchorNodeId);
  const cleanNodes = allNodes.filter(n => connected.has(n.id));

  return {
    meta: {
      project: anchorTitle,
      anchorFile: anchorFilename,
      linkedFiles,
      mode: 'multi-file-clustered',
      generated: new Date().toISOString(),
      nodeCount: cleanNodes.length,
      edgeCount: cleanEdges.length,
      fileCount: 1 + linkedFiles.length,
      sharedNodes: cleanNodes.filter(n => n.shared).length,
      generator: 'neural doc-scan v2.0.0 (server)',
    },
    nodes: cleanNodes,
    edges: cleanEdges,
    _links: cleanEdges,
  };
}
