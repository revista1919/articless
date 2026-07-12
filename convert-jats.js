/**
 * Conversor de articles.json a JATS XML (v3.0 - JSON to JATS)
 * 
 * Características:
 * - Lee artículos desde articles.json en la raíz del proyecto
 * - Toma contenido HTML desde el campo "html_es"
 * - Usa campos en inglés para conflicts, funding, acknowledgments, etc.
 * - Genera JATS XML bilingüe (es/en) para abstracts, títulos, palabras clave
 * - Inserta el XML generado en el campo "jats" de cada artículo
 * - Procesa rigorosamente TODOS los campos del JSON sin saltarse ninguno
 * 
 * Uso: node json-to-jats.js
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// ─── CONFIGURACIÓN ───────────────────────────────────────────────────────────
const INPUT_FILE = path.join(__dirname, 'articles.json');
const OUTPUT_FILE = path.join(__dirname, 'articles.json'); // Se sobreescribe el mismo archivo
const JATS_VERSION = '1.4';
const JATS_DTD_PUBLIC = '-//NISO//DTD JATS (Z39.96) Journal Publishing DTD with MathML3 v1.4 2024//EN';
const JATS_DTD_SYSTEM = 'JATS-journalpublishing1.dtd';
const JOURNAL_ISSN = '3087-2839';
const JOURNAL_NAME = 'Revista Nacional de las Ciencias para Estudiantes';
const JOURNAL_ABBREV = 'Rev. Nac. Cienc. Estud.';
const PUBLISHER_NAME = 'Revista Nacional de las Ciencias para Estudiantes';
const LICENSE_URL = 'https://creativecommons.org/licenses/by/4.0/';
const LICENSE_TEXT = 'Creative Commons Attribution 4.0 International License';
const LICENSE_ABBREV = 'CC BY 4.0';

// ─── FUNCIONES AUXILIARES ─────────────────────────────────────────────────────

/**
 * Escapa caracteres especiales para contenido XML
 */
function escapeXml(str) {
  if (!str) return '';
  return str
    .replace(/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-fA-F]+;)/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Limpia un string de espacios extra y saltos de línea
 */
function cleanText(str) {
  if (!str) return '';
  return str.replace(/\s+/g, ' ').trim();
}

/**
 * Convierte fecha YYYY-MM-DD a partes para JATS
 */
function parseDate(dateStr) {
  if (!dateStr) return { year: '', month: '', day: '', iso: '' };
  const parts = dateStr.split('-');
  return {
    year: parts[0] || '',
    month: parts[1] || '',
    day: parts[2] || '',
    iso: dateStr
  };
}

/**
 * Genera un ID único basado en un texto
 */
function generateSlugId(prefix, text, counter) {
  if (text) {
    const slug = text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .substring(0, 30);
    return `${prefix}-${slug}`;
  }
  return `${prefix}-${counter}`;
}

// ─── MANEJO DE MATEMÁTICAS ───────────────────────────────────────────────────

/**
 * Convierte expresiones matemáticas LaTeX a etiquetas JATS
 */
function convertLatexToJats(text) {
  if (!text) return text;
  
  // Display math \[...\] o $$...$$
  text = text.replace(/\$\$(.*?)\$\$|\\\[(.*?)\\\]/gs, (match, p1, p2) => {
    const formula = cleanText(p1 || p2);
    return `<disp-formula><mml:math><mml:mrow><mml:mi>${escapeXml(formula)}</mml:mi></mml:mrow></mml:math></disp-formula>`;
  });
  
  // Inline math \(...\) o $...$
  text = text.replace(/\$(.*?)\$|\\\((.*?)\\\)/gs, (match, p1, p2) => {
    const formula = cleanText(p1 || p2);
    return `<inline-formula><mml:math><mml:mrow><mml:mi>${escapeXml(formula)}</mml:mi></mml:mrow></mml:math></inline-formula>`;
  });
  
  return text;
}

/**
 * Convierte elementos MathML del DOM a string para JATS
 */
function convertMathMLElement(mathElement) {
  if (!mathElement) return '';
  const serializer = new (mathElement.ownerDocument.defaultView.XMLSerializer)();
  let mathXml = serializer.serializeToString(mathElement);
  mathXml = mathXml.replace(/<math/g, '<mml:math');
  mathXml = mathXml.replace(/<\/math>/g, '</mml:math>');
  return mathXml;
}

// ─── CONVERSIÓN DE CONTENIDO HTML A JATS ─────────────────────────────────────

/**
 * Procesa nodos en línea (texto, enlaces, énfasis, matemáticas, etc.)
 */
function processInlineContent(node, footnotesMap) {
  if (!node) return '';
  
  // Nodo de texto
  if (node.nodeType === 3) {
    let text = node.textContent;
    text = convertLatexToJats(text);
    return escapeXml(text);
  }
  
  // Nodo de elemento
  if (node.nodeType === 1) {
    const tag = node.tagName.toLowerCase();
    const classList = node.classList || [];
    
    if (tag === 'script' || tag === 'style') return '';
    
    // Matemáticas MathML
    if (tag === 'math' || tag === 'm:math' || 
        (tag === 'span' && classList.contains('math'))) {
      const mathElement = tag === 'math' ? node : node.querySelector('math');
      if (mathElement) {
        return convertMathMLElement(mathElement);
      }
      return escapeXml(node.textContent);
    }
    
    // Énfasis y formato
    if (tag === 'em' || tag === 'i' || tag === 'italic') {
      let content = '';
      for (let child of node.childNodes) {
        content += processInlineContent(child, footnotesMap);
      }
      return `<italic>${content}</italic>`;
    }
    
    if (tag === 'strong' || tag === 'b' || tag === 'bold') {
      let content = '';
      for (let child of node.childNodes) {
        content += processInlineContent(child, footnotesMap);
      }
      return `<bold>${content}</bold>`;
    }
    
    if (tag === 'u' || tag === 'underline') {
      let content = '';
      for (let child of node.childNodes) {
        content += processInlineContent(child, footnotesMap);
      }
      return `<underline>${content}</underline>`;
    }
    
    if (tag === 'code' || tag === 'tt') {
      return `<monospace>${escapeXml(node.textContent)}</monospace>`;
    }
    
    if (tag === 'sub') {
      let content = '';
      for (let child of node.childNodes) {
        content += processInlineContent(child, footnotesMap);
      }
      return `<sub>${content}</sub>`;
    }
    
    if (tag === 'sup') {
      let content = '';
      for (let child of node.childNodes) {
        content += processInlineContent(child, footnotesMap);
      }
      return `<sup>${content}</sup>`;
    }
    
    if (tag === 'span' && classList.contains('small-caps')) {
      let content = '';
      for (let child of node.childNodes) {
        content += processInlineContent(child, footnotesMap);
      }
      return `<sc>${content}</sc>`;
    }
    
    // Enlaces
    if (tag === 'a') {
      const href = node.getAttribute('href') || '';
      let content = '';
      for (let child of node.childNodes) {
        content += processInlineContent(child, footnotesMap);
      }
      
      if (classList.contains('citation-link')) {
        const rid = href.replace('#', '');
        return `<xref ref-type="bibr" rid="${escapeXml(rid)}">${content}</xref>`;
      }
      
      if (classList.contains('footnote-link') || href.startsWith('#fn')) {
        const rid = href.replace('#', '');
        return `<xref ref-type="fn" rid="${escapeXml(rid)}">${content}</xref>`;
      }
      
      if (href.startsWith('#fig') || href.startsWith('#table')) {
        const rid = href.replace('#', '');
        const refType = href.startsWith('#fig') ? 'fig' : 'table';
        return `<xref ref-type="${refType}" rid="${escapeXml(rid)}">${content}</xref>`;
      }
      
      if (href.startsWith('mailto:')) {
        return `<email>${escapeXml(href.replace('mailto:', ''))}</email>`;
      }
      
      return `<ext-link ext-link-type="uri" xlink:href="${escapeXml(href)}">${content}</ext-link>`;
    }
    
    // Elementos inline genéricos
    if (tag === 'span' || tag === 'abbr' || tag === 'label') {
      let content = '';
      for (let child of node.childNodes) {
        content += processInlineContent(child, footnotesMap);
      }
      return content;
    }
    
    // Para cualquier otro elemento inline no reconocido
    let content = '';
    for (let child of node.childNodes) {
      content += processInlineContent(child, footnotesMap);
    }
    return content;
  }
  
  return '';
}

