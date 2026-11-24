/**
 * SpreadsheetService.gs — the ONLY code that touches Google Sheets.
 *
 * Two kinds of database share this code:
 *   - the CENTRAL platform spreadsheet (SCHEMA: Gyms, Users, Gym_Settings, audit log)
 *   - one spreadsheet PER GYM (GYM_SCHEMA: Members, ...), see GymDatabaseService.gs
 *
 * A "db handle" ({ schema, label, getSpreadsheet }) selects which one. Every
 * function takes an optional `db` argument that defaults to the central DB, so
 * central-only callers stay unchanged.
 *
 * - Every function is private (trailing underscore): it cannot be called via
 *   google.script.run and is not exposed by the web app.
 * - Tab names are checked against the db's schema, so callers cannot reach arbitrary sheets.
 * - Writes run inside a script-wide LockService lock (see withScriptLock_).
 * - Row positions are re-resolved inside the lock, never trusted from an earlier read.
 */

let spreadsheetCache_ = null;

function getSpreadsheet_() {
  if (!spreadsheetCache_) {
    const config = getConfig_();
    try {
      spreadsheetCache_ = SpreadsheetApp.openById(config.spreadsheetId);
    } catch (e) {
      console.error('Cannot open central spreadsheet: ' + e);
      throw new ApiError(503, 'DATABASE_UNAVAILABLE', 'The database is temporarily unavailable.');
    }
  }
  return spreadsheetCache_;
}

/** Handle for the central platform spreadsheet. */
function centralDb_() {
  return { schema: SCHEMA, label: 'central', getSpreadsheet: getSpreadsheet_ };
}

function dbOrCentral_(db) {
  return db || centralDb_();
}

function getTableSchema_(tableName, db) {
  const schema = dbOrCentral_(db).schema;
  if (!Object.prototype.hasOwnProperty.call(schema, tableName)) {
    throw new Error('Unknown table: ' + tableName); // programming error → generic 500
  }
  return schema[tableName];
}

function getColumnNames_(tableName, db) {
  return getTableSchema_(tableName, db).columns.map(function (c) {
    return c.name;
  });
}

function getSheet_(tableName, db) {
  const handle = dbOrCentral_(db);
  getTableSchema_(tableName, handle);
  const sheet = handle.getSpreadsheet().getSheetByName(tableName);
  if (!sheet) {
    console.error('Missing sheet tab ' + tableName + ' in ' + handle.label + ' database. Run the setup functions.');
    throw new ApiError(503, 'DATABASE_NOT_INITIALIZED', 'The database is not initialized.');
  }
  return sheet;
}

/* ------------------------------------------------------------------ */
/* IDs and locking                                                     */
/* ------------------------------------------------------------------ */

/** Stable, globally unique, immutable ID: e.g. "GYM-3f2b9c...". */
function generateId_(prefix) {
  return prefix + '-' + Utilities.getUuid().replace(/-/g, '').toLowerCase();
}

/**
 * Run fn while holding the script lock. All writes share one lock, so
 * concurrent requests are serialized and cannot interleave read-modify-write
 * sequences. Throws 503 LOCK_TIMEOUT if the lock cannot be acquired.
 */
function withScriptLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(CONFIG_DEFAULTS.LOCK_TIMEOUT_MS)) {
    throw new ApiError(503, 'LOCK_TIMEOUT', 'The server is busy. Please retry.');
  }
  try {
    const result = fn();
    SpreadsheetApp.flush(); // commit pending writes before other executions read
    return result;
  } finally {
    lock.releaseLock();
  }
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

/** Read all records of a table as plain objects (plus a non-enumerable _row). */
function readRecords_(tableName, db) {
  const sheet = getSheet_(tableName, db);
  const columns = getColumnNames_(tableName, db);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const values = sheet.getRange(2, 1, lastRow - 1, columns.length).getDisplayValues();
  const records = [];
  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    if (row.every(function (cell) { return cell === ''; })) continue; // skip blank rows
    const record = {};
    columns.forEach(function (name, c) {
      record[name] = row[c];
    });
    Object.defineProperty(record, '_row', { value: i + 2, enumerable: false });
    records.push(record);
  }
  return records;
}

function findRecords_(tableName, predicate, db) {
  return readRecords_(tableName, db).filter(predicate);
}

