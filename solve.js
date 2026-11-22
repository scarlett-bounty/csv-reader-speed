// Fast drop-in for csv-reader 1.0.0.
//
// Written from the competition rules (RULES.txt): read the text once, left to
// right, with commas and double quotes. A U+FEFF at the very start is dropped.
// A record ends at LF or CRLF; a line left with no characters is no record.
// Outside quotes a CR not followed by LF is dropped (stray_cr). A field that
// opens with a quote runs to the next quote that is not doubled; "" inside it
// is one quote and each CRLF or lone CR inside it is read as LF; what follows
// its closing quote, up to the next comma or line break, is appended as it
// stands (quote_junk, when the field ends); a quote that never closes is a
// literal character and the text after it is read again as unquoted
// (unterminated_quote). A quote inside an unquoted field is a literal
// character. Fields stay strings, never trimmed or converted. columns is the
// first record when header is true, else null; rows holds the records after it
// (every record when header is false), each padded with empty strings
// (short_row) or cut (long_row) to the first record's width.
//
// Errors are emitted in the order met: those met inside a record, then that
// record's short_row/long_row when it ends. Rows are built as they are read.
//
// Dependency-free ES module. Node 22 compatible.

const COMMA = 44; // ,
const QUOTE = 34; // "
const CR = 13;    // \r
const LF = 10;    // \n
const BOM = 0xFEFF;

/**
 * csv-reader 1.0.0's answer for one case's input {text, header}:
 * {columns, rows, errors}.
 */
