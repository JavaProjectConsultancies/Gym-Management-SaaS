/**
 * ValidationService.gs — small declarative validator for request input and
 * sheet records. Unknown fields are rejected so clients cannot smuggle in
 * values such as Gym_ID or Role.
 *
 * Rule shape: { type: 'string'|'email'|'enum'|'boolean'|'number'|'date'|'phone'|'id'|'ref',
 *               required?, minLength?, maxLength?, pattern?, values?,
 *               integer?, min?, max? (numbers) }
 *
 * Options: { allowUnknown?, partial? }
 *   partial — for PATCH: absent fields are skipped (not "required"); a field sent
 *             as null/"" is returned as "" (= clear it) unless it is required.
 */

const EMAIL_PATTERN_ = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ID_PATTERN_ = /^[A-Z]{3}-[0-9a-f]{32}$/;
const DATE_PATTERN_ = /^(\d{4})-(\d{2})-(\d{2})$/;
const PHONE_PATTERN_ = /^\+?[0-9]{7,15}$/;
/** Amount text after removing thousands separators: "1500", "1500.5", "1500.00". */
const MONEY_TEXT_PATTERN_ = /^[0-9]{1,9}(\.[0-9]{1,2})?$/;
/** Whole number text after removing thousands separators: "30", "30.00". */
const INT_TEXT_PATTERN_ = /^[0-9]{1,9}(\.0+)?$/;
/** Separators people type in phone numbers; removed before validation. */
const PHONE_SEPARATORS_ = /[\s\-().]/g;

/**
 * Validate and normalise an object. Returns a new object containing only known
 * fields. Throws ApiError(400, 'VALIDATION_FAILED') listing every field error.
 */
function validateObject_(input, rules, options) {
  const opts = options || {};
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new ApiError(400, 'VALIDATION_FAILED', 'Request body must be a JSON object.');
  }

  const errors = {};
  const output = {};

  Object.keys(input).forEach(function (key) {
    if (!Object.prototype.hasOwnProperty.call(rules, key) && !opts.allowUnknown) {
      errors[key] = 'Unknown field.';
    }
  });

  Object.keys(rules).forEach(function (key) {
    const present = Object.prototype.hasOwnProperty.call(input, key);
    if (opts.partial && !present) return;
    const result = validateValue_(input[key], rules[key]);
    if (result.error) errors[key] = result.error;
    else if (result.value !== undefined) output[key] = result.value;
    else if (opts.partial && present) output[key] = ''; // explicit clear of an optional field
  });

  if (Object.keys(errors).length > 0) {
    throw new ApiError(400, 'VALIDATION_FAILED', 'The request contains invalid data.', { fields: errors });
  }
  return output;
}

