const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
// ... al inicio del archivo, junto a los otros require
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
// ========== CONFIGURACIÓN ==========
const ARTICLES_JSON = path.join(__dirname, 'articles.json');
const OUTPUT_HTML_DIR = path.join(__dirname, 'articles');
const DOMAIN = 'https://www.revistacienciasestudiantes.com';
const JOURNAL_NAME_ES = 'Revista Nacional de las Ciencias para Estudiantes';
const JOURNAL_NAME_EN = 'The National Review of Sciences for Students';
const LOGO_ES = 'https://www.revistacienciasestudiantes.com/assets/logo.png';
const LOGO_EN = 'https://www.revistacienciasestudiantes.com/logoEN.png';
// ========== MODELO INTERMEDIO DE TABLA (AST) ==========

let tableCounter = 1;

function parseTable($, $table) {
  const table = {
    id: $table.attr('id') || `table-${tableCounter}`,
    number: tableCounter++,
    caption: $table.find('caption').text().trim() || null,
    class: $table.attr('class') || null,
    style: $table.attr('style') || null,
    headers: [],
    rows: [],
    columns: 0,
    footnotes: []
  };

  const rows = $table.find('tr');
  let headerProcessed = false;

  rows.each((i, row) => {
    const rowData = [];
    
    $(row).find('th, td').each((j, cell) => {
      const $cell = $(cell);
      
      rowData.push({
        text: $cell.text().trim().replace(/\s+/g, ' '),
        html: $cell.html(),
        colspan: parseInt($cell.attr('colspan')) || 1,
        rowspan: parseInt($cell.attr('rowspan')) || 1,
        class: $cell.attr('class') || null,
        style: $cell.attr('style') || null,
        align: $cell.attr('align') || null,
        type: cell.tagName.toLowerCase()
      });
    });

    if (!headerProcessed && ($(row).find('th').length > 0 || i === 0)) {
      table.headers = rowData;
      headerProcessed = true;
    } else {
      table.rows.push(rowData);
    }
  });

  table.columns = Math.max(
    table.headers.length,
    ...table.rows.map(r => r.reduce((sum, cell) => sum + (cell.colspan || 1), 0))
  );

  return table;
}