function findRecordById_(tableName, id, db) {
  const idColumn = getTableSchema_(tableName, db).idColumn;
  const matches = findRecords_(tableName, function (r) {
    return r[idColumn] === id;
  }, db);
  if (matches.length > 1) {
    console.error('Duplicate ID ' + id + ' in ' + tableName);
    throw new ApiError(500, 'DATA_INTEGRITY_ERROR', 'A data integrity problem was detected.');
  }
  return matches[0] || null;
}

/* ------------------------------------------------------------------ */
/* Writes — the *Locked_ variants MUST be called inside withScriptLock_ */
/* ------------------------------------------------------------------ */

/** Create a record (ID and timestamps are generated; never accepted from callers). */
function createRecord_(tableName, data, db) {
  return withScriptLock_(function () {
    return createRecordLocked_(tableName, data, db);
  });
}

function createRecordLocked_(tableName, data, db) {
  const schema = getTableSchema_(tableName, db);
  const now = nowIso_();
  const record = {};

  schema.columns.forEach(function (col) {
    if (col.type === 'id') record[col.name] = generateId_(schema.idPrefix);
    else if (col.type === 'datetime') record[col.name] = now;
    else record[col.name] = data[col.name];
  });

  const clean = validateRecord_(tableName, record, db);
  const sheet = getSheet_(tableName, db);
  sheet.appendRow(toRowValues_(tableName, clean, db));
  return clean;
}

/** Update fields of a record by ID. ID / Created_At can never change. */
function updateRecord_(tableName, id, patch, db) {
  return withScriptLock_(function () {
    return updateRecordLocked_(tableName, id, patch, db);
  });
}

function updateRecordLocked_(tableName, id, patch, db) {
  const schema = getTableSchema_(tableName, db);
  if (schema.appendOnly) throw new Error(tableName + ' is append-only');

  const existing = findRecordById_(tableName, id, db); // fresh read inside the lock
  if (!existing) throw new ApiError(404, 'NOT_FOUND', 'Record not found.');

  const immutable = [schema.idColumn, 'Created_At'].concat(schema.immutableColumns || []);
  const merged = {};
  schema.columns.forEach(function (col) {
    const canChange = immutable.indexOf(col.name) === -1 && Object.prototype.hasOwnProperty.call(patch, col.name);
    merged[col.name] = canChange ? patch[col.name] : existing[col.name];
  });
  if (merged.Updated_At !== undefined) merged.Updated_At = nowIso_();

  const clean = validateRecord_(tableName, merged, db);
  const sheet = getSheet_(tableName, db);
  sheet.getRange(existing._row, 1, 1, schema.columns.length).setValues([toRowValues_(tableName, clean, db)]);
  return clean;
}

/** Validate a full record against the schema (types, enums, lengths, required). */
function validateRecord_(tableName, record, db) {
  const rules = {};
  getTableSchema_(tableName, db).columns.forEach(function (col) {
    const type = col.type === 'datetime' ? 'string' : col.type;
    rules[col.name] = {
      type: type,
      required: col.type === 'id' || col.type === 'datetime' ? true : Boolean(col.required),
      maxLength: col.maxLength,
      pattern: col.pattern,
      values: col.values,
    };
  });
  const clean = validateObject_(record, rules);
  // Store optional empty columns as '' so rows stay aligned.
  Object.keys(rules).forEach(function (k) {
    if (clean[k] === undefined) clean[k] = '';
  });
  return clean;
}

/** Order values by column and neutralise spreadsheet formula injection. */
function toRowValues_(tableName, record, db) {
  return getColumnNames_(tableName, db).map(function (name) {
    return escapeCell_(record[name]);
  });
}

/**
 * Every non-empty value is written with a leading apostrophe, Sheets' "this is
 * text" marker. The apostrophe is not part of the stored value (getDisplayValues
 * returns the text without it). This:
 *   - neutralises formula injection (=, +, -, @), and
 *   - stops Sheets from re-interpreting values: "1500.00" → 1500, "2026-11-24" → a
 *     date, "09876…" → a number without its leading zero — regardless of the
 *     column's number format (rows appended later do not always inherit it).
 * Found in live testing: a plan price stored as "1500.00" was read back as "1500".
 */
function escapeCell_(value) {
  const s = value === undefined || value === null ? '' : String(value);
  return s === '' ? '' : "'" + s;
}

/* ------------------------------------------------------------------ */
/* Structure                                                           */
/* ------------------------------------------------------------------ */

/**
 * Create missing tabs and write headers. Never deletes or rewrites data.
 * Throws if an existing tab has unexpected headers (fix it manually).
 */
