/**
 * KDP catalog identity — prevent future stubs and print-as-Kindle links.
 *
 * Daily metrics stay keyed to the physical ASIN. This module only shapes
 * newly generated kdp_books / kdp_book_formats payloads.
 *
 * Production cleanup of legacy rows is a separate operation. Collapse
 * candidates are detected here but never executed.
 */

export const FORMAT_EBOOK = 'ebook';
export const FORMAT_KU = 'ku';
export const FORMAT_PAPERBACK = 'paperback';
export const FORMAT_HARDCOVER = 'hardcover';
export const FORMAT_AUDIOBOOK = 'audiobook';
export const FORMAT_UNKNOWN = 'unknown';

export const SOURCE_AUTHORITY = Object.freeze({
  compound_key: 100,
  explicit_asins: 90,
  labeled_section: 80,
  kdp_titles: 70,
  print_setup: 60,
  report_format: 50,
  fallback: 10,
});

const ASIN_RE = /^[A-Z0-9]{10}$/;
const COMPOUND_RE = /DIGITAL=|PRINT=|HARDCOVER=|AUDIOBOOK=|AUDIBLE=/i;
const KINDLE_FAMILY = new Set([FORMAT_EBOOK, FORMAT_KU]);
const PRINT_FAMILY = new Set([FORMAT_PAPERBACK, FORMAT_HARDCOVER]);

export function normalizeAsin(value) {
  const s = String(value || '').trim().toUpperCase();
  return ASIN_RE.test(s) ? s : null;
}

export function extractAsinsFromGroupKey(groupKey) {
  const s = String(groupKey || '');
  const digitalMatch = s.match(/(?:digitalAsin|DIGITAL)\s*[:=]\s*([A-Z0-9]{10})/i);
  const printMatch = s.match(/(?:printAsin|PRINT)\s*[:=]\s*([A-Z0-9]{10})/i);
  const hardcoverMatch = s.match(/(?:hardcoverAsin|HARDCOVER)\s*[:=]\s*([A-Z0-9]{10})/i);
  const audiobookMatch = s.match(/(?:audiobookAsin|AUDIOBOOK|AUDIBLE)\s*[:=]\s*([A-Z0-9]{10})/i);
  const exactAsin = !digitalMatch && !printMatch && !hardcoverMatch && ASIN_RE.test(String(s || '').trim())
    ? String(s).trim().toUpperCase()
    : null;
  return {
    digitalAsin: digitalMatch?.[1] ? String(digitalMatch[1]).toUpperCase() : (exactAsin || null),
    printAsin: printMatch?.[1] ? String(printMatch[1]).toUpperCase() : null,
    hardcoverAsin: hardcoverMatch?.[1] ? String(hardcoverMatch[1]).toUpperCase() : null,
    audiobookAsin: audiobookMatch?.[1] ? String(audiobookMatch[1]).toUpperCase() : null,
  };
}

export function isCompoundBookId(id) {
  return COMPOUND_RE.test(String(id || ''));
}

export function isPrintOnlyBookId(id) {
  const s = String(id || '');
  return /PRINT\s*[:=]/i.test(s) && !/DIGITAL\s*[:=]/i.test(s);
}

export function isBareAsinBookId(id) {
  return Boolean(normalizeAsin(id) && !isCompoundBookId(id));
}

export function compoundBookId({ digital = null, print = null, hardcover = null, audiobook = null } = {}) {
  const d = normalizeAsin(digital);
  const p = normalizeAsin(print);
  const h = normalizeAsin(hardcover);
  const a = normalizeAsin(audiobook);
  if (!d && !p && !h && !a) return null;
  if (d && p) return `DIGITAL=${d}:PRINT=${p}::`;
  if (d && h) return `DIGITAL=${d}:HARDCOVER=${h}::`;
  if (d && a) return `DIGITAL=${d}:AUDIOBOOK=${a}::`;
  if (p && !d) return printOnlyBookId(p);
  if (h && !d) return `:HARDCOVER=${h}::`;
  if (d) return d;
  return p || h || a;
}