function formatCSVCell(text) {
  let cleanText = text.replace(/"/g, '""');
  return `"${cleanText}"`;
}

function tableToCSV(table) {
  const rows = [];
  if (table.headers.length) {
    rows.push(table.headers.map(h => formatCSVCell(h.text)).join(','));
  }
  table.rows.forEach(row => {
    rows.push(row.map(cell => formatCSVCell(cell.text)).join(','));
  });
  return rows.join('\n');
}

function tableToJSON(table) {
  const simpleTable = {
    number: table.number,
    caption: table.caption,
    headers: table.headers.map(h => h.text),
    rows: table.rows.map(row => row.map(cell => cell.text)),
    data: []
  };

  if (table.headers.length) {
    simpleTable.data = table.rows.map(row => {
      const obj = {};
      table.headers.forEach((header, idx) => {
        const key = header.text
          .toLowerCase()
          .replace(/\s+/g, '_')
          .replace(/[^\w]/g, '');
        obj[key] = row[idx]?.text || '';
      });
      return obj;
    });
  }

  return JSON.stringify(simpleTable, null, 2);
}

function escapeLaTeX(text) {
  return text
    .replace(/\\/g, '\\textbackslash ')
    .replace(/_/g, '\\_')
    .replace(/&/g, '\\&')
    .replace(/%/g, '\\%')
    .replace(/\$/g, '\\$')
    .replace(/#/g, '\\#')
    .replace(/{/g, '\\{')
    .replace(/}/g, '\\}')
    .replace(/~/g, '\\textasciitilde ')
    .replace(/\^/g, '\\textasciicircum ');
}

function tableToLaTeX(table) {
  if (!table.rows.length && !table.headers.length) return '';

  const alignment = 'l'.repeat(table.columns);
  let latex = [];

  latex.push('\\begin{table}[h]');
  latex.push('\\centering');
  
  if (table.caption) {
    latex.push(`\\caption{${escapeLaTeX(table.caption)}}`);
  }
  
  latex.push(`\\label{tab:${table.number}}`);
  latex.push(`\\begin{tabular}{|${alignment.split('').join('|')}|}`);
  latex.push('\\hline');

  if (table.headers.length) {
    const headerLine = table.headers
      .map(h => escapeLaTeX(h.text))
      .join(' & ');
    latex.push(headerLine + ' \\\\');
    latex.push('\\hline');
  }

  table.rows.forEach(row => {
    const rowLine = row
      .map(cell => escapeLaTeX(cell.text))
      .join(' & ');
    latex.push(rowLine + ' \\\\');
    latex.push('\\hline');
  });

  latex.push('\\end{tabular}');
  latex.push('\\end{table}');

  return latex.join('\n');
}

function escapeXML(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function tableToXML(table) {
  let xml = [];
  
  xml.push('<?xml version="1.0" encoding="UTF-8"?>');
  xml.push(`<table id="${table.id}" number="${table.number}" xmlns="http://www.w3.org/1999/xhtml">`);

  if (table.caption) {
    xml.push(`  <caption>${escapeXML(table.caption)}</caption>`);
  }

  if (table.headers.length) {
    xml.push('  <thead>');
    xml.push('    <tr>');
    table.headers.forEach(header => {
      xml.push(`      <th>${escapeXML(header.text)}</th>`);
    });
    xml.push('    </tr>');
    xml.push('  </thead>');
  }

  xml.push('  <tbody>');
  table.rows.forEach(row => {
    xml.push('    <tr>');
    row.forEach(cell => {
      xml.push(`      <td>${escapeXML(cell.text)}</td>`);
    });
    xml.push('    </tr>');
  });
  xml.push('  </tbody>');
  
  xml.push('</table>');

  return xml.join('\n');
}

function resetTableCounter() {
  tableCounter = 1;
}
// Asegurar que existe el directorio de salida
if (!fs.existsSync(OUTPUT_HTML_DIR)) {
  fs.mkdirSync(OUTPUT_HTML_DIR, { recursive: true });
}

// ========== UTILIDADES ==========
function generateSlug(text) {
  if (!text) return '';
  return text.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function formatDateEs(dateStr) {
  if (!dateStr) return 'N/A';
  return new Date(dateStr).toLocaleDateString('es-CL', { 
    day: '2-digit', 
    month: '2-digit', 
    year: 'numeric' 
  });
}

function formatDateEn(dateStr) {
  if (!dateStr) return 'N/A';
  return new Date(dateStr).toLocaleDateString('en-US', { 
    month: '2-digit', 
    day: '2-digit', 
    year: 'numeric' 
  });
}

function formatAuthorForCitation(author) {
  // author puede ser string u objeto
  let authorName = '';
  if (typeof author === 'string') {
    authorName = author;
  } else if (author && author.name) {
    authorName = author.name;
  } else if (author && (author.firstName || author.lastName)) {
    authorName = `${author.firstName || ''} ${author.lastName || ''}`.trim();
  } else {
    return '';
  }
  
  const parts = authorName.trim().split(' ');
  if (parts.length >= 2) {
    const apellido = parts.pop();
    const nombre = parts.join(' ');
    return `${apellido}, ${nombre}`;
  }
  return authorName;
}

function getAPAAuthor(author) {
  let authorName = '';
  if (typeof author === 'string') {
    authorName = author;
  } else if (author && author.name) {
    authorName = author.name;
  } else if (author && (author.firstName || author.lastName)) {
    authorName = `${author.firstName || ''} ${author.lastName || ''}`.trim();
  } else {
    return '';
  }
  
  const parts = authorName.trim().split(/\s+/);
  if (parts.length < 2) return authorName;
  const last = parts.pop();
  const initials = parts.map(n => n[0].toUpperCase() + '.').join(' ');
  return `${last}, ${initials}`;
}

function formatAuthorsAPA(authors) {
  // authors puede ser string o array
  let authorsArray = [];
  if (typeof authors === 'string') {
    authorsArray = authors.split(';').map(a => a.trim()).filter(Boolean);
  } else if (Array.isArray(authors)) {
    authorsArray = authors;
  }
  
  if (!authorsArray.length) return '';
  const formatted = authorsArray.map(getAPAAuthor);
  if (formatted.length === 1) {
    return formatted[0];
  } else if (formatted.length === 2) {
    return formatted[0] + ', & ' + formatted[1];
  } else {
    return formatted.slice(0, -1).join(', ') + ', & ' + formatted[formatted.length - 1];
  }
}

function formatAuthorsChicagoOrMLA(authors, language = 'es') {
  let authorsArray = [];
  if (typeof authors === 'string') {
    authorsArray = authors.split(';').map(a => a.trim()).filter(Boolean);
  } else if (Array.isArray(authors)) {
    authorsArray = authors;
  }
  
  if (!authorsArray.length) return '';
  const formatted = authorsArray.map(formatAuthorForCitation);
  const connector = language === 'es' ? 'y' : 'and';
  const etal = 'et al.';
  if (formatted.length === 1) {
    return formatted[0];
  } else if (formatted.length === 2) {
    return `${formatted[0]}, ${connector} ${formatted[1]}`;
  } else {
    return `${formatted[0]}, ${etal}`;
  }
}

function formatAuthorsDisplay(authors, language = 'es') {
  let authorsArray = [];
  if (typeof authors === 'string') {
    authorsArray = authors.split(';').map(a => a.trim()).filter(Boolean);
  } else if (Array.isArray(authors)) {
    authorsArray = authors.map(a => {
      if (typeof a === 'string') return a;
      if (a.name) return a.name;
      if (a.firstName || a.lastName) return `${a.firstName || ''} ${a.lastName || ''}`.trim();
      return '';
    }).filter(Boolean);
  }
  
  if (!authorsArray.length) return 'Autor desconocido';
  const connector = language === 'es' ? 'y' : 'and';
  if (authorsArray.length === 1) {
    return authorsArray[0];
  } else if (authorsArray.length === 2) {
    return `${authorsArray[0]} ${connector} ${authorsArray[1]}`;
  } else {
    return authorsArray.slice(0, -1).join(', ') + `, ${connector} ` + authorsArray[authorsArray.length - 1];
  }
}

function generateBibTeX(article) {
  const year = new Date(article.fecha).getFullYear();

  function escapeBibTeX(text) {
    if (!text) return '';

    const charMap = {
      'á': "{\\'a}", 'é': "{\\'e}", 'í': "{\\'i}", 'ó': "{\\'o}", 'ú': "{\\'u}",
      'Á': "{\\'A}", 'É': "{\\'E}", 'Í': "{\\'I}", 'Ó': "{\\'O}", 'Ú': "{\\'U}",
      'ä': "{\\\"a}", 'ë': "{\\\"e}", 'ï': "{\\\"i}", 'ö': "{\\\"o}", 'ü': "{\\\"u}",
      'Ä': "{\\\"A}", 'Ë': "{\\\"E}", 'Ï': "{\\\"I}", 'Ö': "{\\\"O}", 'Ü': "{\\\"U}",
      'ñ': "{\\~n}", 'Ñ': "{\\~N}",
      'ç': "{\\c{c}}", 'Ç': "{\\c{C}}",
      '&': "\\&", '%': "\\%", '$': "\\$", '#': "\\#", '_': "\\_"
    };

    let escaped = text;
    for (const [char, latex] of Object.entries(charMap)) {
      escaped = escaped.replace(new RegExp(char, 'g'), latex);
    }

    return escaped;
  }

  function formatAuthor(name) {
    if (!name) return '';

    const parts = name.trim().split(/\s+/);

    if (parts.length === 1) {
      return escapeBibTeX(parts[0]);
    }

    const lastName = parts.pop();
    const firstNames = parts.join(' ');

    return `${escapeBibTeX(lastName)}, ${escapeBibTeX(firstNames)}`;
  }

  let authors = [];

  if (typeof article.autores === 'string') {
    authors = article.autores.split(';').map(a => formatAuthor(a.trim()));
  } else if (Array.isArray(article.autores)) {
    authors = article.autores.map(a => {
      if (typeof a === 'string') return formatAuthor(a);
      if (a.name) return formatAuthor(a.name);
      if (a.firstName || a.lastName) {
        return formatAuthor(`${a.firstName || ''} ${a.lastName || ''}`.trim());
      }
      return '';
    });
  }

  const authorsForBib = authors.filter(Boolean).join(' and ');

  const firstAuthorLast = authors.length
    ? authors[0].split(',')[0].toLowerCase().replace(/[^a-z]/g, '')
    : 'article';

  const key = `${firstAuthorLast}${year}${article.numeroArticulo}`;

  const escapedTitle = escapeBibTeX(article.titulo);
  const journalName = "Revista Nacional de las Ciencias para Estudiantes";

  return `@article{${key},
  author = {${authorsForBib}},
  title = {${escapedTitle}},
  journal = {${journalName}},
  year = {${year}},
  volume = {${article.volumen}},
  number = {${article.numero}},
  pages = {${article.primeraPagina}--${article.ultimaPagina}},
  issn = {3087-2839},
  url = {${DOMAIN}/articles/article-${generateSlug(article.titulo)}-${article.numeroArticulo}.html}
}`.trim();
}
// ========== ICONOS SVG ==========
const oaSvg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="72" height="72" viewBox="90 50 500 260" style="vertical-align: middle;">
  <g transform="matrix(1.25 0 0 -1.25 0 360)">
    <defs>
      <path id="a" d="M-90-36h900v360H-90z"/>
    </defs>
    <clipPath id="b">
      <use xlink:href="#a" overflow="visible"/>
    </clipPath>
    <g clip-path="url(#b)">
      <path d="M720-3H0v294.285h720V-3z" fill="#fff"/>
      <path d="M262.883 200.896v-8.846h25.938v8.846c0 21.412 17.421 38.831 38.831 38.831 21.409 0 38.829-17.419 38.829-38.831v-63.985h25.939v63.985c0 35.713-29.056 64.769-64.768 64.769-35.711 0-64.769-29.056-64.769-64.769M349.153 99.568c0-11.816-9.58-21.396-21.399-21.396-11.818 0-21.398 9.58-21.398 21.396 0 11.823 9.58 21.404 21.398 21.404 11.819 0 21.399-9.581 21.399-21.404" fill="#f68212"/>
      <path d="M277.068 99.799c0 27.811 22.627 50.436 50.438 50.436 27.809 0 50.433-22.625 50.433-50.436 0-27.809-22.624-50.438-50.433-50.438-27.811.001-50.438 22.63-50.438 50.438m-25.938 0c0-42.109 34.265-76.373 76.375-76.373 42.111 0 76.373 34.265 76.373 76.373 0 42.113-34.262 76.375-76.373 76.375-42.11 0-76.375-34.262-76.375-76.375" fill="#f68212"/>
    </g>
  </g>
</svg>`;
const orcidSvg = `<svg viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg" width="16" height="16"> <circle cx="128" cy="128" r="120" fill="#A6CE39"/> <g fill="#FFFFFF"> <rect x="71" y="78" width="17" height="102"/> <circle cx="79.5" cy="56" r="11"/> <path d="M103 78 v102 h41.5 c28.2 0 51-22.8 51-51 s-22.8-51-51-51 H103 zm17 17 h24.5 c18.8 0 34 15.2 34 34 s-15.2 34-34 34 H120 V95 z" fill-rule="evenodd"/> </g> </svg>`;

const emailSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle; color: #005a7d;">
  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
  <polyline points="22,6 12,13 2,6"></polyline>
</svg>`;

const ccLogoSvg = `<img src="https://bibliotecas.ucn.cl/wp-content/uploads/2025/04/by1.png" alt="CC BY 4.0" style="height: 1.2em; width: auto; vertical-align: middle;">`;
// ========== SVG ICONS PARA REDES SOCIALES ==========
const socialIcons = {
  instagram: `<svg class="w-5 h-5 fill-current" viewBox="0 0 24 24"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/></svg>`,
  youtube: `<svg class="w-5 h-5 fill-current" viewBox="0 0 24 24"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>`,
  tiktok: `<svg class="w-5 h-5 fill-current" viewBox="0 0 24 24"><path d="M12.53.02C13.84 0 15.14.01 16.44 0c.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/></svg>`,
  spotify: `<svg class="w-5 h-5 fill-current" viewBox="0 0 24 24"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.508 17.308c-.221.362-.689.473-1.05.252-2.983-1.823-6.738-2.237-11.162-1.226-.411.094-.823-.162-.917-.573-.094-.412.162-.823.573-.917 4.847-1.108 8.995-.635 12.305 1.386.36.221.472.69.251 1.05zm1.47-3.255c-.278.452-.865.594-1.317.316-3.414-2.098-8.62-2.706-12.657-1.479-.508.154-1.04-.136-1.194-.644-.154-.508.136-1.04.644-1.194 4.613-1.399 10.366-.719 14.256 1.67.452.278.594.865.316 1.317zm.126-3.374C14.653 7.64 7.29 7.394 3.05 8.681c-.604.183-1.246-.166-1.429-.77-.183-.604.166-1.246.77-1.429 4.883-1.482 13.014-1.201 18.238 1.902.544.323.72 1.034.397 1.578-.323.544-1.034.72-1.578.397z"/></svg>`
};

// ========== SOCIAL LINKS ==========
const socialLinks = {
  instagram: 'https://www.instagram.com/revistanacionalcienciae',
  youtube: 'https://www.youtube.com/@RevistaNacionaldelasCienciaspa',
  tiktok: 'https://www.tiktok.com/@revistacienciaestudiante',
  spotify: 'https://open.spotify.com/show/6amsgUkNXgUTD219XpuqOe?si=LPzCNpusQjSLGBq_pPrVTw'
};
// ========== CARGA DE TEAM.JSON CON MATCHING ROBUSTO ==========
let authorMap = {}; // Mapa por uid
let authorByNameMap = {}; // Mapa por nombre normalizado
let authorBySlugMap = {}; // Mapa por slug

async function loadTeamData() {
  try {
    const TEAM_JSON_URL = 'https://www.revistacienciasestudiantes.com/team/Team.json';
    console.log(`🌐 Cargando equipo desde: ${TEAM_JSON_URL}`);

    const response = await fetch(TEAM_JSON_URL);
    if (!response.ok) {
      throw new Error(`Error HTTP ${response.status} al cargar Team.json`);
    }

    const team = await response.json();

    if (Array.isArray(team)) {
      team.forEach(member => {
        // Guardar por UID (para matching exacto)
        if (member.uid) {
          authorMap[member.uid] = {
            uid: member.uid,
            displayName: member.displayName,
            slug: member.slug,
            orcid: member.orcid,
            email: member.publicEmail,
            firstName: member.firstName,
            lastName: member.lastName,
            institution: member.institution,
            imageUrl: member.imageUrl
          };
        }
        
        // Guardar por slug
        if (member.slug) {
          authorBySlugMap[member.slug] = {
            ...authorMap[member.uid],
            uid: member.uid,
            displayName: member.displayName,
            slug: member.slug,
            orcid: member.orcid,
            email: member.publicEmail
          };
        }
        
        // Guardar por displayName (nombre exacto)
        if (member.displayName) {
          authorByNameMap[member.displayName] = {
            ...authorMap[member.uid],
            uid: member.uid,
            displayName: member.displayName,
            slug: member.slug,
            orcid: member.orcid,
            email: member.publicEmail
          };
        }
        
        // También guardar versiones normalizadas del nombre para matching fuzzy
        // (sin tildes, minúsculas, etc.)
        const normalizedName = member.displayName ? 
          member.displayName.toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '') : '';
        
        if (normalizedName && !authorByNameMap[normalizedName]) {
          authorByNameMap[normalizedName] = {
            ...authorMap[member.uid],
            uid: member.uid,
            displayName: member.displayName,
            slug: member.slug,
            orcid: member.orcid,
            email: member.publicEmail,
            normalizedName
          };
        }
        
        // Guardar por combinación de nombre y apellido
        if (member.firstName || member.lastName) {
          const fullName = `${member.firstName || ''} ${member.lastName || ''}`.trim();
          if (fullName && !authorByNameMap[fullName]) {
            authorByNameMap[fullName] = {
              ...authorMap[member.uid],
              uid: member.uid,
              displayName: member.displayName,
              slug: member.slug,
              orcid: member.orcid,
              email: member.publicEmail
            };
          }
        }
      });
      
      console.log(`📚 ${Object.keys(authorMap).length} autores cargados por UID`);
      console.log(`📚 ${Object.keys(authorByNameMap).length} variantes de nombres indexadas`);
    } else {
      console.log('⚠️ El JSON cargado no es un array.');
    }

  } catch (e) {
    console.log('⚠️ No se pudo cargar Team.json desde la URL, los autores no tendrán enlaces. Error:', e.message);
  }
}

// ========== FUNCIÓN DE MATCHING DE AUTORES ==========
function findAuthorInfo(author, articleAuthorId = null) {
  if (!author) return null;
  
  // Obtener el nombre para mostrar
  let displayName = '';
  if (typeof author === 'string') {
    displayName = author;
  } else if (author.name) {
    displayName = author.name;
  } else if (author.firstName || author.lastName) {
    displayName = `${author.firstName || ''} ${author.lastName || ''}`.trim();
  } else {
    return null;
  }
  
  // 1. INTENTAR POR UID (matching más exacto)
  if (articleAuthorId && authorMap[articleAuthorId]) {
    console.log(`✅ Match por UID: ${articleAuthorId} -> ${authorMap[articleAuthorId].displayName}`);
    return authorMap[articleAuthorId];
  }
  
  // 2. INTENTAR POR NOMBRE EXACTO
  if (authorByNameMap[displayName]) {
    console.log(`✅ Match por nombre exacto: ${displayName}`);
    return authorByNameMap[displayName];
  }
  
  // 3. INTENTAR POR SLUG (si el autor tiene slug en el artículo)
  if (author.slug && authorBySlugMap[author.slug]) {
    console.log(`✅ Match por slug: ${author.slug}`);
    return authorBySlugMap[author.slug];
  }
  
  // 4. INTENTAR MATCHING INTELIGENTE PARA NOMBRES CON NÚMEROS (ej: "nombre-apellido2")
  // Esto maneja casos donde hay duplicados como "Juan Pérez" y "Juan Pérez2"
  const baseNameMatch = displayName.replace(/\d+$/, '').trim(); // Quita números al final
  if (baseNameMatch !== displayName) {
    // Buscar el nombre base en el mapa
    for (const [key, value] of Object.entries(authorByNameMap)) {
      if (key.startsWith(baseNameMatch) || baseNameMatch.startsWith(key)) {
        console.log(`✅ Match por nombre base: ${displayName} -> ${key}`);
        return value;
      }
    }
  }
  
  // 5. INTENTAR NORMALIZACIÓN AVANZADA
  const normalized = displayName.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
  
  const normalizedWithoutNumbers = normalized.replace(/\d+/g, '');
  
  for (const [key, value] of Object.entries(authorByNameMap)) {
    const keyNormalized = key.toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, '');
    
    const keyWithoutNumbers = keyNormalized.replace(/\d+/g, '');
    
    // Comparar versiones normalizadas
    if (keyNormalized === normalized || 
        keyWithoutNumbers === normalizedWithoutNumbers ||
        keyNormalized.includes(normalized) || 
        normalized.includes(keyNormalized)) {
      console.log(`✅ Match por normalización: ${displayName} -> ${key}`);
      return value;
    }
  }
  
  // 6. ÚLTIMO RECURSO: Intentar por apellido si es que tenemos firstName/lastName
  if (typeof author !== 'string' && (author.firstName || author.lastName)) {
    const lastName = author.lastName || '';
    const firstName = author.firstName || '';
    
    for (const [key, value] of Object.entries(authorMap)) {
      if (value.lastName && value.lastName.toLowerCase() === lastName.toLowerCase()) {
        // Coincidencia por apellido
        if (value.firstName && value.firstName.toLowerCase().startsWith(firstName.toLowerCase().charAt(0))) {
          console.log(`✅ Match por apellido + inicial: ${displayName}`);
          return value;
        }
      }
    }
  }
  
  console.log(`❌ No se encontró match para: ${displayName}`);
  return null;
}

// ========== FUNCIÓN PARA PROCESAR AUTORES CON ICONOS (MEJORADA) ==========
// ========== FUNCIÓN PARA PROCESAR AUTORES CON ICONOS (MEJORADA CON IDIOMA Y CORRESPONDENCIA) ==========
function processAuthorsWithIcons(authors, article = null, lang = 'es') {
  if (!authors) return 'Autor desconocido';
  
  let authorsArray = [];
  if (typeof authors === 'string') {
    authorsArray = authors.split(';').map(name => ({ name: name.trim() }));
  } else if (Array.isArray(authors)) {
    authorsArray = authors.map(a => {
      if (typeof a === 'string') return { name: a };
      return a; // ya es objeto
    });
  }
  
  const isSpanish = lang === 'es';
  const superindices = 'abcdefghijklmnopqrstuvwxyz';
  
  const authorElements = authorsArray.map((author, index) => {
    // Obtener nombre para mostrar
    let displayName = '';
    if (typeof author === 'string') {
      displayName = author;
    } else if (author.name) {
      displayName = author.name;
    } else if (author.firstName || author.lastName) {
      displayName = `${author.firstName || ''} ${author.lastName || ''}`.trim();
    } else {
      displayName = 'Autor';
    }
    
    // Obtener el authorId del artículo si existe
    const articleAuthorId = article && article.authorIds ? article.authorIds[index] : null;
    
    // Buscar información del autor usando nuestra función de matching
    const authorInfo = findAuthorInfo(author, articleAuthorId);
    
    // Construir HTML del autor
    let authorHtml = '';
    
    if (authorInfo && authorInfo.slug) {
      // Tiene slug, crear enlace - ¡VERSIÓN CORREGIDA PARA IDIOMA!
      const authorFile = isSpanish ? `${authorInfo.slug}.html` : `${authorInfo.slug}.EN.html`;
      authorHtml += `<a href="/team/${authorFile}" class="author-link"`;
      
      // Añadir atributos de datos para metadata
      if (authorInfo.uid) {
        authorHtml += ` data-author-uid="${authorInfo.uid}"`;
      }
      if (authorInfo.orcid) {
        authorHtml += ` data-author-orcid="${authorInfo.orcid}"`;
      }
      
      authorHtml += `>${displayName}</a>`;
    } else {
      // No tiene slug, solo texto
      authorHtml += `<span class="author-name"`;
      if (authorInfo && authorInfo.uid) {
        authorHtml += ` data-author-uid="${authorInfo.uid}"`;
      }
      authorHtml += `>${displayName}</span>`;
    }
    
    // AÑADIR SUPERÍNDICE (a, b, c, etc.)
    const supLetter = superindices[index] || String(index + 1);
    authorHtml += `<sup class="author-sup">${supLetter}</sup>`;
    
    // Añadir iconos
    const icons = [];
    
    // ORCID (verde) - Priorizar información del team.json
    const orcid = (authorInfo && authorInfo.orcid) || author.orcid;
    if (orcid && orcid.trim() !== '') {
      icons.push(`<a href="https://orcid.org/${orcid}" target="_blank" rel="noopener noreferrer" class="author-icon orcid-icon" title="ORCID">${orcidSvg}</a>`);
    }
    
    // Email (azul)
    const email = (authorInfo && authorInfo.email) || author.email || author.publicEmail;
    if (email && email.trim() !== '') {
      const gmailUrl = 'https://mail.google.com/mail/?view=cm&fs=1&to=' + encodeURIComponent(email);
      icons.push('<a href="' + gmailUrl + '" target="_blank" rel="noopener noreferrer" class="author-icon email-icon" title="' + (isSpanish ? 'Enviar email' : 'Send email') + '">' + emailSvg + '</a>');
    }
    
    // ICONO DE CORRESPONDENCIA (solo si isCorresponding === true)
    const isCorresponding = author.isCorresponding === true || (authorInfo && authorInfo.isCorresponding === true);
    if (isCorresponding) {
      icons.push(`<span class="author-icon corresponding-icon" title="${isSpanish ? 'Autor de correspondencia' : 'Corresponding author'}">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle;">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
          <circle cx="12" cy="7" r="4"></circle>
        </svg>
      </span>`);
    }
    
    if (icons.length > 0) {
      authorHtml += `<span class="author-icons">${icons.join('')}</span>`;
    }
    
    return authorHtml;
  });
  
  return authorElements.join('<span class="author-separator">, </span>');
}
function generateInstitutionsList(autores, lang) {
  let authorsArray;
  if (typeof autores === 'string') {
    authorsArray = autores.split(';').map(a => ({ name: a.trim() }));
  } else if (Array.isArray(autores)) {
    authorsArray = autores;
  } else {
    authorsArray = [];
  }

  const superindices = 'abcdefghijklmnopqrstuvwxyz';
  const institutions = [];
  
  authorsArray.forEach((author, index) => {
    if (author.institution) {
      const supLetter = superindices[index] || String(index + 1);
      institutions.push(`<li><sup>${supLetter}</sup> ${author.institution}</li>`);
    }
  });

  return institutions.length ? 
    `<ul class="institutions-list">${institutions.join('')}</ul>` : '';
}

// ========== FUNCIÓN PARA PROCESAR TABLAS CON BOTONES DE DESCARGA (ACTUALIZADA CON MODELO) ==========
function processTablesWithDownload($, html) {
  if (!html) return html;
  
  // Resetear contador de tablas para cada artículo
  resetTableCounter();
  
  let tableIndex = 0;
  
  $('table').each((i, el) => {
    const $el = $(el);
    tableIndex++;
    const tableId = `table-${tableIndex}`;
    $el.attr('id', tableId);
    $el.addClass('article-table');
    
    // USAR EL MODELO INTERMEDIO - Parsear la tabla UNA vez
    const tableModel = parseTable($, $el);
    
    // Generar todos los formatos usando el modelo
    const csvContent = tableToCSV(tableModel);
    const jsonContent = tableToJSON(tableModel);
    const latexContent = tableToLaTeX(tableModel);
    const xmlContent = tableToXML(tableModel);
    
    // Generar HTML de la tabla
    const tableHtml = $.html($el);
    
    // Añadir BOM (Byte Order Mark) para UTF-8 en Excel
    const BOM = '\uFEFF';
    
    // Crear el wrapper con botones
    const tableWrapper = `
    <div class="table-download-wrapper">
      <div class="table-header">
        <span class="table-label">Tabla ${tableIndex}</span>

        <div class="table-download-buttons">
          <!-- CSV -->
          <a href="data:text/csv;charset=utf-8,${encodeURIComponent(BOM + csvContent)}"
             download="tabla-${tableIndex}.csv"
             class="table-download-btn"
             title="Descargar como CSV">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="2"
                 stroke-linecap="round" stroke-linejoin="round">
              <path d="M9 12h6"/>
              <path d="M9 16h6"/>
              <path d="M9 8h3"/>
              <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/>
              <path d="M14 2v6h6"/>
            </svg>
            <span>CSV</span>
          </a>

          <!-- Excel -->
          <a href="data:application/vnd.ms-excel;charset=utf-8,${encodeURIComponent(BOM + tableHtml)}"
             download="tabla-${tableIndex}.xls"
             class="table-download-btn"
             title="Descargar como Excel">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="2"
                 stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
              <line x1="3" y1="9" x2="21" y2="9"/>
              <line x1="3" y1="15" x2="21" y2="15"/>
              <line x1="9" y1="3" x2="9" y2="21"/>
              <line x1="15" y1="3" x2="15" y2="21"/>
            </svg>
            <span>Excel</span>
          </a>

          <!-- JSON -->
          <a href="data:application/json;charset=utf-8,${encodeURIComponent(jsonContent)}"
             download="tabla-${tableIndex}.json"
             class="table-download-btn"
             title="Descargar como JSON">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="2"
                 stroke-linecap="round" stroke-linejoin="round">
              <path d="M10 20c-1.5 0-2.5-1-2.5-2.5v-3.5c0-1-1-1.5-2-1.5s-2-.5-2-1.5v-1c0-1 1-1.5 2-1.5s2-.5 2-1.5v-3.5c0-1.5 1-2.5 2.5-2.5"/>
              <path d="M14 4c1.5 0 2.5 1 2.5 2.5v3.5c0 1 1 1.5 2 1.5s2 .5 2 1.5v1c0 1-1 1.5-2 1.5s-2 .5-2 1.5v3.5c0 1.5-1 2.5-2.5 2.5"/>
            </svg>
            <span>JSON</span>
          </a>

          <!-- LaTeX -->
          <a href="data:text/plain;charset=utf-8,${encodeURIComponent(latexContent)}"
             download="tabla-${tableIndex}.tex"
             class="table-download-btn"
             title="Descargar como LaTeX">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="2"
                 stroke-linecap="round" stroke-linejoin="round">
              <path d="M19 4h-12l7 8-7 8h12"/>
            </svg>
            <span>LaTeX</span>
          </a>

          <!-- XML -->
          <a href="data:application/xml;charset=utf-8,${encodeURIComponent(xmlContent)}"
             download="tabla-${tableIndex}.xml"
             class="table-download-btn"
             title="Descargar como XML">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="2"
                 stroke-linecap="round" stroke-linejoin="round">
              <polyline points="16 18 22 12 16 6"/>
              <polyline points="8 6 2 12 8 18"/>
            </svg>
            <span>XML</span>
          </a>
        </div>
      </div>

      <div class="table-wrapper">
        ${$.html($el)}
      </div>
    </div>
    `;
    
    $el.replaceWith(tableWrapper);
  });
  
  return $.html();
}
// ========== FUNCIÓN PARA PROCESAR CÓDIGOS CON CODEMIRROR ==========
function processCodeBlocks(html) {
  if (!html) return html;
  
  // Limpiar basura de documento
  let cleanedHtml = html
    .replace(/<!DOCTYPE[^>]*>/gi, '')
    .replace(/<html[^>]*>/gi, '')
    .replace(/<\/html>/gi, '')
    .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, '')
    .replace(/<body[^>]*>/gi, '')
    .replace(/<\/body>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<link[^>]*>/gi, '')
    .replace(/<meta[^>]*>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  
  const $ = cheerio.load(cleanedHtml, { decodeEntities: false });
  let codeIndex = 0;
  
  // Mapa de lenguajes de Highlight.js a CodeMirror
  const languageMap = {
    'python': 'python',
    'py': 'python',
    'javascript': 'javascript',
    'js': 'javascript',
    'typescript': 'javascript',
    'ts': 'javascript',
    'html': 'htmlmixed',
    'xml': 'xml',
    'css': 'css',
    'scss': 'css',
    'bash': 'shell',
    'sh': 'shell',
    'shell': 'shell',
    'r': 'r',
    'c': 'clike',
    'cpp': 'clike',
    'c++': 'clike',
    'java': 'clike',
    'csharp': 'clike',
    'cs': 'clike',
    'sql': 'sql',
    'php': 'php',
    'yaml': 'yaml',
    'yml': 'yaml',
    'dockerfile': 'dockerfile',
    'markdown': 'markdown',
    'md': 'markdown',
    'json': 'javascript',
    'latex': 'stex'
  };
  
  $('pre').each((i, el) => {
    const $el = $(el);
    
    // Evitar reprocesar
    if ($el.parent().hasClass('code-block-wrapper')) {
      return;
    }
    
    // Buscar el elemento code dentro
    let $codeElement = $el.find('code').first();
    let code;
    let language = '';
    
    if ($codeElement.length > 0) {
      code = $codeElement.text();
      const classAttr = $codeElement.attr('class') || '';
      if (classAttr.includes('language-')) {
        language = classAttr.split('language-')[1].split(' ')[0];
      } else if (classAttr.includes('lang-')) {
        language = classAttr.split('lang-')[1].split(' ')[0];
      }
    } else {
      code = $el.text();
    }
    
    // ESCAPAR el código para HTML
    const escapedCode = code
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    
    codeIndex++;
    const codeId = 'code-' + codeIndex;
    
    // Determinar el modo de CodeMirror
    const cmMode = languageMap[language.toLowerCase()] || 'python';
    
    const copySvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
    
    // Construir HTML con un textarea que CodeMirror convertirá
    const codeHtml = [
      '<div class="code-block-wrapper" id="' + codeId + '">',
      '  <div class="code-header">',
      '    <span class="code-language">' + (language || 'código') + '</span>',
      '    <button class="code-copy-btn" onclick="copyCodeFromCM(\'' + codeId + '\', this)" title="Copiar código">',
      '      ' + copySvg,
      '      <span class="copy-text">Copiar</span>',
      '    </button>',
      '  </div>',
      '  <div class="code-block-container">',
      '    <textarea id="' + codeId + '-textarea" class="codemirror-textarea" data-mode="' + cmMode + '">' + escapedCode + '</textarea>',
      '  </div>',
      '</div>'
    ].join('\n');
    
    $el.replaceWith(codeHtml);
  });
  
  let processedHtml = $.html();
  
  // Procesar tablas DESPUÉS del código
  const $2 = cheerio.load(processedHtml, { decodeEntities: false });
  processedHtml = processTablesWithDownload($2, processedHtml);
  
  // Procesar imágenes
  const $3 = cheerio.load(processedHtml, { decodeEntities: false });
  
  let figureIndex = 0;
  $3('img').each((i, el) => {
    const $el = $3(el);
    const alt = $el.attr('alt') || '';
    const src = $el.attr('src') || '';
    const style = $el.attr('style') || '';
    const align = $el.attr('align') || '';
    
    $el.addClass('article-image');
    
    let floatClass = '';
    if (style.includes('float: left') || align === 'left') {
      floatClass = ' float-left';
    } else if (style.includes('float: right') || align === 'right') {
      floatClass = ' float-right';
    }
    
    figureIndex++;
    const figureId = 'figure-' + figureIndex;
    
    if (src) {
      $el.wrap('<a href="' + src + '" target="_blank" rel="noopener noreferrer" class="image-link"></a>');
    }
    
    if (alt) {
      $el.parent().wrap('<figure class="image-figure' + floatClass + '" id="' + figureId + '"></figure>');
      $el.parent().after('<figcaption class="image-caption">' + alt + '</figcaption>');
    } else {
      $el.parent().wrap('<figure class="image-figure' + floatClass + '" id="' + figureId + '"></figure>');
    }
  });
  
  // Procesar ecuaciones
  let equationIndex = 0;
  $3('.MathJax_Display, .math-container').each((i, el) => {
    const $el = $3(el);
    equationIndex++;
    const equationId = 'equation-' + equationIndex;
    $el.attr('id', equationId);
  });
  
  return $3.html();
}
// ========== FUNCIÓN PRINCIPAL ==========
async function generateAll() {
  console.log('🚀 Iniciando generación de artículos estáticos...');
  
  try {
    // 1. Leer articles.json
    if (!fs.existsSync(ARTICLES_JSON)) {
      throw new Error(`No se encuentra ${ARTICLES_JSON}`);
    }
    
    const articles = JSON.parse(fs.readFileSync(ARTICLES_JSON, 'utf8'));
    console.log(`📄 ${articles.length} artículos cargados`);

    // 2. Cargar team.json desde la URL para slugs de autores
    await loadTeamData();

    // 3. Generar HTML para cada artículo
    for (const article of articles) {
      await generateArticleHtml(article);
    }

    // 4. Generar índices
    generateIndexes(articles);

    console.log('🎉 ¡Proceso completado con éxito!');
    
  } catch (err) {
    console.error('❌ Error:', err);
    process.exit(1);
  }
}

async function generateArticleHtml(article) {
  // Procesar autores para meta tags de citación
  let authorsList = [];
  if (typeof article.autores === 'string') {
    authorsList = article.autores.split(';').map(a => formatAuthorForCitation(a));
  } else if (Array.isArray(article.autores)) {
    authorsList = article.autores.map(a => formatAuthorForCitation(a));
  }
  const authorMetaTags = authorsList.map(author => `<meta name="citation_author" content="${author}">`).join('\n');
  
  const articleSlug = article.permalink || `${generateSlug(article.titulo)}-${article.numeroArticulo}`;

  // Construir autores con iconos - AHORA PASAMOS EL ARTÍCULO COMPLETO
  const authorsDisplayEs = processAuthorsWithIcons(article.autores, article, 'es');
  const authorsDisplayEn = processAuthorsWithIcons(article.autores, article, 'en');
  const institutionsList = generateInstitutionsList(article.autores, 'es');
  const finalAuthorsDisplay = formatAuthorsDisplay(article.autores, 'es');
  const authorsAPA = formatAuthorsAPA(article.autores);
  const authorsChicagoEs = formatAuthorsChicagoOrMLA(article.autores, 'es');
  const authorsMLAEs = formatAuthorsChicagoOrMLA(article.autores, 'es');
  const authorsChicagoEn = formatAuthorsChicagoOrMLA(article.autores, 'en');
  const authorsMLAEn = formatAuthorsChicagoOrMLA(article.autores, 'en');
  const year = new Date(article.fecha).getFullYear();
  const tipoEs = article.tipo || 'Artículo de Investigación';
  const typeEn = article.type || 'Research Article';
  const bibtex = generateBibTeX(article);
  
  // Procesar abstracts con párrafos
  const resumenParagraphs = (article.resumen || '').split('\n\n').map(p => `<p class="abstract-text">${p}</p>`).join('');
  const abstractParagraphs = (article.abstract || '').split('\n\n').map(p => `<p class="abstract-text">${p}</p>`).join('');

  // Procesar HTML del artículo (con bloques de código, tablas, etc.)
  const processedHtmlEs = processCodeBlocks(article.html_es || '');
  const processedHtmlEn = processCodeBlocks(article.html_en || '');

  // Procesar referencias
  const referencesHtml = (() => {
    if (!article.referencias) return '<p>No hay referencias disponibles.</p>';
    
    if (article.referencias.includes('<div class="references-list">')) {
      return article.referencias;
    }
    
    const refItems = article.referencias.split('\n').filter(line => line.trim());
    if (refItems.length) {
      const items = refItems.map(ref => {
        const idMatch = ref.match(/id="([^"]+)"/);
        const id = idMatch ? idMatch[1] : '';
        return `<div class="reference-item"${id ? ` id="${id}"` : ''}>${ref}</div>`;
      }).join('');
      return `<div class="references-list">${items}</div>`;
    }
    
    return '<p>No hay referencias disponibles.</p>';
  })();

  // ========== HTML ESPAÑOL ==========
  const htmlContentEs = generateHtmlTemplate({
    lang: 'es',
    article,
    articleSlug,
    authorMetaTags,
    authorsDisplay: authorsDisplayEs,
    institutionsList,
    finalAuthorsDisplay,
    authorsAPA,
    authorsChicagoEs,
    authorsMLAEs,
    authorsChicagoEn,
    authorsMLAEn,
    year,
    tipoEs,
    typeEn,
    bibtex,
    resumenParagraphs,
    abstractParagraphs,
    referencesHtml,
    htmlContent: processedHtmlEs,
    domain: DOMAIN,
    oaSvg,
    orcidSvg,
    emailSvg,
    ccLogoSvg
  });

  const filePathEs = path.join(OUTPUT_HTML_DIR, `article-${articleSlug}.html`);
  fs.writeFileSync(filePathEs, htmlContentEs, 'utf8');
  console.log(`✅ Generado: ${filePathEs}`);

  // ========== HTML INGLÉS ==========
  const htmlContentEn = generateHtmlTemplate({
    lang: 'en',
    article,
    articleSlug,
    authorMetaTags,
    authorsDisplay: authorsDisplayEn,
    institutionsList,
    finalAuthorsDisplay,
    authorsAPA,
    authorsChicagoEs,
    authorsMLAEs,
    authorsChicagoEn,
    authorsMLAEn,
    year,
    tipoEs,
    typeEn,
    bibtex,
    resumenParagraphs,
    abstractParagraphs,
    referencesHtml,
    htmlContent: processedHtmlEn,
    domain: DOMAIN,
    oaSvg,
    orcidSvg,
    emailSvg,
    ccLogoSvg
  });

  const filePathEn = path.join(OUTPUT_HTML_DIR, `article-${articleSlug}EN.html`);
  fs.writeFileSync(filePathEn, htmlContentEn, 'utf8');
  console.log(`✅ Generado: ${filePathEn}`);
}

