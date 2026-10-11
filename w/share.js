// Reads a shared Graft workout link and outlines it for the fallback page.
//
// The format is the app repo's docs/share-format-v1.md:
//   payload = base64url(raw DEFLATE(JSON)), no padding.
// This page only previews. It checks the header and that the JSON is
// readable, as the spec's "The fallback page" section says; the app does the
// full validation when it imports. Wording follows the app's own summaries
// (IntervalConfig.summary, SetConfig.summary, singleTargetText, LoadValue).
//
// No dependencies, no DOM: the page renders what outline() returns, and
// test/share.test.js runs it under Node.

export const VERSION = 1;
export const MAX_PAYLOAD = 16384; // characters
export const MAX_INFLATED = 256 * 1024; // bytes

const DAMAGED = Object.freeze({ ok: false, reason: 'damaged' });
const UNSUPPORTED = Object.freeze({ ok: false, reason: 'unsupported' });
const NEWER = Object.freeze({ ok: false, reason: 'newer' });
const NOT_WORKOUT = Object.freeze({ ok: false, reason: 'notWorkout' });

// MARK: - The link

/** The payload in a location.hash: everything after the `#`. */
export function payloadFrom(hash) {
  if (typeof hash !== 'string') return '';
  return hash.startsWith('#') ? hash.slice(1) : hash;
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const LOOKUP = new Int8Array(128).fill(-1);
for (let i = 0; i < ALPHABET.length; i++) LOOKUP[ALPHABET.charCodeAt(i)] = i;

/**
 * Strict base64url (RFC 4648 §5, no padding): the bytes, or null for anything
 * an encoder wouldn't write — padding, characters outside the alphabet, an
 * impossible length, or unused trailing bits set.
 */
export function base64urlDecode(text) {
  if (typeof text !== 'string' || text.length % 4 === 1) return null;
  const out = new Uint8Array(Math.floor((text.length * 6) / 8));
  let acc = 0;
  let bits = 0;
  let j = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    const value = code < 128 ? LOOKUP[code] : -1;
    if (value < 0) return null;
    acc = (acc << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[j++] = (acc >> bits) & 0xff;
    }
    acc &= (1 << bits) - 1;
  }
  return acc === 0 ? out : null;
}

/** Whether this browser can inflate raw DEFLATE, checked without throwing. */
export function inflateSupported() {
  if (typeof globalThis.DecompressionStream !== 'function') return false;
  try {
    new globalThis.DecompressionStream('deflate-raw');
    return true;
  } catch {
    return false;
  }
}

/**
 * One pass through a DecompressionStream, writing `step` bytes at a time.
 * Gives the output read before any error, and whether an error ended it.
 */
async function inflatePass(bytes, step, limit) {
  const stream = new globalThis.DecompressionStream('deflate-raw');
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();
  (async () => {
    for (let i = 0; i < bytes.length; i += step) await writer.write(bytes.subarray(i, i + step));
    await writer.close();
  })().catch(() => {});

  const parts = [];
  let total = 0;
  let failed = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > limit) {
        reader.cancel().catch(() => {});
        return { tooBig: true };
      }
      parts.push(value);
    }
  } catch {
    failed = true;
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return { out, failed };
}

/**
 * Inflates raw DEFLATE, or returns null. Bytes after the end of the stream
 * are ignored, as the spec says. Browsers following the Compression Streams
 * spec refuse a chunk that runs past the end and drop its output, so on an
 * error the bytes are fed again one at a time: everything up to the end then
 * arrives before the error. A truncated stream still fails, at JSON.parse.
 */
async function inflate(bytes) {
  const whole = await inflatePass(bytes, Math.max(bytes.length, 1), MAX_INFLATED);
  if (whole.tooBig) return null;
  if (!whole.failed) return whole.out;
  const stepped = await inflatePass(bytes, 1, MAX_INFLATED);
  if (stepped.tooBig || stepped.out.length === 0) return null;
  return stepped.out;
}

/**
 * Decodes a payload. One of:
 *   { ok: true, doc }
 *   { ok: false, reason: 'unsupported' }  no raw-DEFLATE inflater here
 *   { ok: false, reason: 'damaged' }      too long, bad base64url, won't inflate, not JSON
 *   { ok: false, reason: 'newer' }        a workout from a newer format version
 *   { ok: false, reason: 'notWorkout' }   readable JSON, but not a workout link
 */
export async function decode(payload) {
  if (typeof payload !== 'string' || payload.length > MAX_PAYLOAD) return DAMAGED;
  const bytes = base64urlDecode(payload);
  if (!bytes) return DAMAGED;
  if (!inflateSupported()) return UNSUPPORTED;

  let inflated;
  try {
    inflated = await inflate(bytes);
  } catch {
    return DAMAGED;
  }
  if (!inflated) return DAMAGED;

  let doc;
  try {
    doc = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(inflated));
  } catch {
    return DAMAGED;
  }
  return checkHeader(doc);
}