function initializeSheets_(db) {
  const handle = dbOrCentral_(db);
  const ss = handle.getSpreadsheet();
  const report = [];

  Object.keys(handle.schema).forEach(function (tableName) {
    const columns = getColumnNames_(tableName, handle);
    let sheet = ss.getSheetByName(tableName);

    if (!sheet) {
      sheet = ss.insertSheet(tableName);
      report.push('Created tab ' + tableName + ' (' + handle.label + ')');
    }

    const lastCol = sheet.getLastColumn();
    if (lastCol === 0) {
      sheet.getRange(1, 1, 1, columns.length).setValues([columns]);
      report.push('Wrote headers for ' + tableName + ' (' + handle.label + ')');
    } else {
      // Upgrade: columns added to the END of a schema in a newer version are
      // appended to an existing tab. Only when the existing headers are an exact
      // prefix of the new ones — anything else still stops with an error.
      const added = appendMissingColumns_(sheet, columns);
      if (added.length) {
        report.push('Added column(s) ' + added.join(', ') + ' to ' + tableName + ' (' + handle.label + ')');
      }
      const problems = checkHeaders_(sheet, columns);
      if (problems.length) {
        throw new Error(
          'Tab ' + tableName + ' (' + handle.label + ') has unexpected headers: ' + problems.join('; ') +
            '. Fix manually; no data was changed.',
        );
      }
    }

    // Formatting only — safe to re-apply.
    sheet.getRange(1, 1, sheet.getMaxRows(), columns.length).setNumberFormat('@');
    sheet.getRange(1, 1, 1, columns.length).setFontWeight('bold').setBackground('#0b1120').setFontColor('#ffffff');
    sheet.setFrozenRows(1);
  });

  return report;
}

/** Return a list of structural problems (empty = OK). Read-only. */
function validateSpreadsheetStructure_(db) {
  const handle = dbOrCentral_(db);
  const ss = handle.getSpreadsheet();
  const problems = [];
  Object.keys(handle.schema).forEach(function (tableName) {
    const where = tableName + (handle.label === 'central' ? '' : ' (' + handle.label + ')');
    const sheet = ss.getSheetByName(tableName);
    if (!sheet) {
      problems.push(where + ': tab missing');
      return;
    }
    const headerProblems = checkHeaders_(sheet, getColumnNames_(tableName, handle));
    headerProblems.forEach(function (p) {
      problems.push(where + ': ' + p);
    });
    if (headerProblems.length) return;

    const idColumn = getTableSchema_(tableName, handle).idColumn;
    const seen = {};
    readRecords_(tableName, handle).forEach(function (r) {
      const id = r[idColumn];
      if (!id) problems.push(where + ' row ' + r._row + ': empty ' + idColumn);
      else if (seen[id]) problems.push(where + ' row ' + r._row + ': duplicate ' + idColumn + ' ' + id);
      seen[id] = true;
    });
  });
  return problems;
}

/**
 * If the sheet's headers are exactly the first N expected columns (and nothing
 * else), write the remaining header names after them. Existing data is never
 * moved; rows simply have empty cells in the new columns. Returns added names.
 */
function appendMissingColumns_(sheet, expected) {
  // Look at the HEADER ROW, not getLastColumn(): data may already have been
  // written into the new column by the newer code before this upgrade ran.
  const width = Math.max(sheet.getLastColumn(), expected.length);
  const header = sheet.getRange(1, 1, 1, width).getDisplayValues()[0];
  let filled = header.length;
  while (filled > 0 && header[filled - 1] === '') filled--;
  if (filled >= expected.length) return [];
  for (let i = 0; i < filled; i++) {
    if (header[i] !== expected[i]) return []; // not a clean prefix → leave for checkHeaders_
  }
  const missing = expected.slice(filled);
  sheet.getRange(1, filled + 1, 1, missing.length).setValues([missing]);
  return missing;
}

function checkHeaders_(sheet, expected) {
  const width = Math.max(sheet.getLastColumn(), expected.length);
  const actual = sheet.getRange(1, 1, 1, width).getDisplayValues()[0];
  const problems = [];
  expected.forEach(function (name, i) {
    if (actual[i] !== name) problems.push('column ' + (i + 1) + ' should be "' + name + '" but is "' + actual[i] + '"');
  });
  for (let i = expected.length; i < actual.length; i++) {
    if (actual[i] !== '') problems.push('unexpected extra column "' + actual[i] + '"');
  }
  return problems;
}
