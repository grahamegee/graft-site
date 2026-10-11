import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { deflateRawSync, inflateRawSync, constants as zlibConstants } from 'node:zlib';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

import {
  payloadFrom, decode, outline, base64urlDecode, inflateSupported, UnusableError,
  MAX_PAYLOAD, formatCompactDuration, formatClock, formatTime, formatWeight,
} from '../w/share.js';

const FIXTURES = join(import.meta.dirname, 'fixtures', 'v1');

/** A fixture's JSON with its whole-line `//` comments removed. */
function fixtureText(path) {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n');
}

/** The payload the app would put in a link: base64url(raw DEFLATE(JSON)). */
function payloadOf(json) {
  return deflateRawSync(Buffer.from(json, 'utf8')).toString('base64url');
}

function fixture(name) {
  const json = JSON.stringify(JSON.parse(fixtureText(join(FIXTURES, name))));
  return { json, doc: JSON.parse(json), payload: payloadOf(json) };
}

async function outlineOf(name) {
  const result = await decode(fixture(name).payload);
  assert.equal(result.ok, true, `${name}: ${result.reason}`);
  return outline(result.doc);
}

const validFixtures = readdirSync(FIXTURES).filter((f) => f.endsWith('.json'));
const invalidFixtures = readdirSync(join(FIXTURES, 'invalid')).filter((f) => f.endsWith('.json'));

describe('valid fixtures', () => {
  test('there are some', () => assert.ok(validFixtures.length >= 10));

  for (const name of validFixtures) {
    test(name, async () => {
      const { doc } = fixture(name);
      const o = await outlineOf(name);
      assert.ok(o.title.length > 0);
      assert.equal(o.items.length, doc.kind === 'block' ? 1 : doc.items.length);
    });
  }
});

