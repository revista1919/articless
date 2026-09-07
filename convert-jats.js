/**
 * Conversor de articles.json a JATS XML (v5.0 - Versión Final Definitiva)
 * 
 * Características principales:
 * - Soporte completo para 6 tipos de artículos académicos
 * - Cumplimiento estricto JATS 1.4
 * - Multi-language (ES/EN) con content-language y lang-grouping
 * - Conversión robusta de tablas, figuras y contenido HTML variable
 * - Manejo avanzado de autores, ORCID, afiliaciones y autor de correspondencia
 * - Procesamiento integral de referencias bibliográficas
 * - Soporte para matemáticas (LaTeX y MathML)
 * - Notas al pie, agradecimientos, financiamiento y disponibilidad de datos
 * 
 * Uso: node json-to-jats.js
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// ─── CONFIGURACIÓN ───────────────────────────────────────────────────────────
const INPUT_FILE = path.join(__dirname, 'articles.json');
const OUTPUT_FILE = path.join(__dirname, 'articles.json');
const BACKUP_FILE = path.join(__dirname, 'articles.backup.json');
const JATS_VERSION = '1.4';
const JATS_DTD_PUBLIC = '-//NISO//DTD JATS (Z39.96) Journal Publishing DTD with MathML3 v1.4 2024//EN';
const JATS_DTD_SYSTEM = 'https://jats.nlm.nih.gov/publishing/1.4/xsd/JATS-journalpublishing1-4-mathml3.xsd';
const JOURNAL_ISSN = '3087-2839';
const JOURNAL_NAME = 'Revista Nacional de las Ciencias para Estudiantes';
const JOURNAL_ABBREV = 'Rev. Nac. Cienc. Estud.';
const JOURNAL_ID = 'RNCE';
const PUBLISHER_NAME = 'Revista Nacional de las Ciencias para Estudiantes';
const LICENSE_URL = 'https://creativecommons.org/licenses/by/4.0/';
const LICENSE_TEXT = 'This is an open-access article distributed under the terms of the Creative Commons Attribution 4.0 International License (CC BY 4.0).';

// ─── TIPOS DE ARTÍCULOS OFICIALES ────────────────────────────────────────────
const ARTICLE_TYPES = {
  'original-research': {
    es: 'Artículo de Investigación Original',
    en: 'Original Research Article',
    jats: 'research-article',
    minWords: 3000,
    maxWords: 8000
  },
  'academic-essay': {
    es: 'Ensayo Académico',
    en: 'Academic Essay',
    jats: 'research-article',
    minWords: 3000,
    maxWords: 6000
  },
  'reflective-essay': {
    es: 'Ensayo Reflexivo',
    en: 'Reflective Essay',
    jats: 'research-article',
    minWords: 1500,
    maxWords: 3000
  },
  'case-report': {
    es: 'Reporte de Caso',
    en: 'Case Report',
    jats: 'case-report',
    minWords: 2000,
    maxWords: 4000
  },
  'systematic-review': {
    es: 'Revisión Sistemática',
    en: 'Systematic Review',
    jats: 'review-article',
    minWords: 4000,
    maxWords: 10000
  },
  'book-review': {
    es: 'Reseña de Libro',
    en: 'Book Review',
    jats: 'book-review',
    minWords: 800,
    maxWords: 2000
  }
};

// ─── FUNCIONES AUXILIARES ─────────────────────────────────────────────────────

function escapeXml(str) {
  if (str == null || str === undefined) return '';
  return String(str)
    .replace(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function cleanText(str) {
  if (!str) return '';
  return String(str).replace(/\s+/g, ' ').trim();
}

function parseDate(dateStr) {
  if (!dateStr) return { year: '', month: '', day: '', iso: '' };
  const parts = String(dateStr).split('-');
  return {
    year: parts[0] || '',
    month: parts[1] || '',
    day: parts[2] || '',
    iso: dateStr
  };
}

function generateSlugId(prefix, text, counter) {
  if (text) {
    const slug = cleanText(text)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .substring(0, 40);
    return `${prefix}-${slug || counter}`;
  }
  return `${prefix}-${counter}`;
}

function normalizeOrcid(orcid) {
  if (!orcid) return '';
  let o = String(orcid).trim();
  if (o.startsWith('http')) return o;
  if (/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/i.test(o)) {
    return `https://orcid.org/${o}`;
  }
  return o;
}

function detectArticleType(articleType, articleTitle = '') {
  if (!articleType) return ARTICLE_TYPES['original-research'];
  
  const typeLower = String(articleType).toLowerCase();
  const titleLower = articleTitle.toLowerCase();
  
  // Buscar en los tipos oficiales
  for (const [key, type] of Object.entries(ARTICLE_TYPES)) {
    if (typeLower.includes(type.es.toLowerCase()) || 
        typeLower.includes(type.en.toLowerCase()) ||
        typeLower.includes(key)) {
      return type;
    }
  }
  
  // Búsqueda por palabras clave
  if (typeLower.includes('investigación') || typeLower.includes('research')) {
    return ARTICLE_TYPES['original-research'];
  }
  if (typeLower.includes('ensayo') && typeLower.includes('reflex')) {
    return ARTICLE_TYPES['reflective-essay'];
  }
  if (typeLower.includes('ensayo') || typeLower.includes('essay')) {
    return ARTICLE_TYPES['academic-essay'];
  }
  if (typeLower.includes('caso') || typeLower.includes('case')) {
    return ARTICLE_TYPES['case-report'];
  }
  if (typeLower.includes('revisión') || typeLower.includes('review')) {
    if (typeLower.includes('sistemática') || typeLower.includes('systematic')) {
      return ARTICLE_TYPES['systematic-review'];
    }
    if (titleLower.includes('libro') || titleLower.includes('book')) {
      return ARTICLE_TYPES['book-review'];
    }
    return ARTICLE_TYPES['systematic-review'];
  }
  if (typeLower.includes('libro') || typeLower.includes('book')) {
    return ARTICLE_TYPES['book-review'];
  }
  
  return ARTICLE_TYPES['original-research'];
}

// ─── CONVERSIÓN DE MATEMÁTICAS ──────────────────────────────────────────────

function convertLatexToJats(text) {
  if (!text) return text;
  
  // Display math $$...$$ o \[...\]
  text = text.replace(/\$\$(.*?)\$\$|\\\[(.*?)\\\]/gs, (_, p1, p2) => {
    const formula = cleanText(p1 || p2);
    return `<disp-formula><mml:math><mml:mrow><mml:mi>${escapeXml(formula)}</mml:mi></mml:mrow></mml:math></disp-formula>`;
  });
  
  // Inline math $...$ o \(...\)
  text = text.replace(/\$(.*?)\$|\\\((.*?)\\\)/gs, (_, p1, p2) => {
    const formula = cleanText(p1 || p2);
    return `<inline-formula><mml:math><mml:mrow><mml:mi>${escapeXml(formula)}</mml:mi></mml:mrow></mml:math></inline-formula>`;
  });
  
  return text;
}

function convertMathMLElement(mathElement) {
  if (!mathElement) return '';
  try {
    const serializer = new (mathElement.ownerDocument.defaultView.XMLSerializer)();
    let mathXml = serializer.serializeToString(mathElement);
    mathXml = mathXml.replace(/<(\/?)math\b/g, '<$1mml:math');
    return mathXml;
  } catch (e) {
    return escapeXml(mathElement.textContent || '');
  }
}

// ─── CONVERSIÓN DE CONTENIDO INLINE ─────────────────────────────────────────

function processInlineContent(node, footnotesMap = {}) {
  if (!node) return '';

  if (node.nodeType === 3) { // Text node
    let text = node.textContent || '';
    text = convertLatexToJats(text);
    return escapeXml(text);
  }

  if (node.nodeType !== 1) return '';

  const tag = node.tagName.toLowerCase();
  const classList = node.classList || { contains: () => false };

  if (tag === 'script' || tag === 'style') return '';

  // MathML
  if (tag === 'math' || tag === 'm:math' || (tag === 'span' && classList.contains('math'))) {
    const mathEl = tag === 'math' ? node : node.querySelector('math');
    if (mathEl) return convertMathMLElement(mathEl);
    return escapeXml(node.textContent || '');
  }

  // Formatting
  if (['em', 'i', 'italic'].includes(tag)) {
    let content = '';
    for (const child of node.childNodes) content += processInlineContent(child, footnotesMap);
    return `<italic>${content}</italic>`;
  }
  
  if (['strong', 'b', 'bold'].includes(tag)) {
    let content = '';
    for (const child of node.childNodes) content += processInlineContent(child, footnotesMap);
    return `<bold>${content}</bold>`;
  }
  
  if (['u', 'underline'].includes(tag)) {
    let content = '';
    for (const child of node.childNodes) content += processInlineContent(child, footnotesMap);
    return `<underline>${content}</underline>`;
  }
  
  if (tag === 'code' || tag === 'tt') {
    return `<monospace>${escapeXml(node.textContent || '')}</monospace>`;
  }
  
  if (tag === 'sub') {
    let content = '';
    for (const child of node.childNodes) content += processInlineContent(child, footnotesMap);
    return `<sub>${content}</sub>`;
  }
  
  if (tag === 'sup') {
    let content = '';
    for (const child of node.childNodes) content += processInlineContent(child, footnotesMap);
    return `<sup>${content}</sup>`;
  }
  
  if (tag === 'span' && classList.contains('small-caps')) {
    let content = '';
    for (const child of node.childNodes) content += processInlineContent(child, footnotesMap);
    return `<sc>${content}</sc>`;
  }

  // Links / xrefs
  if (tag === 'a') {
    const href = node.getAttribute('href') || '';
    let content = '';
    for (const child of node.childNodes) content += processInlineContent(child, footnotesMap);

    if (classList.contains('citation-link') || href.startsWith('#ref') || href.startsWith('#R')) {
      const rid = href.replace(/^#/, '');
      return `<xref ref-type="bibr" rid="${escapeXml(rid)}">${content}</xref>`;
    }
    if (classList.contains('footnote-link') || href.startsWith('#fn')) {
      const rid = href.replace(/^#/, '');
      return `<xref ref-type="fn" rid="${escapeXml(rid)}">${content}</xref>`;
    }
    if (href.startsWith('#fig') || href.startsWith('#F')) {
      const rid = href.replace(/^#/, '');
      return `<xref ref-type="fig" rid="${escapeXml(rid)}">${content}</xref>`;
    }
    if (href.startsWith('#table') || href.startsWith('#T') || href.startsWith('#tab')) {
      const rid = href.replace(/^#/, '');
      return `<xref ref-type="table" rid="${escapeXml(rid)}">${content}</xref>`;
    }
    if (href.startsWith('mailto:')) {
      return `<email>${escapeXml(href.replace('mailto:', ''))}</email>`;
    }
    if (href) {
      return `<ext-link ext-link-type="uri" xlink:href="${escapeXml(href)}">${content}</ext-link>`;
    }
    return content;
  }

  // Generic inline elements
  if (['span', 'abbr', 'label', 'time', 'small'].includes(tag)) {
    let content = '';
    for (const child of node.childNodes) content += processInlineContent(child, footnotesMap);
    return content;
  }

  // Fallback
  let content = '';
  for (const child of node.childNodes) content += processInlineContent(child, footnotesMap);
  return content;
}

// ─── CONVERSIÓN DE BLOQUES ──────────────────────────────────────────────────

function convertParagraph(pElement, footnotesMap = {}) {
  let content = '';
  for (const node of pElement.childNodes) {
    content += processInlineContent(node, footnotesMap);
  }
  const trimmed = content.trim();
  return trimmed ? `<p>${trimmed}</p>` : '';
}

function convertBlockquote(bqElement, footnotesMap = {}) {
  let content = '';
  for (const node of bqElement.childNodes) {
    if (node.nodeType === 3) {
      content += escapeXml(convertLatexToJats(node.textContent || ''));
    } else if (node.nodeType === 1) {
      const tag = node.tagName.toLowerCase();
      if (tag === 'p') {
        let pContent = '';
        for (const n of node.childNodes) pContent += processInlineContent(n, footnotesMap);
        content += `<p>${pContent.trim()}</p>`;
      } else if (['cite', 'attrib', 'footer'].includes(tag)) {
        let c = '';
        for (const n of node.childNodes) c += processInlineContent(n, footnotesMap);
        content += `<attrib>${c.trim()}</attrib>`;
      } else {
        content += processInlineContent(node, footnotesMap);
      }
    }
  }
  return `<disp-quote>${content.trim()}</disp-quote>`;
}

function convertList(listElement, listType, footnotesMap = {}) {
  const items = listElement.querySelectorAll(':scope > li');
  if (!items.length) return '';

  let xml = `<list list-type="${listType}">\n`;
  items.forEach(li => {
    let liContent = '';
    for (const node of li.childNodes) {
      if (node.nodeType === 3) {
        liContent += escapeXml(convertLatexToJats(node.textContent || ''));
      } else if (node.nodeType === 1) {
        const t = node.tagName.toLowerCase();
        if (t === 'p') {
          let p = '';
          for (const n of node.childNodes) p += processInlineContent(n, footnotesMap);
          liContent += p;
        } else if (t === 'ul') {
          liContent += '\n' + convertList(node, 'bullet', footnotesMap);
        } else if (t === 'ol') {
          liContent += '\n' + convertList(node, 'order', footnotesMap);
        } else {
          liContent += processInlineContent(node, footnotesMap);
        }
      }
    }
    xml += `  <list-item><p>${liContent.trim()}</p></list-item>\n`;
  });
  xml += '</list>';
  return xml;
}

function convertDefinitionList(dlElement, footnotesMap = {}) {
  let xml = '<def-list>\n';
  const items = dlElement.querySelectorAll(':scope > dt, :scope > dd');
  let open = false;

  items.forEach(item => {
    const tag = item.tagName.toLowerCase();
    if (tag === 'dt') {
      if (open) xml += '  </def-item>\n';
      open = true;
      xml += '  <def-item>\n';
      xml += `    <term>${escapeXml(cleanText(item.textContent))}</term>\n`;
    } else if (tag === 'dd') {
      let def = '';
      for (const node of item.childNodes) {
        if (node.nodeType === 3) def += escapeXml(cleanText(node.textContent));
        else if (node.nodeType === 1) {
          if (node.tagName.toLowerCase() === 'p') {
            let p = '';
            for (const n of node.childNodes) p += processInlineContent(n, footnotesMap);
            def += p;
          } else {
            def += processInlineContent(node, footnotesMap);
          }
        }
      }
      xml += `    <def><p>${def.trim()}</p></def>\n`;
    }
  });
  if (open) xml += '  </def-item>\n';
  xml += '</def-list>';
  return xml;
}

// ─── CONVERSIÓN DE TABLAS ───────────────────────────────────────────────────

function convertTableElement(tableElement, extraCaption = '', extraNotes = '', footnotesMap = {}) {
  if (!tableElement || tableElement.tagName.toLowerCase() !== 'table') return '';

  let tableId = tableElement.id || tableElement.closest('[id]')?.id || '';
  let label = 'Table';
  let captionText = '';

  // Caption desde <caption> dentro de la tabla
  const captionEl = tableElement.querySelector('caption');
  if (captionEl) {
    captionText = cleanText(captionEl.textContent);
  }

  // Caption externa
  if (extraCaption) {
    captionText = extraCaption;
  }

  // Extraer label
  if (captionText) {
    const labelMatch = captionText.match(/^(Tabla\s*[\w\d.]*|Table\s*[\w\d.]*)/i);
    if (labelMatch) {
      label = labelMatch[1];
      captionText = captionText.substring(label.length).replace(/^[:\s.-]+/, '').trim();
    }
  }

  let xml = `<table-wrap${tableId ? ` id="${escapeXml(tableId)}"` : ''}>\n`;
  xml += `  <label>${escapeXml(label)}</label>\n`;

  if (captionText) {
    xml += `  <caption><p>${escapeXml(captionText)}</p></caption>\n`;
  }

  // Alt text
  const alt = tableElement.querySelector('.table-alt, .alt-text, [data-alt]');
  if (alt) {
    xml += `  <alt-text>${escapeXml(cleanText(alt.textContent || alt.getAttribute('data-alt')))}</alt-text>\n`;
  }

  // Tabla
  xml += '  <table frame="hsides" rules="groups">\n';

  // thead
  const thead = tableElement.querySelector('thead');
  if (thead) {
    xml += '    <thead>\n';
    thead.querySelectorAll('tr').forEach(row => {
      xml += '      <tr>\n';
      row.querySelectorAll('th, td').forEach(cell => {
        const colspan = cell.getAttribute('colspan');
        const rowspan = cell.getAttribute('rowspan');
        const align = cell.getAttribute('align') || cell.style?.textAlign || '';
        let attrs = '';
        if (colspan) attrs += ` colspan="${colspan}"`;
        if (rowspan) attrs += ` rowspan="${rowspan}"`;
        if (align) attrs += ` align="${align}"`;
        xml += `        <th${attrs}>${escapeXml(cleanText(cell.textContent))}</th>\n`;
      });
      xml += '      </tr>\n';
    });
    xml += '    </thead>\n';
  }

  // tbody
  const tbodies = tableElement.querySelectorAll('tbody');
  if (tbodies.length > 0) {
    tbodies.forEach(tbody => {
      xml += '    <tbody>\n';
      tbody.querySelectorAll('tr').forEach(row => {
        xml += '      <tr>\n';
        row.querySelectorAll('td, th').forEach(cell => {
          const colspan = cell.getAttribute('colspan');
          const rowspan = cell.getAttribute('rowspan');
          const align = cell.getAttribute('align') || cell.style?.textAlign || '';
          let attrs = '';
          if (colspan) attrs += ` colspan="${colspan}"`;
          if (rowspan) attrs += ` rowspan="${rowspan}"`;
          if (align) attrs += ` align="${align}"`;

          let cellContent = '';
          for (const n of cell.childNodes) cellContent += processInlineContent(n, footnotesMap);
          xml += `        <td${attrs}>${cellContent || escapeXml(cleanText(cell.textContent))}</td>\n`;
        });
        xml += '      </tr>\n';
      });
      xml += '    </tbody>\n';
    });
  } else {
    // Si no hay tbody, tomar filas directas
    xml += '    <tbody>\n';
    tableElement.querySelectorAll(':scope > tr').forEach(row => {
      xml += '      <tr>\n';
      row.querySelectorAll('td, th').forEach(cell => {
        let cellContent = '';
        for (const n of cell.childNodes) cellContent += processInlineContent(n, footnotesMap);
        xml += `        <td>${cellContent || escapeXml(cleanText(cell.textContent))}</td>\n`;
      });
      xml += '      </tr>\n';
    });
    xml += '    </tbody>\n';
  }

  // tfoot
  const tfoot = tableElement.querySelector('tfoot');
  if (tfoot) {
    xml += '    <tfoot>\n';
    tfoot.querySelectorAll('tr').forEach(row => {
      xml += '      <tr>\n';
      row.querySelectorAll('td, th').forEach(cell => {
        xml += `        <td>${escapeXml(cleanText(cell.textContent))}</td>\n`;
      });
      xml += '      </tr>\n';
    });
    xml += '    </tfoot>\n';
  }

  xml += '  </table>\n';

  // Notas de la tabla
  if (extraNotes) {
    xml += '  <table-wrap-foot>\n';
    xml += `    <fn><p>${escapeXml(extraNotes)}</p></fn>\n`;
    xml += '  </table-wrap-foot>\n';
  }

  const internalNotes = tableElement.querySelector('.table-notes, .table-footnote, .notes');
  if (internalNotes) {
    xml += '  <table-wrap-foot>\n';
    internalNotes.querySelectorAll('p, li, .note-item').forEach(note => {
      xml += `    <fn><p>${escapeXml(cleanText(note.textContent))}</p></fn>\n`;
    });
    xml += '  </table-wrap-foot>\n';
  }

  xml += '</table-wrap>';
  return xml;
}

// ─── CONVERSIÓN DE FIGURAS ──────────────────────────────────────────────────

function convertFigureElement(figureElement, footnotesMap = {}) {
  if (!figureElement) return '';

  const img = figureElement.querySelector('img');
  const table = figureElement.querySelector('table');
  const figcaption = figureElement.querySelector('figcaption, .fig-caption, .image-caption, .caption');

  // Si tiene tabla → tratar como table-wrap
  if (table && !img) {
    const captionText = figcaption ? cleanText(figcaption.textContent) : '';
    return convertTableElement(table, captionText, '', footnotesMap);
  }

  // Figura de imagen
  if (img) {
    const figId = figureElement.id || '';
    const imgSrc = img.getAttribute('src') || '';
    const imgAlt = img.getAttribute('alt') || '';
    let captionText = figcaption ? cleanText(figcaption.textContent) : '';

    let label = 'Figure';
    if (captionText) {
      const m = captionText.match(/^(Figura?\s*[\w\d.]*|Figure\s*[\w\d.]*)/i);
      if (m) {
        label = m[1];
        captionText = captionText.substring(label.length).replace(/^[:\s.-]+/, '').trim();
      }
    }

    let xml = `<fig${figId ? ` id="${escapeXml(figId)}"` : ''}>\n`;
    xml += `  <label>${escapeXml(label)}</label>\n`;
    if (captionText) {
      xml += `  <caption><p>${escapeXml(captionText)}</p></caption>\n`;
    }
    if (imgAlt) {
      xml += `  <alt-text>${escapeXml(imgAlt)}</alt-text>\n`;
    }
    if (imgSrc) {
      let mime = 'image/jpeg';
      if (imgSrc.endsWith('.png')) mime = 'image/png';
      else if (imgSrc.endsWith('.gif')) mime = 'image/gif';
      else if (imgSrc.endsWith('.svg')) mime = 'image/svg+xml';
      else if (imgSrc.endsWith('.webp')) mime = 'image/webp';
      xml += `  <graphic xlink:href="${escapeXml(imgSrc)}" mimetype="${mime}"/>\n`;
    }
    xml += '</fig>';
    return xml;
  }

  return '';
}

// ─── CONVERSIÓN DE CÓDIGO ───────────────────────────────────────────────────

function convertCodeBlock(element) {
  const pre = element.tagName.toLowerCase() === 'pre' ? element : element.querySelector('pre');
  if (!pre) return '';

  const code = pre.querySelector('code') || pre;
  const language = element.querySelector('.code-language, .code-label, [data-lang]');
  const caption = element.querySelector('.code-caption, figcaption');
  const codeId = element.id || '';

  let xml = `<disp-quote${codeId ? ` id="${escapeXml(codeId)}"` : ''}>\n`;
  if (caption) xml += `  <label>${escapeXml(cleanText(caption.textContent))}</label>\n`;
  if (language) xml += `  <attrib>${escapeXml(cleanText(language.textContent || language.getAttribute('data-lang')))}</attrib>\n`;
  xml += `  <preformat>${escapeXml(code.textContent || '')}</preformat>\n`;
  xml += `</disp-quote>`;
  return xml;
}

// ─── RECORRIDO PRINCIPAL DEL CONTENIDO ───────────────────────────────────────

function convertContentSection(contentRoot, footnotesMap = {}, initialLevel = 0) {
  let bodyXml = '';
  let sectionStack = [];
  let secCounter = 0;

  function getIndent() {
    return '  '.repeat(sectionStack.length + 1);
  }

  function closeSections(level) {
    let closed = '';
    while (sectionStack.length > 0 && sectionStack[sectionStack.length - 1].level >= level) {
      sectionStack.pop();
      const indent = '  '.repeat(sectionStack.length + 1);
      closed += `${indent}</sec>\n`;
    }
    return closed;
  }

  function ensureSection() {
    if (sectionStack.length === 0) {
      secCounter++;
      const secId = `sec${secCounter}`;
      bodyXml += `  <sec id="${secId}">\n`;
      bodyXml += `    <title></title>\n`;
      sectionStack.push({ id: secId, level: 1 + initialLevel });
    }
  }

  const children = Array.from(contentRoot.childNodes);

  for (let i = 0; i < children.length; i++) {
    const child = children[i];

    if (child.nodeType === 3) {
      const text = cleanText(child.textContent || '');
      if (!text) continue;
      if (sectionStack.length > 0) {
        bodyXml += getIndent() + `<p>${escapeXml(text)}</p>\n`;
      }
      continue;
    }

    if (child.nodeType !== 1) continue;

    const tagName = child.tagName.toLowerCase();
    const classList = child.classList || { contains: () => false };

    if (['script', 'style', 'hr'].includes(tagName)) continue;
    if (classList.contains('footnotes') || classList.contains('references') || classList.contains('reference-list')) continue;

    // Headings → sections
    if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tagName)) {
      const level = parseInt(tagName.charAt(1)) + initialLevel;
      const actualLevel = Math.min(level, 6);
      bodyXml += closeSections(actualLevel);

      secCounter++;
      const title = cleanText(child.textContent);
      const secId = generateSlugId('sec', title, secCounter);
      const indent = getIndent();

      bodyXml += `${indent}<sec id="${secId}">\n`;
      bodyXml += `${indent}  <title>${escapeXml(title)}</title>\n`;
      sectionStack.push({ id: secId, level: actualLevel });
      continue;
    }

    // Tablas (casos variables)
    if (tagName === 'div' && (classList.contains('table-responsive') || classList.contains('table-wrapper') || classList.contains('table-container'))) {
      ensureSection();
      const table = child.querySelector('table');
      if (table) {
        let extraNotes = '';
        const nextSibling = child.nextElementSibling;
        if (nextSibling && nextSibling.tagName.toLowerCase() === 'p') {
          const noteText = cleanText(nextSibling.textContent);
          if (/fuente|source|nota|note/i.test(noteText) || nextSibling.querySelector('small, em, i')) {
            extraNotes = noteText;
            nextSibling.setAttribute('data-jats-processed', 'true');
          }
        }
        const internalNote = child.querySelector('p, .table-note, .source');
        if (internalNote && !extraNotes) {
          extraNotes = cleanText(internalNote.textContent);
        }

        bodyXml += getIndent() + convertTableElement(table, '', extraNotes, footnotesMap) + '\n';
      }
      continue;
    }

    // Tabla suelta
    if (tagName === 'table' && !child.closest('figure') && !child.closest('.table-responsive')) {
      ensureSection();
      let extraNotes = '';
      const next = child.nextElementSibling;
      if (next && next.tagName.toLowerCase() === 'p') {
        const noteText = cleanText(next.textContent);
        if (/fuente|source|nota|note/i.test(noteText)) {
          extraNotes = noteText;
          next.setAttribute('data-jats-processed', 'true');
        }
      }
      bodyXml += getIndent() + convertTableElement(child, '', extraNotes, footnotesMap) + '\n';
      continue;
    }

    // Figuras
    if (tagName === 'figure' || classList.contains('floating-figure') || classList.contains('image-figure') || classList.contains('figure')) {
      ensureSection();
      bodyXml += getIndent() + convertFigureElement(child, footnotesMap) + '\n';
      continue;
    }

    // Código
    if (tagName === 'pre' || (tagName === 'div' && (classList.contains('code-block') || classList.contains('code-block-wrapper') || classList.contains('highlight')))) {
      ensureSection();
      bodyXml += getIndent() + convertCodeBlock(child) + '\n';
      continue;
    }

    // Párrafos
    if (tagName === 'p') {
      if (child.getAttribute('data-jats-processed') === 'true') continue;
      ensureSection();
      const p = convertParagraph(child, footnotesMap);
      if (p) bodyXml += getIndent() + p + '\n';
      continue;
    }

    // Listas
    if (tagName === 'ol' || tagName === 'ul') {
      ensureSection();
      const listType = tagName === 'ol' ? 'order' : 'bullet';
      bodyXml += getIndent() + convertList(child, listType, footnotesMap) + '\n';
      continue;
    }

    if (tagName === 'dl') {
      ensureSection();
      bodyXml += getIndent() + convertDefinitionList(child, footnotesMap) + '\n';
      continue;
    }

    if (tagName === 'blockquote') {
      ensureSection();
      bodyXml += getIndent() + convertBlockquote(child, footnotesMap) + '\n';
      continue;
    }

    // DIV/SECTION genéricos
    if ((tagName === 'div' || tagName === 'section') &&
        !classList.contains('footnotes') &&
        !classList.contains('references') &&
        !classList.contains('table-responsive')) {
      bodyXml += convertContentSection(child, footnotesMap, sectionStack.length);
      continue;
    }

    // Fallback recursivo
    if (child.children && child.children.length > 0) {
      bodyXml += convertContentSection(child, footnotesMap, sectionStack.length);
    }
  }

  bodyXml += closeSections(0);
  return bodyXml;
}

// ─── REFERENCIAS ─────────────────────────────────────────────────────────────

function parseReferencesFromHtml(referencesHtml) {
  if (!referencesHtml) return [];
  const dom = new JSDOM(referencesHtml);
  const doc = dom.window.document;
  const refItems = doc.querySelectorAll('.reference-item, li, .ref-item');
  const refs = [];

  refItems.forEach((item, index) => {
    const refId = item.id || `ref${index + 1}`;
    const fullText = cleanText(item.textContent);
    const links = item.querySelectorAll('a');

    let authors = '', year = '', title = '', source = '', url = '', doi = '';

    links.forEach(link => {
      const href = link.getAttribute('href') || '';
      if (href.includes('doi.org')) {
        doi = href.replace(/https?:\/\/(dx\.)?doi\.org\//i, '');
      } else if (!url && href.startsWith('http')) {
        url = href;
      }
    });

    const authorMatch = fullText.match(/^([^.]+)\./);
    if (authorMatch) authors = cleanText(authorMatch[1]);

    const yearMatch = fullText.match(/\((\d{4})\)|\.\s*(\d{4})[.,]/);
    if (yearMatch) year = yearMatch[1] || yearMatch[2];

    const titleMatch = fullText.match(/[«“"]([^»”"]+)[»”"]|'([^']+)'/);
    if (titleMatch) title = titleMatch[1] || titleMatch[2];

    const sourceMatch = fullText.match(/(?:\d{4}[.,])\s*(.*?)(?:https?:\/\/|$)/);
    if (sourceMatch && sourceMatch[1]) source = cleanText(sourceMatch[1]);

    refs.push({ id: refId, authors, year, title, source, url, doi, fullText });
  });

  return refs;
}

// ─── CONSTRUCCIÓN DEL JATS COMPLETO ─────────────────────────────────────────

function buildJatsXml(article) {
  // Extracción de campos
  const articleTitle = article.titulo || '';
  const articleTitleEn = article.tituloEnglish || '';
  const doi = article.doi || '';
  const pubDate = article.fecha || '';
  const volume = article.volumen || '';
  const issue = article.numero || '';
  const fpage = article.primeraPagina || '';
  const lpage = article.ultimaPagina || '';
  const pdfUrl = article.pdfUrl || '';
  const abstractEs = cleanText(article.resumen || '');
  const abstractEn = cleanText(article.abstract || '');
  const keywordsEs = Array.isArray(article.palabras_clave) ? article.palabras_clave : [];
  const keywordsEn = Array.isArray(article.keywords_english) ? article.keywords_english : [];
  const area = article.area || '';
  const articleType = article.type || article.tipo || 'original-research';
  const receivedDate = article.receivedDate || '';
  const acceptedDate = article.acceptedDate || '';
  const conflictsEs = cleanText(article.conflicts || '');
  const conflictsEn = cleanText(article.conflictsEnglish || '');
  const fundingEs = cleanText(article.funding || '');
  const fundingEn = cleanText(article.fundingEnglish || '');
  const acknowledgmentsEs = cleanText(article.acknowledgments || '');
  const acknowledgmentsEn = cleanText(article.acknowledgmentsEnglish || '');
  const authorCredits = cleanText(article.authorCredits || '');
  const authorCreditsEn = cleanText(article.authorCreditsEnglish || '');
  const dataAvailability = cleanText(article.dataAvailability || '');
  const dataAvailabilityEn = cleanText(article.dataAvailabilityEnglish || '');
  const autores = Array.isArray(article.autores) ? article.autores : [];
  const htmlContent = article.html_es || '';
  const htmlContentEn = article.html_en || '';
  const referenciasHtml = article.referencias || '';
  const submissionId = article.submissionId || '';
  const specializedCodes = Array.isArray(article.specialized_codes) ? article.specialized_codes : [];

  // Detectar tipo de artículo
  const articleTypeInfo = detectArticleType(articleType, articleTitle);
  const jatsArticleType = articleTypeInfo.jats;

  const pubDateParsed = parseDate(pubDate);
  const receivedDateParsed = parseDate(receivedDate);
  const acceptedDateParsed = parseDate(acceptedDate);

  // Body (Español)
  let bodyXml = '<body>\n';
  let footnotesXml = '';
  let footnotesMap = {};

  if (htmlContent) {
    const dom = new JSDOM(htmlContent);
    const doc = dom.window.document;
    let contentRoot = doc.body || doc.documentElement;

    const footnoteSection = contentRoot.querySelector('.footnotes');
    if (footnoteSection) {
      const items = footnoteSection.querySelectorAll(':scope > ol > li, :scope > .footnote-item, li');
      items.forEach((li, index) => {
        const fnId = li.id || `fn${index + 1}`;
        const clone = li.cloneNode(true);
        const back = clone.querySelector('a[href^="#fn"], a[rev="footnote"]');
        if (back) back.remove();
        footnotesMap[fnId] = cleanText(clone.textContent || '');
      });
      footnoteSection.remove();
    }

    bodyXml += convertContentSection(contentRoot, footnotesMap);
    bodyXml += '</body>';

    if (Object.keys(footnotesMap).length > 0) {
      footnotesXml = '<fn-group>\n';
      for (const [id, content] of Object.entries(footnotesMap)) {
        footnotesXml += `  <fn id="${escapeXml(id)}">\n    <p>${escapeXml(content)}</p>\n  </fn>\n`;
      }
      footnotesXml += '</fn-group>\n';
    }
  } else {
    bodyXml += '</body>';
  }

  // Body (Inglés)
  let hasEnglishBody = false;
  let bodyEnXml = '';
  if (htmlContentEn && cleanText(htmlContentEn.replace(/<[^>]*>/g, '')).length > 80) {
    hasEnglishBody = true;
    const domEn = new JSDOM(htmlContentEn);
    const docEn = domEn.window.document;
    const rootEn = docEn.body || docEn.documentElement;
    bodyEnXml = '<body xml:lang="en">\n';
    bodyEnXml += convertContentSection(rootEn, {});
    bodyEnXml += '</body>';
  }

  const references = parseReferencesFromHtml(referenciasHtml);
  const isMultilingual = !!(articleTitleEn || abstractEn || keywordsEn.length || hasEnglishBody);

  // Construcción XML
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += `<!DOCTYPE article PUBLIC "${JATS_DTD_PUBLIC}" "${JATS_DTD_SYSTEM}">\n`;

  xml += `<article dtd-version="${JATS_VERSION}" article-type="${jatsArticleType}"`;
  xml += isMultilingual ? ' xml:lang="mul"' : ' xml:lang="es"';
  xml += '\n  xmlns:mml="http://www.w3.org/1998/Math/MathML"';
  xml += '\n  xmlns:xlink="http://www.w3.org/1999/xlink">\n';

  if (isMultilingual) {
    xml += '  <processing-meta lang-grouping="yes"/>\n';
  }

  xml += '<front>\n';

  // journal-meta
  xml += '  <journal-meta>\n';
  xml += `    <journal-id journal-id-type="publisher-id">${JOURNAL_ID}</journal-id>\n`;
  xml += '    <journal-title-group>\n';
  xml += `      <journal-title>${escapeXml(JOURNAL_NAME)}</journal-title>\n`;
  xml += `      <abbrev-journal-title abbrev-type="publisher">${escapeXml(JOURNAL_ABBREV)}</abbrev-journal-title>\n`;
  xml += '    </journal-title-group>\n';
  xml += `    <issn publication-format="electronic">${JOURNAL_ISSN}</issn>\n`;
  xml += '    <publisher>\n';
  xml += `      <publisher-name>${escapeXml(PUBLISHER_NAME)}</publisher-name>\n`;
  xml += '    </publisher>\n';
  xml += '  </journal-meta>\n';

  // article-meta
  xml += '  <article-meta>\n';

  if (doi) xml += `    <article-id pub-id-type="doi">${escapeXml(doi)}</article-id>\n`;
  if (submissionId) xml += `    <article-id pub-id-type="publisher-id">${escapeXml(submissionId)}</article-id>\n`;

  xml += '    <content-language>es</content-language>\n';
  if (isMultilingual) xml += '    <content-language>en</content-language>\n';

  if (area || specializedCodes.length) {
    xml += '    <article-categories>\n';
    xml += '      <subj-group subj-group-type="heading">\n';
    if (area) xml += `        <subject>${escapeXml(area)}</subject>\n`;
    specializedCodes.forEach(code => { 
      if (code) xml += `        <subject>${escapeXml(code)}</subject>\n`; 
    });
    xml += '      </subj-group>\n';
    xml += '    </article-categories>\n';
  }

  // title-group
  xml += '    <title-group xml:lang="es">\n';
  xml += `      <article-title>${escapeXml(articleTitle)}</article-title>\n`;
  xml += '    </title-group>\n';
  if (articleTitleEn) {
    xml += '    <title-group xml:lang="en">\n';
    xml += `      <article-title>${escapeXml(articleTitleEn)}</article-title>\n`;
    xml += '    </title-group>\n';
  }

  // contrib-group
  if (autores.length > 0) {
    xml += '    <contrib-group>\n';
    const uniqueInstitutions = [];
    const instMap = {};

    autores.forEach((autor, index) => {
      const authorId = `author-${index + 1}`;
      const name = cleanText(autor.name || '');
      const parts = name.split(/\s+/).filter(Boolean);
      let givenNames = '', surname = '';
      
      if (parts.length === 1) surname = parts[0];
      else if (parts.length === 2) { 
        givenNames = parts[0]; 
        surname = parts[1]; 
      }
      else { 
        surname = parts[parts.length - 1]; 
        givenNames = parts.slice(0, -1).join(' '); 
      }

      const isCorresp = autor.isCorresponding === true || autor.isCorresponding === 'true';

      xml += `      <contrib contrib-type="author" id="${authorId}"${isCorresp ? ' corresp="yes"' : ''}>\n`;
      
      if (autor.orcid) {
        xml += `        <contrib-id contrib-id-type="orcid" authenticated="true">${escapeXml(normalizeOrcid(autor.orcid))}</contrib-id>\n`;
      }
      if (autor.authorId) {
        xml += `        <contrib-id contrib-id-type="publisher-id">${escapeXml(autor.authorId)}</contrib-id>\n`;
      }
      
      xml += '        <name name-style="western">\n';
      xml += `          <surname>${escapeXml(surname)}</surname>\n`;
      if (givenNames) xml += `          <given-names>${escapeXml(givenNames)}</given-names>\n`;
      xml += '        </name>\n';
      
      if (autor.email) xml += `        <email>${escapeXml(autor.email)}</email>\n`;
      
      if (autor.institution) {
        const instName = cleanText(autor.institution);
        if (!instMap[instName]) {
          const affId = `aff${uniqueInstitutions.length + 1}`;
          uniqueInstitutions.push({ id: affId, name: instName });
          instMap[instName] = affId;
        }
        xml += `        <xref ref-type="aff" rid="${instMap[instName]}"/>\n`;
      }
      
      if (isCorresp) xml += '        <xref ref-type="corresp" rid="cor1"/>\n';
      xml += '      </contrib>\n';
    });

    uniqueInstitutions.forEach(aff => {
      xml += `      <aff id="${aff.id}"><institution>${escapeXml(aff.name)}</institution></aff>\n`;
    });
    xml += '    </contrib-group>\n';
  }

  // author-notes
  const hasConflicts = conflictsEs || conflictsEn;
  const hasCorresp = autores.some(a => a.isCorresponding === true || a.isCorresponding === 'true');
  if (hasConflicts || hasCorresp) {
    xml += '    <author-notes>\n';
    if (hasCorresp) {
      const corr = autores.find(a => a.isCorresponding === true || a.isCorresponding === 'true');
      if (corr?.email) xml += `      <corresp id="cor1">Correspondence: <email>${escapeXml(corr.email)}</email></corresp>\n`;
    }
    if (conflictsEs) xml += `      <fn fn-type="COI-statement" xml:lang="es"><p>${escapeXml(conflictsEs)}</p></fn>\n`;
    if (conflictsEn && conflictsEn !== conflictsEs) {
      xml += `      <fn fn-type="COI-statement" xml:lang="en"><p>${escapeXml(conflictsEn)}</p></fn>\n`;
    }
    xml += '    </author-notes>\n';
  }

  // pub-date
  xml += '    <pub-date publication-format="electronic" date-type="pub"';
  if (pubDateParsed.iso) xml += ` iso-8601-date="${pubDateParsed.iso}"`;
  xml += '>\n';
  if (pubDateParsed.day) xml += `      <day>${pubDateParsed.day}</day>\n`;
  if (pubDateParsed.month) xml += `      <month>${pubDateParsed.month}</month>\n`;
  if (pubDateParsed.year) xml += `      <year>${pubDateParsed.year}</year>\n`;
  xml += '    </pub-date>\n';

  if (volume) xml += `    <volume>${escapeXml(volume)}</volume>\n`;
  if (issue) xml += `    <issue>${escapeXml(issue)}</issue>\n`;
  if (fpage) xml += `    <fpage>${escapeXml(fpage)}</fpage>\n`;
  if (lpage) xml += `    <lpage>${escapeXml(lpage)}</lpage>\n`;

  // history
  if (receivedDate || acceptedDate) {
    xml += '    <history>\n';
    if (receivedDate && receivedDateParsed.iso) {
      xml += `      <date date-type="received" iso-8601-date="${receivedDateParsed.iso}">\n`;
      if (receivedDateParsed.day) xml += `        <day>${receivedDateParsed.day}</day>\n`;
      if (receivedDateParsed.month) xml += `        <month>${receivedDateParsed.month}</month>\n`;
      if (receivedDateParsed.year) xml += `        <year>${receivedDateParsed.year}</year>\n`;
      xml += '      </date>\n';
    }
    if (acceptedDate && acceptedDateParsed.iso) {
      xml += `      <date date-type="accepted" iso-8601-date="${acceptedDateParsed.iso}">\n`;
      if (acceptedDateParsed.day) xml += `        <day>${acceptedDateParsed.day}</day>\n`;
      if (acceptedDateParsed.month) xml += `        <month>${acceptedDateParsed.month}</month>\n`;
      if (acceptedDateParsed.year) xml += `        <year>${acceptedDateParsed.year}</year>\n`;
      xml += '      </date>\n';
    }
    xml += '    </history>\n';
  }

  // permissions
  xml += '    <permissions>\n';
  xml += `      <license license-type="open-access" xlink:href="${LICENSE_URL}">\n`;
  xml += `        <license-p>${escapeXml(LICENSE_TEXT)}</license-p>\n`;
  xml += '      </license>\n';
  xml += '    </permissions>\n';

  if (pdfUrl) xml += `    <self-uri content-type="pdf" xlink:href="${escapeXml(pdfUrl)}"/>\n`;

  // abstracts
  if (abstractEs) {
    xml += '    <abstract xml:lang="es">\n      <title>Resumen</title>\n';
    xml += `      <p>${escapeXml(abstractEs)}</p>\n    </abstract>\n`;
  }
  if (abstractEn) {
    xml += '    <abstract xml:lang="en">\n      <title>Abstract</title>\n';
    xml += `      <p>${escapeXml(abstractEn)}</p>\n    </abstract>\n`;
  }

  // keywords
  if (keywordsEs.length) {
    xml += '    <kwd-group xml:lang="es" kwd-group-type="author">\n      <title>Palabras clave</title>\n';
    keywordsEs.forEach(kwd => { 
      const c = cleanText(kwd); 
      if (c) xml += `      <kwd>${escapeXml(c)}</kwd>\n`; 
    });
    xml += '    </kwd-group>\n';
  }
  if (keywordsEn.length) {
    xml += '    <kwd-group xml:lang="en" kwd-group-type="author">\n      <title>Keywords</title>\n';
    keywordsEn.forEach(kwd => { 
      const c = cleanText(kwd); 
      if (c) xml += `      <kwd>${escapeXml(c)}</kwd>\n`; 
    });
    xml += '    </kwd-group>\n';
  }

  // funding
  if (fundingEs || fundingEn) {
    xml += '    <funding-group>\n      <award-group>\n';
    if (fundingEs) xml += `        <funding-source xml:lang="es">${escapeXml(fundingEs)}</funding-source>\n`;
    if (fundingEn && fundingEn !== fundingEs) xml += `        <funding-source xml:lang="en">${escapeXml(fundingEn)}</funding-source>\n`;
    xml += '      </award-group>\n    </funding-group>\n';
  }

  xml += '  </article-meta>\n</front>\n';

  // Body
  xml += bodyXml + '\n';
  if (hasEnglishBody) xml += bodyEnXml + '\n';

  // Back
  xml += '<back>\n';

  if (acknowledgmentsEs || acknowledgmentsEn) {
    xml += '  <ack>\n    <title>Agradecimientos</title>\n';
    if (acknowledgmentsEs) xml += `    <p xml:lang="es">${escapeXml(acknowledgmentsEs)}</p>\n`;
    if (acknowledgmentsEn && acknowledgmentsEn !== acknowledgmentsEs) xml += `    <p xml:lang="en">${escapeXml(acknowledgmentsEn)}</p>\n`;
    xml += '  </ack>\n';
  }

  if (authorCredits || authorCreditsEn) {
    xml += '  <ack>\n    <title>Contribución de los autores</title>\n';
    if (authorCredits) xml += `    <p xml:lang="es">${escapeXml(authorCredits)}</p>\n`;
    if (authorCreditsEn && authorCreditsEn !== authorCredits) xml += `    <p xml:lang="en">${escapeXml(authorCreditsEn)}</p>\n`;
    xml += '  </ack>\n';
  }

  if (dataAvailability || dataAvailabilityEn) {
    xml += '  <ack>\n    <title>Disponibilidad de datos</title>\n';
    if (dataAvailability) xml += `    <p xml:lang="es">${escapeXml(dataAvailability)}</p>\n`;
    if (dataAvailabilityEn && dataAvailabilityEn !== dataAvailability) xml += `    <p xml:lang="en">${escapeXml(dataAvailabilityEn)}</p>\n`;
    xml += '  </ack>\n';
  }

  if (footnotesXml) xml += '  ' + footnotesXml.trim() + '\n';

  // References
  if (references.length > 0) {
    xml += '  <ref-list>\n    <title>Referencias</title>\n';
    references.forEach(ref => {
      xml += `    <ref id="${escapeXml(ref.id)}">\n`;
      xml += '      <mixed-citation publication-type="journal">';
      if (ref.authors) xml += escapeXml(ref.authors);
      if (ref.year) xml += ` (${ref.year})`;
      if (ref.title) xml += `. <article-title>${escapeXml(ref.title)}</article-title>`;
      if (ref.source) xml += `. <source>${escapeXml(ref.source)}</source>`;
      if (ref.doi) xml += `. <pub-id pub-id-type="doi">${escapeXml(ref.doi)}</pub-id>`;
      else if (ref.url) xml += `. <ext-link ext-link-type="uri" xlink:href="${escapeXml(ref.url)}">${escapeXml(ref.url)}</ext-link>`;
      if (!ref.authors && !ref.year && !ref.title) xml += escapeXml(ref.fullText);
      xml += '</mixed-citation>\n    </ref>\n';
    });
    xml += '  </ref-list>\n';
  }

  xml += '</back>\n</article>';
  return xml;
}

// ─── PROCESAMIENTO PRINCIPAL ─────────────────────────────────────────────────

function processArticle(article, index) {
  const title = article.titulo || `Artículo ${index + 1}`;
  console.log(`\n[${index + 1}] Procesando: "${title.substring(0, 70)}${title.length > 70 ? '...' : ''}"`);
  
  try {
    const jatsXml = buildJatsXml(article);
    article.jats = jatsXml;
    console.log(`  ✓ JATS generado (${jatsXml.length.toLocaleString()} caracteres)`);
    
    // Validación básica
    if (jatsXml.length < 500) {
      console.warn('  ⚠ Advertencia: JATS parece demasiado corto');
    }
    
    return { success: true, article };
  } catch (error) {
    console.error(`  ✗ Error: ${error.message}`);
    console.error(error.stack);
    return { success: false, article, error: error.message };
  }
}

function main() {
  console.log('══════════════════════════════════════════════════════════════════');
  console.log('  Conversor articles.json → JATS XML v5.0 (Versión Final)');
  console.log('  Soporte para 6 tipos de artículos académicos');
  console.log('  Cumplimiento JATS 1.4 + Multi-language + Robusto');
  console.log('══════════════════════════════════════════════════════════════════\n');

  if (!fs.existsSync(INPUT_FILE)) {
    console.error(`Error: No existe ${INPUT_FILE}`);
    process.exit(1);
  }

  // Crear backup
  console.log('Creando backup de seguridad...');
  fs.copyFileSync(INPUT_FILE, BACKUP_FILE);

  // Leer JSON
  console.log(`Leyendo ${INPUT_FILE}...`);
  let articles;
  try {
    articles = JSON.parse(fs.readFileSync(INPUT_FILE, 'utf-8'));
  } catch (e) {
    console.error(`Error al parsear JSON: ${e.message}`);
    process.exit(1);
  }

  // Normalizar a array
  if (!Array.isArray(articles)) {
    if (articles.titulo || articles.title || articles.doi) {
      articles = [articles];
    } else {
      const keys = ['articles', 'articulos', 'data', 'items'];
      let found = false;
      for (const k of keys) {
        if (articles[k] && Array.isArray(articles[k])) {
          articles = articles[k];
          found = true;
          break;
        }
      }
      if (!found) {
        console.error('JSON no válido. Debe contener un array de artículos.');
        process.exit(1);
      }
    }
  }

  console.log(`Encontrados ${articles.length} artículo(s).\n`);

  // Procesar
  let successCount = 0;
  let errorCount = 0;
  const errors = [];

  articles.forEach((article, index) => {
    const result = processArticle(article, index);
    if (result.success) {
      successCount++;
    } else {
      errorCount++;
      errors.push({ index: index + 1, title: article.titulo, error: result.error });
    }
  });

  // Guardar
  console.log('\nGuardando archivo actualizado...');
  const originalData = JSON.parse(fs.readFileSync(INPUT_FILE, 'utf-8'));

  if (Array.isArray(originalData)) {
    articles.forEach((a, i) => {
      if (originalData[i]) originalData[i].jats = a.jats;
    });
  } else if (originalData.titulo || originalData.doi) {
    originalData.jats = articles[0].jats;
  } else {
    for (const k of ['articles', 'articulos', 'data', 'items']) {
      if (originalData[k] && Array.isArray(originalData[k])) {
        articles.forEach((a, i) => {
          if (originalData[k][i]) originalData[k][i].jats = a.jats;
        });
        break;
      }
    }
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(originalData, null, 2), 'utf-8');

  // Resumen final
  console.log('\n══════════════════════════════════════════════════════════════════');
  console.log('  RESUMEN FINAL');
  console.log('══════════════════════════════════════════════════════════════════');
  console.log(`  Total procesados : ${articles.length}`);
  console.log(`  Exitosos         : ${successCount}`);
  console.log(`  Con errores      : ${errorCount}`);
  console.log(`  Archivo          : ${OUTPUT_FILE}`);
  console.log(`  Backup           : ${BACKUP_FILE}`);
  
  if (errors.length > 0) {
    console.log('\n  Errores detallados:');
    errors.forEach(e => {
      console.log(`    - Artículo ${e.index}: ${e.title}`);
      console.log(`      Error: ${e.error}`);
    });
  }
  
  console.log('══════════════════════════════════════════════════════════════════\n');

  // Mostrar ejemplo
  if (successCount > 0) {
    const ex = articles.find(a => a.jats);
    if (ex) {
      console.log('Ejemplo del JATS generado (primeros 800 caracteres):');
      console.log('────────────────────────────────────────────────────────────');
      console.log(ex.jats.substring(0, 800) + '...\n');
    }
  }
}

// ─── EJECUCIÓN ────────────────────────────────────────────────────────────────
main();