function generateHtmlTemplate({
  lang,
  article,
  articleSlug,
  authorMetaTags,
  authorsDisplay,
  finalAuthorsDisplay,
  institutionsList,
  authorsAPA,
  authorsChicagoEs,
  authorsMLAEs,
  authorsChicagoEn,
  authorsMLAEn,
  year,
  tipoEs,
  typeEn,
  bibtex,
  resumenParagraphs,
  abstractParagraphs,
  referencesHtml,
  htmlContent,
  domain,
  oaSvg,
  orcidSvg,
  emailSvg,
  ccLogoSvg
}) {
  const isSpanish = lang === 'es';
  
  // Título y metadatos según idioma - LÓGICA MEJORADA PARA TÍTULOS BILINGÜES
  // Determinar títulos disponibles
  const hasSpanishTitle = article.titulo && article.titulo.trim() !== '';
  const hasEnglishTitle = article.tituloEnglish && article.tituloEnglish.trim() !== '';
  // ============ PROCESAR KEYWORDS Y CÓDIGOS ESPECIALIZADOS ============
const keywordsArray = isSpanish 
  ? (Array.isArray(article.palabras_clave) 
      ? article.palabras_clave 
      : (typeof article.palabras_clave === 'string' ? article.palabras_clave.split(';').map(k => k.trim()).filter(Boolean) : []))
  : (Array.isArray(article.keywords_english) 
      ? article.keywords_english 
      : (typeof article.keywords_english === 'string' ? article.keywords_english.split(';').map(k => k.trim()).filter(Boolean) : []));

const specializedCodesArray = Array.isArray(article.specialized_codes) 
  ? article.specialized_codes 
  : (typeof article.specialized_codes === 'string' ? article.specialized_codes.split(';').map(c => c.trim()).filter(Boolean) : []);

const vocabularyName = article.keywords_vocabulary || article.keywords_vocabulary || '';
  // Título principal según idioma actual
  let title = '';
  let altTitle = '';
  
  if (isSpanish) {
    // Versión en español
    title = hasSpanishTitle ? article.titulo : (hasEnglishTitle ? article.tituloEnglish : '');
    
    // Título alternativo (solo si hay título en inglés)
    if (hasEnglishTitle && hasSpanishTitle) {
      altTitle = article.tituloEnglish;
    }
  } else {
    // Versión en inglés
    title = hasEnglishTitle ? article.tituloEnglish : (hasSpanishTitle ? article.titulo : '');
    
    // Título alternativo (solo si hay título en español)
    if (hasSpanishTitle && hasEnglishTitle) {
      altTitle = article.titulo;
    }
  }
  
  const articleType = isSpanish ? tipoEs : typeEn;
  const abstractContent = isSpanish ? resumenParagraphs : abstractParagraphs;
  const altAbstract = isSpanish ? abstractParagraphs : resumenParagraphs;
  const keywords = isSpanish ? (article.palabras_clave || []) : (article.keywords_english || []);
  const funding = isSpanish ? article.funding : article.fundingEnglish;
  const conflicts = isSpanish ? article.conflicts : article.conflictsEnglish;
  const acknowledgments = isSpanish ? article.acknowledgments : article.acknowledgmentsEnglish;
  const authorCredits = isSpanish ? article.authorCredits : article.authorCreditsEnglish;
  const dataAvailability = isSpanish ? article.dataAvailability : article.dataAvailabilityEnglish;
  const fecha = isSpanish ? formatDateEs(article.fecha) : formatDateEn(article.fecha);
  const receivedDate = isSpanish ? formatDateEs(article.receivedDate) : formatDateEn(article.receivedDate);
  const acceptedDate = isSpanish ? formatDateEs(article.acceptedDate) : formatDateEn(article.acceptedDate);

  // Textos según idioma
  const texts = {
    es: {
      backToCatalog: 'Volver al catálogo',
      backToHome: 'Volver al inicio',
      viewOtherLang: 'View in English',
      abstract: 'Resumen',
      viewAbstract: 'Ver abstract en inglés / View English abstract',
      references: 'Referencias',
      acknowledgments: 'Agradecimientos',
      funding: 'Financiamiento',
      dataAvailability: 'Disponibilidad de datos',
      authorContributions: 'Contribución de autores',
      conflictOfInterest: 'Conflicto de intereses',
      pdfPreview: 'Visualización del PDF',
      viewFullScreen: 'Ver en pantalla completa',
      downloadPDF: 'Descargar PDF',
      howToCite: 'Cómo citar',
      information: 'Información',
      keywords: 'Palabras clave',
      articleInfo: 'Información del artículo',
      received: 'Recibido',
      accepted: 'Aceptado',
      published: 'Publicado',
      area: 'Área',
      fundingLabel: 'Financiación',
      copy: 'Copiar',
      copied: '✓ Copiado con formato',
      downloadBibTeX: 'Descargar BibTeX',
      contents: 'CONTENIDO',
      copyCode: 'Copiar código',
      codeCopied: '✓ Copiado',
      license: 'Licencia',
      contact: 'Contacto'
    },
    en: {
      backToCatalog: 'Back to catalog',
      backToHome: 'Back to home',
      viewOtherLang: 'Ver en español',
      abstract: 'Abstract',
      viewAbstract: 'Ver resumen en español / View Spanish abstract',
      references: 'References',
      acknowledgments: 'Acknowledgments',
      funding: 'Funding',
      dataAvailability: 'Data availability',
      authorContributions: 'Author contributions',
      conflictOfInterest: 'Conflict of interest',
      pdfPreview: 'PDF Preview',
      viewFullScreen: 'View Full Screen',
      downloadPDF: 'Download PDF',
      howToCite: 'How to cite',
      information: 'Information',
      keywords: 'Keywords',
      articleInfo: 'Article Information',
      received: 'Received',
      accepted: 'Accepted',
      published: 'Published',
      area: 'Area',
      fundingLabel: 'Funding',
      copy: 'Copy',
      copied: '✓ Copied!',
      downloadBibTeX: 'Download BibTeX',
      contents: 'CONTENTS',
      copyCode: 'Copy code',
      codeCopied: '✓ Copied',
      license: 'License',
      contact: 'Contact'
    }
  };

  const t = texts[lang];

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0">
  <meta name="citation_title" content="${title.replace(/"/g, '&quot;')}">
  ${authorMetaTags}
  <meta name="citation_doi" content="${article.doi.replace('https://doi.org', '')}">
  <meta name="citation_publication_date" content="${article.fecha.replace(/-/g, '/')}">
  <meta name="citation_journal_title" content="Revista Nacional de las Ciencias para Estudiantes">
  <meta name="citation_issn" content="3087-2839">
  <meta name="citation_volume" content="${article.volumen}">
  <meta name="citation_issue" content="${article.numero}">
  <meta name="citation_firstpage" content="${article.primeraPagina}">
  <meta name="citation_lastpage" content="${article.ultimaPagina}">
  <meta name="citation_pdf_url" content="${article.pdfUrl}">
  <meta name="citation_abstract_html_url" content="${domain}/articles/article-${articleSlug}${isSpanish ? '' : 'EN'}.html">
  <meta name="citation_abstract" content="${(isSpanish ? article.resumen : article.abstract).replace(/"/g, '&quot;')}">
  <meta name="citation_keywords" content="${keywords.join('; ')}">
  <meta name="citation_language" content="${lang}">
  <meta name="description" content="${(isSpanish ? article.resumen : article.abstract).replace(/"/g, '&quot;').substring(0, 160)}...">
  <meta name="keywords" content="${keywords.join(', ')}">
  <title>${title.replace(/"/g, '&quot;')} - Revista Nacional de las Ciencias para Estudiantes</title>

  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Playfair+Display:ital,wght@0,700;1,700&family=JetBrains+Mono&family=Lora:ital,wght@0,400;0,700;1,400;1,700&display=swap" rel="stylesheet">
   <!-- CodeMirror -->
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/codemirror.min.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/theme/dracula.min.css">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/codemirror.min.js"></script>
  
  <!-- Modos de lenguaje -->
  <script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/mode/python/python.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/mode/javascript/javascript.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/mode/xml/xml.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/mode/css/css.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/mode/htmlmixed/htmlmixed.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/mode/markdown/markdown.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/mode/shell/shell.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/mode/r/r.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/mode/clike/clike.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/mode/sql/sql.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/mode/php/php.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/mode/yaml/yaml.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/mode/dockerfile/dockerfile.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/polyfill/v3/polyfill.min.js?features=es6"></script>
  <script id="MathJax-script" async src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js"></script>
  <style>

:root {
  /* Premium Palette */
  --nature-blue: #004660;
  --nature-blue-dark: #002c3d;
  --nature-black: #1a1a1a;
  --text-main: #2b2b2b;
  --text-light: #4a4a4a;
  --text-muted: #6b7280;
  --border-color: #e5e7eb;
  --bg-soft: #fbfbfc;
  --bg-hover: #f3f4f6;
  --accent: #d9531e;
  
  /* Code Block Palette */
  --code-bg: #1e1e1e;
  --code-text: #d4d4d4;
  --code-border: #333333;
  --code-header-bg: #252526;
  
  /* Layout constraints */
  --sidebar-width: 260px;
  --aside-width: 280px;
  --content-max-width: 840px;
}

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

*, *::before, *::after {
  box-sizing: border-box;
}

/* Evitar desbordamiento horizontal */
img, svg, video, canvas, iframe, embed, object {
  max-width: 100%;
  height: auto;
}

html {
  scroll-behavior: smooth;
  scroll-padding-top: 80px; /* Altura del header sticky */
}

body {
  font-family: 'Lora', Georgia, serif;
  font-size: 1.05rem;
  line-height: 1.8;
  color: var(--text-main);
  background-color: #ffffff;
  margin: 0;
  overflow-x: hidden;
  overflow-y: auto;
  width: 100%;
  max-width: 100%;
  position: relative;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

h1 {
  font-family: 'Playfair Display', serif;
  font-size: 2.75rem;
  line-height: 1.15;
  margin: 0.5rem 0 1.25rem 0;
  color: var(--nature-black);
  font-weight: 700;
  letter-spacing: -0.01em;
}

h2 {
  font-family: 'Inter', sans-serif;
  font-size: 1.35rem;
  font-weight: 600;
  color: var(--nature-black);
  border-bottom: 1px solid var(--border-color);
  padding-bottom: 0.5rem;
  margin: 3rem 0 1.5rem 0;
  scroll-margin-top: 100px;
  letter-spacing: 0.01em;
}

h3 {
  font-family: 'Inter', sans-serif;
  font-size: 1.15rem;
  font-weight: 600;
  color: var(--text-main);
  margin: 2rem 0 1rem 0;
}

.sd-header {
  background: rgba(255, 255, 255, 0.98);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border-bottom: 1px solid var(--border-color);
  font-family: 'Inter', sans-serif;
  position: sticky;
  top: 0;
  left: 0;
  right: 0;
  z-index: 1000;
  width: 100%;
  box-shadow: 0 1px 2px rgba(0,0,0,0.03);
}
.sd-header-top {
  max-width: 1400px;
  margin: 0 auto;
  padding: 1rem 2rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 2rem;
}

.sd-journal-logo {
  display: flex;
  align-items: center;
  gap: 16px;
  text-decoration: none;
  color: var(--nature-black);
}

.sd-logo-img {
  height: 48px;
  width: auto;
  display: block;
  object-fit: contain;
}

.sd-journal-titles {
  display: flex;
  flex-direction: column;
  border-left: 1px solid var(--border-color);
  padding-left: 16px;
}

.sd-journal-name {
  font-weight: 700;
  font-size: 0.95rem;
  line-height: 1.2;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: var(--nature-blue);
}

.sd-issn {
  font-size: 0.75rem;
  color: var(--text-muted);
  font-family: 'JetBrains Mono', monospace;
  margin-top: 4px;
}

/* Search Bar */
.sd-search-wrapper {
  flex: 1;
  max-width: 500px;
}

.sd-search-bar {
  display: flex;
  align-items: center;
  background: var(--bg-soft);
  border-radius: 6px;
  padding: 8px 14px;
  border: 1px solid var(--border-color);
  transition: all 0.2s;
}

.sd-search-bar:focus-within {
  background: #fff;
  border-color: var(--nature-blue);
  box-shadow: 0 0 0 3px rgba(0, 70, 96, 0.08);
}

.sd-search-icon {
  color: var(--text-muted);
  margin-right: 8px;
}

.sd-search-bar input {
  border: none;
  background: transparent;
  width: 100%;
  font-family: 'Inter', sans-serif;
  font-size: 0.85rem;
  outline: none;
  color: var(--text-main);
}

/* User Nav */
.sd-user-nav {
  display: flex;
  gap: 1.5rem;
  align-items: center;
}

.sd-nav-link {
  text-decoration: none;
  color: var(--text-main);
  font-size: 0.85rem;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 6px;
  transition: color 0.2s;
}

.sd-nav-link:hover {
  color: var(--nature-blue);
}

/* Mobile Controls */
.sd-mobile-controls {
  display: none;
  align-items: center;
  gap: 0.5rem;
}

.sd-mobile-search-btn,
.sd-mobile-menu-btn {
  display: none;
  background: none;
  border: none;
  padding: 8px;
  cursor: pointer;
  color: var(--text-main);
}

.sd-mobile-menu-btn svg {
  width: 24px;
  height: 24px;
  fill: currentColor;
}

/* Mobile Overlay & Menu */
.sd-mobile-overlay {
  display: none;
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.5);
  z-index: 999;
  opacity: 0;
  transition: opacity 0.3s ease;
}

.sd-mobile-overlay.active {
  display: block;
  opacity: 1;
}

.sd-mobile-menu {
  position: fixed;
  top: 0;
  right: -100%;
  width: 85%;
  max-width: 350px;
  height: 100vh;
  background: white;
  z-index: 1000;
  overflow-y: auto;
  transition: right 0.3s ease;
  box-shadow: -2px 0 10px rgba(0,0,0,0.1);
  font-family: 'Inter', sans-serif;
  display: flex;
  flex-direction: column;
}

.sd-mobile-menu.active {
  right: 0;
}

.sd-mobile-menu-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem;
  border-bottom: 1px solid var(--border-color);
}

.sd-mobile-menu-title {
  font-weight: 600;
  color: var(--nature-blue);
  font-size: 0.9rem;
}

.sd-mobile-close-btn {
  background: none;
  border: none;
  padding: 8px;
  cursor: pointer;
  color: var(--text-main);
}

.sd-mobile-search {
  padding: 1rem;
  border-bottom: 1px solid var(--border-color);
}

.sd-mobile-search-bar {
  display: flex;
  align-items: center;
  background: var(--bg-soft);
  border-radius: 6px;
  padding: 8px 12px;
  border: 1px solid var(--border-color);
}

.sd-mobile-nav {
  flex: 1;
  padding: 1rem 0;
}

.sd-mobile-nav-section {
  margin-bottom: 1.5rem;
}

.sd-mobile-nav-section-title {
  padding: 0.5rem 1rem;
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: var(--text-muted);
  background: var(--bg-soft);
}

.sd-mobile-nav-items {
  list-style: none;
  padding: 0;
  margin: 0;
}

.sd-mobile-nav-item {
  border-bottom: 1px solid var(--border-color);
}

.sd-mobile-nav-link {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 1rem;
  text-decoration: none;
  color: var(--text-main);
  font-size: 0.95rem;
  transition: background 0.2s;
}

.sd-mobile-nav-link:hover {
  background: var(--bg-hover);
}

.sd-mobile-nav-link.active {
  background: var(--bg-hover);
  color: var(--nature-blue);
  border-left: 3px solid var(--nature-blue);
}

.sd-mobile-menu-footer {
  padding: 1rem;
  border-top: 1px solid var(--border-color);
  font-size: 0.8rem;
  color: var(--text-muted);
  text-align: center;
}

.main-wrapper {
  max-width: 1400px;
  margin: 0 auto;
  display: grid;
  grid-template-columns: var(--sidebar-width) minmax(0, 1fr) var(--aside-width);
  gap: 4rem;
  padding: 3rem 2rem;
  align-items: start; /* Importante para que sticky funcione */
}

.article-container {
  max-width: var(--content-max-width);
  width: 100%;
}

.article-content {
  text-align: justify;
  hyphens: auto;
}

.article-content p {
  margin-bottom: 1.5rem;
}

/* ===== ARTICLE METADATA & HEADER ===== */
.article-type {
  font-family: 'Inter', sans-serif;
  text-transform: uppercase;
  font-weight: 700;
  font-size: 0.75rem;
  letter-spacing: 0.15em;
  color: var(--accent);
  margin-bottom: 1rem;
  display: block;
}

.alt-title {
  font-size: 1.15rem;
  color: var(--text-muted);
  font-style: italic;
  font-family: 'Lora', serif;
  margin-bottom: 2rem;
  display: block;
}

/* ===== AUTHORS SECTION ===== */
.authors {
  font-family: 'Inter', sans-serif;
  font-size: 1.15rem;
  font-weight: 500;
  margin-bottom: 1rem;
  line-height: 1.8;
  display: flex;
  flex-wrap: wrap;
  align-items: center; 
  gap: 0.15rem 0.3rem;
}
.author-link {
  color: var(--nature-blue);
  text-decoration: none;
  border-bottom: 1px dotted transparent;
  transition: all 0.2s;
  white-space: nowrap;
  display: inline-flex;
}

.author-name {
  color: var(--nature-blue);
  font-weight: 500;
  white-space: nowrap;
  display: inline-flex;

}

.author-link:hover {
  color: var(--accent);
  border-bottom-color: var(--accent);
}



/* Superíndice (a, b, c...) */
.author-sup {
  font-size: 0.65em;
  position: relative;
  top: -0.5em;
  color: var(--text-light);
  margin-left: 1px;
  white-space: nowrap;
  display: inline;
  line-height: 1;
  font-weight: 600;
}

/* Iconos (ORCID, email, correspondencia) */
.author-icons {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  margin-left: 0.2rem;
  vertical-align: middle;
  white-space: nowrap;
}

.author-icon {
  display: inline-block;
  opacity: 0.8;
  transition: all 0.2s;
  color: var(--nature-blue);
}

.author-icon:hover {
  opacity: 1;
  color: var(--accent);
}

/* Separador de coma entre autores */
.author-separator {
  margin-right: 0.15rem;
  color: var(--text-muted);
  white-space: normal;
  display: inline;
}

/* Icono de correspondencia (persona delineada) */
.author-icon.corresponding-icon {
  color: var(--nature-blue);
  cursor: help;
}

.author-icon.corresponding-icon:hover {
  color: var(--accent);
}

/* Para pantallas pequeñas */
@media (max-width: 480px) {
  .authors {
    font-size: 1rem;
    line-height: 1.6;
  }
  
  .author-sup {
    font-size: 0.65em;
  }
  
  .author-icon svg {
    width: 12px;
    height: 12px;
  }
}
  /* ===== SHARE MODAL ===== */
.share-modal-overlay {
  display: none;
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 28, 45, 0.6);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  z-index: 9999;
  opacity: 0;
  transition: opacity 0.3s ease;
  align-items: center;
  justify-content: center;
}

.share-modal-overlay.active {
  display: flex;
  opacity: 1;
}

.share-modal {
  background: #ffffff;
  border-radius: 12px;
  width: 90%;
  max-width: 420px;
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
  transform: translateY(20px);
  transition: transform 0.3s ease;
  overflow: hidden;
  font-family: 'Inter', sans-serif;
}

.share-modal-overlay.active .share-modal {
  transform: translateY(0);
}

.share-modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1.25rem 1.5rem;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-soft);
}

.share-modal-title {
  font-size: 1rem;
  font-weight: 700;
  color: var(--nature-black);
  letter-spacing: -0.01em;
}

.share-modal-close {
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  transition: all 0.2s ease;
}

.share-modal-close:hover {
  background: var(--bg-hover);
  color: var(--nature-black);
}

.share-modal-close svg {
  width: 20px;
  height: 20px;
}

.share-modal-body {
  padding: 1.5rem;
}

.share-modal-url-box {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  background: var(--bg-soft);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 0.5rem 0.75rem;
  margin-bottom: 1.25rem;
}

.share-modal-url {
  flex: 1;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.75rem;
  color: var(--text-light);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.share-modal-copy-btn {
  background: none;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 0.35rem 0.6rem;
  cursor: pointer;
  font-family: 'Inter', sans-serif;
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--nature-blue);
  transition: all 0.2s ease;
  white-space: nowrap;
}

.share-modal-copy-btn:hover {
  background: var(--nature-blue);
  border-color: var(--nature-blue);
  color: white;
}

.share-modal-copy-btn.copied {
  background: #10b981;
  border-color: #10b981;
  color: white;
}

.share-social-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0.75rem;
}