export function printOnlyBookId(printAsin) {
  const print = normalizeAsin(printAsin);
  return print ? `:PRINT=${print}::` : null;
}

export function formatsCompatible(a, b) {
  const left = String(a || '').trim().toLowerCase();
  const right = String(b || '').trim().toLowerCase();
  if (!left || !right || left === FORMAT_UNKNOWN || right === FORMAT_UNKNOWN) return true;
  if (left === right) return true;
  if (KINDLE_FAMILY.has(left) && KINDLE_FAMILY.has(right)) return true;
  if (PRINT_FAMILY.has(left) && PRINT_FAMILY.has(right)) return false;
  if (KINDLE_FAMILY.has(left) && PRINT_FAMILY.has(right)) return false;
  if (PRINT_FAMILY.has(left) && KINDLE_FAMILY.has(right)) return false;
  if (left === FORMAT_AUDIOBOOK && right !== FORMAT_AUDIOBOOK) return false;
  if (right === FORMAT_AUDIOBOOK && left !== FORMAT_AUDIOBOOK) return false;
  return true;
}

function emptyRole() {
  return {
    kindle: null,
    paperback: null,
    hardcover: null,
    audiobook: null,
    sources: [],
  };
}

function roleFamily(format) {
  const fmt = String(format || '').trim().toLowerCase();
  if (KINDLE_FAMILY.has(fmt) || fmt === 'kindle' || fmt === 'digital') return 'kindle';
  if (fmt === FORMAT_PAPERBACK || fmt === 'print') return 'paperback';
  if (fmt === FORMAT_HARDCOVER) return 'hardcover';
  if (fmt === FORMAT_AUDIOBOOK || fmt === 'audible') return 'audiobook';
  return null;
}

export function isPrintRole(role) {
  return Boolean(role && (role.paperback || role.hardcover));
}

export function isKindleRole(role) {
  return Boolean(role && role.kindle);
}

function addEvidence(registry, conflicts, asin, family, source, authority) {
  const id = normalizeAsin(asin);
  const fam = roleFamily(family) || family;
  if (!id || !fam) return;
  const auth = Number(authority) || 0;
  if (!registry.has(id)) registry.set(id, emptyRole());
  const role = registry.get(id);
  role.sources.push({ family: fam, source: String(source || ''), authority: auth });

  const printConflict = fam === 'kindle' && (role.paperback || role.hardcover);
  const kindleConflict = (fam === 'paperback' || fam === 'hardcover') && role.kindle;
  const audioConflict = fam === 'audiobook' && (role.kindle || role.paperback || role.hardcover);
  const audioVs = (fam === 'kindle' || fam === 'paperback' || fam === 'hardcover') && role.audiobook;

  if (printConflict || kindleConflict || audioConflict || audioVs) {
    const existingAuth = Math.max(
      role.kindle?.authority || 0,
      role.paperback?.authority || 0,
      role.hardcover?.authority || 0,
      role.audiobook?.authority || 0,
    );
    conflicts.push({
      type: 'identity.format_conflict',
      asin: id,
      incoming: { family: fam, source, authority: auth },
      existing: {
        kindle: role.kindle,
        paperback: role.paperback,
        hardcover: role.hardcover,
        audiobook: role.audiobook,
      },
    });
    if (auth < existingAuth) return;
    if (auth === existingAuth) {
      if (fam === 'kindle') role.kindle = null;
      if (fam === 'paperback') role.paperback = null;
      if (fam === 'hardcover') role.hardcover = null;
      if (fam === 'audiobook') role.audiobook = null;
      return;
    }
  }

  role[fam] = { source: String(source || ''), authority: auth };
}