/**
 * Convierte un párrafo HTML a <p> JATS
 */
function convertParagraph(pElement, footnotesMap) {
  let content = '';
  for (let node of pElement.childNodes) {
    content += processInlineContent(node, footnotesMap);
  }
  return `<p>${content.trim()}</p>`;
}

/**
 * Convierte un blockquote HTML a <disp-quote> JATS
 */
function convertBlockquote(bqElement, footnotesMap) {
  let content = '';
  
  for (let node of bqElement.childNodes) {
    if (node.nodeType === 3) {
      let text = node.textContent;
      text = convertLatexToJats(text);
      content += escapeXml(text);
    } else if (node.nodeType === 1) {
      const tag = node.tagName.toLowerCase();
      if (tag === 'p') {
        let pContent = '';
        for (let n of node.childNodes) {
          pContent += processInlineContent(n, footnotesMap);
        }
        content += `<p>${pContent.trim()}</p>`;
      } else if (tag === 'cite' || tag === 'attrib') {
        let citeContent = '';
        for (let n of node.childNodes) {
          citeContent += processInlineContent(n, footnotesMap);
        }
        content += `<attrib>${citeContent.trim()}</attrib>`;
      } else {
        content += processInlineContent(node, footnotesMap);
      }
    }
  }
  
  return `<disp-quote>${content.trim()}</disp-quote>`;
}

/**
 * Convierte listas HTML (ol/ul) a <list> JATS
 */