.share-social-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 0.5rem;
  border-radius: 10px;
  border: 1px solid var(--border-color);
  background: #ffffff;
  cursor: pointer;
  transition: all 0.2s ease;
  text-decoration: none;
  font-family: 'Inter', sans-serif;
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--text-light);
}

.share-social-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 16px -4px rgba(0, 0, 0, 0.1);
}

.share-social-btn svg {
  width: 24px;
  height: 24px;
  flex-shrink: 0;
}

.share-social-btn .share-social-label {
  font-size: 0.65rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

/* Colores específicos para cada red social */
.share-social-btn.twitter:hover {
  border-color: #1DA1F2;
  background: #f0f7fd;
}

.share-social-btn.twitter svg { fill: #1DA1F2; }

.share-social-btn.facebook:hover {
  border-color: #1877F2;
  background: #f0f5fd;
}

.share-social-btn.facebook svg { fill: #1877F2; }

.share-social-btn.whatsapp:hover {
  border-color: #25D366;
  background: #f0fdf4;
}

.share-social-btn.whatsapp svg { fill: #25D366; }

.share-social-btn.linkedin:hover {
  border-color: #0A66C2;
  background: #f0f5fc;
}

.share-social-btn.linkedin svg { fill: #0A66C2; }

.share-social-btn.email:hover {
  border-color: var(--nature-blue);
  background: #f0f5f8;
}

.share-social-btn.email svg { fill: var(--nature-blue); }

.share-social-btn.telegram:hover {
  border-color: #0088cc;
  background: #f0f8fd;
}

.share-social-btn.telegram svg { fill: #0088cc; }

.share-social-btn.copy:hover {
  border-color: var(--accent);
  background: #fdf5f0;
}

.share-social-btn.copy svg { fill: var(--accent); }

/* Responsive para modal */
@media (max-width: 480px) {
  .share-modal {
    width: 95%;
  }
  
  .share-social-grid {
    grid-template-columns: repeat(3, 1fr);
    gap: 0.5rem;
  }
  
  .share-social-btn {
    padding: 0.6rem 0.4rem;
  }
  
  .share-social-btn svg {
    width: 20px;
    height: 20px;
  }
}
  /* ===== SHARE BUTTON ===== */
.share-btn-wrapper {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.4rem 0.8rem;
  background-color: var(--bg-soft);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  text-decoration: none;
  font-family: 'Inter', sans-serif;
  color: var(--text-light);
  font-size: 0.8rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.share-btn-wrapper:hover {
  border-color: var(--nature-blue);
  background-color: #ffffff;
  color: var(--nature-blue);
  box-shadow: 0 2px 8px rgba(0, 70, 96, 0.08);
}

.share-btn-wrapper svg {
  width: 14px;
  height: 14px;
  color: var(--nature-blue);
  flex-shrink: 0;
}

/* ===== SHOW MORE / LESS & METADATA EXTENDED ===== */
.show-more-btn {
  background: none;
  border: 1px solid var(--nature-blue);
  color: var(--nature-blue);
  padding: 0.4rem 0.9rem;
  border-radius: 4px;
  font-family: 'Inter', sans-serif;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin: 0.5rem 0 1.2rem 0;
  transition: all 0.2s;
}

.show-more-btn:hover {
  background: var(--bg-soft);
  color: var(--accent);
  border-color: var(--accent);
}

.show-more-btn svg {
  width: 12px;
  height: 12px;
  transition: transform 0.2s;
}

.extended-author-info {
  display: none;
  background: var(--bg-soft);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 1rem 1.25rem;
  margin-bottom: 1.5rem;
  font-family: 'Inter', sans-serif;
  font-size: 0.85rem;
  animation: fadeIn 0.25s ease-in-out;
}

.extended-author-info.active {
  display: block;
}

.institutions-list {
  list-style: none;
  padding: 0;
  margin: 0 0 1rem 0;
}

.institutions-list li {
  margin-bottom: 0.4rem;
  color: var(--text-light);
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
}

.institutions-list sup {
  font-weight: 700;
  color: var(--nature-blue);
  font-size: 0.75rem;
}

.article-dates-block {
  border-top: 1px solid var(--border-color);
  padding-top: 0.75rem;
  color: var(--text-muted);
  font-size: 0.8rem;
  line-height: 1.5;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}

.meta-box {
  font-size: 0.9rem;
  color: var(--text-light);
  margin-top: 1rem;
  display: flex;
  gap: 1.5rem;
  align-items: center;
  flex-wrap: wrap;
  font-family: 'Inter', sans-serif;
}

.action-bar {
  display: flex;
  align-items: center;
  gap: 1.5rem;
  margin: 2rem 0;
  padding: 1.5rem 0;
  border-top: 1px solid var(--border-color);
  border-bottom: 1px solid var(--border-color);
  flex-wrap: wrap;
}

.btn-pdf {
  background: var(--nature-blue);
  color: white !important;
  padding: 0.6rem 1.5rem;
  border-radius: 6px;
  text-decoration: none;
  font-family: 'Inter', sans-serif;
  font-weight: 600;
  font-size: 0.85rem;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  transition: all 0.2s;
  border: none;
  cursor: pointer;
  box-shadow: 0 2px 6px rgba(0, 70, 96, 0.15);
}

.btn-pdf:hover {
  background: var(--nature-blue-dark);
  box-shadow: 0 4px 12px rgba(0, 70, 96, 0.25);
  transform: translateY(-1px);
}

.oa-label {
  display: inline-flex;
  align-items: center;
  color: #F48120;
  font-weight: 500;
  font-size: 0.9rem;
  font-family: 'Inter', sans-serif;
  gap: 4px;
}
/* ==========================================================================
   MODERN EDITORIAL FOOTNOTES SYSTEM - REFINADO FINAL
   ========================================================================== */

/* Enlace en el texto (superíndice) */
.footnote-link {
  text-decoration: none;
  color: #002147;
  font-weight: 700;
  font-size: 0.75em;
  vertical-align: super;
  line-height: 1; /* Ajuste para centrar mejor */
  margin: 0 0.2em;
  padding: 0.1em 0.35em; /* Padding más ajustado */
  border-radius: 4px;
  background-color: rgba(0, 33, 71, 0.08);
  transition: all 0.2s ease;
  white-space: nowrap;
  display: inline-block;
  min-width: 1.2em;
  text-align: center;
}

/* Contador para los enlaces de notas */
body {
  counter-reset: footnote-link-counter;
}

.footnote-link {
  counter-increment: footnote-link-counter;
}

.footnote-link::after {
  content: counter(footnote-link-counter);
  font-weight: 700;
  line-height: 1; /* Asegura que el número no desborde */
}

.footnote-link:hover {
  background-color: rgba(0, 33, 71, 0.15);
  color: #00152e;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.08);
  text-decoration: none;
}

/* Sección de notas */
.footnotes {
  margin-top: 3.5rem;
  padding-top: 2rem;
  border-top: 1px solid #e2e8f0;
  font-size: 0.92rem;
}

.footnotes hr {
  display: none;
}

.footnotes h2, 
.footnotes h3 {
  font-family: 'Inter', sans-serif;
  font-size: 0.85rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: #002147;
  margin-bottom: 1.5rem;
  border-bottom: none;
}

/* Lista ordenada de notas */
.footnotes ol {
  list-style: none; /* Elimina números por defecto */
  padding: 0;
  margin: 0;
  counter-reset: fn-circle-counter; /* Contador independiente para el círculo */
}

/* Elemento de la lista */
.footnotes ol li {
  counter-increment: fn-circle-counter; /* Incrementa el contador del círculo */
  position: relative;
  padding: 0.75rem 0 0.75rem 2.75rem;
  margin-bottom: 0.75rem;
  border-bottom: 1px solid #f1f5f9;
  line-height: 1.7;
  list-style: none; /* Refuerzo para eliminar viñetas/números */
}

/* Número en el círculo */
.footnotes ol li::before {
  content: counter(fn-circle-counter); /* Usa el contador del círculo */
  position: absolute;
  left: 0;
  top: 0.85rem;
  width: 1.8rem;
  height: 1.8rem;
  background: #f8fafc;
  border: 1px solid #cbd5e1;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: 'Inter', sans-serif;
  font-size: 0.7rem;
  font-weight: 700;
  color: #002147;
  box-shadow: inset 0 1px 2px rgba(0,0,0,0.02);
}

.footnotes ol li p {
  margin: 0;
  color: #334155;
}

/* Enlace de retorno */
.footnotes ol li a[href^="#fnref"] {
  text-decoration: none;
  color: #002147;
  font-size: 0.9em;
  margin-left: 0.5em;
  transition: all 0.2s;
  display: inline-block;
  width: 1.8em;
  height: 1.8em;
  line-height: 1.8em;
  text-align: center;
  border-radius: 50%;
  background: #f8fafc;
  border: 1px solid #cbd5e1;
  vertical-align: middle;
  position: relative;
  top: -1px;
}

.footnotes ol li a[href^="#fnref"]::before {
  content: "↩";
  font-size: 0.9em;
}

.footnotes ol li a[href^="#fnref"]:hover {
  color: #FF6C0C;
  border-color: #FF6C0C;
  background: #fff;
}

/* Tooltip */
.footnote-tooltip {
  position: fixed;
  z-index: 9999;
  max-width: 320px;
  padding: 0.85rem 1.15rem;
  background: #ffffff;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  box-shadow: 0 10px 25px -5px rgba(0, 33, 71, 0.1), 0 8px 10px -6px rgba(0, 33, 71, 0.1);
  font-family: 'Lora', Georgia, serif;
  font-size: 0.85rem;
  line-height: 1.6;
  color: #1e293b;
  pointer-events: none;
  opacity: 0;
  transform: translateY(5px);
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.footnote-tooltip.visible {
  opacity: 1;
  transform: translateY(0);
}

.footnote-tooltip::before {
  content: '';
  position: absolute;
  top: -6px;
  left: 20px;
  width: 12px;
  height: 12px;
  background: #ffffff;
  border-left: 1px solid #cbd5e1;
  border-top: 1px solid #cbd5e1;
  transform: rotate(45deg);
}
  /* ===== QUOTE FOOTNOTE (Nota especial debajo de blockquote) ===== */
.quote-footnote {
  margin-top: 0.75rem;
  margin-bottom: 2rem;
  padding: 0.75rem 1rem;
  background: var(--bg-soft);
  border-left: 3px solid var(--nature-blue);
  border-radius: 0 6px 6px 0;
  font-family: 'Inter', sans-serif;
  font-size: 0.8rem;
  color: var(--text-light);
  line-height: 1.6;
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
}

.quote-footnote .footnote-link {
  flex-shrink: 0;
  margin-top: 0.1rem;
  font-size: 0.7em;
  padding: 0.1em 0.35em;
  vertical-align: baseline;
  position: relative;
  top: 0;
  counter-increment: none; /* No usar el contador numérico */
}

.quote-footnote .footnote-link::after {
  content: "a"; /* Letra especial para nota de cita */
  font-weight: 700;
  line-height: 1;
}

.quote-footnote-text {
  flex: 1;
}

.quote-footnote-text .footnote-backlink {
  color: var(--nature-blue);
  text-decoration: none;
  font-size: 0.9em;
  margin-left: 0.25rem;
  display: inline-block;
  width: 1.5em;
  height: 1.5em;
  line-height: 1.5em;
  text-align: center;
  border-radius: 50%;
  background: var(--bg-hover);
  border: 1px solid var(--border-color);
  transition: all 0.2s;
  vertical-align: middle;
  position: relative;
  top: -1px;
}

.quote-footnote-text .footnote-backlink::before {
  content: "↩";
  font-size: 0.9em;
}

.quote-footnote-text .footnote-backlink:hover {
  color: var(--accent);
  border-color: var(--accent);
  background: #fff;
}

/* Responsive */
@media (max-width: 768px) {
  .quote-footnote {
    font-size: 0.75rem;
    padding: 0.6rem 0.75rem;
    flex-direction: column;
    gap: 0.25rem;
  }
}
/* ===== REFERENCE BACKLINKS (Flechitas de volver) ===== */
.reference-item a[href="javascript:void(0)"] {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.5em;
  height: 1.5em;
  line-height: 1 !important; /* Forzar line-height */
  text-align: center;
  border-radius: 50%;
  background: #f8fafc;
  border: 1px solid #cbd5e1;
  color: #002147;
  text-decoration: none;
  font-size: 0.8em;
  margin-left: 0.15rem;
  vertical-align: middle;
  position: relative;
  top: -1px;
  transition: all 0.2s ease;
  cursor: pointer;
  overflow: hidden; /* Evitar desbordamiento */
  box-sizing: border-box; /* Asegurar que el padding no afecte el tamaño */
}

.reference-item a[href="javascript:void(0)"]::before {
  content: "↩";
  font-size: 0.8em; /* Reducir ligeramente el tamaño */
  line-height: 1 !important; /* Forzar line-height */
  display: inline-block;
  text-align: center;
  vertical-align: middle;
  margin: 0;
  padding: 0;
  position: relative;
  top: -0.05em; /* Ajuste fino para centrar */
  font-weight: normal;
}

.reference-item a[href="javascript:void(0)"]:hover {
  color: #FF6C0C;
  border-color: #FF6C0C;
  background: #fff;
  transform: translateY(-1px);
}
/* ===== CITATION PICKER MODAL ===== */
.citation-picker-overlay {
  display: none;
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 28, 45, 0.5);
  backdrop-filter: blur(3px);
  -webkit-backdrop-filter: blur(3px);
  z-index: 9998;
  opacity: 0;
  transition: opacity 0.2s ease;
  align-items: center;
  justify-content: center;
}

.citation-picker-overlay.active {
  display: flex;
  opacity: 1;
}

.citation-picker-modal {
  background: #ffffff;
  border-radius: 12px;
  width: 90%;
  max-width: 320px;
  box-shadow: 0 20px 40px -10px rgba(0, 0, 0, 0.2);
  overflow: hidden;
  font-family: 'Inter', sans-serif;
  transform: scale(0.95);
  transition: transform 0.2s ease;
}

.citation-picker-overlay.active .citation-picker-modal {
  transform: scale(1);
}

.citation-picker-header {
  padding: 0.85rem 1.25rem;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-soft);
}

.citation-picker-title {
  font-size: 0.85rem;
  font-weight: 700;
  color: var(--nature-black);
  letter-spacing: -0.01em;
}

.citation-picker-body {
  padding: 0.5rem;
}

.citation-picker-option {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.7rem 0.75rem;
  border-radius: 8px;
  text-decoration: none;
  color: var(--text-main);
  font-size: 0.8rem;
  font-weight: 500;
  transition: all 0.15s ease;
  border: none;
  background: none;
  width: 100%;
  cursor: pointer;
  text-align: left;
}

.citation-picker-option:hover {
  background: var(--bg-hover);
  color: var(--nature-blue);
}

.citation-picker-option .citation-number {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.5em;
  height: 1.5em;
  border-radius: 50%;
  background: #f8fafc;
  border: 1px solid #cbd5e1;
  font-size: 0.75em;
  font-weight: 700;
  color: #002147;
  flex-shrink: 0;
}

.citation-picker-option:hover .citation-number {
  background: #fff;
  border-color: var(--nature-blue);
  color: var(--nature-blue);
}

/* Responsive */
@media (max-width: 480px) {
  .citation-picker-modal {
    width: 85%;
  }
}
@media (max-width: 768px) {
  /* ===== PREVENIR DESBORDAMIENTO HORIZONTAL ===== */
  html, body {
    width: 100% !important;
    max-width: 100% !important;
    overflow-x: hidden !important;
    position: relative;
  }
  
  .main-wrapper {
    width: 100% !important;
    max-width: 100% !important;
    padding: 1rem !important;
    gap: 1rem !important;
    overflow-x: hidden;
  }
  
  .article-container {
    width: 100% !important;
    max-width: 100% !important;
    padding: 0 !important;
    margin: 0 !important;
    overflow-x: hidden;
  }
  
  .article-content {
    width: 100% !important;
    max-width: 100% !important;
    overflow-x: hidden;
  }
  
  /* CodeMirror en móvil */
  .code-block-wrapper {
    width: 100% !important;
    max-width: 100% !important;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }
  
  .code-block-container .CodeMirror {
    width: 100% !important;
    max-width: 100% !important;
  }
  
  .code-block-container .CodeMirror-scroll {
    overflow-x: auto !important;
  }
  
  /* Tablas en móvil */
  .table-wrapper {
    width: 100% !important;
    max-width: 100% !important;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }
  
  /* Meta box */
  .meta-box {
    width: 100% !important;
    max-width: 100% !important;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  
  /* Action bar */
  .action-bar {
    width: 100% !important;
    max-width: 100% !important;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  
  /* Keywords */
  .keywords {
    width: 100% !important;
    max-width: 100% !important;
    flex-wrap: wrap;
  }
  
  /* Referencias */
  .references-list {
    width: 100% !important;
    max-width: 100% !important;
    overflow-x: hidden;
  }
  
  .reference-item {
    width: 100% !important;
    max-width: 100% !important;
    word-break: break-word;
    overflow-wrap: break-word;
  }
  
  /* Licencia */
  .license-section {
    width: 100% !important;
    max-width: 100% !important;
    overflow-x: hidden;
  }
  
  /* PDF preview */
  .pdf-preview {
    width: 100% !important;
    max-width: 100% !important;
    height: 400px !important;
  }
  
  /* Figuras */
  .image-figure {
    width: 100% !important;
    max-width: 100% !important;
    margin: 1.5rem 0 !important;
  }
  
  /* Metadata items */
  .metadata-item {
    width: 100% !important;
    max-width: 100% !important;
    flex-wrap: wrap;
  }
  
  .metadata-value {
    word-break: break-word;
    overflow-wrap: break-word;
  }
}
/* Ajustes responsive */
@media (max-width: 768px) {
  .footnote-link {
    font-size: 0.7em;
    padding: 0.1em 0.3em;
    min-width: 1.1em;
  }

  .footnotes ol li {
    padding-left: 2.25rem;
  }

  .footnotes ol li::before {
    width: 1.5rem;
    height: 1.5rem;
    font-size: 0.6rem;
    top: 0.7rem;
  }
  
  .footnotes ol li a[href^="#fnref"] {
    width: 1.5em;
    height: 1.5em;
    line-height: 1.5em;
  }
}
/* ===== DOI LINKS (PREMIUM) ===== */
.doi-academic-link,
.meta-doi-wrapper {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.4rem 0.8rem;
  background-color: var(--bg-soft);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  text-decoration: none;
  font-family: 'Inter', sans-serif;
  color: var(--text-light);
  transition: all 0.2s ease;
}

.doi-academic-link:hover,
.meta-doi-wrapper:hover {
  border-color: var(--nature-blue);
  background-color: #ffffff;
  box-shadow: 0 2px 8px rgba(0, 70, 96, 0.08);
}

.doi-prefix,
.meta-doi-label {
  font-weight: 700;
  font-size: 0.75rem;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--nature-blue);
}

.doi-number,
.meta-doi-link {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.8rem;
  font-weight: 500;
  color: var(--text-light);
  text-decoration: none;
  word-break: break-all;
}

/* ===== ABSTRACT ===== */
.abstract-container {
  margin-bottom: 2rem;
}

.abstract-text {
  font-size: 1.05rem;
  text-align: justify;
  color: var(--text-main);
  margin-bottom: 1rem;
  line-height: 1.7;
}

.abstract-toggle {
  margin-top: 1rem;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-soft);
}

.abstract-toggle summary {
  font-family: 'Inter', sans-serif;
  font-size: 0.85rem;
  font-weight: 600;
  padding: 0.75rem 1rem;
  cursor: pointer;
  color: var(--nature-blue);
  list-style: none;
}

.abstract-toggle summary::-webkit-details-marker {
  display: none;
}

.abstract-toggle summary::before {
  content: '▶';
  display: inline-block;
  width: 16px;
  margin-right: 8px;
  transition: transform 0.2s;
  color: var(--nature-blue);
}

.abstract-toggle[open] summary::before {
  transform: rotate(90deg);
}

.abstract-toggle-content {
  padding: 1rem;
  border-top: 1px solid var(--border-color);
  background: white;
  border-radius: 0 0 6px 6px;
  font-style: italic;
}

/* ===== KEYWORDS & SPECIALIZED CODES ===== */
.metadata-section {
  margin-bottom: 1.5rem;
}

.metadata-section h4 {
  font-family: 'Inter', sans-serif;
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--nature-black);
  margin-bottom: 1rem;
  font-weight: 700;
  border-bottom: 1px solid var(--border-color);
  padding-bottom: 0.5rem;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.keyword-tag {
  font-family: 'Inter', sans-serif;
  font-size: 0.75rem;
  background-color: #ffffff;
  padding: 0.35rem 0.85rem;
  border-radius: 20px;
  border: 1px solid var(--border-color);
  color: var(--text-light);
  display: inline-flex;
  align-items: center;
  margin: 0.2rem;
  font-weight: 500;
  transition: all 0.2s ease;
  line-height: 1.4;
}

.keyword-tag:hover {
  border-color: var(--nature-blue);
  color: var(--nature-blue);
  box-shadow: 0 2px 4px rgba(0,0,0,0.04);
}

.keyword-tag.keyword-controlled {
  background-color: var(--bg-soft);
  border-radius: 6px;
  gap: 0.4rem;
  padding: 0.35rem 0.7rem;
}

.keyword-tag.keyword-controlled svg {
  color: var(--nature-blue);
  width: 13px;
  height: 13px;
  flex-shrink: 0;
  stroke-width: 2.5;
}

.keyword-code {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.7rem;
  font-weight: 700;
  color: var(--nature-blue);
  letter-spacing: 0.03em;
  line-height: 1.3;
}

.vocabulary-badge {
  font-family: 'Inter', sans-serif;
  font-size: 0.65rem;
  font-weight: 700;
  color: var(--accent);
  background-color: rgba(217, 83, 30, 0.08);
  padding: 0.2rem 0.6rem;
  border-radius: 4px;
  letter-spacing: 0.05em;
  border: 1px solid rgba(217, 83, 30, 0.2);
  text-transform: none;
  white-space: nowrap;
}

.specialized-codes-container {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  margin-top: 0.25rem;
}

/* ===== METADATA ITEMS ===== */
.metadata-item {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: 0.5rem 0;
  border-bottom: 1px solid var(--border-color);
  font-size: 0.8rem;
  gap: 1rem;
}

.metadata-item:last-child {
  border-bottom: none;
}

.metadata-label {
  font-family: 'Inter', sans-serif;
  font-size: 0.65rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-muted);
  flex-shrink: 0;
  min-width: 70px;
}

.metadata-value {
  font-family: 'Lora', Georgia, serif;
  font-size: 0.78rem;
  color: var(--text-main);
  text-align: right;
  word-break: break-word;
}

/* ===== INFO CARD & TABS ===== */
.info-card {
  background: #ffffff;
  border-radius: 8px;
  padding: 1rem;
  border: 1px solid var(--border-color);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.03);
}

.info-card h4 {
  font-family: 'Inter', sans-serif;
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--nature-blue);
  margin-bottom: 0.75rem;
  font-weight: 700;
}

.info-tabs {
  background: white;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  overflow: hidden;
  margin-bottom: 1.5rem;
}

.tab-buttons {
  display: flex;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-soft);
}

.tab-button {
  flex: 1;
  padding: 0.75rem;
  background: none;
  border: none;
  cursor: pointer;
  font-family: 'Inter', sans-serif;
  font-size: 0.8rem;
  font-weight: 500;
  color: var(--text-light);
  transition: all 0.2s;
  border-bottom: 2px solid transparent;
}

.tab-button:hover {
  color: var(--nature-blue);
  background: white;
}

.tab-button.active {
  color: var(--nature-blue);
  border-bottom-color: var(--nature-blue);
  background: white;
  font-weight: 600;
}

.tab-panel {
  display: none;
  padding: 1.5rem;
}

.tab-panel.active {
  display: block;
}

/* ===== CITATION BOX ===== */
.citation-box {
  background: white;
  padding: 1rem;
  border-radius: 6px;
  border: 1px solid var(--border-color);
}

.citation-item {
  position: relative;
  padding: 0.75rem 0;
  border-bottom: 1px solid var(--border-color);
  font-size: 0.8rem;
  word-wrap: break-word;
  overflow-wrap: break-word;
  word-break: break-all;
}

.citation-item:last-child {
  border-bottom: none;
}

.copy-btn {
  position: absolute;
  right: 0;
  top: 50%;
  transform: translateY(-50%);
  background: white;
  border: 1px solid var(--border-color);
  padding: 2px 8px;
  font-size: 0.65rem;
  cursor: pointer;
  border-radius: 4px;
  transition: all 0.2s;
  color: var(--text-light);
}

.copy-btn:hover {
  background: var(--nature-blue);
  border-color: var(--nature-blue);
  color: white;
}

.bibtex-download {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-top: 1rem;
  color: var(--nature-blue);
  text-decoration: none;
  font-weight: 600;
  font-size: 0.8rem;
  font-family: 'Inter', sans-serif;
}

.bibtex-download:hover {
  color: var(--accent);
}

/* ===== ACADEMIC TABLES (BOOKTABS) ===== */
.table-download-wrapper {
  margin: 2.5rem 0;
  background: transparent;
}

.table-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: 0.5rem 0;
  background: transparent;
  border-bottom: 1.5px solid var(--nature-black);
  font-family: 'Inter', sans-serif;
}

.table-label {
  font-weight: 700;
  font-size: 0.9rem;
  color: var(--nature-black);
  letter-spacing: -0.01em;
}

.table-download-buttons {
  display: flex;
  gap: 1rem;
}

.table-download-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0.2rem 0;
  background: transparent;
  border: none;
  color: var(--text-muted);
  font-size: 0.75rem;
  font-variant: small-caps;
  text-decoration: none;
  transition: color 0.2s ease;
  border-bottom: 1px solid transparent;
  cursor: pointer;
}

