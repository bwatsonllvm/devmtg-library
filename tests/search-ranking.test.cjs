const test = require('node:test');
const assert = require('node:assert/strict');

const utils = require('../js/shared/library-utils.js');

test('buildSearchQueryModel parses advanced filters and constraints', () => {
  const model = utils.buildSearchQueryModel('llvm optimization', {
    allWords: 'pass manager',
    exactPhrase: 'loop vectorization',
    anyWords: 'mlir clang',
    withoutWords: 'cuda',
    where: 'abstract',
    author: 'Alice Smith',
    publication: 'LLVM Developers Meeting',
    yearFrom: '2020',
    yearTo: '2024',
  });

  assert.equal(model.whereScope, 'abstract');
  assert.ok(Array.isArray(model.clauses) && model.clauses.length > 0);
  assert.ok(Array.isArray(model.anyClauses) && model.anyClauses.length > 0);
  assert.ok(Array.isArray(model.excludeClauses) && model.excludeClauses.length > 0);
  assert.ok(Array.isArray(model.requiredPhrases) && model.requiredPhrases.includes('loop vectorization'));
  assert.ok(model.fieldClauses.authors && model.fieldClauses.authors.length > 0);
  assert.ok(model.fieldClauses.venue && model.fieldClauses.venue.length > 0);
  assert.equal(model.yearRange.from, 2020);
  assert.equal(model.yearRange.to, 2024);
});

test('buildSearchQueryModel keeps fielded operators scoped to their target fields', () => {
  const model = utils.buildSearchQueryModel('author:"Alice Smith" topic:mlir venue:arxiv');

  assert.equal(Array.isArray(model.clauses), true);
  assert.equal(model.clauses.length, 0);
  assert.ok(Array.isArray(model.fieldClauses.authors) && model.fieldClauses.authors.length > 0);
  assert.ok(Array.isArray(model.fieldClauses.topics) && model.fieldClauses.topics.length > 0);
  assert.ok(Array.isArray(model.fieldClauses.venue) && model.fieldClauses.venue.length > 0);
});

test('rankPaperRecordsByQuery prioritizes exact-title paper matches', () => {
  const papers = [
    {
      id: 'exact',
      title: 'MLIR-based code generation for GPU tensor cores',
      abstract: 'A practical walkthrough of MLIR code generation for tensor-core kernels.',
      authors: [{ name: 'Alice Smith' }],
      publication: 'Proceedings of LLVM Developers Meeting',
      year: 2024,
      citationCount: 12,
      tags: ['mlir', 'gpu'],
    },
    {
      id: 'near',
      title: 'GPU tensor core optimization in LLVM',
      abstract: 'Includes a section on MLIR based code generation and scheduling.',
      authors: [{ name: 'Bob Johnson' }],
      publication: 'Journal of Compiler Engineering',
      year: 2025,
      citationCount: 350,
      tags: ['llvm', 'gpu'],
    },
    {
      id: 'off-topic',
      title: 'Static analysis for frontend diagnostics',
      abstract: 'Clang diagnostics and warning suppression strategies.',
      authors: [{ name: 'Carol Doe' }],
      publication: 'Compiler Notes',
      year: 2023,
      citationCount: 40,
      tags: ['clang'],
    },
  ];

  const ranked = utils.rankPaperRecordsByQuery(papers, 'MLIR-based code generation for GPU tensor cores');
  assert.ok(ranked.length >= 2);
  assert.equal(ranked[0].id, 'exact');
});

test('rankPaperRecordsByQuery matches abstract/body content when title misses query', () => {
  const papers = [
    {
      id: 'content-hit',
      title: 'Transform dialect scheduling notes',
      abstract: 'We introduce polyhedral dependence graphs for MLIR transform dialect scheduling.',
      content: 'Detailed case study for dependence-graph driven scheduling.',
      authors: [{ name: 'Dana Lee' }],
      publication: 'MLIR Workshop',
      year: 2024,
      tags: ['mlir'],
    },
    {
      id: 'weak',
      title: 'General LLVM compiler overview',
      abstract: 'High-level overview with no dependence graph discussion.',
      authors: [{ name: 'Eli Roe' }],
      publication: 'LLVM Notes',
      year: 2024,
      tags: ['llvm'],
    },
  ];

  const ranked = utils.rankPaperRecordsByQuery(papers, 'polyhedral dependence graphs');
  assert.ok(ranked.length > 0);
  assert.equal(ranked[0].id, 'content-hit');
});