describe('outlines', () => {
  test('Example EMOM', async () => {
    assert.deepEqual(await outlineOf('example-emom.json'), {
      title: 'Example EMOM',
      subtitle: 'EMOM · 10 rounds · every 60s',
      sharedBy: null,
      items: [{
        kind: 'block',
        name: 'Example EMOM',
        format: 'EMOM',
        timing: '10 rounds · every 60s',
        summary: 'EMOM · 10 rounds · every 60s',
        rows: [
          { name: 'Burpee', detail: '8 reps', notes: null },
          { name: 'Kettlebell Swing', detail: '12 reps @ 24 kg', notes: null },
        ],
      }],
    });
  });

  test('Example Session', async () => {
    const o = await outlineOf('example-session.json');
    assert.equal(o.title, 'Example Session');
    assert.equal(o.subtitle, '3 blocks');
    assert.equal(o.sharedBy, 'Alex');
    assert.deepEqual(o.items.map((i) => (i.kind === 'rest' ? i.text : `${i.name} | ${i.summary}`)), [
      'Example EMOM | EMOM · 10 rounds · every 60s',
      'Rest 2:00',
      'Example Strength | Strength · 2 min rest',
      'Rest 3:00',
      'Example AMRAP | AMRAP · 12 min cap',
    ]);
    assert.deepEqual(o.items[2].rows, [{ name: 'Back Squat', detail: '5 × 5 reps @ 80 kg', notes: null }]);
  });

  test('targets, single and per round', async () => {
    const [block] = (await outlineOf('targets.json')).items;
    assert.equal(block.summary, 'Intervals · 3 rounds · 40s/20s');
    assert.deepEqual(block.rows.map((r) => r.detail), [
      '12 reps',
      'per round: 12, 10, 8 reps',
      '30s',
      'per round: 20s, 30s, 45s',
      '250m',
      'per round: 200m, 300m, 400m',
      '15 cal',
      'per round: 10, 12, 14 cal',
      'Time',
    ]);
    assert.equal(block.rows[4].notes, 'Damper on 5');
  });

  test('loads, single and per set', async () => {
    const [block] = (await outlineOf('loads.json')).items;
    assert.equal(block.summary, 'Strength · 2m 30s rest');
    assert.deepEqual(block.rows.map((r) => `${r.name} ${r.detail}`), [
      'Pull-up 3 × 8 reps',
      'Back Squat 5 × 5 reps @ 102.5 kg',
      'Trap Bar Deadlift 3 × 5 reps @ 315 lb',
      'Pull-up 3 × 6 reps @ Light band',
      'Ring Dip 4 sets: 6 reps @ Extra Heavy, Heavy, Medium, Light band',
      'Back Squat 3 sets: 5, 3, 1 reps @ 100, 110, 120.5 kg',
      'Trap Bar Deadlift 2 sets: 5 reps @ 225, 272.5 lb',
      'Ring Dip 3 sets: 8 reps @ bodyweight, 10 kg, 20 kg',
      'Banded Pull-apart 2 × 15 reps @ Medium band',
    ]);
  });

  test('every constraint', async () => {
    const o = await outlineOf('constraints.json');
    assert.deepEqual(o.items.map((i) => (i.kind === 'rest' ? i.text : i.summary)), [
      'Every Minute · 12 rounds · every 60s',
      'Fixed Rounds · 4 rounds · 1m 30s rest',
      'Open Flow · 45s/20s',
      'Rest 2:00',
      'AMRAP · 10 min cap',
      'Capped Rounds · 5 rounds · 20 min cap',
      'Three Rounds · 3 rounds',
      'Rest 1:30',
      'Strength · 3 min rest',
      'Density · 1m 30s rest · 25 min cap',
      'Fifteen Minute Cap · 15 min cap',
    ]);
    assert.equal(o.items[5].rows[0].detail, 'per round: 21, 15, 9, 15, 21 reps @ 20 lb');
    assert.equal(o.items[10].rows[0].detail, '4 × 45s @ 24 kg');
  });

  test('a superset', async () => {
    const [block] = (await outlineOf('superset.json')).items;
    assert.equal(block.summary, 'For Time · 3 rounds · 18 min cap');
    assert.deepEqual(block.rows, [
      {
        name: 'Superset',
        detail: '',
        notes: 'Unbroken if you can',
        group: 'superset',
        components: [
          { name: 'Push-up', detail: 'per round: 15, 12, 9 reps' },
          { name: 'Air Squat', detail: 'per round: 20 reps @ bodyweight, 10 kg, 20 kg' },
        ],
      },
      { name: 'Rowing Machine', detail: '12 cal', notes: null },
    ]);
  });

  test('a complex', async () => {
    const [block] = (await outlineOf('complex.json')).items;
    assert.equal(block.summary, 'Strength · 3 min rest');
    assert.deepEqual(block.rows[0], {
      name: 'Barbell Complex',
      detail: 'Complex · 3 sets',
      notes: "Don't put the bar down",
      group: 'complex',
      components: [
        { name: 'Power Clean', detail: 'per set: 3, 2, 1 reps @ 60, 70, 80 kg' },
        { name: 'Front Squat', detail: '3 reps @ 70 kg' },
        { name: 'Push Press', detail: '5 reps' },
        { name: 'Back Squat', detail: 'per set: 3 reps @ 135, 155, 175.5 lb' },
        { name: 'Push Press', detail: 'Reps' },
      ],
    });
    assert.deepEqual(block.rows[1], { name: 'Pull-up', detail: '3 × 8 reps', notes: null });
  });

  test('unnamed and empty', async () => {
    const empty = await outlineOf('empty-block.json');
    assert.equal(empty.title, 'Interval');
    assert.equal(empty.subtitle, 'Open');
    assert.deepEqual(empty.items[0].rows, []);

    const minimal = await outlineOf('minimal-block.json');
    assert.equal(minimal.title, 'Progression');
    assert.equal(minimal.subtitle, 'Sets');
    assert.deepEqual(minimal.items[0].rows, [{ name: 'Squat', detail: 'Reps', notes: null }]);

    const session = await outlineOf('empty-sequence.json');
    assert.equal(session.title, 'Empty Session');
    assert.equal(session.subtitle, '0 blocks');
    assert.deepEqual(session.items, []);

    const unnamed = outline({ graft: 'workout', v: 1, kind: 'sequence', name: '  ', items: [] });
    assert.equal(unnamed.title, 'Session');
  });

  test('names are carried as text, untouched', () => {
    const name = '<img src=x onerror=alert(1)> & "quotes"';
    const o = outline({ graft: 'workout', v: 1, kind: 'sequence', name, sharedBy: name, items: [] });
    assert.equal(o.title, name);
    assert.equal(o.sharedBy, name);
  });
});

