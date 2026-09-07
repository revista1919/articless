/**
 * Conversor de articles.json a JATS XML (v9.0 FINAL)
 * 
 * CORRECCIONES v9.0:
 * ✅ Eliminado import.meta (causaba SyntaxError en CommonJS)
 * ✅ Manejo mejorado de figuras flotantes con imágenes
 * ✅ Captura de atribución y fuente en figcaption
 * ✅ Compatible 100% con Node.js CommonJS
 * ✅ DOMParser nativo sin dependencias externas
 */

// ─── CONFIGURACIÓN ───────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');

const INPUT_FILE = path.join(__dirname, 'articles.json');
const OUTPUT_FILE = path.join(__dirname, 'articles.json');
const BACKUP_FILE = path.join(__dirname, 'articles.backup.json');

// ─── CONSTANTES JATS ────────────────────────────────────────────────────────
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

// ─── TIPOS DE ARTÍCULOS ─────────────────────────────────────────────────────
const ARTICLE_TYPES = {
  'original-research': { es: 'Artículo de Investigación Original', en: 'Original Research Article', jats: 'research-article' },
  'academic-essay': { es: 'Ensayo Académico', en: 'Academic Essay', jats: 'research-article' },
  'reflective-essay': { es: 'Ensayo Reflexivo', en: 'Reflective Essay', jats: 'research-article' },
  'case-report': { es: 'Reporte de Caso', en: 'Case Report', jats: 'case-report' },
  'systematic-review': { es: 'Revisión Sistemática', en: 'Systematic Review', jats: 'review-article' },
  'book-review': { es: 'Reseña de Libro', en: 'Book Review', jats: 'book-review' }
};

// ─── UTILIDADES ─────────────────────────────────────────────────────────────
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
  return { year: parts[0] || '', month: parts[1] || '', day: parts[2] || '', iso: dateStr };
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
  if (o.startsWith('https://orcid.org/')) return o;
  if (o.startsWith('http://orcid.org/')) return o.replace('http://', 'https://');
  if (/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/i.test(o)) {
    return `https://orcid.org/${o}`;
  }
  if (o.startsWith('orcid.org/')) return `https://${o}`;
  return o;
}

function detectArticleType(articleType) {
  if (!articleType) return ARTICLE_TYPES['original-research'];
  const typeLower = String(articleType).toLowerCase();
  
  for (const [key, type] of Object.entries(ARTICLE_TYPES)) {
    if (typeLower.includes(type.es.toLowerCase()) || 
        typeLower.includes(type.en.toLowerCase()) || 
        typeLower.includes(key)) {
      return type;
    }
  }
  
  if (typeLower.includes('investigación') || typeLower.includes('research')) return ARTICLE_TYPES['original-research'];
  if (typeLower.includes('reflex')) return ARTICLE_TYPES['reflective-essay'];
  if (typeLower.includes('ensayo') || typeLower.includes('essay')) return ARTICLE_TYPES['academic-essay'];
  if (typeLower.includes('caso') || typeLower.includes('case')) return ARTICLE_TYPES['case-report'];
  if (typeLower.includes('revisión') || typeLower.includes('review')) {
    if (typeLower.includes('sistemática') || typeLower.includes('systematic')) return ARTICLE_TYPES['systematic-review'];
    if (typeLower.includes('libro') || typeLower.includes('book')) return ARTICLE_TYPES['book-review'];
    return ARTICLE_TYPES['systematic-review'];
  }
  if (typeLower.includes('libro') || typeLower.includes('book')) return ARTICLE_TYPES['book-review'];
  
  return ARTICLE_TYPES['original-research'];
}

// ─── PARSER DOM ─────────────────────────────────────────────────────────────
function createDOM(html) {
  if (!html) return null;
  
  // Usar DOMParser nativo de Node.js 20+
  if (typeof DOMParser !== 'undefined') {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      if (doc && doc.body) return doc;
    } catch (e) {
      // Continuar
    }
  }
  
  // Fallback: usar JSDOM si está disponible
  try {
    const { JSDOM } = require('jsdom');
    const dom = new JSDOM(html);
    return dom.window.document;
  } catch (e) {
    // Continuar
  }
  
  return null;
}