export function buildFormatRegistry(booksObj, extraEvidence = []) {
  const registry = new Map();
  const conflicts = [];
  const raw = booksObj && typeof booksObj === 'object' ? booksObj : {};

  for (const [key, meta] of Object.entries(raw)) {
    const fromKey = extractAsinsFromGroupKey(key);
    if (fromKey.digitalAsin && isCompoundBookId(key) && fromKey.digitalAsin !== fromKey.printAsin) {
      addEvidence(registry, conflicts, fromKey.digitalAsin, 'kindle', `compound:${key}`, SOURCE_AUTHORITY.compound_key);
    }
    if (fromKey.printAsin) {
      addEvidence(registry, conflicts, fromKey.printAsin, 'paperback', `compound:${key}`, SOURCE_AUTHORITY.compound_key);
    }
    if (fromKey.hardcoverAsin) {
      addEvidence(registry, conflicts, fromKey.hardcoverAsin, 'hardcover', `compound:${key}`, SOURCE_AUTHORITY.compound_key);
    }
    if (fromKey.audiobookAsin && fromKey.audiobookAsin !== fromKey.digitalAsin) {
      addEvidence(registry, conflicts, fromKey.audiobookAsin, 'audiobook', `compound:${key}`, SOURCE_AUTHORITY.compound_key);
    }

    const as = meta && typeof meta === 'object' && meta.asins && typeof meta.asins === 'object' ? meta.asins : {};
    if (isCompoundBookId(key) || isPrintOnlyBookId(key)) {
      if (as.digital && normalizeAsin(as.digital) !== normalizeAsin(as.print)) {
        addEvidence(registry, conflicts, as.digital, 'kindle', `asins:${key}`, SOURCE_AUTHORITY.explicit_asins);
      }
      if (as.print) addEvidence(registry, conflicts, as.print, 'paperback', `asins:${key}`, SOURCE_AUTHORITY.explicit_asins);
      if (as.hardcover) addEvidence(registry, conflicts, as.hardcover, 'hardcover', `asins:${key}`, SOURCE_AUTHORITY.explicit_asins);
      if (as.audiobook) addEvidence(registry, conflicts, as.audiobook, 'audiobook', `asins:${key}`, SOURCE_AUTHORITY.explicit_asins);
    } else {
      if (as.print && !as.digital) {
        addEvidence(registry, conflicts, as.print, 'paperback', `asins:${key}`, SOURCE_AUTHORITY.explicit_asins);
      }
      if (as.hardcover && !as.digital) {
        addEvidence(registry, conflicts, as.hardcover, 'hardcover', `asins:${key}`, SOURCE_AUTHORITY.explicit_asins);
      }
      if (as.digital && normalizeAsin(as.digital) !== normalizeAsin(as.print)) {
        addEvidence(registry, conflicts, as.digital, 'kindle', `asins:${key}`, SOURCE_AUTHORITY.explicit_asins);
      }
    }
  }

  for (const ev of extraEvidence || []) {
    addEvidence(
      registry,
      conflicts,
      ev?.asin,
      ev?.family || ev?.format,
      ev?.source || 'extra',
      ev?.authority != null ? ev.authority : SOURCE_AUTHORITY.kdp_titles,
    );
  }

  return { registry, conflicts };
}

export function findCompoundParentForAsin(booksObj, asin) {
  const needle = normalizeAsin(asin);
  if (!needle) return null;
  for (const [key, meta] of Object.entries(booksObj || {})) {
    if (!isCompoundBookId(key)) continue;
    const fromKey = extractAsinsFromGroupKey(key);
    const as = meta?.asins && typeof meta.asins === 'object' ? meta.asins : {};
    const ids = [
      fromKey.digitalAsin,
      fromKey.printAsin,
      fromKey.hardcoverAsin,
      fromKey.audiobookAsin,
      normalizeAsin(as.digital),
      normalizeAsin(as.print),
      normalizeAsin(as.hardcover),
      normalizeAsin(as.audiobook),
    ].filter(Boolean);
    if (ids.includes(needle)) {
      return {
        bookId: key,
        digitalAsin: fromKey.digitalAsin || normalizeAsin(as.digital),
        printAsin: fromKey.printAsin || normalizeAsin(as.print),
        hardcoverAsin: fromKey.hardcoverAsin || normalizeAsin(as.hardcover),
        audiobookAsin: fromKey.audiobookAsin || normalizeAsin(as.audiobook),
      };
    }
  }
  return null;
}