test('rankPaperRecordsByQuery indexes deep paper text fields (bodyText/fullText)', () => {
  const papers = [
    {
      id: 'deep-hit',
      title: 'Transform Dialect Notes',
      abstract: 'Overview without the target phrase.',
      bodyText: 'This section details polyhedral dependence graphs for schedule construction.',
      authors: [{ name: 'Dana Lee' }],
      publication: 'MLIR Workshop',
      year: 2024,
      tags: ['mlir'],
    },
    {
      id: 'shallow',
      title: 'General LLVM overview',
      abstract: 'General notes about optimization.',
      fullText: 'No dependence graph material.',
      authors: [{ name: 'Eli Roe' }],
      publication: 'LLVM Notes',
      year: 2024,
      tags: ['llvm'],
    },
  ];

  const ranked = utils.rankPaperRecordsByQuery(papers, 'polyhedral dependence graphs');
  assert.ok(ranked.length > 0);
  assert.equal(ranked[0].id, 'deep-hit');
});

test('rankPaperRecordsByQuery prioritizes full token coverage over partial matches', () => {
  const papers = [
    {
      id: 'exact',
      title: 'Polyhedral dependence graphs in MLIR',
      abstract: 'We use polyhedral dependence graphs to drive scheduling.',
      authors: [{ name: 'Alice Smith' }],
      publication: 'Compiler Research',
      year: 2024,
      tags: ['mlir'],
    },
    {
      id: 'partial',
      title: 'Polyhedral dependence modeling',
      abstract: 'Discusses polyhedral dependence methods, without graph construction details.',
      authors: [{ name: 'Bob Jones' }],
      publication: 'Compiler Notes',
      year: 2024,
      tags: ['mlir'],
    },
  ];

  const ranked = utils.rankPaperRecordsByQuery(papers, 'polyhedral dependence graphs');
  assert.ok(ranked.length > 0);
  assert.equal(ranked[0].id, 'exact');
  const partialIndex = ranked.findIndex((paper) => paper.id === 'partial');
  if (partialIndex !== -1) {
    assert.ok(partialIndex > 0);
  }
});

test('rankPaperRecordsByQuery enforces author/publication/year advanced filters', () => {
  const papers = [
    {
      id: 'paper-a',
      title: 'LLVM optimization pipelines in practice',
      abstract: 'Pass-pipeline design for real-world workloads.',
      authors: [{ name: 'Alice Smith' }],
      publication: 'Proceedings of LLVM Developers Meeting',
      year: 2023,
      tags: ['llvm', 'optimization'],
    },
    {
      id: 'paper-b',
      title: 'LLVM optimization pipelines in practice',
      abstract: 'Same title, different author.',
      authors: [{ name: 'Bob Johnson' }],
      publication: 'Proceedings of LLVM Developers Meeting',
      year: 2023,
      tags: ['llvm', 'optimization'],
    },
    {
      id: 'paper-c',
      title: 'LLVM optimization pipelines in practice',
      abstract: 'Same title, different venue.',
      authors: [{ name: 'Alice Smith' }],
      publication: 'Journal of Program Analysis',
      year: 2023,
      tags: ['llvm', 'optimization'],
    },
    {
      id: 'paper-d',
      title: 'LLVM optimization pipelines in practice',
      abstract: 'Same title, outside year range.',
      authors: [{ name: 'Alice Smith' }],
      publication: 'Proceedings of LLVM Developers Meeting',
      year: 2018,
      tags: ['llvm', 'optimization'],
    },
  ];

  const ranked = utils.rankPaperRecordsByQuery(papers, 'llvm optimization', {
    advanced: {
      author: 'Alice Smith',
      publication: 'LLVM Developers Meeting',
      yearFrom: '2020',
      yearTo: '2024',
    },
  });

  assert.deepEqual(ranked.map((paper) => paper.id), ['paper-a']);
});

test('rankTalksByQuery prioritizes exact-title talks', () => {
  const talks = [
    {
      id: 'exact-talk',
      title: 'LLVM for Beginners',
      abstract: 'Beginner introduction to LLVM architecture and pass pipelines.',
      category: 'tutorial',
      _speakerLower: 'alice smith',
      _tagsLower: 'llvm beginner tutorial',
      _meetingLower: 'llvm developers meeting 2024',
      _year: '2024',
      meeting: 'LLVM Developers Meeting 2024',
    },
    {
      id: 'near-talk',
      title: 'Advanced LLVM Optimization Internals',
      abstract: 'Deep dive into pass manager internals for experienced engineers.',
      category: 'technical-talk',
      _speakerLower: 'bob johnson',
      _tagsLower: 'llvm optimization',
      _meetingLower: 'llvm developers meeting 2024',
      _year: '2024',
      meeting: 'LLVM Developers Meeting 2024',
    },
  ];

  const ranked = utils.rankTalksByQuery(talks, 'LLVM for Beginners');
  assert.ok(ranked.length > 0);
  assert.equal(ranked[0].id, 'exact-talk');
});