function convertList(listElement, listType, footnotesMap) {
  const listItems = listElement.querySelectorAll(':scope > li');
  if (listItems.length === 0) return '';
  
  let xml = `<list list-type="${listType}">\n`;
  
  listItems.forEach(li => {
    let liContent = '';
    
    for (let node of li.childNodes) {
      if (node.nodeType === 3) {
        let text = node.textContent;
        text = convertLatexToJats(text);
        liContent += escapeXml(text);
      } else if (node.nodeType === 1) {
        const tag = node.tagName.toLowerCase();
        if (tag === 'p') {
          let pContent = '';
          for (let n of node.childNodes) {
            pContent += processInlineContent(n, footnotesMap);
          }
          liContent += pContent;
        } else if (tag === 'ul') {
          liContent += '\n' + convertList(node, 'bullet', footnotesMap);
        } else if (tag === 'ol') {
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

/**
 * Convierte lista de definiciones a <def-list> JATS
 */
function convertDefinitionList(dlElement, footnotesMap) {
  let xml = '<def-list>\n';
  
  const items = dlElement.querySelectorAll(':scope > dt, :scope > dd');
  let currentTerm = '';
  
  items.forEach(item => {
    const tag = item.tagName.toLowerCase();
    if (tag === 'dt') {
      if (currentTerm) {
        xml += '  </def-item>\n';
      }
      currentTerm = cleanText(item.textContent);
      xml += '  <def-item>\n';
      xml += `    <term>${escapeXml(currentTerm)}</term>\n`;
    } else if (tag === 'dd') {
      let defContent = '';
      for (let node of item.childNodes) {
        if (node.nodeType === 3) {
          defContent += escapeXml(cleanText(node.textContent));
        } else if (node.nodeType === 1) {
          const childTag = node.tagName.toLowerCase();
          if (childTag === 'p') {
            let pContent = '';
            for (let n of node.childNodes) {
              pContent += processInlineContent(n, footnotesMap);
            }
            defContent += pContent;
          } else {
            defContent += processInlineContent(node, footnotesMap);
          }
        }
      }
      xml += `    <def><p>${defContent.trim()}</p></def>\n`;
    }
  });
  
  if (currentTerm) {
    xml += '  </def-item>\n';
  }
  
  xml += '</def-list>';
  return xml;
}

/**
 * Convierte figuras (imágenes y tablas) del HTML a JATS
 */
function convertFigureBlock(figureElement, footnotesMap) {
  let xml = '';
  
  const tableWrapper = figureElement.querySelector('.table-download-wrapper') || 
                       figureElement.querySelector('table');
  const imageFigure = figureElement.querySelector('.image-figure') ||
                      figureElement.querySelector('img');
  const figcaption = figureElement.querySelector(':scope > figcaption');
  
  // Tablas
  if (tableWrapper && !imageFigure) {
    const table = tableWrapper.tagName === 'TABLE' ? tableWrapper : tableWrapper.querySelector('table');
    const tableLabel = figureElement.querySelector('.table-label');
    const captionText = figcaption ? cleanText(figcaption.textContent) : '';
    
    let tableId = '';
    if (figureElement.id) {
      tableId = figureElement.id;
    } else if (table && table.id) {
      tableId = table.id;
    }
    
    let label = 'Table';
    if (tableLabel) {
      label = cleanText(tableLabel.textContent);
    } else if (captionText) {
      const labelMatch = captionText.match(/^(Tabla\s*\w*[\d.]*)/i);
      if (labelMatch) label = labelMatch[1];
    }
    
    xml += `<table-wrap id="${escapeXml(tableId)}">\n`;
    xml += `  <label>${escapeXml(label)}</label>\n`;
    
    if (captionText) {
      let captionOnly = captionText;
      if (label !== 'Table' && captionOnly.startsWith(label)) {
        captionOnly = captionOnly.substring(label.length).replace(/^[:\s.-]+/, '').trim();
      }
      if (captionOnly) {
        xml += `  <caption><p>${escapeXml(captionOnly)}</p></caption>\n`;
      }
    }
    
    const altText = figureElement.querySelector('.table-alt, .alt-text');
    if (altText) {
      xml += `  <alt-text>${escapeXml(cleanText(altText.textContent))}</alt-text>\n`;
    }
    
    if (table) {
      xml += '  <table frame="hsides" rules="groups">\n';
      
      const colgroup = table.querySelector('colgroup');
      if (colgroup) {
        xml += '    <colgroup>\n';
        colgroup.querySelectorAll('col').forEach(col => {
          const span = col.getAttribute('span') || '1';
          const width = col.getAttribute('width') || col.style.width || '';
          let colXml = `      <col`;
          if (span !== '1') colXml += ` span="${span}"`;
          if (width) colXml += ` width="${escapeXml(width)}"`;
          colXml += '/>\n';
          xml += colXml;
        });
        xml += '    </colgroup>\n';
      }
      
      const thead = table.querySelector('thead');
      if (thead) {
        xml += '    <thead>\n';
        thead.querySelectorAll('tr').forEach(row => {
          xml += '      <tr>\n';
          row.querySelectorAll('th, td').forEach(cell => {
            const colspan = cell.getAttribute('colspan') || '';
            const rowspan = cell.getAttribute('rowspan') || '';
            const align = cell.getAttribute('align') || cell.style.textAlign || '';
            let cellXml = `        <th`;
            if (colspan) cellXml += ` colspan="${colspan}"`;
            if (rowspan) cellXml += ` rowspan="${rowspan}"`;
            if (align) cellXml += ` align="${align}"`;
            cellXml += `>${escapeXml(cleanText(cell.textContent))}</th>\n`;
            xml += cellXml;
          });
          xml += '      </tr>\n';
        });
        xml += '    </thead>\n';
      }
      
      const tbodies = table.querySelectorAll('tbody');
      tbodies.forEach(tbody => {
        xml += '    <tbody>\n';
        tbody.querySelectorAll('tr').forEach(row => {
          xml += '      <tr>\n';
          row.querySelectorAll('td, th').forEach(cell => {
            const colspan = cell.getAttribute('colspan') || '';
            const rowspan = cell.getAttribute('rowspan') || '';
            const align = cell.getAttribute('align') || cell.style.textAlign || '';
            let cellXml = `        <td`;
            if (colspan) cellXml += ` colspan="${colspan}"`;
            if (rowspan) cellXml += ` rowspan="${rowspan}"`;
            if (align) cellXml += ` align="${align}"`;
            
            let cellContent = '';
            for (let node of cell.childNodes) {
              cellContent += processInlineContent(node, footnotesMap);
            }
            
            cellXml += `>${cellContent || escapeXml(cleanText(cell.textContent))}</td>\n`;
            xml += cellXml;
          });
          xml += '      </tr>\n';
        });
        xml += '    </tbody>\n';
      });
      
      const tfoot = table.querySelector('tfoot');
      if (tfoot) {
        xml += '    <tfoot>\n';
        tfoot.querySelectorAll('tr').forEach(row => {
          xml += '      <tr>\n';
          row.querySelectorAll('td, th').forEach(cell => {
            const tag = cell.tagName.toLowerCase();
            xml += `        <${tag}>${escapeXml(cleanText(cell.textContent))}</${tag}>\n`;
          });
          xml += '      </tr>\n';
        });
        xml += '    </tfoot>\n';
      }
      
      xml += '  </table>\n';
    }
    
    const tableNotes = figureElement.querySelector('.table-notes, .table-footnote');
    if (tableNotes) {
      xml += `  <table-wrap-foot>\n`;
      const notes = tableNotes.querySelectorAll('p, li, .note-item');
      notes.forEach(note => {
        xml += `    <fn><p>${escapeXml(cleanText(note.textContent))}</p></fn>\n`;
      });
      xml += `  </table-wrap-foot>\n`;
    }
    
    xml += '</table-wrap>';
  } 
  // Figuras de imagen
  else if (imageFigure) {
    const img = imageFigure.tagName === 'IMG' ? imageFigure : imageFigure.querySelector('img');
    const figId = figureElement.id || (imageFigure.tagName !== 'IMG' ? imageFigure.id : '') || '';
    const imgSrc = img ? img.getAttribute('src') || '' : '';
    const imgAlt = img ? img.getAttribute('alt') || '' : '';
    const imgCaption = figureElement.querySelector('.image-caption, .fig-caption');
    const mainCaption = figcaption ? cleanText(figcaption.textContent) : '';
    
    xml += `<fig id="${escapeXml(figId)}">\n`;
    
    let label = 'Figure';
    if (mainCaption) {
      const labelMatch = mainCaption.match(/^(Figura?\s*\w*[\d.]*)/i);
      if (labelMatch) {
        label = labelMatch[1];
      }
    } else if (imgCaption) {
      const labelMatch = cleanText(imgCaption.textContent).match(/^(Figura?\s*\w*[\d.]*)/i);
      if (labelMatch) {
        label = labelMatch[1];
      }
    }
    xml += `  <label>${escapeXml(label)}</label>\n`;
    
    let captionText = mainCaption;
    if (captionText && label !== 'Figure' && captionText.startsWith(label)) {
      captionText = captionText.substring(label.length).replace(/^[:\s.-]+/, '').trim();
    }
    if (captionText) {
      xml += `  <caption><p>${escapeXml(captionText)}</p></caption>\n`;
    }
    
    if (imgAlt) {
      xml += `  <alt-text>${escapeXml(imgAlt)}</alt-text>\n`;
    }
    
    if (imgSrc) {
      let mimetype = 'image/jpeg';
      if (imgSrc.endsWith('.png')) mimetype = 'image/png';
      else if (imgSrc.endsWith('.gif')) mimetype = 'image/gif';
      else if (imgSrc.endsWith('.svg')) mimetype = 'image/svg+xml';
      else if (imgSrc.endsWith('.webp')) mimetype = 'image/webp';
      
      xml += `  <graphic xlink:href="${escapeXml(imgSrc)}" mimetype="${mimetype}"/>\n`;
    }
    
    if (imgCaption) {
      xml += `  <attrib>${escapeXml(cleanText(imgCaption.textContent))}</attrib>\n`;
    }
    
    xml += '</fig>';
  }
  
  return xml;
}

/**
 * Convierte bloques de código a <disp-quote> con <preformat> JATS
 */
function convertCodeBlock(codeWrapper, footnotesMap) {
  const pre = codeWrapper.querySelector('pre');
  const codeHeader = codeWrapper.querySelector('.code-language, .code-label');
  const language = codeHeader ? cleanText(codeHeader.textContent) : '';
  const caption = codeWrapper.querySelector('.code-caption');
  
  if (!pre) return '';
  
  const codeContent = pre.textContent || '';
  const codeId = codeWrapper.id || '';
  
  let xml = `<disp-quote`;
  if (codeId) xml += ` id="${escapeXml(codeId)}"`;
  xml += '>\n';
  
  if (caption) {
    xml += `  <label>${escapeXml(cleanText(caption.textContent))}</label>\n`;
  }
  
  if (language) {
    xml += `  <attrib>${escapeXml(language)}</attrib>\n`;
  }
  
  xml += `  <preformat>${escapeXml(codeContent)}</preformat>\n`;
  xml += `</disp-quote>`;
  
  return xml;
}

/**
 * Convierte una sección completa de contenido HTML
 */
function convertContentSection(contentRoot, footnotesMap, initialLevel = 0) {
  let bodyXml = '';
  let sectionStack = [];
  let secCounter = 0;
  
  function getCurrentIndent() {
    return '  '.repeat(sectionStack.length + 1);
  }
  
  function closeSections(level) {
    let closed = '';
    while (sectionStack.length > 0 && sectionStack[sectionStack.length - 1].level >= level) {
      const sec = sectionStack.pop();
      const indent = '  '.repeat(sectionStack.length + 1);
      closed += `${indent}</sec>\n`;
    }
    return closed;
  }
  
  const children = Array.from(contentRoot.childNodes);
  
  children.forEach(child => {
    if (child.nodeType === 3) {
      const text = child.textContent;
      if (text.trim() === '') return;
      if (sectionStack.length > 0) {
        const indent = getCurrentIndent();
        bodyXml += indent + `<p>${escapeXml(cleanText(text))}</p>\n`;
      }
      return;
    }
    
    if (child.nodeType !== 1) return;
    
    const tagName = child.tagName.toLowerCase();
    const classList = child.classList || [];
    
    if (tagName === 'script' || tagName === 'style' || tagName === 'hr') return;
    if (classList.contains('footnotes')) return;
    
    // Encabezados
    if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tagName)) {
      const level = parseInt(tagName.charAt(1)) + initialLevel;
      const actualLevel = Math.min(level, 6);
      
      bodyXml += closeSections(actualLevel);
      
      secCounter++;
      const title = cleanText(child.textContent);
      const secId = generateSlugId('sec', title, secCounter);
      const indent = getCurrentIndent();
      
      bodyXml += `${indent}<sec id="${secId}">\n`;
      bodyXml += `${indent}  <title>${escapeXml(title)}</title>\n`;
      sectionStack.push({ id: secId, level: actualLevel });
    }
    
    // Párrafos
    else if (tagName === 'p') {
      if (sectionStack.length === 0) {
        secCounter++;
        const secId = `sec${secCounter}`;
        bodyXml += `  <sec id="${secId}">\n`;
        bodyXml += `    <title></title>\n`;
        sectionStack.push({ id: secId, level: 1 + initialLevel });
      }
      const indent = getCurrentIndent();
      bodyXml += indent + convertParagraph(child, footnotesMap) + '\n';
    }
    
    // Blockquote
    else if (tagName === 'blockquote') {
      if (sectionStack.length === 0) {
        secCounter++;
        const secId = `sec${secCounter}`;
        bodyXml += `  <sec id="${secId}">\n    <title></title>\n`;
        sectionStack.push({ id: secId, level: 1 + initialLevel });
      }
      const indent = getCurrentIndent();
      bodyXml += indent + convertBlockquote(child, footnotesMap) + '\n';
    }
    
    // Listas
    else if (tagName === 'ol' || tagName === 'ul') {
      if (sectionStack.length === 0) {
        secCounter++;
        const secId = `sec${secCounter}`;
        bodyXml += `  <sec id="${secId}">\n    <title></title>\n`;
        sectionStack.push({ id: secId, level: 1 + initialLevel });
      }
      const listType = tagName === 'ol' ? 'order' : 'bullet';
      const indent = getCurrentIndent();
      bodyXml += indent + convertList(child, listType, footnotesMap) + '\n';
    }
    
    // Listas de definición
    else if (tagName === 'dl') {
      if (sectionStack.length === 0) {
        secCounter++;
        const secId = `sec${secCounter}`;
        bodyXml += `  <sec id="${secId}">\n    <title></title>\n`;
        sectionStack.push({ id: secId, level: 1 + initialLevel });
      }
      const indent = getCurrentIndent();
      bodyXml += indent + convertDefinitionList(child, footnotesMap) + '\n';
    }
    
    // Figuras
    else if (tagName === 'figure') {
      if (sectionStack.length === 0) {
        secCounter++;
        const secId = `sec${secCounter}`;
        bodyXml += `  <sec id="${secId}">\n    <title></title>\n`;
        sectionStack.push({ id: secId, level: 1 + initialLevel });
      }
      const indent = getCurrentIndent();
      bodyXml += indent + convertFigureBlock(child, footnotesMap) + '\n';
    }
    
    // Tablas directas (fuera de figure)
    else if (tagName === 'table' && !child.closest('figure')) {
      if (sectionStack.length === 0) {
        secCounter++;
        const secId = `sec${secCounter}`;
        bodyXml += `  <sec id="${secId}">\n    <title></title>\n`;
        sectionStack.push({ id: secId, level: 1 + initialLevel });
      }
      const indent = getCurrentIndent();
      const tempFigure = contentRoot.ownerDocument.createElement('figure');
      tempFigure.appendChild(child.cloneNode(true));
      bodyXml += indent + convertFigureBlock(tempFigure, footnotesMap) + '\n';
    }
    
    // Bloques de código
    else if (tagName === 'div' && classList.contains('code-block-wrapper')) {
      if (sectionStack.length === 0) {
        secCounter++;
        const secId = `sec${secCounter}`;
        bodyXml += `  <sec id="${secId}">\n    <title></title>\n`;
        sectionStack.push({ id: secId, level: 1 + initialLevel });
      }
      const indent = getCurrentIndent();
      bodyXml += indent + convertCodeBlock(child, footnotesMap) + '\n';
    }
    
    // Preformateado directo
    else if (tagName === 'pre') {
      if (sectionStack.length === 0) {
        secCounter++;
        const secId = `sec${secCounter}`;
        bodyXml += `  <sec id="${secId}">\n    <title></title>\n`;
        sectionStack.push({ id: secId, level: 1 + initialLevel });
      }
      const indent = getCurrentIndent();
      bodyXml += `${indent}<preformat>${escapeXml(child.textContent)}</preformat>\n`;
    }
    
    // Divs y sections genéricos
    else if ((tagName === 'div' || tagName === 'section') && 
             !classList.contains('footnotes') && 
             !classList.contains('references') &&
             !classList.contains('reference-list')) {
      bodyXml += convertContentSection(child, footnotesMap, sectionStack.length);
    }
    
    // Para cualquier otro elemento no reconocido
    else if (child.children && child.children.length > 0) {
      bodyXml += convertContentSection(child, footnotesMap, sectionStack.length);
    }
  });
  
  bodyXml += closeSections(0);
  
  return bodyXml;
}

// ─── EXTRACCIÓN DE REFERENCIAS DESDE HTML ────────────────────────────────────

/**
 * Parsea el HTML de referencias y extrae los datos estructurados
 */
function parseReferencesFromHtml(referencesHtml) {
  if (!referencesHtml) return [];
  
  const dom = new JSDOM(referencesHtml);
  const doc = dom.window.document;
  const refItems = doc.querySelectorAll('.reference-item');
  const refs = [];
  
  refItems.forEach((item, index) => {
    const refId = item.id || `ref${index + 1}`;
    const fullText = cleanText(item.textContent);
    const links = item.querySelectorAll('a');
    
    let authors = '';
    let year = '';
    let title = '';
    let source = '';
    let url = '';
    let doi = '';
    
    // Extraer enlaces
    links.forEach(link => {
      const href = link.getAttribute('href') || '';
      if (href.includes('doi.org')) {
        doi = href.replace('https://doi.org/', '').replace('http://doi.org/', '');
      } else if (!url) {
        url = href;
      }
    });
    
    // Intentar parsear autores
    const authorMatch = fullText.match(/^([^.]+)\./);
    if (authorMatch) {
      authors = cleanText(authorMatch[1]);
    }
    
    // Intentar parsear año
    const yearMatch = fullText.match(/\((\d{4})\)|\.\s*(\d{4})[.,]/);
    if (yearMatch) {
      year = yearMatch[1] || yearMatch[2];
    }
    
    // Intentar parsear título (entre comillas)
    const titleMatch = fullText.match(/«([^»]+)»|"([^"]+)"|'([^']+)'/);
    if (titleMatch) {
      title = titleMatch[1] || titleMatch[2] || titleMatch[3];
    }
    
    // Intentar parsear fuente
    const sourceMatch = fullText.match(/(?:\d{4}[.,])\s*(.*?)(?:https?:\/\/|$)/);
    if (sourceMatch && sourceMatch[1]) {
      source = cleanText(sourceMatch[1]);
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

// ─── CONSTRUCCIÓN DEL JATS COMPLETO ──────────────────────────────────────────

/**
 * Construye el XML JATS completo a partir de un artículo del JSON
 */
function buildJatsXml(article) {
  // ─── EXTRACCIÓN DE CAMPOS DEL JSON ─────────────────────────────────────
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
  const keywordsEs = article.palabras_clave || [];
  const keywordsEn = article.keywords_english || [];
  const area = article.area || '';
  const articleType = article.type || article.tipo || 'research-article';
  const receivedDate = article.receivedDate || '';
  const acceptedDate = article.acceptedDate || '';
  const conflictsEs = article.conflicts || '';
  const conflictsEn = article.conflictsEnglish || '';
  const fundingEs = article.funding || '';
  const fundingEn = article.fundingEnglish || '';
  const acknowledgmentsEs = article.acknowledgments || '';
  const acknowledgmentsEn = article.acknowledgmentsEnglish || '';
  const authorCredits = article.authorCredits || '';
  const authorCreditsEn = article.authorCreditsEnglish || '';
  const dataAvailability = article.dataAvailability || '';
  const dataAvailabilityEn = article.dataAvailabilityEnglish || '';
  const autores = article.autores || [];
  const htmlContent = article.html_es || '';
  const htmlContentEn = article.html_en || '';
  const referenciasHtml = article.referencias || '';
  const submissionId = article.submissionId || '';
  
  // ─── MAPEO DE TIPO DE ARTÍCULO ─────────────────────────────────────────
  let jatsArticleType = 'research-article';
  const typeLower = articleType.toLowerCase();
  if (typeLower.includes('revisión') || typeLower.includes('revision') || typeLower.includes('review')) {
    jatsArticleType = 'review-article';
  } else if (typeLower.includes('editorial')) {
    jatsArticleType = 'editorial';
  } else if (typeLower.includes('carta') || typeLower.includes('letter')) {
    jatsArticleType = 'letter';
  } else if (typeLower.includes('caso') || typeLower.includes('case')) {
    jatsArticleType = 'case-report';
  }
  
  // ─── PROCESAR FECHAS ───────────────────────────────────────────────────
  const pubDateParsed = parseDate(pubDate);
  const receivedDateParsed = parseDate(receivedDate);
  const acceptedDateParsed = parseDate(acceptedDate);
  
  // ─── PROCESAR CUERPO HTML ──────────────────────────────────────────────
  let bodyXml = '<body>\n';
  let footnotesXml = '';
  let footnotesMap = {};
  
  if (htmlContent) {
    const dom = new JSDOM(htmlContent);
    const doc = dom.window.document;
    
    // Encontrar el contenido raíz
    let contentRoot = doc.body;
    if (!contentRoot) {
      // Si no hay body, usar el documento completo
      contentRoot = doc.documentElement;
    }
    
    // Extraer notas al pie si existen
    const footnoteSection = contentRoot.querySelector('.footnotes');
    if (footnoteSection) {
      const footnoteItems = footnoteSection.querySelectorAll(':scope > ol > li, :scope > .footnote-item');
      footnoteItems.forEach((li, index) => {
        const fnId = li.id || `fn${index + 1}`;
        const contentClone = li.cloneNode(true);
        const backLink = contentClone.querySelector('a[href^="#fn"], a[rev="footnote"]');
        if (backLink) backLink.remove();
        footnotesMap[fnId] = cleanText(contentClone.textContent || contentClone.innerHTML);
      });
      footnoteSection.remove();
    }
    
    // Procesar el cuerpo
    bodyXml += convertContentSection(contentRoot, footnotesMap);
    bodyXml += '</body>';
    
    // Construir fn-group para el back
    if (Object.keys(footnotesMap).length > 0) {
      footnotesXml = '<fn-group>\n';
      for (const [id, content] of Object.entries(footnotesMap)) {
        footnotesXml += `  <fn id="${escapeXml(id)}">\n`;
        footnotesXml += `    <p>${escapeXml(content)}</p>\n`;
        footnotesXml += `  </fn>\n`;
      }
      footnotesXml += '</fn-group>\n';
    }
  } else {
    bodyXml += '</body>';
  }
  
  // ─── PROCESAR REFERENCIAS ──────────────────────────────────────────────
  const references = parseReferencesFromHtml(referenciasHtml);
  
  // ─── PROCESAR CONTENIDO EN INGLÉS (si existe y es diferente) ───────────
  // Nota: JATS permite múltiples versiones del cuerpo con xml:lang
  // Si html_en tiene contenido, lo incluimos como una sección adicional
  let hasEnglishBody = false;
  let bodyEnXml = '';
  if (htmlContentEn && cleanText(htmlContentEn.replace(/<[^>]*>/g, '')).length > 50) {
    hasEnglishBody = true;
    const domEn = new JSDOM(htmlContentEn);
    const docEn = domEn.window.document;
    let contentRootEn = docEn.body || docEn.documentElement;
    
    bodyEnXml = '<body xml:lang="en">\n';
    bodyEnXml += convertContentSection(contentRootEn, {});
    bodyEnXml += '</body>';
  }
  
  // ─── CONSTRUIR XML COMPLETO ────────────────────────────────────────────
  let xml = '';
  
  // Declaración XML y DOCTYPE
  xml += '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += `<!DOCTYPE article PUBLIC "${JATS_DTD_PUBLIC}" "${JATS_DTD_SYSTEM}">\n`;
  
  // Root element
  xml += `<article dtd-version="${JATS_VERSION}" article-type="${jatsArticleType}" xml:lang="es"`;
  xml += '\n         xmlns:mml="http://www.w3.org/1998/Math/MathML"';
  xml += '\n         xmlns:xlink="http://www.w3.org/1999/xlink">\n';
  
  // ─── FRONT ──────────────────────────────────────────────────────────────
  xml += '<front>\n';
  
  // Journal Meta
  xml += '  <journal-meta>\n';
  xml += '    <journal-id journal-id-type="publisher">RNCE</journal-id>\n';
  xml += '    <journal-title-group>\n';
  xml += `      <journal-title>${escapeXml(JOURNAL_NAME)}</journal-title>\n`;
  xml += `      <abbrev-journal-title>${escapeXml(JOURNAL_ABBREV)}</abbrev-journal-title>\n`;
  xml += '    </journal-title-group>\n';
  xml += `    <issn publication-format="electronic">${JOURNAL_ISSN}</issn>\n`;
  xml += '    <publisher>\n';
  xml += `      <publisher-name>${escapeXml(PUBLISHER_NAME)}</publisher-name>\n`;
  xml += '    </publisher>\n';
  xml += '  </journal-meta>\n';
  
  // Article Meta
  xml += '  <article-meta>\n';
  
  // Article ID (DOI)
  if (doi) {
    xml += `    <article-id pub-id-type="doi">${escapeXml(doi)}</article-id>\n`;
  }
  
  // Submission ID como custom-id
  if (submissionId) {
    xml += `    <article-id pub-id-type="publisher">${escapeXml(submissionId)}</article-id>\n`;
  }
  
  // Article categories
  if (area) {
    xml += '    <article-categories>\n';
    xml += '      <subj-group>\n';
    xml += `        <subject>${escapeXml(area)}</subject>\n`;
    xml += '      </subj-group>\n';
    xml += '    </article-categories>\n';
  }
  
  // Title group
  xml += '    <title-group>\n';
  xml += `      <article-title>${escapeXml(articleTitle)}</article-title>\n`;
  // Título en inglés como título alternativo
  if (articleTitleEn) {
    xml += `      <trans-title xml:lang="en">${escapeXml(articleTitleEn)}</trans-title>\n`;
  }
  xml += '    </title-group>\n';
  
  // Contrib group (autores)
  if (autores.length > 0) {
    xml += '    <contrib-group>\n';
    
    // Mapa de instituciones únicas
    const uniqueInstitutions = [];
    const instMap = {};
    
    autores.forEach((autor, index) => {
      const authorId = `author${index + 1}`;
      const name = autor.name || '';
      const nameParts = name.split(' ');
      let givenNames = '';
      let surname = '';
      
      if (nameParts.length === 1) {
        surname = nameParts[0];
      } else if (nameParts.length === 2) {
        givenNames = nameParts[0];
        surname = nameParts[1];
      } else {
        surname = nameParts[nameParts.length - 1];
        givenNames = nameParts.slice(0, -1).join(' ');
      }
      
      xml += `      <contrib contrib-type="author" id="${authorId}">\n`;
      
      // ORCID
      if (autor.orcid) {
        xml += `        <contrib-id contrib-id-type="orcid" authenticated="true">${escapeXml(autor.orcid)}</contrib-id>\n`;
      }
      
      // Author ID del sistema
      if (autor.authorId) {
        xml += `        <contrib-id contrib-id-type="publisher">${escapeXml(autor.authorId)}</contrib-id>\n`;
      }
      
      xml += '        <name>\n';
      xml += `          <surname>${escapeXml(surname)}</surname>\n`;
      xml += `          <given-names>${escapeXml(givenNames)}</given-names>\n`;
      xml += '        </name>\n';
      
      // Email
      if (autor.email) {
        xml += `        <email>${escapeXml(autor.email)}</email>\n`;
      }
      
      // Afiliación
      if (autor.institution) {
        const instName = autor.institution;
        if (!instMap[instName]) {
          const affId = `aff${uniqueInstitutions.length + 1}`;
          uniqueInstitutions.push({ id: affId, name: instName });
          instMap[instName] = affId;
        }
        xml += `        <xref ref-type="aff" rid="${instMap[instName]}">${escapeXml(instName)}</xref>\n`;
      }
      
      xml += '      </contrib>\n';
    });
    
    xml += '    </contrib-group>\n';
    
    // Affiliations
    if (uniqueInstitutions.length > 0) {
      xml += '    <aff-alternatives>\n';
      uniqueInstitutions.forEach(aff => {
        xml += `      <aff id="${aff.id}">\n`;
        xml += `        <institution>${escapeXml(aff.name)}</institution>\n`;
        xml += '      </aff>\n';
      });
      xml += '    </aff-alternatives>\n';
    }
  }
  
  // Author notes (conflicts of interest)
  if (conflictsEs || conflictsEn) {
    xml += '    <author-notes>\n';
    if (conflictsEs) {
      xml += `      <fn fn-type="conflict" xml:lang="es"><p>${escapeXml(conflictsEs)}</p></fn>\n`;
    }
    if (conflictsEn && conflictsEn !== conflictsEs) {
      xml += `      <fn fn-type="conflict" xml:lang="en"><p>${escapeXml(conflictsEn)}</p></fn>\n`;
    }
    xml += '    </author-notes>\n';
  }
  
  // Publication date
  xml += '    <pub-date publication-format="electronic" date-type="pub"';
  if (pubDateParsed.iso) {
    xml += ` iso-8601-date="${pubDateParsed.iso}"`;
  }
  xml += '>\n';
  if (pubDateParsed.year) xml += `      <year>${pubDateParsed.year}</year>\n`;
  if (pubDateParsed.month) xml += `      <month>${pubDateParsed.month}</month>\n`;
  if (pubDateParsed.day) xml += `      <day>${pubDateParsed.day}</day>\n`;
  xml += '    </pub-date>\n';
  
  // Volume, issue, pages
  if (volume) xml += `    <volume>${escapeXml(volume)}</volume>\n`;
  if (issue) xml += `    <issue>${escapeXml(issue)}</issue>\n`;
  if (fpage) xml += `    <fpage>${escapeXml(fpage)}</fpage>\n`;
  if (lpage) xml += `    <lpage>${escapeXml(lpage)}</lpage>\n`;
  
  // History (received, accepted dates)
  if (receivedDate || acceptedDate) {
    xml += '    <history>\n';
    if (receivedDate && receivedDateParsed.iso) {
      xml += `      <date date-type="received" iso-8601-date="${receivedDateParsed.iso}">\n`;
      if (receivedDateParsed.year) xml += `        <year>${receivedDateParsed.year}</year>\n`;
      if (receivedDateParsed.month) xml += `        <month>${receivedDateParsed.month}</month>\n`;
      if (receivedDateParsed.day) xml += `        <day>${receivedDateParsed.day}</day>\n`;
      xml += '      </date>\n';
    }
    if (acceptedDate && acceptedDateParsed.iso) {
      xml += `      <date date-type="accepted" iso-8601-date="${acceptedDateParsed.iso}">\n`;
      if (acceptedDateParsed.year) xml += `        <year>${acceptedDateParsed.year}</year>\n`;
      if (acceptedDateParsed.month) xml += `        <month>${acceptedDateParsed.month}</month>\n`;
      if (acceptedDateParsed.day) xml += `        <day>${acceptedDateParsed.day}</day>\n`;
      xml += '      </date>\n';
    }
    xml += '    </history>\n';
  }
  
  // Permissions (license)
  xml += '    <permissions>\n';
  xml += `      <license license-type="open-access" xlink:href="${LICENSE_URL}">\n`;
  xml += `        <license-p>${escapeXml(LICENSE_TEXT)}</license-p>\n`;
  xml += '      </license>\n';
  xml += '    </permissions>\n';
  
  // Self-uri for PDF
  if (pdfUrl) {
    xml += `    <self-uri content-type="pdf" xlink:href="${escapeXml(pdfUrl)}"/>\n`;
  }
  
  // Abstract(s) - Bilingüe
  if (abstractEs) {
    xml += '    <abstract xml:lang="es">\n';
    xml += '      <title>Resumen</title>\n';
    xml += `      <p>${escapeXml(abstractEs)}</p>\n`;
    xml += '    </abstract>\n';
  }
  if (abstractEn) {
    xml += '    <abstract xml:lang="en">\n';
    xml += '      <title>Abstract</title>\n';
    xml += `      <p>${escapeXml(abstractEn)}</p>\n`;
    xml += '    </abstract>\n';
  }
  
  // Keywords - Bilingüe
  if (keywordsEs.length > 0) {
    xml += '    <kwd-group xml:lang="es">\n';
    xml += '      <title>Palabras clave</title>\n';
    keywordsEs.forEach(kwd => {
      const cleanedKwd = cleanText(kwd);
      if (cleanedKwd) {
        xml += `      <kwd>${escapeXml(cleanedKwd)}</kwd>\n`;
      }
    });
    xml += '    </kwd-group>\n';
  }
  if (keywordsEn.length > 0) {
    xml += '    <kwd-group xml:lang="en">\n';
    xml += '      <title>Keywords</title>\n';
    keywordsEn.forEach(kwd => {
      const cleanedKwd = cleanText(kwd);
      if (cleanedKwd) {
        xml += `      <kwd>${escapeXml(cleanedKwd)}</kwd>\n`;
      }
    });
    xml += '    </kwd-group>\n';
  }
  
  // Funding - Bilingüe
  if (fundingEs || fundingEn) {
    xml += '    <funding-group>\n';
    xml += '      <award-group>\n';
    if (fundingEs) {
      xml += `        <funding-source xml:lang="es">${escapeXml(fundingEs)}</funding-source>\n`;
    }
    if (fundingEn && fundingEn !== fundingEs) {
      xml += `        <funding-source xml:lang="en">${escapeXml(fundingEn)}</funding-source>\n`;
    }
    xml += '      </award-group>\n';
    xml += '    </funding-group>\n';
  }
  
  xml += '  </article-meta>\n';
  xml += '</front>\n';
  
  // ─── BODY ──────────────────────────────────────────────────────────────
  xml += bodyXml + '\n';
  
  // Cuerpo en inglés si existe
  if (hasEnglishBody) {
    xml += bodyEnXml + '\n';
  }
  
  // ─── BACK ──────────────────────────────────────────────────────────────
  xml += '<back>\n';
  
  // Acknowledgments - Bilingüe
  if (acknowledgmentsEs || acknowledgmentsEn) {
    xml += '  <ack>\n';
    xml += '    <title>Agradecimientos</title>\n';
    if (acknowledgmentsEs) {
      xml += `    <p xml:lang="es">${escapeXml(acknowledgmentsEs)}</p>\n`;
    }
    if (acknowledgmentsEn && acknowledgmentsEn !== acknowledgmentsEs) {
      xml += `    <p xml:lang="en">${escapeXml(acknowledgmentsEn)}</p>\n`;
    }
    xml += '  </ack>\n';
  }
  
  // Author credits
  if (authorCredits || authorCreditsEn) {
    xml += '  <ack>\n';
    xml += '    <title>Contribución de los autores</title>\n';
    if (authorCredits) {
      xml += `    <p xml:lang="es">${escapeXml(authorCredits)}</p>\n`;
    }
    if (authorCreditsEn && authorCreditsEn !== authorCredits) {
      xml += `    <p xml:lang="en">${escapeXml(authorCreditsEn)}</p>\n`;
    }
    xml += '  </ack>\n';
  }
  
  // Data availability
  if (dataAvailability || dataAvailabilityEn) {
    xml += '  <ack>\n';
    xml += '    <title>Disponibilidad de datos</title>\n';
    if (dataAvailability) {
      xml += `    <p xml:lang="es">${escapeXml(dataAvailability)}</p>\n`;
    }
    if (dataAvailabilityEn && dataAvailabilityEn !== dataAvailability) {
      xml += `    <p xml:lang="en">${escapeXml(dataAvailabilityEn)}</p>\n`;
    }
    xml += '  </ack>\n';
  }
  
  // Footnotes
  if (footnotesXml) {
    xml += '  ' + footnotesXml.trim() + '\n';
  }
  
  // Conflict of interest en back (si tiene contenido sustancial y no es "no tener conflictos")
  if (conflictsEs && !conflictsEs.toLowerCase().includes('no tener conflictos') && 
      !conflictsEs.toLowerCase().includes('no tener conflicto')) {
    xml += '  <fn-group>\n';
    xml += '    <fn fn-type="conflict" xml:lang="es">\n';
    xml += `      <p>${escapeXml(conflictsEs)}</p>\n`;
    xml += '    </fn>\n';
    xml += '  </fn-group>\n';
  }
  
  // References
  if (references.length > 0) {
    xml += '  <ref-list>\n';
    xml += '    <title>Referencias</title>\n';
    references.forEach(ref => {
      xml += `    <ref id="${escapeXml(ref.id)}">\n`;
      xml += '      <mixed-citation>';
      
      if (ref.authors) {
        xml += escapeXml(ref.authors);
      }
      if (ref.year) {
        xml += ` (${ref.year})`;
      }
      if (ref.title) {
        xml += `. <italic>${escapeXml(ref.title)}</italic>`;
      }
      if (ref.source) {
        xml += `. ${escapeXml(ref.source)}`;
      }
      if (ref.url && !ref.doi) {
        xml += `. <ext-link ext-link-type="uri" xlink:href="${escapeXml(ref.url)}">${escapeXml(ref.url)}</ext-link>`;
      }
      if (ref.doi) {
        xml += `. <pub-id pub-id-type="doi">${escapeXml(ref.doi)}</pub-id>`;
      }
      
      // Si no pudimos parsear bien, usamos el texto completo
      if (!ref.authors && !ref.year) {
        xml += escapeXml(ref.fullText);
      }
      
      xml += '</mixed-citation>\n';
      xml += '    </ref>\n';
    });
    xml += '  </ref-list>\n';
  }
  
  xml += '</back>\n';
  xml += '</article>';
  
  return xml;
}

// ─── PROCESAMIENTO PRINCIPAL ─────────────────────────────────────────────────

/**
 * Procesa un artículo del JSON y genera su JATS XML
 */
function processArticle(article, index) {
  const title = article.titulo || `Artículo ${index + 1}`;
  console.log(`Procesando artículo ${index + 1}: "${title.substring(0, 60)}${title.length > 60 ? '...' : ''}"`);
  
  try {
    const jatsXml = buildJatsXml(article);
    
    // Insertar en el campo jats
    article.jats = jatsXml;
    
    console.log(`  -> JATS generado correctamente (${jatsXml.length} caracteres)`);
    return { success: true, article };
  } catch (error) {
    console.error(`  -> Error: ${error.message}`);
    console.error(`     Stack: ${error.stack}`);
    return { success: false, article, error: error.message };
  }
}

/**
 * Función principal
 */
function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  Conversor articles.json a JATS XML v3.0');
  console.log('  Entrada: articles.json');
  console.log('  Salida: Campo "jats" en cada artículo del JSON');
  console.log('  Contenido HTML: desde campo "html_es"');
  console.log('  Textos bilingües: campos en español e inglés');
  console.log('═══════════════════════════════════════════════════════\n');
  
  // Verificar que existe el archivo de entrada
  if (!fs.existsSync(INPUT_FILE)) {
    console.error(`Error: El archivo '${INPUT_FILE}' no existe.`);
    process.exit(1);
  }
  
  // Leer el archivo JSON
  console.log(`Leyendo ${INPUT_FILE}...`);
  const rawData = fs.readFileSync(INPUT_FILE, 'utf-8');
  let articles;
  
  try {
    articles = JSON.parse(rawData);
  } catch (error) {
    console.error(`Error al parsear el JSON: ${error.message}`);
    process.exit(1);
  }
  
  // Si no es un array, verificar si es un objeto con artículos
  if (!Array.isArray(articles)) {
    // Posiblemente es un objeto con una propiedad que contiene el array
    const possibleKeys = ['articles', 'articulos', 'data', 'items'];
    let found = false;
    for (const key of possibleKeys) {
      if (articles[key] && Array.isArray(articles[key])) {
        articles = articles[key];
        found = true;
        break;
      }
    }
    if (!found) {
      // Si es un solo artículo, envolver en array
      if (articles.titulo || articles.title) {
        articles = [articles];
      } else {
        console.error('Error: El archivo JSON no contiene un array de artículos.');
        process.exit(1);
      }
    }
  }
  
  console.log(`Encontrados ${articles.length} artículo(s) en el JSON.\n`);
  
  // Procesar cada artículo
  let successCount = 0;
  let errorCount = 0;
  
  articles.forEach((article, index) => {
    const result = processArticle(article, index);
    if (result.success) {
      successCount++;
    } else {
      errorCount++;
    }
  });
  
  // Guardar el JSON actualizado
  console.log('\nGuardando archivo actualizado...');
  
  // Leer el archivo original nuevamente para mantener la estructura
  const originalData = JSON.parse(fs.readFileSync(INPUT_FILE, 'utf-8'));
  
  if (Array.isArray(originalData)) {
    // Actualizar el array original
    articles.forEach((article, index) => {
      if (originalData[index]) {
        originalData[index].jats = article.jats;
      }
    });
  } else {
    // Si era un solo artículo
    originalData.jats = articles[0].jats;
  }
  
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(originalData, null, 2), 'utf-8');
  
  // Resumen
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  RESUMEN');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  Total procesados: ${articles.length}`);
  console.log(`  Exitosos: ${successCount}`);
  console.log(`  Con errores: ${errorCount}`);
  console.log(`  Archivo actualizado: ${OUTPUT_FILE}`);
  console.log('═══════════════════════════════════════════════════════\n');
  
  // Mostrar ejemplo de un campo jats generado
  if (successCount > 0) {
    const exampleArticle = articles.find(a => a.jats);
    if (exampleArticle && exampleArticle.jats) {
      console.log('Ejemplo del XML generado (primeros 500 caracteres):');
      console.log('────────────────────────────────────────────────────');
      console.log(exampleArticle.jats.substring(0, 500) + '...');
      console.log('────────────────────────────────────────────────────\n');
    }
  }
}

// ─── EJECUCIÓN ────────────────────────────────────────────────────────────────
main();