describe('header', () => {
  const headerFixtures = invalidFixtures.filter((f) => f.startsWith('2-'));

  test('there are some', () => assert.ok(headerFixtures.length >= 5));

  for (const name of headerFixtures) {
    test(name, async () => {
      const path = join(FIXTURES, 'invalid', name);
      const expect = readFileSync(path, 'utf8').split('\n')[0].match(/^\/\/ expect: (\w+):/)[1];
      const reason = { newerVersion: 'newer', notAWorkoutLink: 'notWorkout' }[expect];
      assert.ok(reason, `${name}: unexpected expectation ${expect}`);
      const result = await decode(payloadOf(fixtureText(path)));
      assert.deepEqual(result, { ok: false, reason });
    });
  }

  test('a whole v spelled with a decimal point is version 1', async () => {
    const result = await decode(payloadOf('{"graft":"workout","v":1.0,"kind":"sequence","items":[]}'));
    assert.equal(result.ok, true);
  });

  test('JSON that is not an object is not a workout', async () => {
    for (const json of ['[]', '5', '"workout"', 'null']) {
      assert.deepEqual(await decode(payloadOf(json)), { ok: false, reason: 'notWorkout' }, json);
    }
  });
});

describe('the page only previews', () => {
  // Past the header, the app validates. The page reads whatever it can, and
  // never crashes: a doc it can't lay out raises UnusableError, which the
  // page shows as damaged.
  for (const name of invalidFixtures.filter((f) => !f.startsWith('2-'))) {
    test(name, async () => {
      const result = await decode(payloadOf(fixtureText(join(FIXTURES, 'invalid', name))));
      assert.equal(result.ok, true);
      try {
        const o = outline(result.doc);
        assert.equal(typeof o.title, 'string');
      } catch (error) {
        assert.ok(error instanceof UnusableError, `${name}: ${error}`);
      }
    });
  }

  test('structurally unusable docs', () => {
    const docs = [
      { graft: 'workout', v: 1 },
      { graft: 'workout', v: 1, kind: 'rest', seconds: 60 },
      { graft: 'workout', v: 1, kind: 'sequence' },
      { graft: 'workout', v: 1, kind: 'sequence', items: [null] },
      { graft: 'workout', v: 1, kind: 'sequence', items: [{ kind: 'sequence', items: [] }] },
      { graft: 'workout', v: 1, kind: 'block', base: 'nope', rows: [] },
      { graft: 'workout', v: 1, kind: 'block', base: 'interval', rows: {} },
      { graft: 'workout', v: 1, kind: 'block', base: 'interval', rows: [{ exercise: 'Burpee' }] },
    ];
    for (const doc of docs) assert.throws(() => outline(doc), UnusableError, JSON.stringify(doc));
  });

  test('odd values degrade instead of throwing', () => {
    const o = outline({
      graft: 'workout', v: 1, kind: 'block', base: 'interval', format: 'EMOM', rounds: 'ten',
      rows: [{
        exercise: { name: 'Burpee', components: [null, { name: 'Squat' }] },
        slots: [{ target: { kind: 'reps', value: 'x' }, load: { kind: 'band', band: 'purple' } }],
      }],
    });
    assert.equal(o.subtitle, 'Open');
    assert.deepEqual(o.items[0].rows[0].components, [{ name: '?', detail: 'Open' }, { name: 'Squat', detail: '' }]);
  });
});