function cloneMeta(meta) {
  const m = meta && typeof meta === 'object' ? meta : {};
  const as = m.asins && typeof m.asins === 'object' ? m.asins : {};
  return {
    titleName: m.titleName == null ? null : String(m.titleName),
    author: m.author == null ? null : String(m.author),
    coverImageUrl: m.coverImageUrl == null ? (m.coverUrl == null ? null : String(m.coverUrl)) : String(m.coverImageUrl),
    asins: {
      digital: normalizeAsin(as.digital),
      print: normalizeAsin(as.print),
      hardcover: normalizeAsin(as.hardcover),
      audiobook: normalizeAsin(as.audiobook || as.audible),
    },
    printSetupIds: m.printSetupIds && typeof m.printSetupIds === 'object' ? { ...m.printSetupIds } : {},
  };
}

export function wouldMergeByTitleOrAuthor() {
  return false;
}

export function detectStubCollapseCandidates({ stubs = [], canonicalBooksObj = {} } = {}) {
  const out = [];
  for (const stub of stubs || []) {
    const stubId = String(stub?.id || stub?.bookId || '').trim();
    const asin = normalizeAsin(stub?.asin || stubId);
    if (!asin) continue;
    const parent = findCompoundParentForAsin(canonicalBooksObj, asin);
    if (!parent) continue;
    out.push({
      stubBookId: stubId || asin,
      canonicalBookId: parent.bookId,
      asin,
      reason: parent.printAsin === asin || parent.hardcoverAsin === asin
        ? 'print_of_compound'
        : (parent.digitalAsin === asin ? 'kindle_of_compound' : 'asin_of_compound'),
      execute: false,
    });
  }
  return out;
}

export function sanitizeBookshelfEntries(entries) {
  const list = Array.isArray(entries) ? entries : [];
  const printAsins = new Set();
  for (const e of list) {
    const print = normalizeAsin(e?.asins?.print);
    const hardcover = normalizeAsin(e?.asins?.hardcover);
    if (print) printAsins.add(print);
    if (hardcover) printAsins.add(hardcover);
  }
  return list.map((e) => {
    const row = e && typeof e === 'object' ? { ...e } : {};
    const as = row.asins && typeof row.asins === 'object' ? { ...row.asins } : {};
    const digital = normalizeAsin(as.digital);
    const print = normalizeAsin(as.print);
    const hardcover = normalizeAsin(as.hardcover);
    const audiobook = normalizeAsin(as.audiobook);
    if (digital && (printAsins.has(digital) || digital === print || digital === hardcover)) {
      as.digital = null;
    } else {
      as.digital = digital;
    }
    as.print = print;
    as.hardcover = hardcover;
    as.audiobook = audiobook;
    const asinsAll = Array.isArray(row.asinsAll)
      ? row.asinsAll.map(normalizeAsin).filter(Boolean)
      : [];
    if (!as.digital && !as.print && !as.hardcover && !as.audiobook && asinsAll.length) {
      row.unresolvedFormat = true;
    }
    row.asins = as;
    row.asinsAll = asinsAll;
    return row;
  });
}