/** Validate one value against one rule → { value } or { error }. */
function validateValue_(value, rule) {
  const empty = value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
  if (empty) {
    return rule.required ? { error: 'Required.' } : { value: undefined };
  }

  switch (rule.type) {
    case 'string':
    case 'email': {
      if (typeof value !== 'string') return { error: 'Must be a string.' };
      let v = value.trim();
      if (rule.type === 'email') {
        v = v.toLowerCase();
        if (!EMAIL_PATTERN_.test(v)) return { error: 'Must be a valid email address.' };
      }
      if (rule.minLength && v.length < rule.minLength) return { error: 'Must be at least ' + rule.minLength + ' characters.' };
      if (rule.maxLength && v.length > rule.maxLength) return { error: 'Must be at most ' + rule.maxLength + ' characters.' };
      if (rule.pattern && !rule.pattern.test(v)) return { error: 'Has an invalid format.' };
      return { value: v };
    }
    case 'enum':
      if (typeof value !== 'string' || rule.values.indexOf(value) === -1) {
        return { error: 'Must be one of: ' + rule.values.join(', ') + '.' };
      }
      return { value: value };
    case 'id':
    case 'ref':
      if (typeof value !== 'string' || !ID_PATTERN_.test(value)) return { error: 'Must be a valid ID.' };
      return { value: value };
    case 'boolean':
      if (typeof value !== 'boolean') return { error: 'Must be true or false.' };
      return { value: value };
    case 'number':
      if (typeof value !== 'number' || !isFinite(value)) return { error: 'Must be a number.' };
      if (rule.integer && Math.floor(value) !== value) return { error: 'Must be a whole number.' };
      if (rule.min !== undefined && value < rule.min) return { error: 'Must be at least ' + rule.min + '.' };
      if (rule.max !== undefined && value > rule.max) return { error: 'Must be at most ' + rule.max + '.' };
      if (rule.decimals !== undefined) {
        const scaled = value * Math.pow(10, rule.decimals);
        if (Math.abs(scaled - Math.round(scaled)) > 1e-6) {
          return { error: 'Use at most ' + rule.decimals + ' decimal places.' };
        }
      }
      return { value: value };
    case 'int': // stored column: whole number as text, e.g. "30" (Sheets may show "30.00" / "1,000")
      if (typeof value === 'number' && Math.floor(value) === value && value >= 0) return { value: String(value) };
      if (typeof value === 'string' && INT_TEXT_PATTERN_.test(value.trim().replace(/,/g, ''))) {
        return { value: String(parseInt(value.trim().replace(/,/g, ''), 10)) };
      }
      return { error: 'Must be a whole number.' };
    case 'money': // stored column: canonical "1500.00"; also accepts how Sheets may display it ("1500", "1,500.5")
      if (typeof value === 'number' && isFinite(value) && value >= 0) return { value: formatMoney_(value) };
      if (typeof value === 'string' && MONEY_TEXT_PATTERN_.test(value.trim().replace(/,/g, ''))) {
        return { value: formatMoney_(parseFloat(value.trim().replace(/,/g, ''))) };
      }
      return { error: 'Must be an amount like 1500.00.' };
    case 'date':
      if (typeof value !== 'string' || !isValidIsoDate_(value.trim())) return { error: 'Must be a date (YYYY-MM-DD).' };
      return { value: value.trim() };
    case 'phone': {
      if (typeof value !== 'string') return { error: 'Must be a string.' };
      const phone = normalizePhone_(value);
      if (!PHONE_PATTERN_.test(phone)) return { error: 'Must be a phone number of 7–15 digits.' };
      return { value: phone };
    }
    default:
      return { error: 'Unsupported type.' };
  }
}

/** Guard for path parameters such as :gymId. */
function assertValidId_(value, prefix, label) {
  if (typeof value !== 'string' || !ID_PATTERN_.test(value) || value.indexOf(prefix + '-') !== 0) {
    throw new ApiError(400, 'VALIDATION_FAILED', 'Invalid ' + label + '.');
  }
  return value;
}

/** "+91 98765-43210" → "+919876543210". Validation happens separately. */
function normalizePhone_(value) {
  return String(value).trim().replace(PHONE_SEPARATORS_, '');
}

/** True for a real calendar date in YYYY-MM-DD form (rejects 2026-02-30). */
function isValidIsoDate_(value) {
  const m = DATE_PATTERN_.exec(value);
  if (!m) return false;
  const year = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  const day = parseInt(m[3], 10);
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

/** Today's date (YYYY-MM-DD) in the script's time zone (appsscript.json → timeZone). */
function todayIso_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

/** 1500 → "1500.00" (amounts are stored as text so Sheets never reformats them). */
function formatMoney_(amount) {
  return (Math.round(amount * 100) / 100).toFixed(2);
}

/** Whole days from date a to date b (both YYYY-MM-DD); negative if b is earlier. */
function daysBetweenIso_(a, b) {
  const pa = DATE_PATTERN_.exec(a);
  const pb = DATE_PATTERN_.exec(b);
  const ta = Date.UTC(parseInt(pa[1], 10), parseInt(pa[2], 10) - 1, parseInt(pa[3], 10));
  const tb = Date.UTC(parseInt(pb[1], 10), parseInt(pb[2], 10) - 1, parseInt(pb[3], 10));
  return Math.round((tb - ta) / 86400000);
}

/** Add whole days to a YYYY-MM-DD date. */
function addDaysIso_(isoDate, days) {
  const m = DATE_PATTERN_.exec(isoDate);
  const d = new Date(Date.UTC(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10) + days));
  return d.toISOString().slice(0, 10);
}