.table-download-btn:hover {
  color: var(--nature-blue);
  border-bottom: 1px solid var(--nature-blue);
}

.table-download-btn svg {
  width: 12px;
  height: 12px;
  opacity: 0.7;
}

.table-wrapper {
  overflow-x: auto;
  padding: 1rem 0;
  -webkit-overflow-scrolling: touch;
}

.article-table {
  width: 100%;
  border-collapse: collapse;
  font-family: 'Inter', sans-serif;
  font-size: 0.95rem;
  color: var(--text-main);
  border-top: 2px solid var(--nature-black);
  border-bottom: 2px solid var(--nature-black);
}

.article-table th {
  border-bottom: 1px solid var(--nature-black);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 1rem;
  color: var(--nature-black);
  text-align: left;
  font-weight: 600;
  font-size: 0.85rem;
}

.article-table td {
  padding: 1rem;
  border: none;
  border-bottom: 1px solid var(--border-color);
  vertical-align: top;
}

.article-table tr:last-child td {
  border-bottom: none;
}

.article-table tr:hover {
  background-color: var(--bg-soft);
}

/* ===== CODE BLOCKS (CODEMIRROR) ===== */
.code-block-wrapper {
  margin: 2.5rem 0;
  border-radius: 10px;
  background: #1e1e1e;
  box-shadow: 0 10px 30px -5px rgba(0, 0, 0, 0.25), 0 0 1px 1px rgba(255, 255, 255, 0.05) inset;
  overflow: hidden;
  border: 1px solid #2d2d2d;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

.code-block-wrapper:hover {
  border-color: #404040;
  box-shadow: 0 12px 35px -5px rgba(0, 0, 0, 0.35), 0 0 1px 1px rgba(255, 255, 255, 0.08) inset;
}

.code-header {
  background: #252526;
  padding: 0.75rem 1.25rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid #2d2d2d;
  font-family: 'Inter', sans-serif;
}

.code-language {
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #9cdcfe;
  opacity: 0.85;
}

.code-copy-btn {
  background: #2d2d2d;
  border: 1px solid #3c3c3c;
  border-radius: 5px;
  padding: 0.35rem 0.85rem;
  font-size: 0.72rem;
  font-family: 'Inter', sans-serif;
  font-weight: 500;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  color: #cccccc;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.code-copy-btn:hover {
  background: #4ec9b0;
  border-color: #4ec9b0;
  color: #1e1e1e;
  transform: translateY(-1px);
  box-shadow: 0 2px 6px rgba(78, 201, 176, 0.25);
}

.code-copy-btn:active {
  transform: translateY(0);
}

.code-block-container {
  position: relative;
}

/* CodeMirror overrides */
.code-block-container .CodeMirror {
  height: auto;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 0.85rem;
  line-height: 1.65;
  background: #1e1e1e;
  color: #d4d4d4;
  padding: 0.5rem 0;
}

.code-block-container .CodeMirror-gutters {
  background: #1e1e1e;
  border-right: 1px solid #2d2d2d;
  padding-right: 4px;
}

.code-block-container .CodeMirror-linenumber {
  color: #656565;
  padding: 0 10px 0 12px;
  font-size: 0.8rem;
}

.code-block-container .CodeMirror-cursor {
  border-left: 2px solid #4ec9b0;
}

.code-block-container .CodeMirror-selected {
  background: rgba(78, 201, 176, 0.18) !important;
}

.code-block-container .CodeMirror-focused .CodeMirror-selected {
  background: rgba(78, 201, 176, 0.25) !important;
}

/* Ocultar el textarea original */
.codemirror-textarea {
  display: none;
}
  /* ===== CODEMIRROR MOBILE FIX ===== */
@media (max-width: 768px) {
  .code-block-container .CodeMirror {
    font-size: 0.75rem !important;
    line-height: 1.5 !important;
  }
  
  .code-block-container .CodeMirror-gutters {
    min-width: 30px !important;
  }
  
  .code-block-container .CodeMirror-linenumber {
    font-size: 0.65rem !important;
    padding: 0 4px !important;
  }
  
  .code-block-container .CodeMirror-scroll {
    overflow-x: auto !important;
    -webkit-overflow-scrolling: touch !important;
  }
  
  .code-block-wrapper {
    border-radius: 6px !important;
    margin: 1.5rem 0 !important;
  }
}
  /* ===== TABLAS RESPONSIVE ===== */
@media (max-width: 768px) {
  .table-download-wrapper {
    width: 100% !important;
    max-width: 100% !important;
    overflow-x: hidden;
  }
  
  .table-header {
    flex-direction: column;
    gap: 0.5rem;
    align-items: flex-start;
  }
  
  .table-download-buttons {
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  
  .table-wrapper {
    width: 100% !important;
    max-width: 100% !important;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }
  
  .article-table {
    font-size: 0.8rem !important;
  }
  
  .article-table th,
  .article-table td {
    padding: 0.5rem !important;
  }
}
/* ===== BLOCKQUOTES & PULL QUOTES ===== */
blockquote {
  margin: 3rem 0;
  padding: 2rem 3rem;
  border-left: 4px solid var(--nature-blue);
  background: var(--bg-soft);
  font-style: italic;
  font-size: 1.25rem;
  color: var(--nature-blue-dark);
  position: relative;
  border-radius: 0 8px 8px 0;
}

blockquote cite {
  display: block;
  margin-top: 1.5rem;
  font-size: 0.85rem;
  font-style: normal;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--text-muted);
  letter-spacing: 0.05em;
}

/* ===== MATH EQUATIONS ===== */
.MathJax_Display,
.math-container {
  margin: 2.5rem 0 !important;
  padding: 1.5rem;
  background: var(--bg-soft);
  border-radius: 8px;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  max-width: 100%;
  scrollbar-width: thin;
  scrollbar-color: var(--nature-blue) var(--border-color);
}

.MathJax {
  max-width: 100% !important;
  overflow-x: auto !important;
}

/* ===== FIGURES & IMAGES ===== */
.image-link {
  display: inline-block;
  position: relative;
  cursor: zoom-in;
  transition: filter 0.3s ease;
  line-height: 0;
}

.image-link:hover {
  filter: brightness(0.95);
}

.image-link::after {
  content: "⤢";
  position: absolute;
  bottom: 12px;
  right: 12px;
  background: rgba(255, 255, 255, 0.9);
  color: #333;
  width: 28px;
  height: 28px;
  border-radius: 2px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  opacity: 0;
  transition: opacity 0.2s ease;
  box-shadow: 0 2px 5px rgba(0,0,0,0.1);
}

.image-link:hover::after {
  opacity: 1;
}

.image-figure {
  margin: 3rem 0;
  text-align: center;
  max-width: 100%;
}

.image-figure.float-left {
  float: left;
  margin: 0 1.5rem 1rem 0;
  max-width: 50%;
}

.image-figure.float-right {
  float: right;
  margin: 0 0 1rem 1.5rem;
  max-width: 50%;
}

.article-image {
  max-width: 100%;
  height: auto;
  border-radius: 4px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.05);
  display: block;
}

.image-caption {
  margin-top: 1rem;
  font-family: 'Inter', sans-serif;
  font-size: 0.85rem;
  color: var(--text-muted);
  font-style: normal;
  line-height: 1.5;
}

/* ===== LISTS ===== */
.article-content ul,
.article-content ol {
  margin: 1.5rem 0 1.5rem 2rem;
  padding-left: 0;
}

.article-content li {
  margin-bottom: 0.5rem;
  position: relative;
}

.article-content ul ul { list-style-type: circle; }
.article-content ul ul ul { list-style-type: square; }
.article-content ol { list-style-type: decimal; }
.article-content ol ol { list-style-type: lower-alpha; }
.article-content ol ol ol { list-style-type: lower-roman; }

/* ===== REFERENCES ===== */
.references-list {
  margin-top: 2rem;
  font-size: 0.95rem;
}

.reference-item {
  margin-bottom: 1.2rem;
  padding-left: 2rem;
  text-indent: -2rem;
  line-height: 1.6;
  word-wrap: break-word;
  scroll-margin-top: 100px;
}

.reference-item a {
  color: var(--nature-blue);
  text-decoration: none;
  word-break: break-all;
  border-bottom: 1px dotted #ccc;
}

.reference-item a:hover {
  border-bottom: 1px solid var(--nature-blue);
}

.citation-link {
  color: var(--nature-blue);
  text-decoration: none;
  border-bottom: 1px dotted var(--nature-blue);
  cursor: pointer;
  transition: all 0.2s;
}

.citation-link:hover {
  border-bottom-style: solid;
}

/* ===== PDF PREVIEW ===== */
.pdf-preview {
  width: 100%;
  height: 700px;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  margin: 1.5rem 0;
}

/* ===== LICENSE SECTION ===== */
.license-section {
  margin-top: 3rem;
  padding: 1.5rem;
  border-top: 2px solid var(--border-color);
  background: var(--bg-soft);
  border-radius: 8px;
  font-family: 'Inter', sans-serif;
  font-size: 0.9rem;
  color: var(--text-light);
  text-align: center;
}

.license-section a {
  color: var(--nature-blue);
  text-decoration: none;
  font-weight: 500;
}

.license-section a:hover {
  text-decoration: underline;
}

.license-section img {
  height: 1.5em;
  width: auto;
  vertical-align: middle;
  margin: 0 0.5rem;
}

.toc-sidebar {
  position: sticky;
  top: 80px; /* Justo debajo del header */
  height: fit-content;
  max-height: calc(100vh - 100px);
  overflow-y: auto;
  font-family: 'Inter', sans-serif;
  scrollbar-width: thin;
  padding-right: 0.5rem;
  align-self: start; /* Importante para que sticky funcione en grid */
}
.toc-sidebar::-webkit-scrollbar {
  width: 4px;
}

.toc-sidebar::-webkit-scrollbar-thumb {
  background: var(--border-color);
  border-radius: 4px;
}

.toc-title {
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: var(--text-muted);
  margin-bottom: 1rem;
}

.toc-list {
  list-style: none;
  border-left: 1px solid var(--border-color);
  margin: 0;
  padding: 0;
}

.toc-item {
  margin: 0;
}

.toc-item a {
  display: block;
  padding: 0.4rem 1rem;
  color: var(--text-light);
  text-decoration: none;
  font-size: 0.85rem;
  font-weight: 400;
  transition: all 0.2s ease;
  border-left: 2px solid transparent;
  margin-left: -1px;
}

.toc-item a:hover {
  color: var(--nature-blue);
  border-left-color: var(--nature-blue);
  background: var(--bg-hover);
}

.toc-item a.active {
  color: var(--nature-blue);
  border-left-color: var(--nature-blue);
  font-weight: 500;
  background: linear-gradient(to right, var(--bg-soft), transparent);
}

.right-sidebar {
  position: sticky;
  top: 80px; /* Justo debajo del header */
  max-height: calc(100vh - 100px);
  overflow-y: auto;
  font-family: 'Inter', sans-serif;
  scrollbar-width: thin;
  padding-right: 0.5rem;
  align-self: start; /* Importante para que sticky funcione en grid */
}

.right-sidebar::-webkit-scrollbar {
  width: 6px;
}

.right-sidebar::-webkit-scrollbar-thumb {
  background: var(--border-color);
  border-radius: 3px;
}
/* ===== STICKY FIX PARA SAFARI ===== */
@supports (-webkit-touch-callout: none) {
  .sd-header {
    position: -webkit-sticky;
    position: sticky;
  }
  
  .toc-sidebar,
  .right-sidebar {
    position: -webkit-sticky;
    position: sticky;
  }
}
/* ===== FOOTER ===== */
.footer {
  background: #1a1a1a;
  color: white;
  padding: 60px 20px 30px;
  margin-top: 60px;
  border-top: 1px solid #333;
  font-family: 'Inter', sans-serif;
}

.footer-container {
  max-width: 1200px;
  margin: 0 auto;
}

.footer-social {
  display: flex;
  justify-content: center;
  gap: 40px;
  margin-bottom: 40px;
  flex-wrap: wrap;
}

.social-icon {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  color: #999;
  text-decoration: none;
  transition: all 0.3s;
}

.social-icon:hover {
  color: white;
  transform: translateY(-3px);
}

.social-icon svg {
  width: 24px;
  height: 24px;
  fill: currentColor;
}

.social-label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 2px;
  font-weight: 500;
  opacity: 0;
  transition: opacity 0.3s;
}

.social-icon:hover .social-label {
  opacity: 1;
}

.footer-contact {
  text-align: center;
  margin: 40px 0;
  padding: 20px 0;
  border-top: 1px solid #333;
  border-bottom: 1px solid #333;
}

.contact-label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 3px;
  color: #666;
  display: block;
  margin-bottom: 10px;
}

.contact-email {
  color: white;
  text-decoration: none;
  font-size: 1rem;
  transition: color 0.3s;
}

.contact-email:hover {
  color: var(--nature-blue);
}

.footer-nav-links {
  display: flex;
  justify-content: center;
  gap: 30px;
  margin: 30px 0;
  flex-wrap: wrap;
}

.footer-nav-link {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #999;
  text-decoration: none;
  font-size: 0.85rem;
  font-weight: 500;
  transition: color 0.3s;
}

.footer-nav-link:hover {
  color: white;
}

.footer-bottom {
  text-align: center;
  font-size: 9px;
  color: #666;
  text-transform: uppercase;
  letter-spacing: 4px;
  padding-top: 30px;
}
  .footer-bottom {
  text-align: center;
  font-size: 9px;
  color: #666;
  text-transform: uppercase;
  letter-spacing: 4px;
  padding-top: 30px;
}

/* ===== FOOTER LEGAL LINKS ===== */
.footer-links {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 1rem;
  margin-bottom: 1rem;
  flex-wrap: wrap;
  letter-spacing: 1px;
}

.footer-links a {
  color: #999;
  text-decoration: none;
  font-size: 0.75rem;
  font-weight: 500;
  letter-spacing: 1px;
  text-transform: uppercase;
  transition: all 0.3s ease;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
}

.footer-links a:hover {
  color: #ffffff;
  background: rgba(255, 255, 255, 0.08);
  transform: translateY(-1px);
}

.footer-links span {
  color: #555;
  font-size: 0.7rem;
  user-select: none;
}

/* Copyright */
.footer-bottom p {
  margin: 0;
  padding: 0;
  color: #555;
  font-size: 0.7rem;
  letter-spacing: 2px;
  line-height: 1.6;
}

/* Responsive */
@media (max-width: 768px) {
  .footer-links {
    gap: 0.5rem;
  }
  
  .footer-links a {
    font-size: 0.65rem;
    padding: 0.2rem 0.4rem;
  }
  
  .footer-links span {
    font-size: 0.6rem;
  }
  
  .footer-bottom p {
    font-size: 0.6rem;
    letter-spacing: 1px;
  }
}
/* ===== DOI EN SIDEBAR (metadata-item) ===== */
.metadata-doi-item {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  padding: 0.6rem 0;
  border-bottom: 1px solid var(--border-color);
}

.metadata-doi-item .metadata-label {
  flex-shrink: 0;
  min-width: 70px;
}

.metadata-doi-item .metadata-value {
  flex: 1;
  text-align: left;
  word-break: break-all;
}

.sidebar-doi-link {
  color: var(--nature-blue);
  text-decoration: none;
  font-family: 'JetBrains Mono', 'Consolas', 'Courier New', monospace;
  font-size: 0.72rem;
  transition: color 0.2s ease;
  display: inline-block;
  border-bottom: 1px dotted #94a3b8;
  word-break: break-all;
}

.sidebar-doi-link:hover {
  color: #e86125;
  border-bottom: 1px solid #e86125;
}
.mobile-only { display: none; }
.desktop-only { display: inline-block; }

/* ===== MOBILE INFO SECTION ===== */
.mobile-info {
  display: none;
  margin-top: 2rem;
  padding-top: 2rem;
  border-top: 2px solid var(--border-color);
}

/* ===== RESPONSIVE ===== */
@media (max-width: 1100px) {
  .main-wrapper {
    grid-template-columns: 1fr;
    gap: 2rem;
    padding: 2rem;
  }
  
  .toc-sidebar,
  .right-sidebar {
    display: none;
  }
  
  .mobile-info {
    display: block;
  }
  
  h1 {
    font-size: 2rem;
  }
}

@media (max-width: 900px) {
  .sd-search-wrapper,
  .sd-user-nav {
    display: none;
  }
  
  .sd-mobile-controls {
    display: flex;
  }
  
  .sd-mobile-search-btn,
  .sd-mobile-menu-btn {
    display: block;
  }
  
  .sd-logo-img {
    height: 36px;
  }
}