export function applyCatalogIdentity(booksObj, options = {}) {
  const raw = booksObj && typeof booksObj === 'object' ? booksObj : {};
  const extraEvidence = [];
  for (const title of options.priorTitles || []) {
    const asin = normalizeAsin(title?.asin);
    if (!asin) continue;
    if (title?.format) {
      extraEvidence.push({
        asin,
        family: title.format,
        source: 'kdp_titles',
        authority: SOURCE_AUTHORITY.kdp_titles,
      });
    }
  }

  const { registry, conflicts } = buildFormatRegistry(raw, extraEvidence);
  const out = {};
  const parentByAsin = new Map();

  const remember = (asin, bookId) => {
    const id = normalizeAsin(asin);
    if (!id || !bookId) return;
    if (!parentByAsin.has(id)) parentByAsin.set(id, bookId);
  };

  for (const [key, meta] of Object.entries(raw)) {
    if (!isCompoundBookId(key) || isPrintOnlyBookId(key)) continue;
    const fromKey = extractAsinsFromGroupKey(key);
    const cloned = cloneMeta(meta);
    if (fromKey.digitalAsin && fromKey.digitalAsin !== fromKey.printAsin) cloned.asins.digital = fromKey.digitalAsin;
    if (fromKey.printAsin) cloned.asins.print = fromKey.printAsin;
    if (fromKey.hardcoverAsin) cloned.asins.hardcover = fromKey.hardcoverAsin;
    if (fromKey.audiobookAsin) cloned.asins.audiobook = fromKey.audiobookAsin;
    if (cloned.asins.digital && isPrintRole(registry.get(cloned.asins.digital))) {
      conflicts.push({
        type: 'identity.format_conflict',
        asin: cloned.asins.digital,
        incoming: { family: 'kindle', source: key, authority: SOURCE_AUTHORITY.fallback },
        existing: registry.get(cloned.asins.digital),
      });
      cloned.asins.digital = fromKey.digitalAsin && !isPrintRole(registry.get(fromKey.digitalAsin))
        ? fromKey.digitalAsin
        : null;
    }
    out[key] = cloned;
    remember(cloned.asins.digital, key);
    remember(cloned.asins.print, key);
    remember(cloned.asins.hardcover, key);
    remember(cloned.asins.audiobook, key);
  }

  for (const [key, meta] of Object.entries(raw)) {
    const fromKey = extractAsinsFromGroupKey(key);
    const cloned = cloneMeta(meta);
    const print = fromKey.printAsin || cloned.asins.print;
    const digital = (isCompoundBookId(key) && !isPrintOnlyBookId(key))
      ? (fromKey.digitalAsin || cloned.asins.digital)
      : cloned.asins.digital;
    if (!print || digital) continue;
    if (parentByAsin.has(print)) continue;
    const id = isPrintOnlyBookId(key) ? key : printOnlyBookId(print);
    if (!id || out[id]) continue;
    out[id] = {
      ...cloned,
      asins: { digital: null, print, hardcover: cloned.asins.hardcover, audiobook: null },
    };
    remember(print, id);
  }

  for (const [key, meta] of Object.entries(raw)) {
    if (isCompoundBookId(key) || isPrintOnlyBookId(key)) continue;
    const asin = normalizeAsin(key);
    if (!asin) continue;
    if (parentByAsin.has(asin)) continue;
    if (isPrintRole(registry.get(asin))) continue;
    const cloned = cloneMeta(meta);
    const explicitDigital = cloned.asins.digital;
    const labeledKindle = explicitDigital === asin && !cloned.asins.print && !cloned.asins.hardcover;
    if (!labeledKindle) continue;
    out[key] = {
      ...cloned,
      asins: { digital: asin, print: null, hardcover: null, audiobook: cloned.asins.audiobook },
    };
    remember(asin, key);
  }

  const existingStubs = Array.isArray(options.existingStubs)
    ? options.existingStubs
    : Object.keys(raw)
      .filter((id) => isBareAsinBookId(id))
      .map((id) => ({ id, asin: id }));

  const collapseCandidates = detectStubCollapseCandidates({
    stubs: existingStubs,
    canonicalBooksObj: out,
  });

  const unresolvedAsins = [];
  for (const [key] of Object.entries(raw)) {
    const asin = normalizeAsin(key);
    if (!asin) continue;
    if (parentByAsin.has(asin) || out[key]) continue;
    if (isCompoundBookId(key) || isPrintOnlyBookId(key)) continue;
    unresolvedAsins.push(asin);
  }

  return {
    booksObj: out,
    registry,
    conflicts,
    collapseCandidates,
    unresolvedAsins,
    parentByAsin,
  };
}

