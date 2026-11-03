// Ready-made smart notes, to start from or learn the format. They're also
// the engine's own test cases: their answers are computed, not looked up.

import type { SmartSpec } from './types';

const PRIMERS: SmartSpec = {
  title: 'PCR primers',
  description: 'Write forward and reverse PCR primers 5′→3′ for a random template.',
  vars: [
    { name: 'template', label: 'The double-stranded template, both strands labelled', role: 'input' },
    { name: 'len', label: 'Primer length (bp)', role: 'input' },
    { name: 'primer', label: 'The primer, 5′→3′', role: 'answer' },
  ],
  cases: [
    {
      name: 'Forward primer',
      params: { dir: 'forward' },
      front: 'This template DNA is amplified by PCR:<br>[template]<br>Write the [len] bp <b>forward</b> primer, 5′→3′.',
      altFronts: [
        'Design a [len]-nucleotide <b>forward</b> primer (written 5′→3′) to amplify this DNA:<br>[template]',
        '[template]<br>Which [len] bp <b>forward</b> primer would you use to amplify this region? Give it 5′→3′.',
        'To amplify this sequence by PCR, what is the <b>forward</b> primer of length [len]? Write it 5′→3′.<br>[template]',
      ],
      back: '[primer]',
    },
    {
      name: 'Reverse primer',
      params: { dir: 'reverse' },
      front: 'This template DNA is amplified by PCR:<br>[template]<br>Write the [len] bp <b>reverse</b> primer, 5′→3′.',
      altFronts: [
        'Design a [len]-nucleotide <b>reverse</b> primer (written 5′→3′) to amplify this DNA:<br>[template]',
        '[template]<br>Which [len] bp <b>reverse</b> primer would you use to amplify this region? Give it 5′→3′.',
        'To amplify this sequence by PCR, what is the <b>reverse</b> primer of length [len]? Write it 5′→3′.<br>[template]',
      ],
      back: '[primer]',
    },
  ],
  code: String.raw`function sample(r, params, lib) {
  const top = lib.randomSeq(r, r.int(24, 30));
  const len = r.int(5, 8);
  return { top: top, len: len, template: lib.duplex(top) };
}

function solve(inputs, params, lib) {
  const top = inputs.top;
  const k = Number(inputs.len);
  if (params.dir === 'forward') {
    const p = top.slice(0, k);
    return {
      vars: { primer: '5′–' + p + '–3′' },
      steps: '<p>The forward primer matches the first ' + k + ' bases of the top strand, read 5′→3′. It pairs with the 3′ end of the bottom strand and extends left to right.</p>',
      traps: ['5′–' + lib.complement(p) + '–3′ is the bottom strand under those bases written left to right, which is really 3′→5′.'],
    };
  }
  const end = top.slice(top.length - k);
  const p = lib.reverseComplement(end);
  return {
    vars: { primer: '5′–' + p + '–3′' },
    steps: '<p>The reverse primer pairs with the 3′ end of the top strand. Take its last ' + k + ' bases (' + end + '), complement them (' + lib.complement(end) + ', which reads 3′→5′), and write that 5′→3′: ' + p + '.</p>',
    traps: [
      '5′–' + lib.complement(end) + '–3′ is the complement written left to right, which is really 3′→5′.',
      '5′–' + end + '–3′ is the top strand itself, which a primer can’t pair with.',
    ],
  };
}`,
  tests: [
    // the Topic 6 comprehension check
    { case: 0, inputs: { top: 'TGTCGGCCGGTAACAGTAACCCCGGAATGA', len: 5 }, expected: { primer: '5′–TGTCG–3′' } },
    { case: 1, inputs: { top: 'TGTCGGCCGGTAACAGTAACCCCGGAATGA', len: 5 }, expected: { primer: '5′–TCATT–3′' } },
  ],
};