// ─── REFERENCIAS ────────────────────────────────────────────────────────────
function parseReferencesFromHtml(referencesHtml) {
  if (!referencesHtml) return [];
  
  const doc = createDOM(referencesHtml);
  if (!doc) return [];
  
  const refItems = doc.querySelectorAll('.reference-item, .ref-item, li');
  const refs = [];

  refItems.forEach((item, index) => {
    const refId = item.id || `ref${index + 1}`;
    const fullText = cleanText(item.textContent);
    
    let authors = '', year = '', title = '', source = '', url = '', doi = '';
    
    // Extraer enlaces válidos
    const links = item.querySelectorAll('a[href]');
    links.forEach(link => {
      const href = link.getAttribute('href') || '';
      if (href.includes('javascript:')) return;
      
      if (href.includes('doi.org')) {
        doi = href.replace(/https?:\/\/(dx\.)?doi\.org\//i, '');
      } else if (href.startsWith('http')) {
        url = href;
      }
    });
    
    // Parsear año
    const yearMatch = fullText.match(/\((\d{4})\)|\.\s*(\d{4})[.,]|\s(\d{4})[.,]/);
    if (yearMatch) {
      year = yearMatch[1] || yearMatch[2] || yearMatch[3];
    }
    
    // Parsear título
    const titleMatch = fullText.match(/[«"]([^»"]+)[»"]|«([^»]+)»|"([^"]+)"/);
    if (titleMatch) {
      title = cleanText(titleMatch[1] || titleMatch[2] || titleMatch[3]);
    }
    
    // Parsear autores
    let authorsText = fullText;
    if (year) {
      const yearPos = fullText.indexOf(year);
      if (yearPos > 0) {
        authorsText = fullText.substring(0, yearPos).replace(/[\(\)]/g, '').trim();
      }
    } else if (title) {
      const titlePos = fullText.indexOf(title);
      if (titlePos > 0) {
        authorsText = fullText.substring(0, titlePos).trim();
      }
    }
    
    authors = cleanText(authorsText)
      .replace(/\.$/, '')
      .replace(/,\s*$/, '')
      .trim();
    
    // Parsear fuente
    if (title) {
      const titleEnd = fullText.indexOf(title) + title.length;
      let sourceText = fullText.substring(titleEnd);
      sourceText = sourceText.replace(/^[.\s]+/, '').trim();
      
      const urlPos = sourceText.indexOf('http');
      if (urlPos > 0) {
        sourceText = sourceText.substring(0, urlPos).trim();
      }
      
      source = cleanText(sourceText).replace(/\.$/, '');
    }
    
    refs.push({
      id: refId,
      authors,
      year,
      title,
      source,
      url,
      doi,
      fullText
    });
  });

  return refs;
}

// ─── CONTENIDO INLINE ───────────────────────────────────────────────────────
function processInlineContent(node, footnotesMap = {}) {
  if (!node) return '';

  if (node.nodeType === 3) {
    return escapeXml(node.textContent || '');
  }

  if (node.nodeType !== 1) return '';

  const tag = node.tagName.toLowerCase();
  const classList = node.classList || { contains: () => false };

  if (tag === 'script' || tag === 'style') return '';

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

  if (tag === 'a') {
    const href = node.getAttribute('href') || '';
    let content = '';
    for (const child of node.childNodes) content += processInlineContent(child, footnotesMap);

    if (href.includes('javascript:') || !href) return content;

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
    if (href.startsWith('http')) {
      return `<ext-link ext-link-type="uri" xlink:href="${escapeXml(href)}">${content}</ext-link>`;
    }
    return content;
  }

  if (['span', 'abbr', 'label', 'time', 'small'].includes(tag)) {
    let content = '';
    for (const child of node.childNodes) content += processInlineContent(child, footnotesMap);
    return content;
  }

  let content = '';
  for (const child of node.childNodes) content += processInlineContent(child, footnotesMap);
  return content;
}

// ─── CONVERSIÓN DE BLOQUES ─────────────────────────────────────────────────
function convertParagraph(pElement, footnotesMap = {}) {
  let content = '';
  for (const node of pElement.childNodes) {
    content += processInlineContent(node, footnotesMap);
  }
  const trimmed = content.trim();
  return trimmed ? `<p>${trimmed}</p>` : '';
}

function convertList(listElement, listType, footnotesMap = {}) {
  const items = Array.from(listElement.children).filter(child => 
    child.tagName.toLowerCase() === 'li'
  );
  if (!items.length) return '';

  let xml = `<list list-type="${listType}">\n`;
  items.forEach(li => {
    let liContent = '';
    for (const node of li.childNodes) {
      if (node.nodeType === 3) {
        liContent += escapeXml(node.textContent || '');
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

// ─── CONVERSIÓN DE FIGURAS MEJORADA ─────────────────────────────────────────
function convertFigureElement(figureElement, figureCounter = 1, footnotesMap = {}) {
  if (!figureElement) return '';
  
  const img = figureElement.querySelector('img');
  const table = figureElement.querySelector('table');
  const figcaption = figureElement.querySelector('figcaption, .caption, .fig-caption');
  
  // Si es tabla
  if (table && !img) {
    const captionText = figcaption ? cleanText(figcaption.textContent) : '';
    return convertTableElement(table, String(figureCounter), captionText, footnotesMap);
  }
  
  // Si es imagen
  if (img) {
    const figId = figureElement.id || figureElement.getAttribute('data-id') || `fig${figureCounter}`;
    const imgSrc = img.getAttribute('src') || img.getAttribute('data-src') || '';
    const imgAlt = img.getAttribute('alt') || '';
    
    // Procesar caption completo
    let captionText = '';
    let attributionText = '';
    let sourceUrl = '';
    
    if (figcaption) {
      // Obtener texto completo del caption
      captionText = cleanText(figcaption.textContent);
      
      // Extraer atribución (texto después de "Fuente:" o "Foto por:")
      const sourceMatch = captionText.match(/Fuente:\s*(.+)$|Foto por\s*(.+)$|Source:\s*(.+)$/i);
      if (sourceMatch) {
        attributionText = cleanText(sourceMatch[1] || sourceMatch[2] || sourceMatch[3] || '');
        
        // Extraer URL de la fuente
        const sourceLink = figcaption.querySelector('a[href]');
        if (sourceLink) {
          sourceUrl = sourceLink.getAttribute('href') || '';
        }
        
        // Limpiar caption (quitar atribución)
        captionText = captionText.replace(/Fuente:\s*.+$|Foto por\s*.+$|Source:\s*.+$/i, '').trim();
      }
    }
    
    // Extraer número de figura
    let label = `Figure ${figureCounter}`;
    const labelMatch = captionText.match(/^(Figura?\s*\d+|Figure\s*\d+)/i);
    if (labelMatch) {
      label = labelMatch[1];
      captionText = captionText.substring(label.length).replace(/^[:\s.-]+/, '').trim();
    }
    
    let xml = `<fig id="${escapeXml(figId)}">\n`;
    xml += `  <label>${escapeXml(label)}</label>\n`;
    
    if (captionText) {
      xml += `  <caption><p>${escapeXml(captionText)}</p></caption>\n`;
    }
    
    if (imgAlt) {
      xml += `  <alt-text>${escapeXml(imgAlt)}</alt-text>\n`;
    }
    
    if (imgSrc) {
      let mime = 'image/jpeg';
      const lowerSrc = imgSrc.toLowerCase();
      if (lowerSrc.endsWith('.png')) mime = 'image/png';
      else if (lowerSrc.endsWith('.gif')) mime = 'image/gif';
      else if (lowerSrc.endsWith('.svg')) mime = 'image/svg+xml';
      else if (lowerSrc.endsWith('.webp')) mime = 'image/webp';
      
      xml += `  <graphic xlink:href="${escapeXml(imgSrc)}" mimetype="${mime}"/>\n`;
    }
    
    // Atribución
    if (attributionText || sourceUrl) {
      xml += '  <attrib>';
      if (attributionText) {
        xml += escapeXml(attributionText);
      }
      if (sourceUrl && sourceUrl.startsWith('http')) {
        xml += ` <ext-link ext-link-type="uri" xlink:href="${escapeXml(sourceUrl)}">${escapeXml(sourceUrl)}</ext-link>`;
      }
      xml += '</attrib>\n';
    }
    
    xml += '</fig>';
    return xml;
  }
  
  return '';
}

// ─── CONVERSIÓN DE TABLAS ──────────────────────────────────────────────────
function convertTableElement(tableElement, tableNumber = '1', captionText = '', footnotesMap = {}) {
  if (!tableElement || tableElement.tagName.toLowerCase() !== 'table') return '';

  const tableId = tableElement.id || `table${tableNumber}`;
  const label = `Table ${tableNumber}`;

  let xml = `<table-wrap id="${escapeXml(tableId)}">\n`;
  xml += `  <label>${escapeXml(label)}</label>\n`;

  if (captionText) {
    xml += `  <caption><p>${escapeXml(captionText)}</p></caption>\n`;
  }

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
        let attrs = '';
        if (colspan) attrs += ` colspan="${colspan}"`;
        if (rowspan) attrs += ` rowspan="${rowspan}"`;
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
          let attrs = '';
          if (colspan) attrs += ` colspan="${colspan}"`;
          if (rowspan) attrs += ` rowspan="${rowspan}"`;
          
          let cellContent = '';
          for (const n of cell.childNodes) cellContent += processInlineContent(n, footnotesMap);
          xml += `        <td${attrs}>${cellContent || escapeXml(cleanText(cell.textContent))}</td>\n`;
        });
        xml += '      </tr>\n';
      });
      xml += '    </tbody>\n';
    });
  } else {
    xml += '    <tbody>\n';
    tableElement.querySelectorAll('tr').forEach(row => {
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

  xml += '  </table>\n';
  xml += '</table-wrap>';
  return xml;
}

// ─── CÓDIGO ─────────────────────────────────────────────────────────────────
function convertCodeBlock(element) {
  const pre = element.tagName.toLowerCase() === 'pre' ? element : element.querySelector('pre');
  if (!pre) return '';

  const language = element.querySelector('.code-language, .code-label, [data-lang]');
  const caption = element.querySelector('.code-caption');
  const codeId = element.id || '';

  let xml = `<disp-quote${codeId ? ` id="${escapeXml(codeId)}"` : ''}>\n`;
  if (caption) xml += `  <label>${escapeXml(cleanText(caption.textContent))}</label>\n`;
  if (language) xml += `  <attrib>${escapeXml(cleanText(language.textContent || language.getAttribute('data-lang')))}</attrib>\n`;
  xml += `  <preformat>${escapeXml(pre.textContent || '')}</preformat>\n`;
  xml += `</disp-quote>`;
  return xml;
}

// ─── RECORRIDO PRINCIPAL ───────────────────────────────────────────────────
function convertContentSection(contentRoot, footnotesMap = {}, initialLevel = 0) {
  let bodyXml = '';
  let sectionStack = [];
  let secCounter = 0;
  let tableCounter = 0;
  let figureCounter = 0;

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
      bodyXml += `  <sec id="${secId}">\n    <title></title>\n`;
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

    // Headings
    if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tagName)) {
      const level = parseInt(tagName.charAt(1)) + initialLevel;
      const actualLevel = Math.min(level, 6);
      bodyXml += closeSections(actualLevel);

      secCounter++;
      const title = cleanText(child.textContent);
      const secId = generateSlugId('sec', title, secCounter);
      const indent = getIndent();

      bodyXml += `${indent}<sec id="${secId}">\n${indent}  <title>${escapeXml(title)}</title>\n`;
      sectionStack.push({ id: secId, level: actualLevel });
      continue;
    }

    // Figuras flotantes (clase floating-figure)
    if (tagName === 'figure' || classList.contains('floating-figure') || classList.contains('image-figure') || classList.contains('figure')) {
      ensureSection();
      figureCounter++;
      bodyXml += getIndent() + convertFigureElement(child, figureCounter, footnotesMap) + '\n';
      continue;
    }

    // Tablas
    if (tagName === 'table') {
      ensureSection();
      tableCounter++;
      
      let captionText = '';
      const next = child.nextElementSibling;
      if (next && next.tagName.toLowerCase() === 'p') {
        const nextText = cleanText(next.textContent);
        if (/^tabla|^table/i.test(nextText)) {
          captionText = nextText;
          next.setAttribute('data-jats-processed', 'true');
        }
      }
      
      bodyXml += getIndent() + convertTableElement(child, String(tableCounter), captionText, footnotesMap) + '\n';
      continue;
    }

    // Código
    if (tagName === 'pre' || (tagName === 'div' && (classList.contains('code-block') || classList.contains('code-block-wrapper') || classList.contains('highlight')))) {
      ensureSection();
      bodyXml += getIndent() + convertCodeBlock(child) + '\n';
      continue;
    }

    // Paragraphs
    if (tagName === 'p') {
      if (child.getAttribute('data-jats-processed') === 'true') continue;
      ensureSection();
      const p = convertParagraph(child, footnotesMap);
      if (p) bodyXml += getIndent() + p + '\n';
      continue;
    }

    // Lists
    if (tagName === 'ol' || tagName === 'ul') {
      ensureSection();
      const listType = tagName === 'ol' ? 'order' : 'bullet';
      bodyXml += getIndent() + convertList(child, listType, footnotesMap) + '\n';
      continue;
    }

    // Generic div/section
    if ((tagName === 'div' || tagName === 'section') && 
        !classList.contains('footnotes') && 
        !classList.contains('references')) {
      bodyXml += convertContentSection(child, footnotesMap, sectionStack.length);
      continue;
    }

    // Fallback
    if (child.children && child.children.length > 0) {
      bodyXml += convertContentSection(child, footnotesMap, sectionStack.length);
    }
  }

  bodyXml += closeSections(0);
  return bodyXml;
}

// ─── CONSTRUCCIÓN DEL JATS ─────────────────────────────────────────────────
function buildJatsXml(article) {
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

  const articleTypeInfo = detectArticleType(articleType);
  const jatsArticleType = articleTypeInfo.jats;

  const pubDateParsed = parseDate(pubDate);
  const receivedDateParsed = parseDate(receivedDate);
  const acceptedDateParsed = parseDate(acceptedDate);

  // Body español
  let bodyXml = '<body>\n';
  let footnotesMap = {};

  if (htmlContent) {
    const doc = createDOM(htmlContent);
    if (doc) {
      const contentRoot = doc.body || doc.documentElement;
      bodyXml += convertContentSection(contentRoot, footnotesMap);
    }
  }
  bodyXml += '</body>';

  // Body inglés (solo si es diferente)
  let hasEnglishBody = false;
  let bodyEnXml = '';
  if (htmlContentEn) {
    const textOnlyEn = cleanText(htmlContentEn.replace(/<[^>]*>/g, ''));
    const textOnlyEs = cleanText(htmlContent.replace(/<[^>]*>/g, ''));
    
    if (textOnlyEn.length > 80 && textOnlyEn !== textOnlyEs) {
      hasEnglishBody = true;
      const docEn = createDOM(htmlContentEn);
      if (docEn) {
        bodyEnXml = '<body xml:lang="en">\n';
        bodyEnXml += convertContentSection(docEn.body || docEn.documentElement, {});
        bodyEnXml += '</body>';
      }
    }
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
    xml += '    <article-categories>\n      <subj-group subj-group-type="heading">\n';
    if (area) xml += `        <subject>${escapeXml(area)}</subject>\n`;
    specializedCodes.forEach(code => { if (code) xml += `        <subject>${escapeXml(code)}</subject>\n`; });
    xml += '      </subj-group>\n    </article-categories>\n';
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
      else if (parts.length === 2) { givenNames = parts[0]; surname = parts[1]; }
      else { surname = parts[parts.length - 1]; givenNames = parts.slice(0, -1).join(' '); }

      const isCorresp = autor.isCorresponding === true || autor.isCorresponding === 'true';

      xml += `      <contrib contrib-type="author" id="${authorId}"${isCorresp ? ' corresp="yes"' : ''}>\n`;
      
      if (autor.orcid) {
        const orcidNormalized = normalizeOrcid(autor.orcid);
        xml += `        <contrib-id contrib-id-type="orcid" authenticated="true">${escapeXml(orcidNormalized)}</contrib-id>\n`;
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
      xml += `      <aff id="${aff.id}">\n        <institution>${escapeXml(aff.name)}</institution>\n      </aff>\n`;
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
      if (corr?.email) {
        xml += `      <corresp id="cor1">Correspondence: <email>${escapeXml(corr.email)}</email></corresp>\n`;
      }
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
    keywordsEs.forEach(kwd => { const c = cleanText(kwd); if (c) xml += `      <kwd>${escapeXml(c)}</kwd>\n`; });
    xml += '    </kwd-group>\n';
  }
  if (keywordsEn.length) {
    xml += '    <kwd-group xml:lang="en" kwd-group-type="author">\n      <title>Keywords</title>\n';
    keywordsEn.forEach(kwd => { const c = cleanText(kwd); if (c) xml += `      <kwd>${escapeXml(c)}</kwd>\n`; });
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

  // References
  if (references.length > 0) {
    xml += '  <ref-list>\n    <title>Referencias</title>\n';
    references.forEach(ref => {
      xml += `    <ref id="${escapeXml(ref.id)}">\n`;
      xml += '      <mixed-citation publication-type="journal">';
      
      if (ref.authors) xml += escapeXml(ref.authors);
      if (ref.year) xml += ` (${escapeXml(ref.year)})`;
      if (ref.title) xml += `. <article-title>${escapeXml(ref.title)}</article-title>`;
      if (ref.source) xml += `. <source>${escapeXml(ref.source)}</source>`;
      if (ref.doi) {
        xml += `. <pub-id pub-id-type="doi">${escapeXml(ref.doi)}</pub-id>`;
      } else if (ref.url) {
        xml += `. <ext-link ext-link-type="uri" xlink:href="${escapeXml(ref.url)}">${escapeXml(ref.url)}</ext-link>`;
      }
      
      if (!ref.authors && !ref.year && !ref.title && !ref.url && !ref.doi) {
        xml += escapeXml(ref.fullText);
      }
      
      xml += '</mixed-citation>\n    </ref>\n';
    });
    xml += '  </ref-list>\n';
  }

  xml += '</back>\n</article>';
  return xml;
}

// ─── FUNCIÓN PRINCIPAL ──────────────────────────────────────────────────────
function processArticle(article, index) {
  const title = article.titulo || `Artículo ${index + 1}`;
  console.log(`\n[${index + 1}] Procesando: "${title.substring(0, 70)}${title.length > 70 ? '...' : ''}"`);
  
  try {
    const jatsXml = buildJatsXml(article);
    article.jats = jatsXml;
    console.log(`  ✓ JATS generado (${jatsXml.length.toLocaleString()} caracteres)`);
    return { success: true, article };
  } catch (error) {
    console.error(`  ✗ Error: ${error.message}`);
    console.error(error.stack);
    return { success: false, article, error: error.message };
  }
}

// ─── MAIN ───────────────────────────────────────────────────────────────────
function main() {
  console.log('══════════════════════════════════════════════════════════════════');
  console.log('  Conversor articles.json → JATS XML v9.0 FINAL');
  console.log('  Figuras flotantes, atribución, tablas y código mejorados');
  console.log('══════════════════════════════════════════════════════════════════\n');

  if (!fs.existsSync(INPUT_FILE)) {
    console.error(`Error: No existe ${INPUT_FILE}`);
    process.exit(1);
  }

  console.log('Creando backup...');
  fs.copyFileSync(INPUT_FILE, BACKUP_FILE);

  let articles;
  try {
    articles = JSON.parse(fs.readFileSync(INPUT_FILE, 'utf-8'));
  } catch (e) {
    console.error(`Error al parsear JSON: ${e.message}`);
    process.exit(1);
  }

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
        console.error('JSON no válido.');
        process.exit(1);
      }
    }
  }

  console.log(`Encontrados ${articles.length} artículo(s).\n`);

  let successCount = 0;
  let errorCount = 0;

  articles.forEach((article, index) => {
    const result = processArticle(article, index);
    if (result.success) successCount++;
    else errorCount++;
  });

  console.log('\nGuardando...');
  const originalData = JSON.parse(fs.readFileSync(INPUT_FILE, 'utf-8'));

  if (Array.isArray(originalData)) {
    articles.forEach((a, i) => { if (originalData[i]) originalData[i].jats = a.jats; });
  } else if (originalData.titulo || originalData.doi) {
    originalData.jats = articles[0].jats;
  } else {
    for (const k of ['articles', 'articulos', 'data', 'items']) {
      if (originalData[k] && Array.isArray(originalData[k])) {
        articles.forEach((a, i) => { if (originalData[k][i]) originalData[k][i].jats = a.jats; });
        break;
      }
    }
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(originalData, null, 2), 'utf-8');

  console.log('\n══════════════════════════════════════════════════════════════════');
  console.log(`  Total: ${articles.length} | Éxito: ${successCount} | Error: ${errorCount}`);
  console.log(`  Archivo: ${OUTPUT_FILE}`);
  console.log(`  Backup: ${BACKUP_FILE}`);
  console.log('══════════════════════════════════════════════════════════════════\n');
}

// ─── EXPORTACIONES ──────────────────────────────────────────────────────────
module.exports = { buildJatsXml, processArticle, detectArticleType };

// ─── EJECUCIÓN ──────────────────────────────────────────────────────────────
if (require.main === module) {
  main();
}