export function resolveCanonicalFormats(bookId, meta, registry) {
  const cloned = cloneMeta(meta);
  const fromKey = extractAsinsFromGroupKey(bookId);
  let digital = cloned.asins.digital || (isCompoundBookId(bookId) ? fromKey.digitalAsin : null);
  let print = cloned.asins.print || fromKey.printAsin;
  let hardcover = cloned.asins.hardcover || fromKey.hardcoverAsin;
  let audiobook = cloned.asins.audiobook || fromKey.audiobookAsin;

  if (digital && isPrintRole(registry?.get(digital))) digital = null;
  if (print && isKindleRole(registry?.get(print)) && !isPrintRole(registry?.get(print))) print = null;

  const formats = [];
  if (digital) {
    formats.push({ asin: digital, format: FORMAT_EBOOK });
    formats.push({ asin: digital, format: FORMAT_KU });
  }
  if (print) formats.push({ asin: print, format: FORMAT_PAPERBACK });
  if (hardcover) formats.push({ asin: hardcover, format: FORMAT_HARDCOVER });
  if (audiobook && audiobook !== digital) formats.push({ asin: audiobook, format: FORMAT_AUDIOBOOK });
  return formats;
}

function normalizeTitleValue(s) {
  return String(s || '').trim().toLowerCase();
}

export function buildCanonicalTitlesRows({ accountId, booksObj, existingStubs = null, priorTitles = [] } = {}) {
  const identity = applyCatalogIdentity(booksObj, { existingStubs, priorTitles });
  const bookRows = [];
  const formatRows = [];
  const titleRowsByAsin = new Map();
  const seenAsinParent = new Map();

  for (const [bookId, b0] of Object.entries(identity.booksObj)) {
    const b = cloneMeta(b0);
    const titleName = b.titleName;
    const author = b.author;
    if (isBareAsinBookId(bookId) && !titleName && !author && !b.asins.digital && !b.asins.print) {
      continue;
    }
    bookRows.push({
      account_id: accountId,
      id: bookId,
      normalized_title: normalizeTitleValue(titleName || bookId),
      display_title: titleName,
      author,
      language: null,
      cover_url: b.coverImageUrl,
      cover_path: null,
    });

    const formats = resolveCanonicalFormats(bookId, b, identity.registry);
    for (const ff of formats) {
      const asin = normalizeAsin(ff.asin);
      const fmt = String(ff.format || '').trim().toLowerCase();
      if (!asin || !fmt) continue;
      if ((fmt === FORMAT_EBOOK || fmt === FORMAT_KU) && isPrintRole(identity.registry.get(asin))) {
        identity.conflicts.push({
          type: 'identity.format_conflict',
          asin,
          incoming: { family: 'kindle', source: 'titles_row', authority: SOURCE_AUTHORITY.fallback },
          existing: identity.registry.get(asin),
        });
        continue;
      }
      const priorParent = seenAsinParent.get(asin);
      if (priorParent && priorParent !== bookId) {
        identity.conflicts.push({
          type: 'identity.duplicate_parent',
          asin,
          incoming: { bookId, format: fmt },
          existing: { bookId: priorParent },
        });
        continue;
      }
      if (!priorParent) seenAsinParent.set(asin, bookId);
      formatRows.push({
        account_id: accountId,
        id: `${bookId}::${asin}::${fmt}::`,
        book_id: bookId,
        asin,
        format: fmt,
        marketplace: null,
      });
      if (!titleRowsByAsin.has(asin)) {
        const row = {
          account_id: accountId,
          asin,
          title: titleName,
          author,
          cover_url: b.coverImageUrl,
        };
        if (fmt === FORMAT_PAPERBACK && b.printSetupIds?.paperback) {
          row.kdp_setup_book_id = String(b.printSetupIds.paperback).trim().toUpperCase();
        }
        titleRowsByAsin.set(asin, row);
      } else if (fmt === FORMAT_PAPERBACK && b.printSetupIds?.paperback) {
        titleRowsByAsin.get(asin).kdp_setup_book_id = String(b.printSetupIds.paperback).trim().toUpperCase();
      }
    }
  }

  return {
    ...identity,
    bookRows,
    formatRows,
    titleRows: Array.from(titleRowsByAsin.values()),
  };
}