export function run(input) {
  const s = input.text;
  const header = input.header === true;
  const n = s.length;
  let p = 0;
  if (n > 0 && s.charCodeAt(0) === BOM) p = 1;

  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1; // first record's field count; -1 until the first record
  let line = 1;
  let recIdx = 0; // records read so far

  // Parse records until the input is consumed.
  while (p < n) {
    // A line left with no characters is no record: skip a bare LF or CRLF.
    const c0 = s.charCodeAt(p);
    if (c0 === LF) { p++; line++; continue; }
    if (c0 === CR && s.charCodeAt(p + 1) === LF) { p += 2; line++; continue; }

    const startLine = line;
    const rowIdx = (header && recIdx === 0) ? null : recIdx - (header ? 1 : 0);
    const fields = [];

    // Parse the fields of this record.
    let recDone = false;
    while (!recDone) {
      // ---- parse one field starting at p ----
      let value;
      if (s.charCodeAt(p) === QUOTE) {
        // Quoted field.
        const contentStart = p + 1;
        // Find the closing quote: the next quote that is not doubled.
        let q = contentStart;
        let escaped = false; // content holds a "" pair
        for (;;) {
          q = s.indexOf('"', q);
          if (q === -1) break;
          if (s.charCodeAt(q + 1) === QUOTE) { escaped = true; q += 2; continue; }
          break;
        }
        if (q === -1) {
          // No closing quote anywhere: the quote never closes. It is a
          // literal character and the text after it is read again as
          // unquoted.
          errors.push({ code: 'unterminated_quote', line: startLine, row: rowIdx });
          // Re-read as unquoted from just after the opening quote. The
          // field value starts with the literal quote.
          let seg = contentStart;
          let e2 = contentStart;
          const parts = ['"'];
          let endKind = 0; // 0=eof 1=comma 2=lf 3=crlf
          while (e2 < n) {
            const c = s.charCodeAt(e2);
            if (c === COMMA) { endKind = 1; break; }
            if (c === LF) { endKind = 2; break; }
            if (c === CR) {
              if (s.charCodeAt(e2 + 1) === LF) { endKind = 3; break; }
              // lone CR: drop it, stray_cr
              parts.push(s.slice(seg, e2));
              errors.push({ code: 'stray_cr', line: startLine, row: rowIdx });
              e2++;
              seg = e2;
              continue;
            }
            e2++;
          }
          parts.push(s.slice(seg, e2));
          value = parts.join('');
          if (endKind === 0) { p = n; recDone = true; }
          else if (endKind === 1) { p = e2 + 1; }
          else if (endKind === 2) { p = e2 + 1; line++; recDone = true; }
          else { p = e2 + 2; line++; recDone = true; }
          fields.push(value);
          continue;
        }

        // q is the closing quote. Content is s[contentStart..q].
        let hasNL = false;
        if (!escaped) {
          const nl = s.indexOf('\n', contentStart);
          if (nl !== -1 && nl < q) hasNL = true;
          else {
            const cr = s.indexOf('\r', contentStart);
            if (cr !== -1 && cr < q) hasNL = true;
          }
        } else {
          hasNL = true; // "" present: take the careful path
        }
        let content;
        if (!hasNL && !escaped) {
          content = s.slice(contentStart, q);
        } else {
          // Careful path: "" -> ", CRLF/CR/LF -> LF, and count lines.
          let out = '';
          let i = contentStart;
          let seg = contentStart;
          while (i < q) {
            const c = s.charCodeAt(i);
            if (c === QUOTE) {
              out += s.slice(seg, i) + '"';
              i += 2;
              seg = i;
            } else if (c === CR) {
              out += s.slice(seg, i) + '\n';
              line++;
              if (s.charCodeAt(i + 1) === LF) i += 2;
              else i += 1;
              seg = i;
            } else if (c === LF) {
              out += s.slice(seg, i) + '\n';
              line++;
              i++;
              seg = i;
            } else {
              i++;
            }
          }
          out += s.slice(seg, q);
          content = out;
        }

        // Junk after the closing quote, up to the next comma or line break,
        // appended as it stands (quote_junk when the field ends). A lone CR
        // inside it is dropped (stray_cr), not junk.
        let junkKind = 0; // 0=eof 1=comma 2=lf 3=crlf
        let junkEnd = q + 1;
        let junk = '';
        {
          let seg = q + 1;
          const parts = [];
          let e2 = q + 1;
          while (e2 < n) {
            const c = s.charCodeAt(e2);
            if (c === COMMA) { junkKind = 1; break; }
            if (c === LF) { junkKind = 2; break; }
            if (c === CR) {
              if (s.charCodeAt(e2 + 1) === LF) { junkKind = 3; break; }
              parts.push(s.slice(seg, e2));
              errors.push({ code: 'stray_cr', line: startLine, row: rowIdx });
              e2++;
              seg = e2;
              continue;
            }
            e2++;
          }
          parts.push(s.slice(seg, e2));
          junkEnd = e2;
          junk = parts.length === 1 ? parts[0] : parts.join('');
        }
        if (junk.length > 0) {
          errors.push({ code: 'quote_junk', line: startLine, row: rowIdx });
          value = content + junk;
        } else {
          value = content;
        }
        if (junkKind === 0) { p = n; recDone = true; }
        else if (junkKind === 1) { p = junkEnd + 1; }
        else if (junkKind === 2) { p = junkEnd + 1; line++; recDone = true; }
        else { p = junkEnd + 2; line++; recDone = true; }
        fields.push(value);
        continue;
      }

      // Unquoted field: scan to comma, LF, CR, or EOF. A quote here is literal.
      let e = p;
      let val = null;
      let endKind = 0; // 0=eof 1=comma 2=lf 3=crlf
      while (e < n) {
        const c = s.charCodeAt(e);
        if (c === COMMA) { endKind = 1; break; }
        if (c === LF) { endKind = 2; break; }
        if (c === CR) {
          if (s.charCodeAt(e + 1) === LF) { endKind = 3; break; }
          // Lone CR: dropped, stray_cr. Field continues after it.
          if (val === null) val = s.slice(p, e);
          else val += s.slice(p, e);
          errors.push({ code: 'stray_cr', line: startLine, row: rowIdx });
          e++;
          p = e;
          continue;
        }
        e++;
      }
      if (val === null) value = s.slice(p, e);
      else value = val + s.slice(p, e);
      if (endKind === 0) { p = n; recDone = true; }
      else if (endKind === 1) { p = e + 1; }
      else if (endKind === 2) { p = e + 1; line++; recDone = true; }
      else { p = e + 2; line++; recDone = true; }
      fields.push(value);
    }

    // The record ends here. The first record sets the width; later records
    // are padded or cut to it, with a short_row/long_row error.
    if (width === -1) {
      width = fields.length;
      if (header) columns = fields;
      else rows.push(fields);
    } else if (fields.length < width) {
      errors.push({ code: 'short_row', line: startLine, row: rowIdx, fields: fields.length });
      const padded = fields.slice();
      for (let k = fields.length; k < width; k++) padded.push('');
      rows.push(padded);
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: startLine, row: rowIdx, extra: fields.slice(width) });
      rows.push(fields.slice(0, width));
    } else {
      rows.push(fields);
    }
    recIdx++;
  }

  return { columns, rows, errors };
}