/** The spec's Validation step 2: `graft` and `v`. */
export function checkHeader(doc) {
  if (!isObject(doc) || doc.graft !== 'workout') return NOT_WORKOUT;
  const v = doc.v;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) return NOT_WORKOUT;
  if (v > VERSION) return NEWER;
  return { ok: true, doc };
}

// MARK: - Outline

/** Thrown by outline() for a doc it can't lay out. The page shows it as damaged. */
export class UnusableError extends Error {}

const BASE_NAMES = { interval: 'Interval', timed: 'Timed', progressive: 'Progression' };
const TARGET_NAMES = { reps: 'Reps', time: 'Time', distance: 'Distance', calories: 'Calories' };
const BAND_NAMES = { light: 'Light', medium: 'Medium', heavy: 'Heavy', extraHeavy: 'Extra Heavy' };

/**
 * A plain outline of a decoded doc:
 *   { title, subtitle, sharedBy, items }
 * where items are
 *   { kind: 'block', name, format, timing, summary, rows }
 *   { kind: 'rest', seconds, text }
 * and rows are
 *   { name, detail, notes }                              an exercise
 *   { name, detail, notes, group, components: [{ name, detail }] }  a superset or complex
 * A top-level block is its own single item. Throws UnusableError for a doc
 * whose structure can't be outlined.
 */
export function outline(doc) {
  if (!isObject(doc)) throw new UnusableError('not an object');
  const sharedBy = nonEmpty(doc.sharedBy);
  if (doc.kind === 'block') {
    const block = blockOutline(doc);
    return { title: block.name, subtitle: block.summary, sharedBy, items: [block] };
  }
  if (doc.kind === 'sequence') {
    const items = list(doc.items).map(itemOutline);
    const blocks = items.filter((item) => item.kind === 'block').length;
    return { title: nonEmpty(doc.name) ?? 'Session', subtitle: plural(blocks, 'block'), sharedBy, items };
  }
  throw new UnusableError('top level is neither a block nor a sequence');
}

function itemOutline(item) {
  if (isObject(item) && item.kind === 'block') return blockOutline(item);
  if (isObject(item) && item.kind === 'rest' && isNumber(item.seconds)) {
    return { kind: 'rest', seconds: item.seconds, text: `Rest ${formatClock(item.seconds)}` };
  }
  throw new UnusableError('an item is neither a block nor a rest');
}

function blockOutline(block) {
  const base = block.base;
  if (!Object.hasOwn(BASE_NAMES, base)) throw new UnusableError('unknown base');
  const format = nonEmpty(isObject(block.format) ? block.format.name : undefined);
  const timing = timingSummary(base, block);
  const sets = base === 'progressive';
  const rows = list(block.rows).map((row) => rowOutline(row, sets));
  return {
    kind: 'block',
    name: nonEmpty(block.name) ?? BASE_NAMES[base],
    format,
    timing,
    summary: [format, timing].filter(Boolean).join(' · '),
    rows,
  };
}

/** IntervalConfig.summary and SetConfig.summary. */
export function timingSummary(base, block) {
  const parts = [];
  if (base === 'progressive') {
    if (isNumber(block.setRest)) parts.push(`${formatCompactDuration(block.setRest)} rest`);
    if (isNumber(block.timeCap)) parts.push(`${formatCompactDuration(block.timeCap)} cap`);
    return parts.join(' · ') || 'Sets';
  }
  const work = base === 'interval' && isNumber(block.work) ? block.work : null;
  const rest = base === 'interval' && isNumber(block.rest) ? block.rest : null;
  const cap = base === 'timed' && isNumber(block.timeCap) ? block.timeCap : null;
  if (isNumber(block.rounds)) parts.push(plural(Math.trunc(block.rounds), 'round'));
  if (work !== null) {
    parts.push(rest !== null ? `${Math.trunc(work)}s/${Math.trunc(rest)}s` : `every ${Math.trunc(work)}s`);
  } else if (rest !== null) {
    parts.push(`${formatCompactDuration(rest)} rest`);
  }
  if (cap !== null) parts.push(`${formatCompactDuration(cap)} cap`);
  return parts.join(' · ') || 'Open';
}

function rowOutline(row, isSets) {
  if (!isObject(row) || !isObject(row.exercise)) throw new UnusableError('a row has no exercise');
  const exercise = row.exercise;
  const notes = nonEmpty(row.notes);
  const sets = isSets && isNumber(row.sets) ? Math.trunc(row.sets) : null;
  const per = isSets ? 'per set' : 'per round';

  if (Array.isArray(exercise.components)) {
    const slots = Array.isArray(row.slots) ? row.slots : [];
    const components = exercise.components.map((component, i) => ({
      name: (isObject(component) ? nonEmpty(component.name) : null) ?? '?',
      detail: isObject(slots[i]) ? prescription(slots[i], null, per) : '',
    }));
    const setsText = sets > 1 ? `${sets} sets` : '';
    if (row.superset === true) {
      return { name: 'Superset', detail: setsText, notes, group: 'superset', components };
    }
    return {
      name: nonEmpty(exercise.name) ?? 'Complex',
      detail: ['Complex', setsText].filter(Boolean).join(' · '),
      notes,
      group: 'complex',
      components,
    };
  }
  return { name: text(exercise.name), detail: prescription(row, sets, per), notes };
}