test('buildSearchSnippet centers snippet on matched query text', () => {
  const source =
    'This repository includes many resources. The section on MLIR tensor cores includes practical examples of code generation, scheduling, and optimization details that matter in production systems.';
  const snippet = utils.buildSearchSnippet(source, 'MLIR tensor cores', { maxLength: 110 });

  assert.ok(snippet.length <= 113); // Includes optional leading/trailing ellipsis.
  assert.match(snippet.toLowerCase(), /mlir|tensor|cores/);
});

test('highlightSearchText keeps contiguous phrases in one highlight block', () => {
  const text = 'Chris Lattner presented an MLIR Transform Dialect update.';
  const highlighted = utils.highlightSearchText(text, 'Chris Lattner');

  assert.match(highlighted, /<mark>Chris Lattner<\/mark>/);
  assert.doesNotMatch(highlighted, /<mark>Chris<\/mark>\s+<mark>Lattner<\/mark>/);
});

test('highlightSearchText keeps disjoint query terms as separate highlights', () => {
  const text = 'Chris and the rest of the team included Lattner in the credits.';
  const highlighted = utils.highlightSearchText(text, 'Chris Lattner');

  assert.match(highlighted, /<mark>Chris<\/mark>/);
  assert.match(highlighted, /<mark>Lattner<\/mark>/);
  assert.doesNotMatch(highlighted, /<mark>Chris and the rest of the team included Lattner<\/mark>/);
});

test('rankPaperRecordsByQuery favors tighter context over scattered matches', () => {
  const papers = [
    {
      id: 'tight-context',
      title: 'Transform dialect implementation notes',
      abstract: 'We present an MLIR pass pipeline scheduling strategy for transform dialect workflows.',
      authors: [{ name: 'Alice Smith' }],
      publication: 'Compiler Research',
      year: 2024,
      citationCount: 24,
      tags: ['mlir'],
    },
    {
      id: 'scattered',
      title: 'MLIR pipeline internals',
      abstract: 'This work discusses pass manager architecture.',
      content: 'Scheduling tradeoffs are described in a later appendix focused on deployment.',
      authors: [{ name: 'Bob Johnson' }],
      publication: 'Compiler Research',
      year: 2024,
      citationCount: 24,
      tags: ['mlir'],
    },
  ];

  const ranked = utils.rankPaperRecordsByQuery(papers, 'mlir pass pipeline scheduling');
  assert.ok(ranked.length >= 2);
  assert.equal(ranked[0].id, 'tight-context');
});

test('parseUrlState tolerates malformed URL encoding', () => {
  assert.doesNotThrow(() => {
    const parsed = utils.parseUrlState('?q=%E0%A4%A&speaker=Alice%20Smith', []);
    assert.equal(parsed.speaker, 'Alice Smith');
    assert.equal(typeof parsed.query, 'string');
  });
});

test('composeCrossTypeRelevance rewards strict top-ranked matches', () => {
  const strictTop = utils.composeCrossTypeRelevance(180, {
    kindTopScore: 180,
    globalTopScore: 220,
    rankIndex: 0,
    tier: 'strict',
    kind: 'paper',
  });
  const relaxedTop = utils.composeCrossTypeRelevance(180, {
    kindTopScore: 180,
    globalTopScore: 220,
    rankIndex: 0,
    tier: 'relaxed',
    kind: 'paper',
  });
  const strictDeep = utils.composeCrossTypeRelevance(180, {
    kindTopScore: 180,
    globalTopScore: 220,
    rankIndex: 24,
    tier: 'strict',
    kind: 'paper',
  });

  assert.ok(strictTop > relaxedTop);
  assert.ok(strictTop > strictDeep);
});

test('composeCrossTypeRelevance applies kind priors and global-ratio penalty', () => {
  const talkTop = utils.composeCrossTypeRelevance(100, {
    kindTopScore: 100,
    globalTopScore: 100,
    rankIndex: 0,
    tier: 'strict',
    kind: 'talk',
  });
  const docsTop = utils.composeCrossTypeRelevance(100, {
    kindTopScore: 100,
    globalTopScore: 100,
    rankIndex: 0,
    tier: 'strict',
    kind: 'docs',
  });
  const highGlobal = utils.composeCrossTypeRelevance(120, {
    kindTopScore: 120,
    globalTopScore: 220,
    rankIndex: 0,
    tier: 'strict',
    kind: 'talk',
  });
  const lowGlobal = utils.composeCrossTypeRelevance(20, {
    kindTopScore: 120,
    globalTopScore: 220,
    rankIndex: 0,
    tier: 'strict',
    kind: 'talk',
  });

  assert.ok(talkTop > docsTop);
  assert.ok(highGlobal > lowGlobal);
});