const INTERACTIONS: SmartSpec = {
  title: 'Two-gene interactions in a dihybrid cross',
  description: 'Derive the F2 phenotypic ratio from how two genes interact, starting from 9:3:3:1.',
  vars: [
    { name: 'organism', label: 'The organism', role: 'input' },
    { name: 'genes', label: 'What each gene does and how they interact', role: 'input' },
    { name: 'cross', label: 'The dihybrid cross', role: 'input' },
    { name: 'ratio', label: 'Expected phenotypic ratio', role: 'answer' },
    { name: 'interaction', label: 'Which gene hides which, if either', role: 'answer' },
  ],
  cases: [
    { name: 'No interaction (9:3:3:1)', params: { type: 'none' } },
    { name: 'Complementary genes (9:7)', params: { type: 'complementation' } },
    { name: 'Recessive epistasis (9:3:4)', params: { type: 'recessive' } },
    { name: 'Dominant epistasis (12:3:1)', params: { type: 'dominant' } },
    { name: 'Suppression (13:3)', params: { type: 'suppression' } },
    { name: 'Redundant genes (15:1)', params: { type: 'synthetic' } },
  ].map((c) => ({
    ...c,
    front: 'In [organism]: [genes]<br><br>Two dihybrids are crossed: [cross]. What phenotypic ratio do you expect among the offspring?',
    altFronts: [
      'Consider [organism]. [genes]<br><br>Predict the phenotypic ratio of the progeny of [cross].',
      '[genes]<br><br>If two dihybrid [organism] are crossed ([cross]), in what ratio will the offspring phenotypes appear?',
      'Cross: [cross] in [organism].<br>[genes]<br><br>What are the expected offspring phenotypes, and in what ratio?',
    ],
    back: '[ratio]<br>[interaction]',
  })),
  code: String.raw`function sample(r, params, lib) {
  const letters = r.sample(['A', 'B', 'C', 'D', 'E', 'G', 'H', 'K', 'M', 'N', 'P', 'R', 'S', 'T', 'W'], 2);
  const g1 = letters[0], g2 = letters[1];
  const a = g1.toLowerCase(), b = g2.toLowerCase();
  const cols = r.sample(['black', 'brown', 'yellow', 'white', 'red', 'purple', 'grey', 'orange', 'cream'], 3);
  const trait = r.pick([['tall', 'dwarf'], ['smooth', 'wrinkled'], ['straight-haired', 'curly-haired'], ['long-tailed', 'short-tailed']]);
  const m = r.pick(['hairless', 'dwarf', 'curly-winged', 'pale', 'eyeless']);
  const organism = r.pick(['a flowering plant', 'mice', 'fruit flies', 'Labrador retrievers', 'corn', 'snapdragons', 'guinea pigs']);
  const c1 = cols[0], c2 = cols[1], c3 = cols[2];
  const dom = function (x) { return '<i>' + x + '</i>/–'; };
  const rec = function (x) { return '<i>' + x + '/' + x + '</i>'; };
  let genes;
  switch (params.type) {
    case 'none':
      genes = dom(g1) + ' gives ' + c1 + ' and ' + rec(a) + ' gives ' + c2 + '. A second, independent gene controls a different trait: ' + dom(g2) + ' gives ' + trait[0] + ' and ' + rec(b) + ' gives ' + trait[1] + '.';
      break;
    case 'complementation':
      genes = 'Pigment needs the products of two genes. With at least one ' + g1 + ' and at least one ' + g2 + ' allele it is ' + c1 + '; ' + rec(a) + ' or ' + rec(b) + ' (or both) is ' + c2 + '.';
      break;
    case 'recessive':
      genes = dom(g1) + ' gives ' + c1 + ' and ' + rec(a) + ' gives ' + c2 + '. But ' + rec(b) + ' gives ' + c3 + ' whatever gene ' + g1 + ' is; ' + dom(g2) + ' lets gene ' + g1 + ' show.';
      break;
    case 'dominant':
      genes = 'A dominant allele ' + g2 + ' gives ' + c3 + ' whatever gene ' + g1 + ' is. In ' + rec(b) + ' individuals, ' + dom(g1) + ' gives ' + c1 + ' and ' + rec(a) + ' gives ' + c2 + '.';
      break;
    case 'suppression':
      genes = 'A dominant mutant allele ' + g1 + ' gives the ' + m + ' phenotype (' + rec(a) + ' is wild type). A dominant allele ' + g2 + ' of another gene suppresses it: carriers of ' + g1 + ' that also have ' + g2 + ' look wild type.';
      break;
    default:
      genes = 'Genes ' + g1 + ' and ' + g2 + ' do the same job, so only ' + rec(a) + '; ' + rec(b) + ' individuals are ' + m + '. Everything else is wild type.';
  }
  const cross = '<i>' + g1 + '/' + a + '; ' + g2 + '/' + b + '</i> × <i>' + g1 + '/' + a + '; ' + g2 + '/' + b + '</i>';
  return { organism: organism, genes: genes, cross: cross, g1: g1, g2: g2, c1: c1, c2: c2, c3: c3, t1: trait[0], t2: trait[1], m: m };
}

function solve(inputs, params, lib) {
  const A = inputs.g1, a = A.toLowerCase(), B = inputs.g2, b = B.toLowerCase();
  const rules = {
    none: function (g) { return (lib.has(g[0], A) ? inputs.c1 : inputs.c2) + ', ' + (lib.has(g[1], B) ? inputs.t1 : inputs.t2); },
    complementation: function (g) { return lib.has(g[0], A) && lib.has(g[1], B) ? inputs.c1 : inputs.c2; },
    recessive: function (g) { return !lib.has(g[1], B) ? inputs.c3 : lib.has(g[0], A) ? inputs.c1 : inputs.c2; },
    dominant: function (g) { return lib.has(g[1], B) ? inputs.c3 : lib.has(g[0], A) ? inputs.c1 : inputs.c2; },
    suppression: function (g) { return lib.has(g[0], A) && !lib.has(g[1], B) ? inputs.m : 'wild type'; },
    synthetic: function (g) { return !lib.has(g[0], A) && !lib.has(g[1], B) ? inputs.m : 'wild type'; },
  };
  const rule = rules[params.type] || rules.synthetic;
  const counts = lib.phenotypes(lib.cross(A + a + ' ' + B + b, A + a + ' ' + B + b), rule);
  const notes = {
    none: 'No interaction: the genes affect different traits.',
    complementation: 'Complementary genes: ' + a + '/' + a + ' or ' + b + '/' + b + ' alone is enough to give ' + inputs.c2 + '.',
    recessive: 'Gene ' + B + ' is epistatic to gene ' + A + ' (recessive epistasis: ' + b + '/' + b + ' hides gene ' + A + ').',
    dominant: 'Gene ' + B + ' is epistatic to gene ' + A + ' (dominant epistasis: ' + B + '/– hides gene ' + A + ').',
    suppression: B + ' suppresses ' + A + ': only ' + A + '/–; ' + b + '/' + b + ' is ' + inputs.m + '.',
    synthetic: 'Redundant genes: only the double mutant ' + a + '/' + a + '; ' + b + '/' + b + ' is ' + inputs.m + '.',
  };
  // the four 9:3:3:1 classes and what each looks like here
  const classes = [
    [9, A + '/–; ' + B + '/–', [[A, A], [B, B]]],
    [3, A + '/–; ' + b + '/' + b, [[A, A], [b, b]]],
    [3, a + '/' + a + '; ' + B + '/–', [[a, a], [B, B]]],
    [1, a + '/' + a + '; ' + b + '/' + b, [[a, a], [b, b]]],
  ];
  const steps = '<p>Start from 9:3:3:1 and name each class:</p><ul>' + classes.map(function (c) {
    return '<li>' + c[0] + ' <i>' + c[1] + '</i> → ' + rule(c[2]) + '</li>';
  }).join('') + '</ul><p>Add up classes with the same phenotype: ' + lib.ratioOf(counts) + '.</p>';
  const traps = params.type === 'none' ? [] : ['9:3:3:1 would mean four different phenotypes; here classes that look the same add together.'];
  return { vars: { ratio: lib.describeRatio(counts), interaction: notes[params.type] || notes.synthetic }, steps: steps, traps: traps };
}`,
  tests: [
    {
      case: 0,
      inputs: { g1: 'B', g2: 'T', c1: 'black', c2: 'white', t1: 'tall', t2: 'dwarf' },
      expected: { ratio: '9 black, tall : 3 black, dwarf : 3 white, tall : 1 white, dwarf' },
    },
    { case: 1, inputs: { g1: 'C', g2: 'P', c1: 'purple', c2: 'white' }, expected: { ratio: '9 purple : 7 white' } },
    // the Labrador example from Topic 4
    { case: 2, inputs: { g1: 'B', g2: 'E', c1: 'black', c2: 'brown', c3: 'yellow' }, expected: { ratio: '9 black : 4 yellow : 3 brown' } },
    { case: 3, inputs: { g1: 'G', g2: 'W', c1: 'green', c2: 'yellow', c3: 'white' }, expected: { ratio: '12 white : 3 green : 1 yellow' } },
    { case: 4, inputs: { g1: 'H', g2: 'S', m: 'hairless' }, expected: { ratio: '13 wild type : 3 hairless' } },
    { case: 5, inputs: { g1: 'A', g2: 'B', m: 'dwarf' }, expected: { ratio: '15 wild type : 1 dwarf' } },
  ],
};

export const SMART_EXAMPLES: SmartSpec[] = [PRIMERS, INTERACTIONS];