/**
 * A row's or slot's target and load: "8 reps", "12 reps @ 24 kg",
 * "5 × 5 reps @ 80 kg", "per round: 21, 15, 9 reps @ 20 lb",
 * "3 sets: 5, 3, 1 reps @ 100, 110, 120.5 kg".
 */
export function prescription(p, sets, per) {
  const targets = Array.isArray(p.targetPerRound) && p.targetPerRound.length ? p.targetPerRound : null;
  const loads = Array.isArray(p.loadPerRound) && p.loadPerRound.length ? p.loadPerRound : null;
  const target = targets ? targetListText(targets) : isObject(p.target) ? targetText(p.target) : null;
  const load = loads ? loadListText(loads) : isObject(p.load) ? loadText(p.load) : null;

  let line = target ?? TARGET_NAMES[p.targetType] ?? 'Open';
  if (load) line += ` @ ${load}`;
  if (targets || (loads && load)) return sets > 1 ? `${sets} sets: ${line}` : `${per}: ${line}`;
  if (sets > 1) return target ? `${sets} × ${line}` : `${sets} sets · ${line}`;
  return line;
}

/** singleTargetText: "8 reps", "45s", "1:30", "400m", "12 cal". */
export function targetText(target) {
  const v = target.value;
  if (!isNumber(v)) return null;
  switch (target.kind) {
    case 'reps': return `${Math.trunc(v)} reps`;
    case 'time': return formatTime(v);
    case 'distance': return `${Math.trunc(v)}m`;
    case 'calories': return `${Math.trunc(v)} cal`;
    default: return null;
  }
}

function targetListText(targets) {
  for (const [kind, unit] of [['reps', 'reps'], ['calories', 'cal']]) {
    if (targets.every((t) => isObject(t) && t.kind === kind && isNumber(t.value))) {
      return `${targets.map((t) => Math.trunc(t.value)).join(', ')} ${unit}`;
    }
  }
  const texts = targets.map((t) => (isObject(t) ? targetText(t) : null));
  return texts.every(Boolean) ? texts.join(', ') : null;
}

/** LoadValue.displayText, bodyweight left out as the app does: "24 kg", "Medium band". */
export function loadText(load) {
  switch (load.kind) {
    case 'weight':
      return isNumber(load.value) && (load.unit === 'kg' || load.unit === 'lb')
        ? `${formatWeight(load.value)} ${load.unit}`
        : null;
    case 'band':
      return Object.hasOwn(BAND_NAMES, load.band) ? `${BAND_NAMES[load.band]} band` : null;
    default:
      return null;
  }
}

function loadListText(loads) {
  if (!loads.every(isObject)) return null;
  if (loads.every((l) => l.kind === 'bodyweight')) return null;
  const unit = loads[0].unit;
  if (loads.every((l) => l.kind === 'weight' && l.unit === unit && isNumber(l.value)) && loadText(loads[0])) {
    return `${loads.map((l) => formatWeight(l.value)).join(', ')} ${unit}`;
  }
  if (loads.every((l) => l.kind === 'band' && Object.hasOwn(BAND_NAMES, l.band))) {
    return `${loads.map((l) => BAND_NAMES[l.band]).join(', ')} band`;
  }
  const texts = loads.map((l) => (l.kind === 'bodyweight' ? 'bodyweight' : loadText(l)));
  return texts.every(Boolean) ? texts.join(', ') : null;
}

// MARK: - Formatting (the app's DurationFormatters and WeightUnit.formatValue)

/** formatElapsedTime: "2:00", "1:05:00". */
export function formatClock(seconds) {
  const total = Math.max(0, Math.trunc(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** formatTime: "45s" under a minute, otherwise "1:30". */
export function formatTime(seconds) {
  const total = Math.trunc(seconds);
  return total >= 60 ? formatClock(seconds) : `${total}s`;
}

/** formatCompactDuration: "24h", "1h 30m", "12 min", "1m 30s", "45s". */
export function formatCompactDuration(seconds) {
  const total = Math.max(0, Math.trunc(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  if (m > 0) return s > 0 ? `${m}m ${s}s` : `${m} min`;
  return `${s}s`;
}

/** WeightUnit.formatValue: two decimals at most, trailing zeros dropped. */
export function formatWeight(value) {
  return value.toFixed(2).replace(/\.?0+$/, '');
}

// MARK: - Helpers

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function text(value) {
  return typeof value === 'string' ? value : '';
}

/** A string that isn't blank once trimmed (the app's emptiness test), or null. */
function nonEmpty(value) {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function list(value) {
  if (!Array.isArray(value)) throw new UnusableError('expected a list');
  return value;
}

function plural(count, noun) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}