describe('damaged', () => {
  const emom = () => fixture('example-emom.json').payload;

  test('characters outside base64url', async () => {
    for (const payload of ['not base64!', 'abc+def/', 'YWJj=', 'abcé']) {
      assert.deepEqual(await decode(payload), { ok: false, reason: 'damaged' }, payload);
    }
  });

  test('an impossible base64url length', async () => {
    assert.deepEqual(await decode(emom() + 'A'.repeat(4 - (emom().length % 4) + 1)), { ok: false, reason: 'damaged' });
  });

  test('unused trailing bits set', () => {
    assert.deepEqual(base64urlDecode('QQ'), new Uint8Array([0x41]));
    assert.equal(base64urlDecode('QR'), null);
  });

  test('garbage that is valid base64url', async () => {
    assert.deepEqual(await decode('Z2FyYmFnZSBnYXJiYWdl'), { ok: false, reason: 'damaged' });
  });

  test('truncated deflate', async () => {
    const bytes = deflateRawSync(Buffer.from(fixture('example-session.json').json));
    for (const keep of [bytes.length - 2, Math.floor(bytes.length / 2), 3]) {
      const payload = bytes.subarray(0, keep).toString('base64url');
      assert.deepEqual(await decode(payload), { ok: false, reason: 'damaged' }, `kept ${keep}`);
    }
  });

  test('a truncated link', async () => {
    const payload = fixture('example-session.json').payload;
    assert.deepEqual(await decode(payload.slice(0, payload.length - 40)), { ok: false, reason: 'damaged' });
  });

  test('not JSON', async () => {
    assert.deepEqual(await decode(payloadOf('{"graft":"workout",')), { ok: false, reason: 'damaged' });
    assert.deepEqual(await decode(payloadOf('hello')), { ok: false, reason: 'damaged' });
  });

  test('not UTF-8', async () => {
    const payload = deflateRawSync(Buffer.from([0x22, 0xff, 0xfe, 0x22])).toString('base64url');
    assert.deepEqual(await decode(payload), { ok: false, reason: 'damaged' });
  });

  test('a payload over the length limit', async () => {
    const json = JSON.stringify({ graft: 'workout', v: 1, kind: 'sequence', name: '', items: [] });
    const big = payloadOf(json) + 'A'.repeat(MAX_PAYLOAD);
    assert.ok(big.length > MAX_PAYLOAD);
    assert.deepEqual(await decode(big), { ok: false, reason: 'damaged' });
  });

  test('a payload at the length limit is read', async () => {
    // Random text barely compresses, so the payload is about as long as the name.
    let name = randomBytes(MAX_PAYLOAD).toString('base64url');
    const payloadFor = () => payloadOf(JSON.stringify({ graft: 'workout', v: 1, kind: 'sequence', name, items: [] }));
    let payload = payloadFor();
    while (payload.length > MAX_PAYLOAD) {
      name = name.slice(0, name.length - 20);
      payload = payloadFor();
    }
    assert.ok(payload.length > MAX_PAYLOAD - 100, `${payload.length}`);
    assert.ok(payload.length <= MAX_PAYLOAD, `${payload.length}`);
    assert.equal((await decode(payload)).ok, true);
  });

  test('a payload that inflates past 256 KB', async () => {
    const name = 'x'.repeat(256 * 1024);
    const payload = payloadOf(JSON.stringify({ graft: 'workout', v: 1, kind: 'sequence', name, items: [] }));
    assert.ok(payload.length < MAX_PAYLOAD, 'compresses well enough to pass the length check');
    assert.deepEqual(await decode(payload), { ok: false, reason: 'damaged' });
  });

  test('bytes after the end of the stream are ignored', async () => {
    const { json } = fixture('example-emom.json');
    const bytes = Buffer.concat([deflateRawSync(Buffer.from(json)), Buffer.from(' sent from my phone')]);
    const result = await decode(bytes.toString('base64url'));
    assert.equal(result.ok, true);
    assert.equal(outline(result.doc).title, 'Example EMOM');
  });

  test('bytes after the end, where the browser refuses a chunk that runs past it', async () => {
    // The Compression Streams spec makes a browser error on a chunk with
    // bytes left over after the stream's end, dropping that chunk's output.
    // Node ignores them instead, so stand in a stream that behaves like the
    // spec for this one test.
    const { json } = fixture('example-emom.json');
    const compressed = deflateRawSync(Buffer.from(json));
    const end = compressed.length;
    const original = globalThis.DecompressionStream;
    globalThis.DecompressionStream = class extends TransformStream {
      constructor(format) {
        assert.equal(format, 'deflate-raw');
        let input = Buffer.alloc(0);
        let emitted = 0;
        super({
          transform(chunk, controller) {
            input = Buffer.concat([input, chunk]);
            if (input.length > end) throw new TypeError('Junk found after end of compressed data.');
            const out = inflateRawSync(input, { finishFlush: zlibConstants.Z_SYNC_FLUSH });
            if (out.length > emitted) controller.enqueue(new Uint8Array(out.subarray(emitted)));
            emitted = out.length;
          },
        });
      }
    };
    try {
      const bytes = Buffer.concat([compressed, Buffer.from('junk')]);
      const result = await decode(bytes.toString('base64url'));
      assert.equal(result.ok, true);
      assert.equal(outline(result.doc).title, 'Example EMOM');
    } finally {
      globalThis.DecompressionStream = original;
    }
  });
});