export function resolvePlaceholderIdentity({
  asin,
  format = null,
  booksObj = {},
  registry = null,
} = {}) {
  const id = normalizeAsin(asin);
  const fmt = String(format || '').trim().toLowerCase() || FORMAT_UNKNOWN;
  if (!id) {
    return {
      bookId: null,
      createPlaceholderBook: false,
      createPlaceholderFormat: false,
      reason: 'missing_asin',
    };
  }

  const identity = registry ? { booksObj, registry, parentByAsin: null } : applyCatalogIdentity(booksObj);
  const parent = identity.parentByAsin instanceof Map
    ? identity.parentByAsin.get(id)
    : findCompoundParentForAsin(identity.booksObj || booksObj, id)?.bookId || null;
  const role = (identity.registry || registry)?.get?.(id);

  if (parent) {
    return {
      bookId: parent,
      createPlaceholderBook: false,
      createPlaceholderFormat: false,
      reason: 'compound_parent',
    };
  }

  if ((fmt === FORMAT_EBOOK || fmt === FORMAT_KU) && isPrintRole(role)) {
    return {
      bookId: null,
      createPlaceholderBook: false,
      createPlaceholderFormat: false,
      reason: 'print_cannot_be_kindle',
    };
  }

  if (!fmt || fmt === FORMAT_UNKNOWN) {
    return {
      bookId: null,
      createPlaceholderBook: false,
      createPlaceholderFormat: false,
      reason: 'unresolved_format',
    };
  }

  // Leftover daily facts stay ASIN-keyed. Do not manufacture a logical book
  // from a fact row alone — that is how null-author ASIN-title Kindle stubs
  // were created. Titles / bookshelf / compound keys own catalog identity.
  return {
    bookId: null,
    createPlaceholderBook: false,
    createPlaceholderFormat: false,
    reason: 'unresolved_parent',
  };
}

export function summarizeCatalogRows({ bookRows = [], formatRows = [] } = {}) {
  const books = bookRows.length;
  const asins = new Set(formatRows.map((r) => r.asin).filter(Boolean));
  const parentsByAsin = new Map();
  const formatsByAsin = new Map();
  for (const row of formatRows) {
    const asin = normalizeAsin(row.asin);
    if (!asin) continue;
    if (!parentsByAsin.has(asin)) parentsByAsin.set(asin, new Set());
    parentsByAsin.get(asin).add(row.book_id);
    if (!formatsByAsin.has(asin)) formatsByAsin.set(asin, new Set());
    formatsByAsin.get(asin).add(row.format);
  }
  let duplicateParents = 0;
  let printAsKindle = 0;
  for (const [asin, parents] of parentsByAsin.entries()) {
    if (parents.size > 1) duplicateParents += 1;
    const fmts = formatsByAsin.get(asin) || new Set();
    if ((fmts.has(FORMAT_PAPERBACK) || fmts.has(FORMAT_HARDCOVER)) && (fmts.has(FORMAT_EBOOK) || fmts.has(FORMAT_KU))) {
      printAsKindle += 1;
    }
  }
  const unknownAuthorStubs = bookRows.filter((b) => {
    const id = String(b?.id || '');
    const title = String(b?.display_title || b?.normalized_title || '').trim().toLowerCase();
    return isBareAsinBookId(id) && (!b?.author) && (title === id.toLowerCase() || !b?.display_title);
  }).length;
  return {
    books,
    asins: asins.size,
    duplicateParents,
    printAsKindle,
    unknownAuthorStubs,
  };
}

export function simulateCleanCatalogIngest(rawBooksObj, options = {}) {
  const built = buildCanonicalTitlesRows({
    accountId: options.accountId || '00000000-0000-0000-0000-000000000001',
    booksObj: rawBooksObj,
    existingStubs: options.existingStubs,
    priorTitles: options.priorTitles,
  });
  return {
    ...built,
    summary: summarizeCatalogRows(built),
  };
}