@media (max-width: 768px) {
  .sd-header-top {
    padding: 1rem;
  }
  
  .sd-journal-name {
    font-size: 0.8rem;
    max-width: 200px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  
  .sd-logo-img {
    display: none;
  }
  
  .sd-journal-titles {
    border-left: none;
    padding-left: 0;
  }
  
  .article-container {
    margin: 0 auto !important;
    padding: 0 1rem !important;
    width: 100% !important;
    max-width: 100% !important;
  }
  
  h1 {
    font-size: 1.75rem;
  }
  
  .article-content {
    text-align: left;
    hyphens: none;
  }
  
  .article-content p {
    font-size: 1.05rem;
    line-height: 1.7;
  }
  
  blockquote {
    margin: 2rem 0;
    padding: 1.5rem;
    font-size: 1.1rem;
  }
  
  .action-bar {
    gap: 1rem;
  }
  
  .code-block-wrapper,
  .table-wrapper,
  .MathJax_Display,
  .math-container {
    margin: 1.5rem -1rem;
    border-radius: 0;
    border-left: none;
    border-right: none;
  }
  
  .keyword-tag {
    font-size: 0.7rem;
    padding: 0.25rem 0.6rem;
  }
  
  .image-figure.float-left,
  .image-figure.float-right {
    float: none;
    margin: 1.5rem 0;
    max-width: 100%;
  }
  
  .footer-social {
    gap: 20px;
  }
  
  .footer-nav-links {
    flex-direction: column;
    align-items: center;
    gap: 15px;
  }
  
  .desktop-only { display: none; }
  .mobile-only { display: inline-block; }
  
  img, svg, iframe, embed, object {
    max-width: 100% !important;
    height: auto !important;
  }
  
  code:not(pre code) {
    white-space: pre-wrap;
    word-break: break-word;
    max-width: 100%;
  }
}

@media (max-width: 480px) {
  h1 {
    font-size: 1.5rem;
  }
  
  .doi-prefix,
  .meta-doi-label {
    font-size: 0.65rem;
  }
  
  .doi-number,
  .meta-doi-link {
    font-size: 0.75rem;
  }
  
  .keyword-code {
    font-size: 0.6rem;
  }
  
  .vocabulary-badge {
    font-size: 0.5rem;
    padding: 0.1rem 0.4rem;
  }
}

  </style>
 
</head>
<body>
  <header class="sd-header">
  <div class="sd-header-top">
    <div class="sd-brand-container">
      <a href="/" class="sd-journal-logo">
        <img src="${isSpanish ? LOGO_ES : LOGO_EN}" alt="Logo ${isSpanish ? 'RNCE' : 'TNRSFS'}" class="sd-logo-img">
        <div class="sd-journal-titles">
          <span class="sd-journal-name">${isSpanish ? JOURNAL_NAME_ES : JOURNAL_NAME_EN}</span>
          <span class="sd-issn">ISSN: 3087-2839</span>
        </div>
      </a>
    </div>
    
    <!-- Search - Solo visible en desktop -->
    <div class="sd-search-wrapper">
      <form id="search-form" class="sd-search-bar">
        <svg class="sd-search-icon" viewBox="0 0 24 24" width="18" height="18">
          <path fill="currentColor" d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
        </svg>
        <input type="text" id="search-input" placeholder="${isSpanish ? 'Buscar artículos, autores...' : 'Search articles, authors...'}" aria-label="Buscar">
      </form>
    </div>
    
    <!-- User Nav - Solo visible en desktop -->
    <div class="sd-user-nav">
      <a href="${isSpanish ? '/submit' : '/en/submit'}" class="sd-nav-link">${isSpanish ? 'Envíos' : 'Submissions'}</a>
      <a href="${isSpanish ? '/faq' : '/en/faq'}" class="sd-nav-link">${isSpanish ? 'Ayuda' : 'Help'}</a>
      <a href="${isSpanish ? '/login' : '/en/login'}" class="sd-nav-link sd-account">
        <svg viewBox="0 0 24 24" width="18" height="18">
          <path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/>
        </svg>
        ${isSpanish ? 'Mi cuenta' : 'My account'}
      </a>
    </div>
    
    <!-- Controles móviles -->
    <div class="sd-mobile-controls">
      <button class="sd-mobile-search-btn" onclick="toggleMobileSearch()" aria-label="Buscar">
        <svg viewBox="0 0 24 24">
          <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
        </svg>
      </button>
      <button class="sd-mobile-menu-btn" onclick="toggleMobileMenu()" aria-label="Menú">
        <svg viewBox="0 0 24 24">
          <path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"/>
        </svg>
      </button>
    </div>
  </div>
</header>

<!-- Overlay para menú móvil -->
<div class="sd-mobile-overlay" id="mobileOverlay" onclick="closeMobileMenu()"></div>

<!-- Menú móvil -->
<div class="sd-mobile-menu" id="mobileMenu">
  <div class="sd-mobile-menu-header">
    <span class="sd-mobile-menu-title">${isSpanish ? 'MENÚ DEL ARTÍCULO' : 'ARTICLE MENU'}</span>
    <button class="sd-mobile-close-btn" onclick="closeMobileMenu()">
      <svg viewBox="0 0 24 24">
        <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
      </svg>
    </button>
  </div>
  
  <!-- Búsqueda móvil (Siempre visible ahora para mejor UX) -->
  <div class="sd-mobile-search">
    <form id="mobile-search-form" class="sd-mobile-search-bar" onsubmit="handleMobileSearch(event)">
      <svg width="16" height="16" viewBox="0 0 24 24">
        <path fill="currentColor" d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
      </svg>
      <input type="text" id="mobile-search-input" placeholder="${isSpanish ? 'Buscar artículos...' : 'Search articles...'}" aria-label="Buscar" value="${isSpanish ? 'busca autores, artículos, etc...' : 'search authors, articles, etc...'}">
    </form>
  </div>
  
  <!-- Sección 1: CONTENIDO DEL ARTÍCULO (Tabla de contenidos) -->
  <div class="sd-mobile-nav-section">
    <div class="sd-mobile-nav-section-title">${t.contents}</div>
    <ul class="sd-mobile-nav-items" id="mobile-toc-list">
      <!-- Los elementos se generarán dinámicamente con JavaScript -->
      <li class="sd-mobile-nav-item">
        <a href="#abstract" class="sd-mobile-nav-link mobile-toc-link">
          <svg viewBox="0 0 24 24" width="20" height="20">
            <path d="M4 6H20v2H4zM4 12H20v2H4zM4 18H20v2H4z"/>
          </svg>
          ${t.abstract}
        </a>
      </li>
      <!-- Más elementos se añadirán vía JS -->
    </ul>
  </div>
  
  <!-- Sección 2: ENLACES DE USUARIO (Solo Envíos, Ayuda, Mi cuenta) -->
  <div class="sd-mobile-nav-section">
    <div class="sd-mobile-nav-section-title">${isSpanish ? 'MI CUENTA' : 'MY ACCOUNT'}</div>
    <ul class="sd-mobile-nav-items">
      <li class="sd-mobile-nav-item">
        <a href="${isSpanish ? '/submit' : '/en/submit'}" class="sd-mobile-nav-link">
          <svg viewBox="0 0 24 24" width="20" height="20">
            <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
          </svg>
          ${isSpanish ? 'Envíos' : 'Submissions'}
        </a>
      </li>
      <li class="sd-mobile-nav-item">
        <a href="${isSpanish ? '/faq' : '/en/faq'}" class="sd-mobile-nav-link">
          <svg viewBox="0 0 24 24" width="20" height="20">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-2h2v2zm2-7h-2v-2h2v2zm-4 0h-2v-2h2v2zm0-4h-2V6h2v2z"/>
          </svg>
          ${isSpanish ? 'Ayuda' : 'Help'}
        </a>
      </li>
      <li class="sd-mobile-nav-item">
        <a href="${isSpanish ? '/login' : '/en/login'}" class="sd-mobile-nav-link">
          <svg viewBox="0 0 24 24" width="20" height="20">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/>
          </svg>
          ${isSpanish ? 'Mi cuenta' : 'My account'}
        </a>
      </li>
    </ul>
  </div>
  
  <!-- Footer del menú móvil -->
  <div class="sd-mobile-menu-footer">
    <div>ISSN: 3087-2839</div>
    <div style="margin-top: 0.5rem; font-size: 0.7rem;">
      &copy; ${new Date().getFullYear()} ${isSpanish ? 'RNCE' : 'TNRSFS'}
    </div>
  </div>
</div>

  <div class="main-wrapper">
    <!-- Left Sidebar - Table of Contents -->
    <nav class="toc-sidebar">
      <div class="toc-title">${t.contents}</div>
      <ul class="toc-list" id="toc-list"></ul>
    </nav>

    <!-- Main Content -->
    <main class="article-container">
      <article>
        <header class="article-header">
          <div class="article-type">${articleType}</div>
          
          <!-- Título bilingüe - LÓGICA MEJORADA -->
          <h1 id="main-title">${title}</h1>
          ${altTitle ? `
          <div class="alt-title-container">
            <span class="alt-title" title="${isSpanish ? 'Título en inglés / English title' : 'Título en español / Spanish title'}">${altTitle}</span>
          </div>
          ` : ''}
<div class="authors">
            ${authorsDisplay}
          </div>
          <!-- Botón Show more / Show less -->
<div>
  <button id="showMoreBtn" class="show-more-btn" onclick="toggleAuthorDetails()">
    <span id="showMoreText">${isSpanish ? 'Mostrar más' : 'Show more'}</span>
    <svg id="showMoreArrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"></polyline></svg>
  </button>
</div>

<!-- Contenedor desplegable con Instituciones y Fechas -->
<div id="extendedAuthorInfo" class="extended-author-info">
  ${institutionsList}
  <div class="article-dates-block">
    ${isSpanish ? 'Recibido' : 'Received'} ${receivedDate} · ${isSpanish ? 'Aceptado' : 'Accepted'} ${acceptedDate} · ${isSpanish ? 'Disponible en línea' : 'Available online'} ${fecha}
  </div>
</div>

                    <!-- ===== META BOX CORREGIDA CON DOI Y COMPARTIR ===== -->
          <div class="meta-box">
            <span>Vol. ${article.volumen}, ${isSpanish ? 'Núm.' : 'No.'} ${article.numero}</span>
            <span>pp. ${article.primeraPagina}-${article.ultimaPagina}</span>
            <span>${fecha}</span>
            ${article.doi ? `
            <span class="meta-doi-wrapper">
              <span class="meta-doi-label">DOI:</span>
              <a href="https://doi.org/${article.doi}" target="_blank" rel="noopener noreferrer" class="meta-doi-link">
                https://doi.org/${article.doi}
              </a>
            </span>
            ` : ''}
            
            <!-- Botón de compartir -->
            <button class="share-btn-wrapper" onclick="shareArticle()">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="18" cy="5" r="3"></circle>
                <circle cx="6" cy="12" r="3"></circle>
                <circle cx="18" cy="19" r="3"></circle>
                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
                <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
              </svg>
              ${isSpanish ? 'Compartir' : 'Share'}
            </button>
          </div>
          <!-- Action Bar -->
          <div class="action-bar">
            <a href="${article.pdfUrl}" target="_blank" rel="noopener noreferrer" class="btn-pdf">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"/>
                <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>
              </svg>
              ${isSpanish ? 'Abrir PDF' : 'Open PDF'}
            </a>
            <span class="oa-label">
              ${oaSvg}
              Open Access
            </span>
          </div>
        </header>

        <!-- Abstract Section -->
        <section id="abstract">
          <h2>${t.abstract}</h2>
          <div class="abstract-container">
            <div class="abstract-text">
              ${abstractContent}
            </div>
            
            ${altAbstract ? `
            <details class="abstract-toggle">
              <summary>${t.viewAbstract}</summary>
              <div class="abstract-toggle-content">
                ${altAbstract}
              </div>
            </details>
            ` : ''}
          </div>
        </section>

        <!-- Full Article Content -->
        <section id="full-text" class="article-content">
          ${htmlContent || '<p>El texto completo estará disponible próximamente.</p>'}
        </section>

        <!-- References Section -->
        <section id="references">
          <h2>${t.references}</h2>
          ${referencesHtml}
        </section>

        <!-- Additional Info Section -->
        <section id="additional-info">
          ${acknowledgments ? `
          <h2>${t.acknowledgments}</h2>
          <p>${acknowledgments}</p>
          ` : ''}
          
          ${funding && funding.trim() !== '' && funding !== 'No declarada' && funding !== 'Not declared' ? `
          <h2>${t.funding}</h2>
          <p>${funding}</p>
          ` : ''}
          
          ${dataAvailability && dataAvailability.trim() !== '' ? `
          <h2>${t.dataAvailability}</h2>
          <p>${dataAvailability}</p>
          ` : ''}
          
          ${authorCredits && authorCredits.trim() !== '' ? `
          <h2>${t.authorContributions}</h2>
          <p>${authorCredits}</p>
          ` : ''}
          
          <h2>${t.conflictOfInterest}</h2>
          <p>${conflicts}</p>
        </section>

        <!-- PDF Preview Section -->
        ${article.pdfUrl ? `
        <section id="pdf-preview">
          <h2>${t.pdfPreview}</h2>
          <embed src="${article.pdfUrl}" type="application/pdf" class="pdf-preview" />
          <div style="display: flex; gap: 1rem; margin-top: 1rem;">
            <a href="${article.pdfUrl}" target="_blank" class="btn-pdf">${t.viewFullScreen}</a>
            <a href="${article.pdfUrl}" download class="btn-pdf" style="background: var(--text-light);">${t.downloadPDF}</a>
          </div>
        </section>
        ` : ''}

      <!-- License Section -->
<section id="license" class="license-section">
  <p>
    <strong>© ${new Date().getFullYear()} ${authorsAPA}</strong>
    <span style="margin: 0 0.5rem;">·</span>
    <strong>${t.license}:</strong> 
    Este artículo se publica bajo la licencia 
    <a href="https://creativecommons.org/licenses/by/4.0/deed.${isSpanish ? 'es' : 'en'}" target="_blank" rel="license noopener noreferrer">
      ${ccLogoSvg} CC BY 4.0
    </a>
  </p>
  
  <p style="margin-top: 0.5rem; font-size: 0.85rem; color: var(--text-muted);">
    ${isSpanish ? 'Los autores retienen los derechos de autor y conceden a la revista el derecho de primera publicación' : 'Authors retain copyright and grant the journal right of first publication'}
  </p>
  
  <p style="margin-top: 0.5rem; font-size: 0.8rem;">
    <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="license noopener noreferrer">
      Creative Commons Attribution 4.0 International License
    </a>
  </p>
</section>
      </article>

      <!-- Mobile Info Section -->
      <div class="mobile-info">
        <div class="info-tabs">
          <div class="tab-buttons">
            <button class="tab-button active" onclick="switchTab('mobile', 'citations')">${t.howToCite}</button>
            <button class="tab-button" onclick="switchTab('mobile', 'metadata')">${t.information}</button>
          </div>
          
          <!-- Citations Tab -->
          <div id="mobile-citations" class="tab-panel active">
            <h4>${t.howToCite}</h4>
            <div class="citation-box">
              <div class="citation-item">
                <strong>APA</strong>
                <button class="copy-btn" onclick="copyRichText('apa-text-${lang}-mobile', event)">${t.copy}</button>
                <div id="apa-text-${lang}-mobile" style="margin-top: 0.25rem;">${authorsAPA}. (${year}). ${title}. <em>Revista Nacional de las Ciencias para Estudiantes</em>, ${article.volumen}(${article.numero}), ${article.primeraPagina}-${article.ultimaPagina}. ${article.doi ? `https://doi.org/${article.doi}` : ''}</div>
              </div>
              <div class="citation-item">
                <strong>MLA</strong>
                <button class="copy-btn" onclick="copyRichText('mla-text-${lang}-mobile', event)">${t.copy}</button>
                <div id="mla-text-${lang}-mobile" style="margin-top: 0.25rem;">${isSpanish ? authorsMLAEs : authorsMLAEn}. "${title}." <em>Revista Nacional de las Ciencias para Estudiantes</em>, vol. ${article.volumen}, no. ${article.numero}, ${year}, pp. ${article.primeraPagina}-${article.ultimaPagina}. ${article.doi ? `https://doi.org/${article.doi}` : ''}</div>
              </div>
              <div class="citation-item">
                <strong>Chicago</strong>
                <button class="copy-btn" onclick="copyRichText('chi-text-${lang}-mobile', event)">${t.copy}</button>
                <div id="chi-text-${lang}-mobile" style="margin-top: 0.25rem;">${isSpanish ? authorsChicagoEs : authorsChicagoEn}. "${title}." <em>Revista Nacional de las Ciencias para Estudiantes</em> ${article.volumen}, no. ${article.numero} (${year}): ${article.primeraPagina}-${article.ultimaPagina}. ${article.doi ? `https://doi.org/${article.doi}` : ''}</div>
              </div>
              <a href="data:text/plain;charset=utf-8,${encodeURIComponent(bibtex)}" download="article-${article.numeroArticulo}.bib" class="bibtex-download">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5z"/>
                  <path d="M7.646 11.854a.5.5 0 0 0 .708 0l3-3a.5.5 0 0 0-.708-.708L8.5 10.293V1.5a.5.5 0 0 0-1 0v8.793L5.354 8.146a.5.5 0 1 0-.708.708l3 3z"/>
                </svg>
                ${t.downloadBibTeX}
              </a>
            </div>
          </div>
          
          <!-- Metadata Tab -->
          <div id="mobile-metadata" class="tab-panel">
            <h4>${t.keywords}</h4>
            <div class="keywords" style="margin-bottom: 1.5rem;">
              ${keywords.map(kw => {
    // Detectar si es formato controlado: "CÓDIGO: Término"
    const match = typeof kw === 'string' ? kw.match(/^([A-Za-z0-9.]+):\s*(.+)/) : null;
    if (match) {
        return `<span class="keyword-tag keyword-controlled">
            <code class="keyword-code">${match[1]}</code>
            <span class="keyword-term">${match[2]}</span>
        </span>`;
    }
    // Formato legacy: término simple
    return `<span class="keyword-tag">${kw}</span>`;
}).join('')}
            </div>
            
            <h4>${t.articleInfo}</h4>
            <div class="metadata-item">
              <span class="metadata-label">${t.received}</span>
              <span class="metadata-value">${receivedDate}</span>
            </div>
            <div class="metadata-item">
              <span class="metadata-label">${t.accepted}</span>
              <span class="metadata-value">${acceptedDate}</span>
            </div>
            <div class="metadata-item">
              <span class="metadata-label">${t.published}</span>
              <span class="metadata-value">${fecha}</span>
            </div>
            <div class="metadata-item">
              <span class="metadata-label">${t.area}</span>
              <span class="metadata-value">${article.area}</span>
            </div>

            ${article.doi ? `
            <div class="metadata-item metadata-doi-item">
              <span class="metadata-label">DOI</span>
              <span class="metadata-value">
                <a href="https://doi.org/${article.doi}" target="_blank" rel="noopener noreferrer" class="sidebar-doi-link">
                  ${article.doi}
                </a>
              </span>
            </div>
            ` : ''}

            ${funding && funding !== 'No declarada' && funding !== 'Not declared' ? `
            <div class="metadata-item">
              <span class="metadata-label">${t.fundingLabel}</span>
              <span class="metadata-value">${funding}</span>
            </div>
            ` : ''}
          </div>
        </div>
      </div>
    </main>

    <!-- Right Sidebar with Tabs -->
    <aside class="right-sidebar">
      <div class="info-tabs">
        <div class="tab-buttons">
          <button class="tab-button active" onclick="switchTab('desktop', 'citations')">${t.howToCite}</button>
          <button class="tab-button" onclick="switchTab('desktop', 'metadata')">${t.information}</button>
        </div>
        
        <!-- Citations Tab -->
        <div id="desktop-citations" class="tab-panel active">
          <h4>${t.howToCite}</h4>
          <div class="citation-box">
            <div class="citation-item">
              <strong>APA</strong>
              <button class="copy-btn" onclick="copyRichText('apa-text-${lang}', event)">${t.copy}</button>
              <div id="apa-text-${lang}" style="margin-top: 0.25rem;">${authorsAPA}. (${year}). ${title}. <em>Revista Nacional de las Ciencias para Estudiantes</em>, ${article.volumen}(${article.numero}), ${article.primeraPagina}-${article.ultimaPagina}. ${article.doi ? `https://doi.org/${article.doi}` : ''}</div>
            </div>
            <div class="citation-item">
              <strong>MLA</strong>
              <button class="copy-btn" onclick="copyRichText('mla-text-${lang}', event)">${t.copy}</button>
              <div id="mla-text-${lang}" style="margin-top: 0.25rem;">${isSpanish ? authorsMLAEs : authorsMLAEn}. "${title}." <em>Revista Nacional de las Ciencias para Estudiantes</em>, vol. ${article.volumen}, no. ${article.numero}, ${year}, pp. ${article.primeraPagina}-${article.ultimaPagina}. ${article.doi ? `https://doi.org/${article.doi}` : ''}</div>
            </div>
            <div class="citation-item">
              <strong>Chicago</strong>
              <button class="copy-btn" onclick="copyRichText('chi-text-${lang}', event)">${t.copy}</button>
              <div id="chi-text-${lang}" style="margin-top: 0.25rem;">${isSpanish ? authorsChicagoEs : authorsChicagoEn}. "${title}." <em>Revista Nacional de las Ciencias para Estudiantes</em> ${article.volumen}, no. ${article.numero} (${year}): ${article.primeraPagina}-${article.ultimaPagina}. ${article.doi ? `https://doi.org/${article.doi}` : ''}</div>
            </div>
            <a href="data:text/plain;charset=utf-8,${encodeURIComponent(bibtex)}" download="article-${article.numeroArticulo}.bib" class="bibtex-download">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5z"/>
                <path d="M7.646 11.854a.5.5 0 0 0 .708 0l3-3a.5.5 0 0 0-.708-.708L8.5 10.293V1.5a.5.5 0 0 0-1 0v8.793L5.354 8.146a.5.5 0 1 0-.708.708l3 3z"/>
              </svg>
              ${t.downloadBibTeX}
            </a>
          </div>
        </div>
   <!-- Metadata Tab -->
<div id="desktop-metadata" class="tab-panel active">
  <div class="info-card">
    <!-- Palabras Clave (Libres) -->
    ${keywordsArray.length > 0 ? `
    <div class="metadata-section">
      <h4>${isSpanish ? 'Palabras Clave' : 'Keywords'}</h4>
      <div class="keywords">
        ${keywordsArray.map(kw => `<span class="keyword-tag">${kw.replace(/"/g, '&quot;')}</span>`).join('')}
      </div>
    </div>
    ` : ''}

    <!-- Códigos Especializados (SEPARADOS) -->
    ${specializedCodesArray.length > 0 ? `
    <div class="metadata-section" style="margin-top: 1.25rem; padding-top: 1rem; border-top: 1px solid var(--border-color);">
      <h4 style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
        ${isSpanish ? 'Códigos Especializados' : 'Specialized Codes'}
        ${vocabularyName ? `<span class="vocabulary-badge">${vocabularyName}</span>` : ''}
      </h4>
      <div class="keywords specialized-codes-container">
        ${specializedCodesArray.map(code => `
          <span class="keyword-tag keyword-controlled">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display: inline-block; vertical-align: middle; margin-right: 4px;">
              <polyline points="16 18 22 12 16 6"></polyline>
              <polyline points="8 6 2 12 8 18"></polyline>
            </svg>
            <span class="keyword-code">${code.replace(/"/g, '&quot;')}</span>
          </span>
        `).join('')}
      </div>
    </div>
    ` : ''}
          
          <h4>${t.articleInfo}</h4>
          <div class="metadata-item">
            <span class="metadata-label">${t.received}</span>
            <span class="metadata-value">${receivedDate}</span>
          </div>
          <div class="metadata-item">
            <span class="metadata-label">${t.accepted}</span>
            <span class="metadata-value">${acceptedDate}</span>
          </div>
          <div class="metadata-item">
            <span class="metadata-label">${t.published}</span>
            <span class="metadata-value">${fecha}</span>
          </div>
          <div class="metadata-item">
            <span class="metadata-label">${t.area}</span>
            <span class="metadata-value">${article.area}</span>
          </div>

          ${article.doi ? `
          <div class="metadata-item metadata-doi-item">
            <span class="metadata-label">DOI</span>
            <span class="metadata-value">
              <a href="https://doi.org/${article.doi}" target="_blank" rel="noopener noreferrer" class="sidebar-doi-link">
                ${article.doi}
              </a>
            </span>
          </div>
          ` : ''}

          ${funding && funding !== 'No declarada' && funding !== 'Not declared' ? `
          <div class="metadata-item">
            <span class="metadata-label">${t.fundingLabel}</span>
            <span class="metadata-value">${funding}</span>
          </div>
          ` : ''}
        </div>
      </div>
    </aside>
  </div>

   <!-- Footer con Redes Sociales y Contacto (igual que en news) -->
   <footer class="footer">
    <div class="footer-container">
      <!-- Redes Sociales -->
      <div class="footer-social">
        <a href="${socialLinks.instagram}" target="_blank" rel="noopener" class="social-icon">
          ${socialIcons.instagram}
          <span class="social-label">Instagram</span>
        </a>
        <a href="${socialLinks.youtube}" target="_blank" rel="noopener" class="social-icon">
          ${socialIcons.youtube}
          <span class="social-label">YouTube</span>
        </a>
        <a href="${socialLinks.tiktok}" target="_blank" rel="noopener" class="social-icon">
          ${socialIcons.tiktok}
          <span class="social-label">TikTok</span>
        </a>
        <a href="${socialLinks.spotify}" target="_blank" rel="noopener" class="social-icon">
          ${socialIcons.spotify}
          <span class="social-label">Spotify</span>
        </a>
      </div>

      <!-- Contacto - Versión ultra simple sin JavaScript -->
      <div class="footer-contact">
        <span class="contact-label">${t.contact}</span>
        
        <!-- Versión para escritorio (Gmail) - visible solo en pantallas grandes -->
        <a href="https://mail.google.com/mail/?view=cm&fs=1&to=contact@revistacienciasestudiantes.com" 
           target="_blank" 
           class="contact-email desktop-only"
           rel="noopener">
          contact@revistacienciasestudiantes.com
        </a>
        
        <!-- Versión para móvil (mailto) - visible solo en pantallas pequeñas -->
        <a href="mailto:contact@revistacienciasestudiantes.com" 
           class="contact-email mobile-only"
           rel="noopener">
          contact@revistacienciasestudiantes.com
        </a>
      </div>

      <!-- Navegación adicional: Volver al catálogo, Volver al home, Ver en otro idioma -->
      <div class="footer-nav-links">
        <a href="${isSpanish ? '/articles/index.html' : '/articles/index.EN.html'}" class="footer-nav-link">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M11.354 1.646a.5.5 0 0 1 0 .708L5.707 8l5.647 5.646a.5.5 0 0 1-.708.708l-6-6a.5.5 0 0 1 0-.708l6-6a.5.5 0 0 1 .708 0z"/>
          </svg>
          ${t.backToCatalog}
        </a>
        <a href="/" class="footer-nav-link">
          ${t.backToHome}
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M4.646 1.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1 0 .708l-6 6a.5.5 0 0 1-.708-.708L10.293 8 4.646 2.354a.5.5 0 0 1 0-.708z"/>
          </svg>
        </a>
        <a href="/articles/article-${articleSlug}${isSpanish ? 'EN' : ''}.html" class="footer-nav-link">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12.87 15.07l-2.54-2.51.03-.03c1.68-1.68 2.77-3.85 2.96-6.03h3.68V3h-8V1h-2v2H3v2h11.17C13.93 6.69 12.69 8.45 11 10.22c-.74-.74-1.36-1.59-1.86-2.52h-2c.59 1.43 1.46 2.78 2.55 3.88L3 20.59 4.41 22 12 14.41l3.29 3.29L17 15.06l-4.13-3.99z"/>
          </svg>
          ${t.viewOtherLang}
        </a>
      </div>

      <!-- Copyright y enlaces legales -->
      <div class="footer-bottom">
        <div class="footer-links">
          <a href="/privacy${isSpanish ? '' : 'EN'}.html">Privacidad</a>
          <span>|</span>
          <a href="/terms${isSpanish ? '' : 'EN'}.html">Términos</a>
          <span>|</span>
          <a href="/credits${isSpanish ? '' : 'EN'}.html">Créditos</a>
        </div>
        <p>© ${new Date().getFullYear()} ${isSpanish ? JOURNAL_NAME_ES : JOURNAL_NAME_EN} · ISSN 3087-2839</p>
      </div>
    </div>
  </footer>
<!-- Share Modal -->
<div class="share-modal-overlay" id="shareModalOverlay" onclick="closeShareModal(event)">
  <div class="share-modal" onclick="event.stopPropagation()">
    <div class="share-modal-header">
      <span class="share-modal-title">${isSpanish ? 'Compartir artículo' : 'Share article'}</span>
      <button class="share-modal-close" onclick="closeShareModal()" aria-label="Cerrar">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    </div>
    <div class="share-modal-body">
      <div class="share-modal-url-box">
        <span class="share-modal-url" id="shareUrlText"></span>
        <button class="share-modal-copy-btn" id="shareCopyBtn" onclick="copyShareUrl()">${isSpanish ? 'Copiar' : 'Copy'}</button>
      </div>
      <div class="share-social-grid">
        <a href="#" class="share-social-btn twitter" id="shareTwitter" target="_blank" rel="noopener noreferrer">
          <svg viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
          <span class="share-social-label">X</span>
        </a>
        <a href="#" class="share-social-btn facebook" id="shareFacebook" target="_blank" rel="noopener noreferrer">
          <svg viewBox="0 0 24 24"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
          <span class="share-social-label">Facebook</span>
        </a>
        <a href="#" class="share-social-btn whatsapp" id="shareWhatsapp" target="_blank" rel="noopener noreferrer">
          <svg viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
          <span class="share-social-label">WhatsApp</span>
        </a>
        <a href="#" class="share-social-btn linkedin" id="shareLinkedin" target="_blank" rel="noopener noreferrer">
          <svg viewBox="0 0 24 24"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.225 0z"/></svg>
          <span class="share-social-label">LinkedIn</span>
        </a>
        <a href="#" class="share-social-btn email" id="shareEmail">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>
          <span class="share-social-label">Email</span>
        </a>
        <a href="#" class="share-social-btn telegram" id="shareTelegram" target="_blank" rel="noopener noreferrer">
          <svg viewBox="0 0 24 24"><path d="M11.944 0A12 12 0 000 12a12 12 0 0012 12 12 12 0 0012-12A12 12 0 0012 0a12 12 0 00-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 01.171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>
          <span class="share-social-label">Telegram</span>
        </a>
        <a href="#" class="share-social-btn copy" id="shareCopyLink">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
          <span class="share-social-label">${isSpanish ? 'Copiar' : 'Copy'}</span>
        </a>
      </div>
    </div>
  </div>
</div>
<script>
function toggleAuthorDetails() {
  const info = document.getElementById('extendedAuthorInfo');
  const text = document.getElementById('showMoreText');
  const arrow = document.getElementById('showMoreArrow');
  
  info.classList.toggle('active');
  if (info.classList.contains('active')) {
    text.textContent = '${isSpanish ? 'Mostrar menos' : 'Show less'}';
    arrow.style.transform = 'rotate(180deg)';
  } else {
    text.textContent = '${isSpanish ? 'Mostrar más' : 'Show more'}';
    arrow.style.transform = 'rotate(0deg)';
  }
}
  function shareArticle() {
  openShareModal();
}
// ========== CITATION PICKER MODAL ==========
function openCitationPicker(event, referenceId) {
  event.preventDefault();
  
  // Buscar todas las citas que apuntan a esta referencia
  var citations = document.querySelectorAll('a[href="#' + referenceId + '"][id^="cite-ref-"]');
  
  if (citations.length === 0) return;
  
  // Si solo hay una cita, ir directamente
  if (citations.length === 1) {
    var target = document.getElementById(citations[0].id);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Resaltar temporalmente
      target.style.backgroundColor = 'rgba(78, 201, 176, 0.3)';
      setTimeout(function() {
        target.style.backgroundColor = '';
      }, 2000);
    }
    return;
  }
  
  // Si hay múltiples citas, mostrar modal
  var overlay = document.getElementById('citationPickerOverlay');
  var body = document.getElementById('citationPickerBody');
  
  if (!overlay || !body) return;
  
  // Limpiar
  body.innerHTML = '';
  
  // Añadir opciones
  citations.forEach(function(citation, index) {
    var btn = document.createElement('button');
    btn.className = 'citation-picker-option';
    btn.innerHTML = '<span class="citation-number">' + (index + 1) + '</span> Volver a la cita ' + (index + 1);
    btn.onclick = function() {
      closeCitationPicker();
      var target = document.getElementById(citation.id);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // Resaltar temporalmente
        target.style.backgroundColor = 'rgba(78, 201, 176, 0.3)';
        setTimeout(function() {
          target.style.backgroundColor = '';
        }, 2000);
      }
    };
    body.appendChild(btn);
  });
  
  // Mostrar modal
  overlay.classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeCitationPicker() {
  var overlay = document.getElementById('citationPickerOverlay');
  if (overlay) {
    overlay.classList.remove('active');
    document.body.style.overflow = '';
  }
}

// Cerrar con Escape
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') {
    closeCitationPicker();
  }
});

// Cerrar al hacer clic fuera
document.addEventListener('click', function(e) {
  var overlay = document.getElementById('citationPickerOverlay');
  if (overlay && e.target === overlay) {
    closeCitationPicker();
  }
});
function openShareModal() {
  var overlay = document.getElementById('shareModalOverlay');
  var url = window.location.href;
  var title = document.title;
  var encodedUrl = encodeURIComponent(url);
  var encodedTitle = encodeURIComponent(title);
  
  // Actualizar URL en el modal
  document.getElementById('shareUrlText').textContent = url;
  
  // Configurar enlaces de redes sociales (usando concatenación, no backticks)
  document.getElementById('shareTwitter').href = 'https://twitter.com/intent/tweet?url=' + encodedUrl + '&text=' + encodedTitle;
  document.getElementById('shareFacebook').href = 'https://www.facebook.com/sharer/sharer.php?u=' + encodedUrl;
  document.getElementById('shareWhatsapp').href = 'https://wa.me/?text=' + encodedTitle + '%20' + encodedUrl;
  document.getElementById('shareLinkedin').href = 'https://www.linkedin.com/sharing/share-offsite/?url=' + encodedUrl;
   document.getElementById('shareEmail').href = 'https://mail.google.com/mail/?view=cm&fs=1&su=' + encodedTitle + '&body=' + encodedUrl;
  document.getElementById('shareTelegram').href = 'https://t.me/share/url?url=' + encodedUrl + '&text=' + encodedTitle;
  document.getElementById('shareCopyLink').onclick = function(e) {
    e.preventDefault();
    copyShareUrl();
  };
  
  // Mostrar modal
  overlay.classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeShareModal(event) {
  var overlay = document.getElementById('shareModalOverlay');
  if (event && event.target !== overlay) return;
  overlay.classList.remove('active');
  document.body.style.overflow = '';
}

function copyShareUrl() {
  var url = window.location.href;
  var copyBtn = document.getElementById('shareCopyBtn');
  
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(function() {
      showCopiedFeedback(copyBtn);
    }).catch(function() {
      fallbackCopy(url, copyBtn);
    });
  } else {
    fallbackCopy(url, copyBtn);
  }
}

function fallbackCopy(text, btn) {
  var textArea = document.createElement('textarea');
  textArea.value = text;
  document.body.appendChild(textArea);
  textArea.select();
  document.execCommand('copy');
  document.body.removeChild(textArea);
  showCopiedFeedback(btn);
}

function showCopiedFeedback(btn) {
  var originalText = btn.textContent;
  btn.textContent = '${isSpanish ? '✓ Copiado' : '✓ Copied'}';
  btn.classList.add('copied');
  setTimeout(function() {
    btn.textContent = originalText;
    btn.classList.remove('copied');
  }, 2000);
}

// Cerrar modal con tecla Escape
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') {
    closeShareModal();
  }
});
// ========== FUNCIONES PARA MENÚ MÓVIL ==========
let mobileSearchVisible = false;

function toggleMobileMenu() {
  const menu = document.getElementById('mobileMenu');
  const overlay = document.getElementById('mobileOverlay');
  
  menu.classList.toggle('active');
  overlay.classList.toggle('active');
  
  // Prevenir scroll del body cuando el menú está abierto
  if (menu.classList.contains('active')) {
    document.body.style.overflow = 'hidden';
    // Generar TOC móvil cada vez que se abre el menú
    generateMobileTOC();
  } else {
    document.body.style.overflow = '';
  }
}

function closeMobileMenu() {
  const menu = document.getElementById('mobileMenu');
  const overlay = document.getElementById('mobileOverlay');
  
  if (menu) menu.classList.remove('active');
  if (overlay) overlay.classList.remove('active');
  document.body.style.overflow = '';
  
  // También cerrar la búsqueda si está abierta
  const mobileSearch = document.getElementById('mobileSearch');
  if (mobileSearchVisible) {
    mobileSearch.style.display = 'none';
    mobileSearchVisible = false;
  }
}

function toggleMobileSearch() {
  // Abrir el menú móvil
  const menu = document.getElementById('mobileMenu');
  const overlay = document.getElementById('mobileOverlay');
  
  menu.classList.add('active');
  overlay.classList.add('active');
  document.body.style.overflow = 'hidden';
  
  // Generar el TOC móvil
  generateMobileTOC();
  
  // Pequeño retraso para asegurar que el menú esté renderizado
  setTimeout(() => {
    const mobileSearchInput = document.getElementById('mobile-search-input');
    if (mobileSearchInput) {
      mobileSearchInput.focus();
      // Opcional: seleccionar todo el texto existente
      mobileSearchInput.select();
    }
  }, 300); // 300ms es suficiente para la animación del menú
}
function handleMobileSearch(e) {
  e.preventDefault();
  const query = document.getElementById('mobile-search-input').value.trim();
  if (query) {
    const encodedQuery = encodeURIComponent(query).replace(/%20/g, '+');
    window.location.href = '/article?article_search=' + encodedQuery;
  }
}

// ========== FUNCIÓN DE BÚSQUEDA PRINCIPAL ==========
document.addEventListener('DOMContentLoaded', () => {
  const searchForm = document.getElementById('search-form');
  if (searchForm) {
    searchForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const query = document.getElementById('search-input').value.trim();
      if (query) {
        const encodedQuery = encodeURIComponent(query).replace(/%20/g, '+');
        window.location.href = '/article?article_search=' + encodedQuery;
      }
    });
  }
});

// ========== GENERAR TABLA DE CONTENIDOS PARA MÓVIL ==========
function generateMobileTOC() {
  const mobileTocList = document.getElementById('mobile-toc-list');
  if (!mobileTocList) return;
  
  // Guardar el idioma actual
  const isSpanish = document.documentElement.lang === 'es';
  
  // Limpiar lista existente
  mobileTocList.innerHTML = '';
  
  // Añadir resumen siempre
  const abstractItem = document.createElement('li');
  abstractItem.className = 'sd-mobile-nav-item';
  
  // Usar concatenación normal en lugar de template string anidado
  abstractItem.innerHTML = '<a href="#abstract" class="sd-mobile-nav-link mobile-toc-link" data-target="abstract">' +
    '<svg viewBox="0 0 24 24" width="20" height="20">' +
      '<path d="M4 6H20v2H4zM4 12H20v2H4zM4 18H20v2H4z"/>' +
    '</svg>' +
    (isSpanish ? 'Resumen' : 'Abstract') +
  '</a>';
  
  mobileTocList.appendChild(abstractItem);
  
  // Obtener todos los encabezados h2 del artículo
  const headings = document.querySelectorAll('.article-container h2');
  
  headings.forEach((heading, index) => {
    // Ignorar ciertos encabezados que no queremos en el TOC
    if (heading.id === 'citations' || heading.closest('.citation-box')) return;
    
    // Asegurar que el encabezado tenga un ID
    const id = heading.id || 'section-' + index;
    heading.id = id;
    
    // Crear elemento de menú
    const li = document.createElement('li');
    li.className = 'sd-mobile-nav-item';
    
    // Determinar ícono según el tipo de sección
    let iconPath = '';
    const headingText = heading.textContent.toLowerCase();
    
    if (headingText.includes('referencia') || headingText.includes('reference')) {
      iconPath = '<path d="M4 6H20v2H4zM4 12H20v2H4zM4 18H20v2H4z"/>';
    } else if (headingText.includes('agradec') || headingText.includes('acknowledg')) {
      iconPath = '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>';
    } else if (headingText.includes('financi') || headingText.includes('funding')) {
      iconPath = '<path d="M11.5 1L8 12h3.5L8 23 16 9h-4.5L16 1h-4.5z"/>';
    } else if (headingText.includes('pdf') || headingText.includes('visualiz')) {
      iconPath = '<path d="M20 2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4V4c0-1.1-.9-2-2-2z"/>';
    } else if (headingText.includes('licen') || headingText.includes('license')) {
      iconPath = '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>';
    } else {
      iconPath = '<path d="M4 6H20v2H4zM4 12H20v2H4zM4 18H20v2H4z"/>';
    }
    
    // Construir el HTML con concatenación
    li.innerHTML = '<a href="#' + id + '" class="sd-mobile-nav-link mobile-toc-link" data-target="' + id + '">' +
      '<svg viewBox="0 0 24 24" width="20" height="20">' +
        iconPath +
      '</svg>' +
      heading.textContent +
    '</a>';
    
    mobileTocList.appendChild(li);
  });
  
  // Añadir evento de cierre del menú al hacer clic en los enlaces
  document.querySelectorAll('.mobile-toc-link').forEach(link => {
    link.addEventListener('click', (e) => {
      const targetId = link.getAttribute('data-target');
      if (targetId) {
        e.preventDefault();
        const targetElement = document.getElementById(targetId);
        if (targetElement) {
          targetElement.scrollIntoView({ behavior: 'smooth' });
          closeMobileMenu(); // Cerrar el menú después de navegar
        }
      }
    });
  });
}

// ========== INICIALIZAR CODEMIRROR ==========
document.addEventListener('DOMContentLoaded', () => {
  // Inicializar CodeMirror en todos los textareas de código
  document.querySelectorAll('.codemirror-textarea').forEach((textarea) => {
    const mode = textarea.getAttribute('data-mode') || 'python';
    
    CodeMirror.fromTextArea(textarea, {
      mode: mode,
      theme: 'dracula',
      readOnly: true,
      lineNumbers: true,
      lineWrapping: false,
      indentUnit: 4,
      tabSize: 4,
      viewportMargin: Infinity,
      autoRefresh: true
    });
  });
});

// ========== FUNCIÓN PARA COPIAR CÓDIGO DE CODEMIRROR ==========
function copyCodeFromCM(codeId, btn) {
  const wrapper = document.getElementById(codeId);
  if (!wrapper) return;
  
  // Obtener la instancia de CodeMirror
  const textarea = wrapper.querySelector('.codemirror-textarea');
  const cmInstance = textarea && textarea.CodeMirror;
  
  let code = '';
  if (cmInstance) {
    code = cmInstance.getValue();
  } else {
    code = textarea ? textarea.value : '';
  }
  
  navigator.clipboard.writeText(code).then(() => {
    const originalHtml = btn.innerHTML;
    btn.innerHTML = '✓ Copiado';
    btn.style.background = '#22c55e';
    btn.style.color = 'white';
    btn.style.borderColor = '#22c55e';
    
    setTimeout(() => {
      btn.innerHTML = originalHtml;
      btn.style.background = '';
      btn.style.color = '';
      btn.style.borderColor = '';
    }, 2000);
  }).catch(err => {
    console.error('Error copying code:', err);
    alert('No se pudo copiar el código');
  });
}
// ========== TAB SWITCHING ==========
function switchTab(device, tabName) {
  if (device === 'desktop') {
    document.querySelectorAll('#desktop-citations, #desktop-metadata').forEach(panel => {
      panel.classList.remove('active');
    });
    document.querySelectorAll('.right-sidebar .tab-button').forEach(btn => {
      btn.classList.remove('active');
    });
    document.getElementById('desktop-' + tabName).classList.add('active');
    if (event) event.target.classList.add('active');
  } else {
    document.querySelectorAll('#mobile-citations, #mobile-metadata').forEach(panel => {
      panel.classList.remove('active');
    });
    document.querySelectorAll('.mobile-info .tab-button').forEach(btn => {
      btn.classList.remove('active');
    });
    document.getElementById('mobile-' + tabName).classList.add('active');
    if (event) event.target.classList.add('active');
  }
}

// ========== GENERATE DESKTOP TABLE OF CONTENTS ==========
document.addEventListener('DOMContentLoaded', function() {
  var tocList = document.getElementById('toc-list');
  if (!tocList) return;

  // --- PRIMERO: AÑADIR ENCABEZADOS H2 ---
  var headings = document.querySelectorAll('.article-container h2');
  
  for (var j = 0; j < headings.length; j++) {
    var heading = headings[j];
    if (heading.id === 'citations' || heading.closest('.citation-box')) continue;
    
    var id = heading.id || 'section-' + j;
    heading.id = id;
    
    var li = document.createElement('li');
    li.className = 'toc-item';
    var link = document.createElement('a');
    link.href = '#' + id;
    link.textContent = heading.textContent;
    
    link.addEventListener('click', (function(sectionId) {
      return function(e) {
        e.preventDefault();
        document.getElementById(sectionId).scrollIntoView({ behavior: 'smooth' });
      };
    })(id));
    
    li.appendChild(link);
    tocList.appendChild(li);
  }

  // --- DESPUÉS: AÑADIR ELEMENTOS ESPECIALES (FIGURAS, TABLAS, ETC.) ---
  var specialElements = window.__SPECIAL_ELEMENTS__ || [];
  
  // Definir iconos para cada tipo
  var iconMap = {
    figure: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5" fill="currentColor"/><path d="M21 15L16 10 5 21"/></svg>',
    table: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5zm0 5h18M10 3v18"/></svg>',
    code: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="m18 16 4-4-4-4M6 8l-4 4 4 4M14.5 4l-5 16"/></svg>',
    equation: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 7h3a2 2 0 0 1 2 2v6a2 2 0 0 0 2 2h3"/><path d="M7 11h4"/><path d="M17 7h.01"/><circle cx="18.5" cy="15.5" r="2.5"/></svg>'
  };

  if (specialElements.length > 0) {
    // Crear un separador visual
    var separator = document.createElement('li');
    separator.className = 'toc-separator';
    separator.innerHTML = '<span style="display:block; font-size:0.7rem; font-weight:600; text-transform:uppercase; letter-spacing:1px; color:var(--text-muted); margin:1rem 0 0.5rem 0; padding-left:1rem;">FIGURAS Y TABLAS</span>';
    tocList.appendChild(separator);

    for (var i = 0; i < specialElements.length; i++) {
      var element = specialElements[i];
      var li = document.createElement('li');
      li.className = 'toc-item toc-special';
      var link = document.createElement('a');
      link.href = '#' + element.id;
      
      // Usar el icono correspondiente
      var icon = iconMap[element.type] || '•';
      link.innerHTML = icon + ' <span style="margin-left: 6px;">' + element.title + '</span>';
      
      link.addEventListener('click', (function(id) {
        return function(e) {
          e.preventDefault();
          document.getElementById(id).scrollIntoView({ behavior: 'smooth' });
        };
      })(element.id));
      
      li.appendChild(link);
      tocList.appendChild(li);
    }
  }

  // Smooth scroll for all internal links
  var anchors = document.querySelectorAll('a[href^="#"]');
  for (var k = 0; k < anchors.length; k++) {
    var anchor = anchors[k];
    anchor.addEventListener('click', function(e) {
      var href = this.getAttribute('href');
      if (href === '#') return;
      
      var target = document.querySelector(href);
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth' });
      }
    });
  }

  // Active section highlighting
  var observer = new IntersectionObserver(function(entries) {
    for (var l = 0; l < entries.length; l++) {
      var entry = entries[l];
      if (entry.isIntersecting) {
        var links = document.querySelectorAll('.toc-item a');
        for (var m = 0; m < links.length; m++) {
          var link = links[m];
          link.classList.remove('active');
          if (link.getAttribute('href') === '#' + entry.target.id) {
            link.classList.add('active');
          }
        }
      }
    }
  }, { threshold: 0.3, rootMargin: '-80px 0px -80px 0px' });

  // Observar todos los elementos relevantes
  var elementsToObserve = document.querySelectorAll('.article-container h2, #abstract, [id^="figure-"], [id^="table-"], [id^="code-"], [id^="equation-"]');
  for (var n = 0; n < elementsToObserve.length; n++) {
    var el = elementsToObserve[n];
    if (el.id) observer.observe(el);
  }
  
  // Generar TOC móvil inicial
  if (typeof generateMobileTOC === 'function') {
    generateMobileTOC();
  }
});
// ========== ACTIVE SECTION HIGHLIGHTING FOR MOBILE TOC ==========
// Crear un observer separado para el TOC móvil
document.addEventListener('DOMContentLoaded', () => {
  const mobileObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        document.querySelectorAll('.mobile-toc-link').forEach(link => {
          link.classList.remove('active');
          if (link.getAttribute('data-target') === entry.target.id) {
            link.classList.add('active');
          }
        });
      }
    });
  }, { threshold: 0.3, rootMargin: '-80px 0px -80px 0px' });

  document.querySelectorAll('.article-container h2, #abstract').forEach(el => {
    if (el.id) mobileObserver.observe(el);
  });
});

// ========== COPY RICH TEXT FUNCTION ==========
function copyRichText(id, event) {
  const element = document.getElementById(id);
  if (!element) return;
  
  const htmlContent = element.innerHTML;
  const plainText = element.innerText || element.textContent;
  
  const clipboardItem = new ClipboardItem({
    'text/plain': new Blob([plainText], { type: 'text/plain' }),
    'text/html': new Blob([htmlContent], { type: 'text/html' })
  });
  
  navigator.clipboard.write([clipboardItem]).then(() => {
    const btn = event.target;
    const originalText = btn.innerText;
    const originalBg = btn.style.background;
    const originalColor = btn.style.color;
    
    btn.innerText = document.documentElement.lang === 'es' ? '✓ Copiado' : '✓ Copied';
    btn.style.background = '#22c55e';
    btn.style.color = 'white';
    btn.style.borderColor = '#22c55e';
    
    setTimeout(() => {
      btn.innerText = originalText;
      btn.style.background = originalBg;
      btn.style.color = originalColor;
      btn.style.borderColor = '';
    }, 2000);
  }).catch(err => {
    console.error('Error copying rich text: ', err);
    fallbackCopy(plainText, event.target);
  });
}

function fallbackCopy(text, btn) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  
  const originalText = btn.innerText;
  
  try {
    document.execCommand('copy');
    btn.innerText = document.documentElement.lang === 'es' ? '✓ Copiado' : '✓ Copied';
    btn.style.background = '#22c55e';
    btn.style.color = 'white';
    setTimeout(() => {
      btn.innerText = originalText;
      btn.style.background = 'white';
      btn.style.color = '';
    }, 2000);
  } catch (err) {
    console.error('Fallback copy failed:', err);
    alert('No se pudo copiar. Por favor, selecciona el texto manualmente.');
  }
  
  document.body.removeChild(textarea);
}

// ========== CERRAR MENÚ CON TECLA ESCAPE ==========
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeMobileMenu();
  }
});

// ========== MATHJAX ==========
if (window.MathJax) {
  MathJax.typesetPromise();
}

// ========== INICIALIZACIÓN ADICIONAL ==========
document.addEventListener('DOMContentLoaded', () => {
  // Cerrar menú al hacer clic en un enlace (por si acaso)
  const mobileLinks = document.querySelectorAll('.sd-mobile-nav-link');
  mobileLinks.forEach(link => {
    link.addEventListener('click', () => {
      // No cerrar si es un enlace externo o tiene target _blank
      if (!link.hasAttribute('target') || link.getAttribute('target') !== '_blank') {
        setTimeout(closeMobileMenu, 150); // Pequeño retraso para permitir la navegación
      }
    });
  });
});
</script>
<script>
// ========== DETECCIÓN DE ELEMENTOS ESPECIALES (AHORA DESPUÉS DE QUE EL DOM EXISTE) ==========
window.__SPECIAL_ELEMENTS__ = (function() {
  var elements = [];
  
  // Detectar figuras
  var figures = document.querySelectorAll('figure.image-figure[id^="figure-"]');
  for (var i = 0; i < figures.length; i++) {
    var fig = figures[i];
    var caption = fig.querySelector('.image-caption');
    elements.push({
      type: 'figure',
      id: fig.id,
      title: caption ? caption.textContent.trim() : 'Figura ' + (i + 1)
    });
  }
  
  // Detectar tablas
  var tables = document.querySelectorAll('table.article-table[id^="table-"]');
  for (var i = 0; i < tables.length; i++) {
    var table = tables[i];
    // Intentar encontrar caption si existe
    var caption = table.querySelector('caption');
    elements.push({
      type: 'table',
      id: table.id,
      title: caption ? caption.textContent.trim() : 'Tabla ' + (i + 1)
    });
  }
  
  // Detectar código
  var codeBlocks = document.querySelectorAll('.code-block-wrapper[id^="code-"]');
  for (var i = 0; i < codeBlocks.length; i++) {
    var code = codeBlocks[i];
    var language = code.querySelector('.code-language');
    elements.push({
      type: 'code',
      id: code.id,
      title: language ? 'Código (' + language.textContent.trim() + ')' : 'Código ' + (i + 1)
    });
  }
  
  // Detectar ecuaciones
  var equations = document.querySelectorAll('[id^="equation-"]');
  for (var i = 0; i < equations.length; i++) {
    var eq = equations[i];
    elements.push({
      type: 'equation',
      id: eq.id,
      title: 'Ecuación ' + (i + 1)
    });
  }
  
  console.log('Elementos especiales detectados:', elements); // Para debug
  return elements;
})();
</script>
<script>
  document.addEventListener('DOMContentLoaded', function() {
    const footnoteLinks = document.querySelectorAll('.footnote-link');

    footnoteLinks.forEach(link => {
      link.addEventListener('mouseenter', function(e) {
        const href = this.getAttribute('href');
        if (!href || !href.startsWith('#')) return;
        const targetId = href.substring(1);
        const targetFootnote = document.getElementById(targetId);
        if (!targetFootnote) return;

        // Crear el tooltip
        const tooltip = document.createElement('div');
        tooltip.className = 'footnote-tooltip';
        tooltip.textContent = targetFootnote.textContent.replace('↩', '').trim();

        document.body.appendChild(tooltip);

        // Posicionar el tooltip cerca del enlace
        const rect = this.getBoundingClientRect();
        const tooltipRect = tooltip.getBoundingClientRect();
        let top = rect.bottom + window.scrollY + 10;
        let left = rect.left + window.scrollX;

        // Ajustar si se sale por la derecha
        if (left + tooltipRect.width > window.innerWidth - 20) {
          left = window.innerWidth - tooltipRect.width - 20;
        }

        // Ajustar si se sale por abajo
        if (top + tooltipRect.height > window.innerHeight + window.scrollY - 20) {
          top = rect.top + window.scrollY - tooltipRect.height - 10;
        }

        tooltip.style.top = top + 'px';
        tooltip.style.left = left + 'px';

        // Mostrar con un pequeño retraso para evitar parpadeo
        setTimeout(() => tooltip.classList.add('visible'), 10);

        // Guardar referencia al tooltip para eliminarlo después
        this._tooltip = tooltip;

        // Listener para eliminarlo al salir del enlace
        this.addEventListener('mouseleave', function() {
          if (this._tooltip) {
            this._tooltip.remove();
            this._tooltip = null;
          }
        }, { once: true });
      });
    });
  });
</script>

<!-- Citation Picker Modal -->
<div class="citation-picker-overlay" id="citationPickerOverlay" onclick="closeCitationPicker()">
  <div class="citation-picker-modal" onclick="event.stopPropagation()">
    <div class="citation-picker-header">
      <span class="citation-picker-title">Volver a la cita</span>
    </div>
    <div class="citation-picker-body" id="citationPickerBody">
      <!-- Opciones generadas dinámicamente -->
    </div>
  </div>
</div>

</body>
</html>`;
}

function generateIndexes(articles) {
  // Agrupar por año
  const articlesByYear = articles.reduce((acc, article) => {
    const year = new Date(article.fecha).getFullYear() || 'Sin fecha';
    if (!acc[year]) acc[year] = [];
    acc[year].push(article);
    return acc;
  }, {});

  // Índice español
  const indexContent = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Índice de Artículos - Revista Nacional de las Ciencias para Estudiantes</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=Lora:wght@400;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --primary-blue: #007398;
      --text-dark: #333333;
      --text-grey: #666666;
      --border: #e4e4e4;
      --bg-light: #f8f9fa;
    }
    body {
      font-family: 'Inter', sans-serif;
      line-height: 1.6;
      color: var(--text-dark);
      background-color: #f0f0f0;
      margin: 0;
      padding: 0;
    }
    .top-bar {
      background: white;
      border-bottom: 1px solid var(--border);
      padding: 1rem 2rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      position: sticky;
      top: 0;
      z-index: 100;
    }
    .journal-name {
      font-weight: 700;
      color: var(--primary-blue);
      text-decoration: none;
      font-size: 0.9rem;
      letter-spacing: 0.5px;
    }
    .main-wrapper {
      max-width: 1200px;
      margin: 2rem auto;
      padding: 0 2rem;
    }
    .article-container {
      background: white;
      padding: 3rem;
      box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);
      border-radius: 8px;
    }
    h1 {
      font-family: 'Lora', serif;
      font-size: 2.5rem;
      margin: 0 0 1rem;
      line-height: 1.2;
      color: #000;
    }
    .description {
      color: var(--text-grey);
      margin-bottom: 3rem;
      font-size: 1.1rem;
    }
    h2 {
      font-family: 'Inter', sans-serif;
      font-size: 1.8rem;
      color: var(--text-dark);
      margin: 3rem 0 1.5rem;
      border-bottom: 2px solid var(--border);
      padding-bottom: 0.5rem;
    }
    .articles-list {
      list-style: none;
      padding: 0;
      margin: 0;
    }
    .article-item {
      margin-bottom: 1.5rem;
      padding: 1rem;
      border-radius: 6px;
      transition: background 0.2s;
    }
    .article-item:hover {
      background: var(--bg-light);
    }
    .article-link {
      color: var(--primary-blue);
      text-decoration: none;
      font-size: 1.2rem;
      font-weight: 600;
      display: block;
      margin-bottom: 0.3rem;
    }
    .article-link:hover {
      text-decoration: underline;
    }
    .article-meta {
      color: var(--text-grey);
      font-size: 0.9rem;
      display: flex;
      gap: 1rem;
      flex-wrap: wrap;
    }
    footer {
      text-align: center;
      padding: 4rem 2rem;
      color: var(--text-grey);
      font-size: 0.9rem;
    }
    @media (max-width: 900px) {
      .main-wrapper { padding: 0 1rem; }
      .article-container { padding: 1.5rem; }
      h1 { font-size: 2rem; }
      h2 { font-size: 1.5rem; }
    }
  </style>
</head>
<body>
  <div class="top-bar">
    <a href="/" class="journal-name">REVISTA NACIONAL DE LAS CIENCIAS PARA ESTUDIANTES</a>
    <div class="issn">ISSN: 3087-2839</div>
  </div>
  <div class="main-wrapper">
    <main class="article-container">
      <h1>Índice de Artículos</h1>
      <p class="description">Accede a los artículos por año de publicación. Cada enlace lleva a la página del artículo con resumen, referencias y PDF.</p>
      
      ${Object.keys(articlesByYear).sort().reverse().map(year => `
      <section>
        <h2>Año ${year}</h2>
        <ul class="articles-list">
          ${articlesByYear[year].map(article => {
            const articleSlug = article.permalink || `${generateSlug(article.titulo)}-${article.numeroArticulo}`;
            const authorsDisplay = formatAuthorsDisplay(article.autores, 'es');
            return `
            <li class="article-item">
              <a href="/articles/article-${articleSlug}.html" class="article-link">${article.titulo}</a>
              <div class="article-meta">
                <span>${authorsDisplay}</span>
                <span>Vol. ${article.volumen}, Núm. ${article.numero}</span>
                <span>pp. ${article.primeraPagina}-${article.ultimaPagina}</span>
              </div>
            </li>
          `;
          }).join('')}
        </ul>
      </section>
      `).join('')}
    </main>
  </div>
  <footer>
    <p>&copy; ${new Date().getFullYear()} Revista Nacional de las Ciencias para Estudiantes. ISSN 3087-2839</p>
    <p><a href="/" style="color:var(--primary-blue); text-decoration:none;">Volver al inicio</a></p>
  </footer>
</body>
</html>`;

  const indexPath = path.join(OUTPUT_HTML_DIR, 'index.html');
  fs.writeFileSync(indexPath, indexContent, 'utf8');
  console.log(`✅ Índice español: ${indexPath}`);

  // Índice inglés
  const indexContentEn = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Index of Articles - The National Review of Sciences for Students</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=Lora:wght@400;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --primary-blue: #007398;
      --text-dark: #333333;
      --text-grey: #666666;
      --border: #e4e4e4;
      --bg-light: #f8f9fa;
    }
    body {
      font-family: 'Inter', sans-serif;
      line-height: 1.6;
      color: var(--text-dark);
      background-color: #f0f0f0;
      margin: 0;
      padding: 0;
    }
    .top-bar {
      background: white;
      border-bottom: 1px solid var(--border);
      padding: 1rem 2rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      position: sticky;
      top: 0;
      z-index: 100;
    }
    .journal-name {
      font-weight: 700;
      color: var(--primary-blue);
      text-decoration: none;
      font-size: 0.9rem;
      letter-spacing: 0.5px;
    }
    .main-wrapper {
      max-width: 1200px;
      margin: 2rem auto;
      padding: 0 2rem;
    }
    .article-container {
      background: white;
      padding: 3rem;
      box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);
      border-radius: 8px;
    }
    h1 {
      font-family: 'Lora', serif;
      font-size: 2.5rem;
      margin: 0 0 1rem;
      line-height: 1.2;
      color: #000;
    }
    .description {
      color: var(--text-grey);
      margin-bottom: 3rem;
      font-size: 1.1rem;
    }
    h2 {
      font-family: 'Inter', sans-serif;
      font-size: 1.8rem;
      color: var(--text-dark);
      margin: 3rem 0 1.5rem;
      border-bottom: 2px solid var(--border);
      padding-bottom: 0.5rem;
    }
    .articles-list {
      list-style: none;
      padding: 0;
      margin: 0;
    }
    .article-item {
      margin-bottom: 1.5rem;
      padding: 1rem;
      border-radius: 6px;
      transition: background 0.2s;
    }
    .article-item:hover {
      background: var(--bg-light);
    }
    .article-link {
      color: var(--primary-blue);
      text-decoration: none;
      font-size: 1.2rem;
      font-weight: 600;
      display: block;
      margin-bottom: 0.3rem;
    }
    .article-link:hover {
      text-decoration: underline;
    }
    .article-meta {
      color: var(--text-grey);
      font-size: 0.9rem;
      display: flex;
      gap: 1rem;
      flex-wrap: wrap;
    }
    footer {
      text-align: center;
      padding: 4rem 2rem;
      color: var(--text-grey);
      font-size: 0.9rem;
    }
    @media (max-width: 900px) {
      .main-wrapper { padding: 0 1rem; }
      .article-container { padding: 1.5rem; }
      h1 { font-size: 2rem; }
      h2 { font-size: 1.5rem; }
    }
  </style>
</head>
<body>
  <div class="top-bar">
    <a href="/" class="journal-name">THE NATIONAL REVIEW OF SCIENCES FOR STUDENTS</a>
    <div class="issn">ISSN: 3087-2839</div>
  </div>
  <div class="main-wrapper">
    <main class="article-container">
      <h1>Index of Articles</h1>
      <p class="description">Access articles by year of publication. Each link leads to the article page with abstract, references and PDF.</p>
      
      ${Object.keys(articlesByYear).sort().reverse().map(year => `
      <section>
        <h2>Year ${year}</h2>
        <ul class="articles-list">
          ${articlesByYear[year].map(article => {
            const articleSlug = article.permalink || `${generateSlug(article.titulo)}-${article.numeroArticulo}`;
            const authorsDisplay = formatAuthorsDisplay(article.autores, 'en');
            return `
            <li class="article-item">
              <a href="/articles/article-${articleSlug}EN.html" class="article-link">${article.titulo}</a>
              <div class="article-meta">
                <span>${authorsDisplay}</span>
                <span>Vol. ${article.volumen}, No. ${article.numero}</span>
                <span>pp. ${article.primeraPagina}-${article.ultimaPagina}</span>
              </div>
            </li>
          `;
          }).join('')}
        </ul>
      </section>
      `).join('')}
    </main>
  </div>
  <footer>
    <p>&copy; ${new Date().getFullYear()} The National Review of Sciences for Students. ISSN 3087-2839</p>
    <p><a href="/" style="color:var(--primary-blue); text-decoration:none;">Back to home</a></p>
  </footer>
</body>
</html>`;

  const indexPathEn = path.join(OUTPUT_HTML_DIR, 'index.EN.html');
  fs.writeFileSync(indexPathEn, indexContentEn, 'utf8');
  console.log(`✅ Índice inglés: ${indexPathEn}`);
}

// ========== EJECUCIÓN ==========
generateAll();