describe('unsupported', () => {
  test('no DecompressionStream', async () => {
    const original = globalThis.DecompressionStream;
    delete globalThis.DecompressionStream;
    try {
      assert.equal(inflateSupported(), false);
      assert.deepEqual(await decode(fixture('example-emom.json').payload), { ok: false, reason: 'unsupported' });
    } finally {
      globalThis.DecompressionStream = original;
    }
    assert.equal(inflateSupported(), true);
  });

  test('a DecompressionStream without deflate-raw', async () => {
    const original = globalThis.DecompressionStream;
    globalThis.DecompressionStream = class {
      constructor(format) {
        if (format !== 'gzip' && format !== 'deflate') throw new TypeError(`Unsupported format: ${format}`);
      }
    };
    try {
      assert.deepEqual(await decode(fixture('example-emom.json').payload), { ok: false, reason: 'unsupported' });
    } finally {
      globalThis.DecompressionStream = original;
    }
  });

  test('a damaged link is still damaged', async () => {
    const original = globalThis.DecompressionStream;
    delete globalThis.DecompressionStream;
    try {
      assert.deepEqual(await decode('not base64!'), { ok: false, reason: 'damaged' });
    } finally {
      globalThis.DecompressionStream = original;
    }
  });
});

describe('helpers', () => {
  test('payloadFrom', () => {
    assert.equal(payloadFrom('#abc-_'), 'abc-_');
    assert.equal(payloadFrom(''), '');
    assert.equal(payloadFrom('#'), '');
  });

  test('durations match the app', () => {
    assert.equal(formatCompactDuration(45), '45s');
    assert.equal(formatCompactDuration(90), '1m 30s');
    assert.equal(formatCompactDuration(720), '12 min');
    assert.equal(formatCompactDuration(5400), '1h 30m');
    assert.equal(formatCompactDuration(86400), '24h');
    assert.equal(formatClock(120), '2:00');
    assert.equal(formatClock(3725), '1:02:05');
    assert.equal(formatTime(45), '45s');
    assert.equal(formatTime(90), '1:30');
  });

  test('weights match the app', () => {
    assert.equal(formatWeight(24), '24');
    assert.equal(formatWeight(102.5), '102.5');
    assert.equal(formatWeight(20.25), '20.25');
    assert.equal(formatWeight(0), '0');
  });
});
