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
// ========== FUNCIÓN PARA PROCESAR AUTORES CON ICONOS (MEJORADA CON IDIOMA) ==========
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
      icons.push(`<a href="mailto:${email}" class="author-icon email-icon" title="Email">${emailSvg}</a>`);
    }
    
    if (icons.length > 0) {
      authorHtml += `<span class="author-icons">${icons.join('')}</span>`;
    }
    
    return authorHtml;
  });
  
  return authorElements.join('<span class="author-separator">, </span>');
}

// ========== FUNCIÓN PARA PROCESAR CÓDIGOS EN HTML ==========
// ========== FUNCIÓN PARA PROCESAR CÓDIGOS EN HTML ==========
// ========== FUNCIÓN PARA PROCESAR CÓDIGOS EN HTML (VERSIÓN MODIFICADA) ==========
function processCodeBlocks(html) {
  if (!html) return html;
  
  const $ = cheerio.load(html, { decodeEntities: false });
  let codeIndex = 0;
  let tableIndex = 0;
  let figureIndex = 0;
  let equationIndex = 0;
  
  // Procesar bloques de código
  $('pre code, pre').each((i, el) => {
    const $el = $(el);
    const code = $el.text();
    const lines = code.split('\n');
    const lineCount = lines.length;
    
    // Detectar lenguaje
    let language = '';
    const classAttr = $el.attr('class') || '';
    if (classAttr.includes('language-')) {
      language = classAttr.split('language-')[1].split(' ')[0];
    } else if (classAttr.includes('lang-')) {
      language = classAttr.split('lang-')[1].split(' ')[0];
    }
    
    // Generar números de línea
    let lineNumbersHtml = '';
    for (let i = 1; i <= lineCount; i++) {
      lineNumbersHtml += `<span class="code-line-number">${i}</span>`;
    }
    
    // Escapar código y envolver cada línea
    const escapedCode = code.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const wrappedLines = lines.map(line => 
      `<span class="line">${line || ' '}</span>`
    ).join('\n');
    
    // Generar ID consistente
    codeIndex++;
    const codeId = `code-${codeIndex}`;
    
    const codeHtml = `
  <div class="code-block-wrapper" id="${codeId}">
    <div class="code-header">
      <span class="code-language">${language || 'código'}</span>
      <button class="code-copy-btn" onclick="copyCode('${codeId}', this)" title="Copiar código (Ctrl+C)">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
        </svg>
        <span class="copy-text">Copiar</span>
      </button>
    </div>
    <div class="code-block-container">
      <div class="code-line-numbers" aria-hidden="true">
        ${lineNumbersHtml}
      </div>
      <pre class="code-block ${language ? `language-${language}` : ''}"><code class="${language ? `language-${language}` : ''}">${wrappedLines}</code></pre>
    </div>
  </div>
`;
    
    $el.parent().replaceWith(codeHtml);
  });
  
  // Procesar tablas
  $('table').each((i, el) => {
    const $el = $(el);
    tableIndex++;
    const tableId = `table-${tableIndex}`;
    $el.attr('id', tableId);
    $el.addClass('article-table');
    $el.wrap('<div class="table-wrapper"></div>');
  });
  
  // Procesar imágenes
  $('img').each((i, el) => {
    const $el = $(el);
    const alt = $el.attr('alt') || '';
    const src = $el.attr('src') || '';
    const style = $el.attr('style') || '';
    const align = $el.attr('align') || '';
    
    if (src && !src.startsWith('http') && !src.startsWith('data:')) {
      $el.attr('src', src);
    }
    
    $el.addClass('article-image');
    
    let floatClass = '';
    if (style.includes('float: left') || align === 'left') {
      floatClass = ' float-left';
    } else if (style.includes('float: right') || align === 'right') {
      floatClass = ' float-right';
    }
    
    figureIndex++;
    const figureId = `figure-${figureIndex}`;
    
    if (alt) {
      $el.wrap(`<figure class="image-figure${floatClass}" id="${figureId}"></figure>`);
      $el.after(`<figcaption class="image-caption">${alt}</figcaption>`);
    } else {
      $el.wrap(`<figure class="image-figure${floatClass}" id="${figureId}"></figure>`);
    }
  });
  
  // Procesar ecuaciones
  $('.MathJax_Display, .math-container').each((i, el) => {
    const $el = $(el);
    equationIndex++;
    const equationId = `equation-${equationIndex}`;
    $el.attr('id', equationId);
  });
  
  return $.html();
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
  <meta name="citation_publication_date" content="${article.fecha}">
  <meta name="citation_journal_title" content="Revista Nacional de las Ciencias para Estudiantes">
  <meta name="citation_issn" content="3087-2839">
  <meta name="citation_volume" content="${article.volumen}">
  <meta name="citation_issue" content="${article.numero}">
  <meta name="citation_firstpage" content="${article.primeraPagina}">
  <meta name="citation_lastpage" content="${article.ultimaPagina}">
  <meta name="citation_pdf_url" content="${article.pdfUrl}">
  <meta name="citation_abstract_html_url" content="${domain}/articles/article-${articleSlug}${isSpanish ? '' : 'EN'}.html">
  <meta name="citation_abstract" content="${(isSpanish ? article.resumen : article.abstract).replace(/"/g, '&quot;').substring(0, 500)}">
  <meta name="citation_keywords" content="${keywords.join('; ')}">
  <meta name="citation_language" content="${lang}">
  <meta name="description" content="${(isSpanish ? article.resumen : article.abstract).replace(/"/g, '&quot;').substring(0, 160)}...">
  <meta name="keywords" content="${keywords.join(', ')}">
  <title>${title.replace(/"/g, '&quot;')} - Revista Nacional de las Ciencias para Estudiantes</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Playfair+Display:ital,wght@0,700;1,700&family=JetBrains+Mono&family=Lora:ital,wght@0,400;0,700;1,400;1,700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.8.0/styles/github.min.css">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.8.0/highlight.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/polyfill/v3/polyfill.min.js?features=es6"></script>
  <script id="MathJax-script" async src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js"></script>
  <style>
:root {
  --nature-blue: #005a7d;
  --nature-blue-dark: #003e56;
  --nature-black: #111111;
  --text-main: #222222;
  --text-light: #595959;
  --text-muted: #6b7280;
  --border-color: #e5e7eb;
  --bg-soft: #f8f9fa;
  --bg-hover: #f3f4f6;
  --accent: #c2410c;
  --code-bg: #1a1b26;
  --code-text: #cfc9c2;
  --code-border: #2c2e3a;
  --code-header-bg: #232530;
  --sidebar-width: 260px;
  --aside-width: 280px;
  --content-max-width: 800px;
}
/* Garantizar que nada desborde el viewport */
* {
  max-width: 100vw;
  box-sizing: border-box;
}
body {
  overflow-x: hidden;
  width: 100%;
  position: relative;
}
  /* ESTO ESTÁ FALTANDO - AÑÁDELO EN EL BLOQUE DE ESTILOS */
body {
  font-family: 'Lora', serif;
  line-height: 1.7;
  color: var(--text-main);
  background-color: #fff;
  margin: 0;
  overflow-x: hidden;
}
/* --- Estilos I --- */
/* ===== HEADER MEJORADO PARA MÓVIL ===== */
/* ===== HEADER CON MENÚ HAMBURGUESA PARA MÓVIL ===== */
.sd-header {
  background: #fff;
  border-bottom: 1px solid var(--border-color);
  font-family: 'Inter', sans-serif;
  position: sticky;
  top: 0;
  z-index: 1000;
  width: 100%;
}

.sd-header-top {
  max-width: 1400px;
  margin: 0 auto;
  padding: 0.75rem 2rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 2rem;
}

/* Brand / Logo Section */
.sd-journal-logo {
  display: flex;
  align-items: center;
  gap: 12px;
  text-decoration: none;
  color: var(--nature-black);
}

/* LOGO - TAMAÑO BASE (ESCRITORIO) */
.sd-logo-img {
  height: 42px;
  width: auto;
  display: block;
  object-fit: contain;
  transition: height 0.2s ease;
}

.sd-journal-titles {
  display: flex;
  flex-direction: column;
  border-left: 1px solid #e0e0e0;
  padding-left: 15px;
}

.sd-journal-name {
  font-weight: 600;
  font-size: 0.95rem;
  line-height: 1.2;
}

.sd-issn {
  font-size: 0.7rem;
  color: var(--text-muted);
  margin-top: 2px;
}

/* Search Bar - Minimalist (solo desktop) */
.sd-search-wrapper {
  flex: 1;
  max-width: 500px;
}

.sd-search-bar {
  display: flex;
  align-items: center;
  background: #f0f2f4;
  border-radius: 4px;
  padding: 6px 12px;
  border: 1px solid transparent;
  transition: all 0.2s;
}

.sd-search-bar:focus-within {
  background: #fff;
  border-color: var(--nature-blue);
  box-shadow: 0 0 0 3px rgba(0, 90, 125, 0.1);
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
  /* Añadir al bloque de estilos existente */
.sd-mobile-nav-link.active {
  background: var(--bg-hover);
  color: var(--nature-blue);
  border-left: 3px solid var(--nature-blue);
}

.sd-mobile-nav-link.active svg {
  color: var(--nature-blue);
}

/* User Utility Nav (solo desktop) */
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

/* ===== MENÚ HAMBURGUESA PARA MÓVIL ===== */
.sd-mobile-controls {
  display: none;
  align-items: center;
  gap: 0.5rem;
}

.sd-mobile-search-btn {
  display: none;
  background: none;
  border: none;
  padding: 8px;
  cursor: pointer;
  color: var(--text-main);
}

.sd-mobile-search-btn svg {
  width: 20px;
  height: 20px;
  fill: currentColor;
}

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

/* Overlay para el menú móvil */
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

/* Menú lateral móvil */
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

/* Header del menú móvil */
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

.sd-mobile-close-btn svg {
  width: 20px;
  height: 20px;
  fill: currentColor;
}

/* Búsqueda en menú móvil */
.sd-mobile-search {
  padding: 1rem;
  border-bottom: 1px solid var(--border-color);
}

.sd-mobile-search-bar {
  display: flex;
  align-items: center;
  background: #f0f2f4;
  border-radius: 4px;
  padding: 8px 12px;
  border: 1px solid transparent;
}

.sd-mobile-search-bar:focus-within {
  border-color: var(--nature-blue);
  background: #fff;
}

.sd-mobile-search-bar input {
  border: none;
  background: transparent;
  width: 100%;
  font-family: 'Inter', sans-serif;
  font-size: 0.9rem;
  outline: none;
  margin-left: 8px;
}

/* Navegación en menú móvil */
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

.sd-mobile-nav-item:last-child {
  border-bottom: none;
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

.sd-mobile-nav-link svg {
  width: 20px;
  height: 20px;
  fill: currentColor;
  color: var(--text-muted);
}

.sd-mobile-nav-badge {
  margin-left: auto;
  font-size: 0.7rem;
  color: var(--text-muted);
}

/* Footer del menú móvil */
.sd-mobile-menu-footer {
  padding: 1rem;
  border-top: 1px solid var(--border-color);
  font-size: 0.8rem;
  color: var(--text-muted);
  text-align: center;
}

/* ===== RESPONSIVE ===== */

/* Tablets (900px) */
@media (max-width: 900px) {
  .sd-header-top {
    padding: 0.6rem 1.5rem;
  }
  
  .sd-logo-img {
    height: 36px;
  }
  
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
}

/* Móviles (600px) */
@media (max-width: 600px) {
  .sd-header-top {
    padding: 0.4rem 1rem;
  }
  
  /* LOGO OCULTO EN MÓVIL - se muestra solo el título */
  .sd-logo-img {
    display: none;
  }
  
  .sd-journal-titles {
    border-left: none;
    padding-left: 0;
  }
  
  .sd-journal-name {
    font-size: 0.75rem;
    font-weight: 600;
    max-width: 180px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  
  .sd-issn {
    font-size: 0.6rem;
  }
  
  .sd-mobile-controls {
    gap: 0.25rem;
  }
  
  .sd-mobile-search-btn svg,
  .sd-mobile-menu-btn svg {
    width: 20px;
    height: 20px;
  }
}

/* Móviles pequeños (400px) */
@media (max-width: 400px) {
  .sd-header-top {
    padding: 0.3rem 0.75rem;
  }
  
  .sd-journal-name {
    font-size: 0.7rem;
    max-width: 140px;
  }
  
  .sd-issn {
    display: none;
  }
}

/* Pantallas extremadamente pequeñas (320px) */
@media (max-width: 320px) {
  .sd-journal-name {
    font-size: 0.65rem;
    max-width: 120px;
  }
}
/* Search Bar - Minimalist */
.sd-search-wrapper {
  flex: 1;
  max-width: 500px;
}

.sd-search-bar {
  display: flex;
  align-items: center;
  background: #f0f2f4;
  border-radius: 4px;
  padding: 6px 12px;
  border: 1px solid transparent;
  transition: all 0.2s;
}

.sd-search-bar:focus-within {
  background: #fff;
  border-color: var(--nature-blue);
  box-shadow: 0 0 0 3px rgba(0, 90, 125, 0.1);
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

/* User Utility Nav */
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

/* Mobile Adjustments */
@media (max-width: 900px) {
  .sd-search-wrapper, 
  .sd-user-nav {
    display: none; /* Oculta búsqueda y menú en móvil */
  }
}

/* Si quieres mostrar un menú hamburguesa en móvil, añade esto */
@media (max-width: 900px) {
  .sd-mobile-menu-btn {
    display: block; /* Botón de menú hamburguesa */
    background: none;
    border: none;
    padding: 8px;
    cursor: pointer;
  }
  
  .sd-mobile-menu-btn svg {
    width: 24px;
    height: 24px;
    fill: var(--text-main);
  }
}
      /* Footer Styles (igual que en news) */
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
      color: #005a7d;
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

    .footer-nav-link svg {
      width: 16px;
      height: 16px;
      fill: currentColor;
    }

    .footer-bottom {
      text-align: center;
      font-size: 9px;
      color: #666;
      text-transform: uppercase;
      letter-spacing: 4px;
      padding-top: 30px;
    }

    .footer-links {
      display: flex;
      justify-content: center;
      gap: 20px;
      margin: 20px 0;
      font-size: 9px;
    }

    .footer-links a {
      color: #777;
      text-decoration: none;
      transition: color 0.3s;
    }

    .footer-links a:hover {
      color: white;
    }

    /* Versiones desktop/mobile para email */
    .mobile-only {
      display: none;
    }
    .desktop-only {
      display: inline-block;
    }

    @media (max-width: 768px) {
      .footer-social {
        gap: 20px;
      }
      
      .footer-nav-links {
        flex-direction: column;
        align-items: center;
        gap: 15px;
      }
      
      .desktop-only {
        display: none;
      }
      .mobile-only {
        display: inline-block;
      }
    }
.sd-journal-titles {
  display: flex;
  flex-direction: column;
  border-left: 1px solid #e0e0e0; /* Línea divisoria sutil estilo Elsevier */
  padding-left: 15px;
}
.sd-journal-name {
  font-weight: 600;
  font-size: 0.95rem;
  line-height: 1.2;
}
.sd-issn {
  font-size: 0.7rem;
  color: var(--text-muted);
  margin-top: 2px;
}
/* Search Bar - Minimalist */
.sd-search-wrapper {
  flex: 1;
  max-width: 500px;
}
.sd-search-bar {
  display: flex;
  align-items: center;
  background: #f0f2f4;
  border-radius: 4px;
  padding: 6px 12px;
  border: 1px solid transparent;
  transition: all 0.2s;
}
.sd-search-bar:focus-within {
  background: #fff;
  border-color: var(--nature-blue);
  box-shadow: 0 0 0 3px rgba(0, 90, 125, 0.1);
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
/* User Utility Nav */
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
/* Mobile Adjustments */
@media (max-width: 900px) {
  .sd-search-wrapper, .sd-user-nav {
    display: none;
  }
}
  
    /* Main Layout */
    .main-wrapper {
      max-width: 1400px;
      margin: 0 auto;
      display: grid;
      grid-template-columns: var(--sidebar-width) minmax(0, 1fr) var(--aside-width);
      gap: 3rem;
      padding: 2rem;
    }

    /* Left Sidebar - Table of Contents */
    .toc-sidebar {
      position: sticky;
      top: 100px;
      height: fit-content;
      font-family: 'Inter', sans-serif;
      max-height: calc(100vh - 120px);
      overflow-y: auto;
      scrollbar-width: thin;
      padding-right: 0.5rem;
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

    /* Main Content */
    .article-container {
      max-width: var(--content-max-width);
      width: 100%;
    }

    .article-header {
      margin-bottom: 2.5rem;
    }

    .article-type {
      font-family: 'Inter', sans-serif;
      text-transform: uppercase;
      font-weight: 600;
      font-size: 0.7rem;
      letter-spacing: 0.1em;
      color: var(--accent);
      margin-bottom: 0.75rem;
    }

    h1 {
      font-family: 'Playfair Display', serif;
      font-size: 2.4rem;
      line-height: 1.2;
      margin: 0.5rem 0 1rem 0;
      color: var(--nature-black);
      font-weight: 700;
    }

    .alt-title-container {
      margin-bottom: 1.5rem;
    }

    .alt-title {
      font-size: 1.1rem;
      color: var(--text-light);
      border-bottom: 1px dotted var(--text-light);
      display: inline-block;
      cursor: help;
      font-style: italic;
      transition: border-color 0.2s;
    }

    .alt-title:hover {
      border-bottom-color: var(--nature-blue);
      color: var(--nature-blue);
    }

    .authors {
      font-family: 'Inter', sans-serif;
      font-size: 1.1rem;
      font-weight: 500;
      margin-bottom: 1rem;
      line-height: 1.5;
      display: flex;
      flex-wrap: wrap;
      gap: 0.3rem;
    }

    .author-link, .author-name {
      color: var(--nature-blue);
      text-decoration: none;
      border-bottom: 1px dotted transparent;
      transition: border-color 0.2s;
    }

    .author-link:hover {
      border-bottom-color: var(--nature-blue);
    }

    .author-icons {
      display: inline-flex;
      gap: 0.3rem;
      margin-left: 0.3rem;
      vertical-align: middle;
    }

    .author-icon {
      display: inline-block;
      opacity: 0.8;
      transition: opacity 0.2s;
    }

    .author-icon:hover {
      opacity: 1;
    }

    .author-separator {
      color: var(--text-light);
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
      margin: 1.5rem 0 2rem 0;
      padding-bottom: 1.5rem;
      border-bottom: 1px solid var(--border-color);
      flex-wrap: wrap;
    }

    .btn-pdf {
      background: var(--nature-blue);
      color: white !important;
      padding: 0.6rem 1.5rem;
      border-radius: 4px;
      text-decoration: none;
      font-family: 'Inter', sans-serif;
      font-weight: 600;
      font-size: 0.85rem;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      transition: background 0.2s;
      border: none;
      cursor: pointer;
    }

    .btn-pdf:hover {
      background: var(--nature-blue-dark);
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

    h2 {
      font-family: 'Inter', sans-serif;
      font-size: 1.3rem;
      font-weight: 600;
      border-bottom: 2px solid var(--nature-black);
      padding-bottom: 0.4rem;
      margin: 2.5rem 0 1.5rem 0;
      scroll-margin-top: 100px;
    }

    h3 {
      font-family: 'Inter', sans-serif;
      font-size: 1.1rem;
      font-weight: 600;
      margin: 1.8rem 0 1rem 0;
    }

    /* Abstract */
    .abstract-container {
      margin-bottom: 2rem;
    }

    .abstract-text {
      font-size: 1.05rem;
      text-align: justify;
      color: var(--text-main);
      margin-bottom: 1rem;
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

    /* Article Content */
    .article-content {
  font-size: 1.05rem;
  line-height: 1.7;
  text-align: justify;  /* ← AÑADE ESTA LÍNEA */
}

    .article-content p {
      margin-bottom: 1.2rem;
    }

    .article-content img {
      max-width: 100%;
      height: auto;
      border-radius: 4px;
      margin: 1.5rem 0;
    }

/* ===== BLOQUES DE CÓDIGO ESTILO VS CODE DARK+ ===== */
.code-block-wrapper {
  margin: 2.5rem 0;
  border-radius: 12px;
  background: #1e1e1e;
  box-shadow: 0 15px 30px -10px rgba(0, 0, 0, 0.5);
  overflow: hidden;
  font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Courier New', monospace;
  border: 1px solid #3c3c3c;
}

.code-header {
  background: #2d2d2d;
  padding: 0.6rem 1.25rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid #3c3c3c;
  color: #cccccc;
  font-family: 'Inter', sans-serif;
}

.code-language {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.8rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: #9cdcfe;
}

.code-language::before {
  content: "●";
  color: #4ec9b0;
  font-size: 1rem;
  margin-right: 4px;
}

.code-copy-btn {
  background: #3c3c3c;
  border: 1px solid #555555;
  border-radius: 4px;
  padding: 0.3rem 0.8rem;
  font-size: 0.7rem;
  font-family: 'Inter', sans-serif;
  font-weight: 500;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  color: #cccccc;
  transition: all 0.2s ease;
}

.code-copy-btn:hover {
  background: #4ec9b0;
  border-color: #4ec9b0;
  color: #1e1e1e;
}

.code-copy-btn svg {
  width: 14px;
  height: 14px;
  stroke: currentColor;
}

.code-block-container {
  display: flex;
  background: #1e1e1e;
  position: relative;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  max-width: 100vw;
  width: 100%;
}

/* Asegurar que el código no fuerce el ancho */
.code-block {
  flex: 1;
  margin: 0;
  padding: 1.2rem 0 1.2rem 1.5rem;
  background: transparent;
  color: #d4d4d4;
  line-height: 1.6;
  font-size: 0.85rem;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  tab-size: 2;
  white-space: pre;
  word-break: normal;
  max-width: 100%;
  min-width: 0; /* Importante para flexbox */
}

.code-block code {
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  text-shadow: none;
  display: inline-block;
  min-width: min-content;
}

/* Numeración de líneas */
.code-line-numbers {
  display: flex;
  flex-direction: column;
  padding: 1.2rem 0 1.2rem 1rem;
  text-align: right;
  background: #1e1e1e;
  color: #6d8a9e;
  font-size: 0.85rem;
  line-height: 1.6;
  font-family: 'JetBrains Mono', monospace;
  user-select: none;
  border-right: 1px solid #3c3c3c;
  min-width: 45px;
  letter-spacing: 0.5px;
}

.code-line-number {
  display: block;
  padding-right: 0.8rem;
  color: #6d8a9e;
  font-size: 0.8rem;
  transition: color 0.2s;
}

.code-block-container:hover .code-line-number {
  color: #9cdcfe;
}

/* Contenedor del código */
.code-block {
  flex: 1;
  margin: 0;
  padding: 1.2rem 0 1.2rem 1.5rem;
  background: transparent;
  color: #d4d4d4;
  line-height: 1.6;
  font-size: 0.85rem;
  overflow-x: auto;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  tab-size: 2;
  white-space: pre;
  word-break: normal;
  position: relative;
}

.code-block code {
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  text-shadow: none;
  display: block;
}

/* Highlight.js VS Code Dark+ colors */
.code-block .hljs {
  background: transparent;
  color: #d4d4d4;
}

.code-block .hljs-keyword,
.code-block .hljs-built_in {
  color: #569cd6;
  font-weight: 600;
}

.code-block .hljs-title,
.code-block .hljs-function {
  color: #dcdcaa;
}

.code-block .hljs-string {
  color: #ce9178;
}

.code-block .hljs-number {
  color: #b5cea8;
}

.code-block .hljs-comment {
  color: #6a9955;
  font-style: italic;
}

.code-block .hljs-variable,
.code-block .hljs-name {
  color: #9cdcfe;
}

.code-block .hljs-operator {
  color: #d4d4d4;
}

.code-block .hljs-type {
  color: #4ec9b0;
}

.code-block .hljs-params {
  color: #d4d4d4;
}

.code-block .hljs-attribute {
  color: #9cdcfe;
}

.code-block .hljs-tag {
  color: #569cd6;
}

.code-block .hljs-class {
  color: #4ec9b0;
}

.code-block .hljs-selector-class {
  color: #d7ba7d;
}

.code-block .hljs-meta {
  color: #d4d4d4;
}

.code-block .hljs-regexp {
  color: #d16969;
}

.code-block .hljs-symbol {
  color: #d4d4d4;
}

.code-block .hljs-bullet {
  color: #d4d4d4;
}

.code-block .hljs-link {
  color: #569cd6;
  text-decoration: underline;
}

.code-block .hljs-emphasis {
  font-style: italic;
}

.code-block .hljs-strong {
  font-weight: bold;
}

/* Scrollbars personalizados */
.code-block::-webkit-scrollbar,
.code-line-numbers::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

.code-block::-webkit-scrollbar-track,
.code-line-numbers::-webkit-scrollbar-track {
  background: #2d2d2d;
}

.code-block::-webkit-scrollbar-thumb,
.code-line-numbers::-webkit-scrollbar-thumb {
  background: #555555;
  border-radius: 4px;
}

.code-block::-webkit-scrollbar-thumb:hover,
.code-line-numbers::-webkit-scrollbar-thumb:hover {
  background: #666666;
}

/* Línea destacada al hover */
.code-block code .line:hover {
  background: rgba(255, 255, 255, 0.05);
}

/* Tooltip para el botón */
.code-copy-btn[title] {
  position: relative;
}

.code-copy-btn[title]:hover::after {
  content: attr(title);
  position: absolute;
  bottom: 100%;
  left: 50%;
  transform: translateX(-50%);
  background: #2d2d2d;
  color: #cccccc;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 0.7rem;
  white-space: nowrap;
  border: 1px solid #3c3c3c;
  margin-bottom: 8px;
  z-index: 100;
}
    /* ===== TABLES - ESTILO ACADÉMICO BOOKTABS ===== */
    .table-wrapper {
      overflow-x: auto;
      margin: 3rem 0;
      border-top: 2px solid var(--nature-black);
      border-bottom: 2px solid var(--nature-black);
      padding: 0.5rem 0;
      -webkit-overflow-scrolling: touch;
    }

    .article-table {
      width: 100%;
      border-collapse: collapse;
      font-family: 'Inter', sans-serif;
      font-size: 0.9rem;
      color: var(--text-main);
      min-width: 100%;
    }

    .article-table th {
  border-bottom: 1.5px solid var(--nature-black);
  background: transparent;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 12px 15px;
  color: var(--nature-black);
  text-align: left;
  word-wrap: break-word;
  word-break: break-word;
  overflow-wrap: break-word;
}

.article-table td {
  padding: 12px 15px;
  border: none;
  border-bottom: 1px solid #eee;
  word-wrap: break-word;
  word-break: break-word;
  overflow-wrap: break-word;
  hyphens: auto;
}

    .article-table tr:last-child td {
      border-bottom: none;
    }

    .article-table tr:hover {
      background-color: var(--bg-soft);
    }
/* ===== TOOLBAR PROFESIONAL - EDICIÓN REFINADA ===== */

/* ===== ELEMENTOS ESPECIALES - TOOLBAR PROFESIONAL ===== */
.special-element-toolbar {
  position: absolute;
  top: -40px;
  right: 0;
  display: flex;
  gap: 8px;
  background: white;
  border-radius: 8px;
  padding: 4px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  border: 1px solid var(--border-color);
  opacity: 0;
  transform: translateY(5px);
  transition: all 0.2s ease;
  z-index: 50;
  font-family: 'Inter', sans-serif;
}

.special-element-container {
  position: relative;
  margin: 2.5rem 0;
}

.special-element-container:hover .special-element-toolbar {
  opacity: 1;
  transform: translateY(0);
}

.toolbar-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  background: white;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--text-main);
  cursor: pointer;
  transition: all 0.2s;
  text-decoration: none;
}

.toolbar-btn:hover {
  background: var(--nature-blue);
  border-color: var(--nature-blue);
  color: white;
}

.toolbar-btn svg {
  width: 14px;
  height: 14px;
  stroke: currentColor;
  fill: none;
}

/* Modal para visualización en pantalla completa */
.special-modal {
  display: none;
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.9);
  z-index: 10000;
  overflow-y: auto;
}

.special-modal.active {
  display: flex;
  align-items: center;
  justify-content: center;
}

.special-modal-content {
  background: white;
  max-width: 95vw;
  max-height: 95vh;
  overflow: auto;
  border-radius: 8px;
  position: relative;
  padding: 2rem;
}

.special-modal-close {
  position: absolute;
  top: 1rem;
  right: 1rem;
  background: none;
  border: none;
  font-size: 2rem;
  cursor: pointer;
  color: var(--text-muted);
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  transition: all 0.2s;
}

.special-modal-close:hover {
  background: var(--bg-soft);
  color: var(--nature-blue);
}

/* Tabla de descargas */
.download-format-menu {
  position: absolute;
  top: 100%;
  right: 0;
  background: white;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  padding: 0.5rem 0;
  min-width: 150px;
  z-index: 100;
  display: none;
}

.download-format-menu.active {
  display: block;
}

.format-option {
  display: block;
  width: 100%;
  padding: 0.5rem 1rem;
  border: none;
  background: none;
  text-align: left;
  font-size: 0.85rem;
  color: var(--text-main);
  cursor: pointer;
  transition: background 0.2s;
}

.format-option:hover {
  background: var(--bg-soft);
  color: var(--nature-blue);
}

/* Badge para elementos especiales */
.special-badge {
  display: inline-block;
  background: var(--nature-blue);
  color: white;
  font-size: 0.65rem;
  padding: 2px 8px;
  border-radius: 12px;
  margin-left: 8px;
  vertical-align: middle;
}

/* Tooltip mejorado */
[data-tooltip] {
  position: relative;
}

[data-tooltip]:hover::after {
  content: attr(data-tooltip);
  position: absolute;
  bottom: 100%;
  left: 50%;
  transform: translateX(-50%);
  background: var(--nature-black);
  color: white;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 0.7rem;
  white-space: nowrap;
  margin-bottom: 5px;
  z-index: 1000;
}
    /* ===== FIGURES AND FLOATING ELEMENTS ===== */
    .image-figure {
      margin: 1.5rem 0;
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
      display: block;
    }

    .image-caption {
      margin-top: 0.5rem;
      font-size: 0.9rem;
      color: var(--text-muted);
      font-style: italic;
      text-align: center;
    }

    /* Clear floats */
    .clearfix::after {
      content: "";
      clear: both;
      display: table;
    }

    /* ===== EQUATIONS ===== */
    /* ===== EQUATIONS - CON SCROLL EN MÓVIL ===== */
.MathJax_Display, .math-container {
  margin: 2rem 0 !important;
  padding: 1.5rem 0.5rem;
  background: linear-gradient(to right, transparent, var(--bg-soft), transparent);
  border-top: 1px solid var(--border-color);
  border-bottom: 1px solid var(--border-color);
  overflow-x: auto;
  overflow-y: hidden;
  -webkit-overflow-scrolling: touch;
  max-width: 100%;
  scrollbar-width: thin;
  scrollbar-color: var(--nature-blue) var(--border-color);
}

.MathJax_Display::-webkit-scrollbar,
.math-container::-webkit-scrollbar {
  height: 6px;
}

.MathJax_Display::-webkit-scrollbar-track,
.math-container::-webkit-scrollbar-track {
  background: var(--border-color);
  border-radius: 3px;
}

.MathJax_Display::-webkit-scrollbar-thumb,
.math-container::-webkit-scrollbar-thumb {
  background: var(--nature-blue);
  border-radius: 3px;
}

.MathJax_Display:hover,
.math-container:hover {
  transform: none; /* Quitamos el scale que podía causar problemas */
}

/* Forzar que MathJax respete el contenedor */
.MathJax {
  max-width: 100% !important;
  overflow-x: auto !important;
  overflow-y: hidden !important;
}

.MJX-TEX {
  white-space: nowrap !important;
}

    .math-container:hover {
      transform: scale(1.01);
    }

    /* ===== LISTS - VERSÁTILES Y ANIDADAS ===== */
    .article-content ul, 
    .article-content ol {
      margin: 1.5rem 0 1.5rem 2rem;
      padding-left: 0;
    }

    .article-content li {
      margin-bottom: 0.5rem;
      position: relative;
    }

    /* Listas anidadas con diferentes estilos */
    .article-content ul ul {
      list-style-type: circle;
      margin-top: 0.5rem;
      margin-bottom: 0.5rem;
    }
    
    .article-content ul ul ul {
      list-style-type: square;
    }
    
    .article-content ul ul ul ul {
      list-style-type: disc;
    }

    .article-content ol {
      list-style-type: decimal;
    }
    
    .article-content ol ol {
      list-style-type: lower-alpha;
    }
    
    .article-content ol ol ol {
      list-style-type: lower-roman;
    }
    
    .article-content ol ol ol ol {
      list-style-type: upper-alpha;
    }
    
    .article-content ol ol ol ol ol {
      list-style-type: upper-roman;
    }

    /* Listas mixtas */
    .article-content ul ol, 
    .article-content ol ul {
      margin-top: 0.5rem;
      margin-bottom: 0.5rem;
    }

    /* Listas con viñetas personalizadas */
    .article-content ul[type="disc"] { list-style-type: disc; }
    .article-content ul[type="circle"] { list-style-type: circle; }
    .article-content ul[type="square"] { list-style-type: square; }
    .article-content ul[type="none"] { list-style-type: none; }
    
    .article-content ol[type="1"] { list-style-type: decimal; }
    .article-content ol[type="A"] { list-style-type: upper-alpha; }
    .article-content ol[type="a"] { list-style-type: lower-alpha; }
    .article-content ol[type="I"] { list-style-type: upper-roman; }
    .article-content ol[type="i"] { list-style-type: lower-roman; }

    /* ===== BLOCKQUOTES - ESTILO EDITORIAL ===== */
    blockquote {
      margin: 3rem 4rem;
      padding: 0 1.5rem;
      border-left: 3px solid var(--accent);
      font-style: italic;
      font-size: 1.2rem;
      color: var(--text-light);
      position: relative;
    }

    blockquote::before {
      content: '"';
      position: absolute;
      top: -10px;
      left: -10px;
      font-size: 4rem;
      color: var(--bg-soft);
      font-family: 'Playfair Display', serif;
      z-index: -1;
    }

    blockquote cite {
      display: block;
      margin-top: 1rem;
      font-size: 0.9rem;
      font-style: normal;
      font-weight: 600;
      text-transform: uppercase;
      color: var(--nature-black);
      letter-spacing: 1px;
    }

    /* Math */
    .MathJax {
      font-size: 1.1em !important;
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

    /* References */
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

    .reference-item em {
      font-style: italic;
    }

    .reference-item a {
      color: #005a7d;
      text-decoration: none;
      word-break: break-all;
      border-bottom: 1px dotted #ccc;
    }

    .reference-item a:hover {
      border-bottom: 1px solid #005a7d;
    }

        .right-sidebar {
      position: sticky;
      top: 100px;
      max-height: calc(100vh - 120px); /* Altura máxima: 100% del viewport menos el espacio del top-nav y un margen */
      overflow-y: auto; /* ¡Activa la barra de desplazamiento vertical! */
      font-family: 'Inter', sans-serif;
      scrollbar-width: thin; /* Para Firefox: barra más delgada */
      padding-right: 0.5rem; /* Pequeño padding para que el texto no toque la barra */
    }

    /* Estilo para la barra de desplazamiento en navegadores WebKit (Chrome, Safari, Edge) */
    .right-sidebar::-webkit-scrollbar {
      width: 6px; /* Ancho de la barra */
    }

    .right-sidebar::-webkit-scrollbar-track {
      background: var(--bg-soft); /* Color de fondo de la pista */
      border-radius: 3px;
    }

    .right-sidebar::-webkit-scrollbar-thumb {
      background: var(--border-color); /* Color del "pulgón" de la barra */
      border-radius: 3px;
    }

    .right-sidebar::-webkit-scrollbar-thumb:hover {
      background: var(--text-muted); /* Color al pasar el mouse */
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
    }

    .tab-panel {
      display: none;
      padding: 1.5rem;
    }

    .tab-panel.active {
      display: block;
    }

    .info-card {
      background: var(--bg-soft);
      border-radius: 8px;
    }

    .info-card h4 {
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--text-muted);
      margin-bottom: 1rem;
      font-weight: 600;
    }

    .keywords {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    .keyword-tag {
      font-size: 0.7rem;
      background: white;
      padding: 4px 8px;
      border-radius: 4px;
      border: 1px solid var(--border-color);
      color: var(--text-light);
    }

    .metadata-item {
      font-size: 0.85rem;
      padding: 0.5rem 0;
      border-bottom: 1px solid var(--border-color);
      display: flex;
      justify-content: space-between;
    }

    .metadata-item:last-child {
      border-bottom: none;
    }

    .metadata-label {
      color: var(--text-muted);
      font-weight: 500;
    }

    .metadata-value {
      font-weight: 400;
      text-align: right;
    }

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

    .pdf-preview {
      width: 100%;
      height: 700px;
      border: 1px solid var(--border-color);
      border-radius: 4px;
      margin: 1.5rem 0;
    }

    /* License Section */
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

    /* Mobile info section */
    .mobile-info {
      display: none;
      margin-top: 2rem;
      padding-top: 2rem;
      border-top: 2px solid var(--border-color);
    }

    /* Smooth scrolling for anchor links */
    html {
      scroll-behavior: smooth;
      scroll-padding-top: 100px;
    }

    /* Mobile Optimization */
    @media (max-width: 1100px) {
      .main-wrapper {
        grid-template-columns: 1fr;
        gap: 2rem;
        padding: 1.5rem;
      }
      .toc-sidebar, .right-sidebar {
        display: none;
      }
      .mobile-info {
        display: block;
      }
      h1 {
        font-size: 2rem;
      }
      .article-content ul, 
      .article-content ol {
        margin: 1.5rem 0 1.5rem 1.5rem;
      }
      blockquote {
        margin: 2rem 1.5rem;
      }
      .image-figure.float-left,
      .image-figure.float-right {
        float: none;
        margin: 1.5rem 0;
        max-width: 100%;
      }
    }

    @media (max-width: 600px) {
      .top-nav {
        padding: 0.75rem 1rem;
      }
      .main-wrapper {
        padding: 1rem;
      }
      h1 {
        font-size: 1.6rem;
      }
      .action-bar {
        gap: 1rem;
      }
      .btn-pdf {
        padding: 0.5rem 1rem;
        font-size: 0.8rem;
      }
      .authors {
        font-size: 1rem;
      }
      .article-content ul, 
      .article-content ol {
        margin: 1.5rem 0 1.5rem 1rem;
      }
      blockquote {
        margin: 1.5rem 1rem;
        font-size: 1rem;
      }
      .table-wrapper {
        margin: 2rem 0;
      }
      .article-table {
        font-size: 0.8rem;
      }
      .article-table th,
      .article-table td {
        padding: 8px 10px;
      }
/* Optimizaciones adicionales para móvil */
@media (max-width: 600px) {
  /* Hacer el header más compacto en general */
  .sd-header {
    position: sticky;
    top: 0;
  }
  
  /* Si tienes un botón de menú hamburguesa, asegúrate de que sea pequeño */
  .sd-mobile-menu-btn {
    padding: 4px !important;
  }
  
  .sd-mobile-menu-btn svg {
    width: 20px !important;
    height: 20px !important;
  }
}

/* Para pantallas muy pequeñas, podemos ocultar elementos no críticos */
@media (max-width: 350px) {
  .sd-user-nav,
  .sd-search-wrapper {
    display: none !important;
  }
  
  /* Mostrar solo el logo y el título en este caso */
  .sd-header-top {
    justify-content: flex-start;
  }
}
.code-block-wrapper {
  margin: 1.5rem 0;
  font-size: 0.75rem;
}

.code-header {
  padding: 0.4rem 0.8rem;
}

.code-language {
  font-size: 0.7rem;
}

.code-copy-btn {
  padding: 0.2rem 0.5rem;
  font-size: 0.65rem;
}

.code-line-numbers {
  min-width: 35px;
  padding: 0.8rem 0 0.8rem 0.5rem;
  font-size: 0.75rem;
}

.code-line-number {
  padding-right: 0.5rem;
  font-size: 0.75rem;
}

.code-block {
  padding: 0.8rem 0 0.8rem 1rem;
  font-size: 0.75rem;
}
  .code-block-wrapper {
    margin: 1rem 0;
    border-radius: 8px;
    max-width: 100%;
  }
  
  .code-block-container {
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }
  
  .code-line-numbers {
    min-width: 30px;
    padding: 0.8rem 0 0.8rem 0.5rem;
    font-size: 0.7rem;
    position: sticky;
    left: 0;
    background: #1e1e1e;
    z-index: 2;
  }
  
  .code-block {
    padding: 0.8rem 1rem;
    font-size: 0.7rem;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    min-width: 0;
  }
  
  /* Ecuaciones en móvil */
  .MathJax_Display, .math-container {
    margin: 1.5rem 0 !important;
    padding: 1rem 0.25rem;
    font-size: 0.9rem;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    max-width: calc(100vw - 2rem);
  }
  
  /* Tablas en móvil */
  .table-wrapper {
    margin: 1.5rem 0;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    max-width: 100%;
  }
  
  .article-table {
    min-width: 100%;
    font-size: 0.8rem;
  }
  
  .article-table th,
  .article-table td {
    padding: 8px 10px;
    white-space: nowrap; /* Opcional: permite scroll horizontal en tablas */
  }
  
  /* Imágenes flotantes en móvil */
  .image-figure.float-left,
  .image-figure.float-right {
    float: none;
    margin: 1rem 0;
    max-width: 100%;
  }
  
  /* Ajustar el contenedor principal */
  .main-wrapper {
    padding: 1rem;
    max-width: 100vw;
    overflow-x: hidden;
  }
  
  .article-container {
    max-width: 100%;
    overflow-x: hidden;
  }
  
  .article-content {
    max-width: 100%;
    overflow-x: hidden;
    word-wrap: break-word;
  }
  
  /* Evitar que nada se desborde */
  img, svg, iframe, embed, object {
    max-width: 100% !important;
    height: auto !important;
  }
  
  /* Código en línea */
  code:not(pre code) {
    white-space: pre-wrap;
    word-break: break-word;
    max-width: 100%;
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

          <div class="meta-box">
            <span>Vol. ${article.volumen}, ${isSpanish ? 'Núm.' : 'No.'} ${article.numero}</span>
            <span>pp. ${article.primeraPagina}-${article.ultimaPagina}</span>
            <span>${fecha}</span>
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
            <strong>${t.license}:</strong> 
            Este artículo se publica bajo la licencia 
            <a href="https://creativecommons.org/licenses/by/4.0/deed.${isSpanish ? 'es' : 'en'}" target="_blank" rel="license noopener noreferrer">
              ${ccLogoSvg} CC BY 4.0
            </a>
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
                <div id="apa-text-${lang}-mobile" style="margin-top: 0.25rem;">${authorsAPA}. (${year}). ${title}. <em>Revista Nacional de las Ciencias para Estudiantes</em>, ${article.volumen}(${article.numero}), ${article.primeraPagina}-${article.ultimaPagina}.</div>
              </div>
              <div class="citation-item">
                <strong>MLA</strong>
                <button class="copy-btn" onclick="copyRichText('mla-text-${lang}-mobile', event)">${t.copy}</button>
                <div id="mla-text-${lang}-mobile" style="margin-top: 0.25rem;">${isSpanish ? authorsMLAEs : authorsMLAEn}. "${title}." <em>Revista Nacional de las Ciencias para Estudiantes</em>, vol. ${article.volumen}, no. ${article.numero}, ${year}, pp. ${article.primeraPagina}-${article.ultimaPagina}.</div>
              </div>
              <div class="citation-item">
                <strong>Chicago</strong>
                <button class="copy-btn" onclick="copyRichText('chi-text-${lang}-mobile', event)">${t.copy}</button>
                <div id="chi-text-${lang}-mobile" style="margin-top: 0.25rem;">${isSpanish ? authorsChicagoEs : authorsChicagoEn}. "${title}." <em>Revista Nacional de las Ciencias para Estudiantes</em> ${article.volumen}, no. ${article.numero} (${year}): ${article.primeraPagina}-${article.ultimaPagina}.</div>
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
              ${keywords.map(kw => `<span class="keyword-tag">${kw}</span>`).join('')}
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
              <div id="apa-text-${lang}" style="margin-top: 0.25rem;">${authorsAPA}. (${year}). ${title}. <em>Revista Nacional de las Ciencias para Estudiantes</em>, ${article.volumen}(${article.numero}), ${article.primeraPagina}-${article.ultimaPagina}.</div>
            </div>
            <div class="citation-item">
              <strong>MLA</strong>
              <button class="copy-btn" onclick="copyRichText('mla-text-${lang}', event)">${t.copy}</button>
              <div id="mla-text-${lang}" style="margin-top: 0.25rem;">${isSpanish ? authorsMLAEs : authorsMLAEn}. "${title}." <em>Revista Nacional de las Ciencias para Estudiantes</em>, vol. ${article.volumen}, no. ${article.numero}, ${year}, pp. ${article.primeraPagina}-${article.ultimaPagina}.</div>
            </div>
            <div class="citation-item">
              <strong>Chicago</strong>
              <button class="copy-btn" onclick="copyRichText('chi-text-${lang}', event)">${t.copy}</button>
              <div id="chi-text-${lang}" style="margin-top: 0.25rem;">${isSpanish ? authorsChicagoEs : authorsChicagoEn}. "${title}." <em>Revista Nacional de las Ciencias para Estudiantes</em> ${article.volumen}, no. ${article.numero} (${year}): ${article.primeraPagina}-${article.ultimaPagina}.</div>
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
        <div id="desktop-metadata" class="tab-panel">
          <h4>${t.keywords}</h4>
          <div class="keywords" style="margin-bottom: 1.5rem;">
            ${keywords.map(kw => `<span class="keyword-tag">${kw}</span>`).join('')}
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

<script>
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

// ========== HIGHLIGHT JS ==========
document.addEventListener('DOMContentLoaded', () => {
  if (window.hljs) {
    document.querySelectorAll('pre code').forEach((block) => {
      hljs.highlightElement(block);
    });
  }
});

// ========== FUNCIÓN PARA COPIAR CÓDIGO ==========
function copyCode(codeId, btn) {
  const codeElement = document.getElementById(codeId);
  if (!codeElement) return;
  
  const code = codeElement.textContent || codeElement.innerText;
  
  navigator.clipboard.writeText(code).then(() => {
    const originalText = btn.innerText;
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
// ========== DETECCIÓN DE ELEMENTOS ESPECIALES ==========
(function() {
  function updateSpecialElements() {
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
      elements.push({
        type: 'table',
        id: table.id,
        title: 'Tabla ' + (i + 1)
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
    
    window.__SPECIAL_ELEMENTS__ = elements;
    console.log('Elementos especiales detectados:', elements.length);
  }

  // Función para envolver elementos con toolbar
  function wrapSpecialElements() {
    // Envolver figuras
    var figures = document.querySelectorAll('figure.image-figure[id^="figure-"]');
    for (var i = 0; i < figures.length; i++) {
      wrapWithToolbar(figures[i], 'figure', getElementTitle(figures[i], 'figure'));
    }
    
    // Envolver tablas
    var tables = document.querySelectorAll('table.article-table[id^="table-"]');
    for (var i = 0; i < tables.length; i++) {
      wrapWithToolbar(tables[i], 'table', getElementTitle(tables[i], 'table'));
    }
    
    // Envolver bloques de código
    var codes = document.querySelectorAll('.code-block-wrapper[id^="code-"]');
    for (var i = 0; i < codes.length; i++) {
      wrapWithToolbar(codes[i], 'code', getElementTitle(codes[i], 'code'));
    }
    
    // Envolver ecuaciones
    var equations = document.querySelectorAll('[id^="equation-"]');
    for (var i = 0; i < equations.length; i++) {
      wrapWithToolbar(equations[i], 'equation', 'Ecuación');
    }
    
    updateSpecialElements();
  }

  function getElementTitle(element, type) {
    if (type === 'figure') {
      var caption = element.querySelector('.image-caption');
      return caption ? caption.textContent.trim() : 'Figura';
    } else if (type === 'code') {
      var language = element.querySelector('.code-language');
      return language ? 'Código (' + language.textContent.trim() + ')' : 'Código';
    }
    return type === 'table' ? 'Tabla' : 'Ecuación';
  }

  function wrapWithToolbar(element, type, title) {
    if (element.parentElement && element.parentElement.classList.contains('special-element-container')) {
      return;
    }
    
    var container = document.createElement('div');
    container.className = 'special-element-container';
    container.setAttribute('data-element-type', type);
    
    element.parentNode.insertBefore(container, element);
    container.appendChild(element);
    
    var toolbar = document.createElement('div');
    toolbar.className = 'special-element-toolbar';
    
    var buttons = [];
    
    // Botón pantalla completa
    buttons.push('<button class="toolbar-btn" onclick="openInModal(\'' + element.id + '\')" data-tooltip="Ver en pantalla completa">' +
        '<svg viewBox="0 0 24 24" width="14" height="14">' +
          '<path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/>' +
        '</svg>' +
        '<span class="toolbar-label">Pantalla completa</span>' +
      '</button>');
    
    // Botón nueva pestaña
    buttons.push('<button class="toolbar-btn" onclick="openInNewTab(\'' + element.id + '\')" data-tooltip="Abrir en nueva pestaña">' +
        '<svg viewBox="0 0 24 24" width="14" height="14">' +
          '<path d="M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/>' +
        '</svg>' +
        '<span class="toolbar-label">Nueva pestaña</span>' +
      '</button>');
    
    // Botones específicos para tablas
    if (type === 'table') {
      buttons.push('<div style="position: relative;">' +
          '<button class="toolbar-btn" onclick="toggleDownloadMenu(this, \'' + element.id + '\')" data-tooltip="Descargar tabla">' +
            '<svg viewBox="0 0 24 24" width="14" height="14">' +
              '<path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>' +
            '</svg>' +
            '<span class="toolbar-label">Descargar</span>' +
          '</button>' +
          '<div class="download-format-menu">' +
            '<button class="format-option" onclick="downloadTable(\'' + element.id + '\', \'csv\')">CSV</button>' +
            '<button class="format-option" onclick="downloadTable(\'' + element.id + '\', \'excel\')">Excel</button>' +
            '<button class="format-option" onclick="downloadTable(\'' + element.id + '\', \'json\')">JSON</button>' +
            '<button class="format-option" onclick="downloadTable(\'' + element.id + '\', \'markdown\')">Markdown</button>' +
            '<button class="format-option" onclick="downloadTable(\'' + element.id + '\', \'latex\')">LaTeX</button>' +
            '<button class="format-option" onclick="downloadTable(\'' + element.id + '\', \'html\')">HTML</button>' +
          '</div>' +
        '</div>');
    }
    
    // Botón copiar para código
    if (type === 'code') {
      buttons.push('<button class="toolbar-btn" onclick="copyElementContent(\'' + element.id + '\')" data-tooltip="Copiar contenido">' +
          '<svg viewBox="0 0 24 24" width="14" height="14">' +
            '<rect x="9" y="9" width="13" height="13" rx="2" ry="2" fill="none" stroke="currentColor" stroke-width="2"/>' +
            '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" fill="none" stroke="currentColor" stroke-width="2"/>' +
          '</svg>' +
          '<span class="toolbar-label">Copiar</span>' +
        '</button>');
    }
    
    toolbar.innerHTML = buttons.join('');
    container.appendChild(toolbar);
    
    var badge = document.createElement('span');
    badge.className = 'special-badge';
    badge.textContent = type === 'figure' ? 'Figura' : 
                        type === 'table' ? 'Tabla' : 
                        type === 'code' ? 'Código' : 'Ecuación';
    element.parentNode.insertBefore(badge, element);
  }

  // Ejecutar cuando el DOM esté listo
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      setTimeout(wrapSpecialElements, 100);
    });
  } else {
    setTimeout(wrapSpecialElements, 100);
  }
})();

// ========== FUNCIONES GLOBALES PARA ELEMENTOS ESPECIALES ==========
var currentModalElement = null;

function openInModal(elementId) {
  var element = document.getElementById(elementId);
  if (!element) return;
  
  var modal = document.getElementById('special-modal') || createModal();
  var modalContent = modal.querySelector('.special-modal-content');
  
  var clone = element.cloneNode(true);
  clone.classList.add('in-modal');
  
  modalContent.innerHTML = '';
  modalContent.appendChild(clone);
  
  modal.classList.add('active');
  document.body.style.overflow = 'hidden';
  currentModalElement = elementId;
}

function createModal() {
  var modal = document.createElement('div');
  modal.id = 'special-modal';
  modal.className = 'special-modal';
  modal.innerHTML = '<div class="special-modal-content">' +
    '<button class="special-modal-close" onclick="closeModal()">&times;</button>' +
    '</div>';
  document.body.appendChild(modal);
  
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && modal.classList.contains('active')) {
      closeModal();
    }
  });
  
  modal.addEventListener('click', function(e) {
    if (e.target === modal) {
      closeModal();
    }
  });
  
  return modal;
}

function closeModal() {
  var modal = document.getElementById('special-modal');
  if (modal) {
    modal.classList.remove('active');
    document.body.style.overflow = '';
  }
  currentModalElement = null;
}

function openInNewTab(elementId) {
  var element = document.getElementById(elementId);
  if (!element) return;
  
  var title = element.getAttribute('data-title') || 'Elemento especial';
  var content = element.outerHTML;
  
  var newWindow = window.open('', '_blank');
  newWindow.document.write('<!DOCTYPE html>' +
    '<html><head><title>' + title + ' - Revista Nacional</title>' +
    '<meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">' +
    '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono&display=swap" rel="stylesheet">' +
    '<style>body{font-family:"Inter",sans-serif;padding:2rem;max-width:1200px;margin:0 auto;background:#f8f9fa;}' +
    '.container{background:white;padding:2rem;border-radius:8px;box-shadow:0 4px 6px rgba(0,0,0,0.1);}' +
    'h1{font-size:1.5rem;color:#005a7d;margin-bottom:1.5rem;}' +
    'pre{background:#1e1e1e;padding:1rem;border-radius:4px;overflow-x:auto;}' +
    'code{font-family:"JetBrains Mono",monospace;}' +
    'img{max-width:100%;height:auto;}' +
    'table{width:100%;border-collapse:collapse;margin:1rem 0;}' +
    'th,td{border:1px solid #ddd;padding:8px;text-align:left;}' +
    'th{background:#f0f0f0;}' +
    '.close-btn{position:fixed;top:1rem;right:1rem;padding:0.5rem 1rem;background:#005a7d;color:white;border:none;border-radius:4px;cursor:pointer;}' +
    '</style></head><body>' +
    '<div class="container"><h1>' + title + '</h1>' +
    '<div id="element-container">' + content + '</div></div>' +
    '<button class="close-btn" onclick="window.close()">Cerrar ventana</button>' +
    '</body></html>');
  newWindow.document.close();
}

// Funciones para descarga de tablas
function downloadTable(tableId, format) {
  var table = document.getElementById(tableId);
  if (!table) return;
  
  var content = '';
  var filename = 'table-' + tableId;
  var mimeType = '';
  
  switch(format) {
    case 'csv':
      content = tableToCSV(table);
      mimeType = 'text/csv';
      filename += '.csv';
      break;
    case 'excel':
      content = tableToExcel(table);
      mimeType = 'application/vnd.ms-excel';
      filename += '.xls';
      break;
    case 'json':
      content = tableToJSON(table);
      mimeType = 'application/json';
      filename += '.json';
      break;
    case 'markdown':
      content = tableToMarkdown(table);
      mimeType = 'text/markdown';
      filename += '.md';
      break;
    case 'latex':
      content = tableToLaTeX(table);
      mimeType = 'text/plain';
      filename += '.tex';
      break;
    case 'html':
      content = table.outerHTML;
      mimeType = 'text/html';
      filename += '.html';
      break;
    default:
      return;
  }
  
  var blob = new Blob([content], { type: mimeType });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  
  showToast('Tabla descargada como ' + format.toUpperCase());
}

function tableToCSV(table) {
  var rows = table.querySelectorAll('tr');
  var csv = [];
  
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var cells = row.querySelectorAll('th, td');
    var rowData = [];
    
    for (var j = 0; j < cells.length; j++) {
      var cell = cells[j];
      var text = cell.textContent.trim();
      if (text.includes(',') || text.includes('"') || text.includes('\n')) {
        text = '"' + text.replace(/"/g, '""') + '"';
      }
      rowData.push(text);
    }
    
    csv.push(rowData.join(','));
  }
  
  return csv.join('\n');
}

function tableToExcel(table) {
  return '<html><head><meta charset="UTF-8"><title>Tabla exportada</title></head><body>' +
    table.outerHTML + '</body></html>';
}

function tableToJSON(table) {
  var headers = [];
  var data = [];
  
  var headerRow = table.querySelector('tr');
  if (headerRow) {
    var headerCells = headerRow.querySelectorAll('th, td');
    for (var i = 0; i < headerCells.length; i++) {
      headers.push(headerCells[i].textContent.trim());
    }
  }
  
  var rows = table.querySelectorAll('tr');
  for (var i = 1; i < rows.length; i++) {
    var row = rows[i];
    var cells = row.querySelectorAll('td');
    var rowData = {};
    
    for (var j = 0; j < cells.length; j++) {
      if (headers[j]) {
        rowData[headers[j]] = cells[j].textContent.trim();
      } else {
        rowData['columna_' + j] = cells[j].textContent.trim();
      }
    }
    
    data.push(rowData);
  }
  
  return JSON.stringify(data, null, 2);
}

function tableToMarkdown(table) {
  var rows = table.querySelectorAll('tr');
  var markdown = [];
  
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var cells = row.querySelectorAll('th, td');
    var rowData = [];
    
    for (var j = 0; j < cells.length; j++) {
      rowData.push(cells[j].textContent.trim());
    }
    
    if (i === 0) {
      markdown.push('| ' + rowData.join(' | ') + ' |');
      var separators = [];
      for (var j = 0; j < rowData.length; j++) {
        separators.push(' --- ');
      }
      markdown.push('|' + separators.join('|') + '|');
    } else {
      markdown.push('| ' + rowData.join(' | ') + ' |');
    }
  }
  
  return markdown.join('\n');
}

function tableToLaTeX(table) {
  var rows = table.querySelectorAll('tr');
  var latex = ['\\begin{table}[h]', '\\centering', '\\begin{tabular}{'];
  
  var firstRow = rows[0];
  var colCount = firstRow ? firstRow.querySelectorAll('th, td').length : 0;
  
  var colFormat = '';
  for (var i = 0; i < colCount; i++) {
    colFormat += 'c';
  }
  latex.push('{|' + colFormat + '|}');
  latex.push('}');
  latex.push('\\hline');
  
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var cells = row.querySelectorAll('th, td');
    var rowData = [];
    
    for (var j = 0; j < cells.length; j++) {
      var text = cells[j].textContent.trim();
      text = text.replace(/_/g, '\\_')
                 .replace(/&/g, '\\&')
                 .replace(/%/g, '\\%')
                 .replace(/\$/g, '\\$')
                 .replace(/#/g, '\\#')
                 .replace(/{/g, '\\{')
                 .replace(/}/g, '\\}');
      rowData.push(text);
    }
    
    latex.push(rowData.join(' & ') + ' \\\\');
    latex.push('\\hline');
  }
  
  latex.push('\\end{tabular}');
  latex.push('\\caption{Título de la tabla}');
  latex.push('\\label{tab:' + table.id + '}');
  latex.push('\\end{table}');
  
  return latex.join('\n');
}

function showToast(message, duration) {
  if (duration === undefined) duration = 2000;
  
  var toast = document.createElement('div');
  toast.textContent = message;
  toast.style.cssText = 'position:fixed;bottom:20px;right:20px;background:#005a7d;color:white;' +
    'padding:12px 24px;border-radius:8px;font-family:"Inter",sans-serif;font-size:0.9rem;' +
    'box-shadow:0 4px 12px rgba(0,0,0,0.15);z-index:10001;animation:slideIn 0.3s ease;';
  
  document.body.appendChild(toast);
  
  setTimeout(function() {
    toast.style.animation = 'slideIn 0.3s ease reverse';
    setTimeout(function() { toast.remove(); }, 300);
  }, duration);
}

function toggleDownloadMenu(btn, tableId) {
  event.stopPropagation();
  
  var menus = document.querySelectorAll('.download-format-menu.active');
  for (var i = 0; i < menus.length; i++) {
    if (menus[i] !== btn.nextElementSibling) {
      menus[i].classList.remove('active');
    }
  }
  
  var menu = btn.nextElementSibling;
  if (menu) {
    menu.classList.toggle('active');
    
    if (menu.classList.contains('active')) {
      var closeMenu = function(e) {
        if (!menu.contains(e.target) && e.target !== btn) {
          menu.classList.remove('active');
          document.removeEventListener('click', closeMenu);
        }
      };
      setTimeout(function() {
        document.addEventListener('click', closeMenu);
      }, 100);
    }
  }
}

function copyElementContent(elementId) {
  var element = document.getElementById(elementId);
  if (!element) return;
  
  var text = '';
  
  if (element.classList.contains('code-block-wrapper')) {
    var codeElement = element.querySelector('code');
    text = codeElement ? codeElement.textContent : element.textContent;
  } else {
    text = element.textContent;
  }
  
  navigator.clipboard.writeText(text).then(function() {
    showToast('Contenido copiado al portapapeles');
  }).catch(function(err) {
    console.error('Error copying:', err);
    showToast('Error al copiar', 3000);
  });
}

// ========== ACTUALIZAR ELEMENTOS ESPECIALES DESPUÉS DE CARGAR ==========
document.addEventListener('DOMContentLoaded', function() {
  // Envolver elementos especiales con contenedor y toolbar
  wrapSpecialElements();
  
  // Actualizar la lista de elementos especiales para el TOC
  updateSpecialElementsList();
});

function wrapSpecialElements() {
  // Envolver figuras
  var figures = document.querySelectorAll('figure.image-figure[id^="figure-"]');
  for (var i = 0; i < figures.length; i++) {
    wrapWithToolbar(figures[i], 'figure', getFigureTitle(figures[i]));
  }
  
  // Envolver tablas
  var tables = document.querySelectorAll('table.article-table[id^="table-"]');
  for (var i = 0; i < tables.length; i++) {
    wrapWithToolbar(tables[i], 'table', getTableTitle(tables[i]));
  }
  
  // Envolver bloques de código
  var codes = document.querySelectorAll('.code-block-wrapper[id^="code-"]');
  for (var i = 0; i < codes.length; i++) {
    wrapWithToolbar(codes[i], 'code', getCodeTitle(codes[i]));
  }
  
  // Envolver ecuaciones
  var equations = document.querySelectorAll('[id^="equation-"]');
  for (var i = 0; i < equations.length; i++) {
    wrapWithToolbar(equations[i], 'equation', 'Ecuación');
  }
}

function wrapWithToolbar(element, type, title) {
  // Evitar envolver múltiples veces
  if (element.parentElement && element.parentElement.classList.contains('special-element-container')) {
    return;
  }
  
  var container = document.createElement('div');
  container.className = 'special-element-container';
  container.setAttribute('data-element-type', type);
  
  // Insertar antes de mover el elemento
  element.parentNode.insertBefore(container, element);
  container.appendChild(element);
  
  // Crear toolbar
  var toolbar = document.createElement('div');
  toolbar.className = 'special-element-toolbar';
  
  // Botones según tipo
  var buttons = [];
  
  // Botón abrir en modal (pantalla completa)
  buttons.push('<button class="toolbar-btn" onclick="openInModal(\'' + element.id + '\')" data-tooltip="Ver en pantalla completa">' +
      '<svg viewBox="0 0 24 24" width="14" height="14">' +
        '<path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/>' +
      '</svg>' +
      '<span class="toolbar-label">Pantalla completa</span>' +
    '</button>');
  
  // Botón abrir en nueva pestaña
  buttons.push('<button class="toolbar-btn" onclick="openInNewTab(\'' + element.id + '\')" data-tooltip="Abrir en nueva pestaña">' +
      '<svg viewBox="0 0 24 24" width="14" height="14">' +
        '<path d="M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/>' +
      '</svg>' +
      '<span class="toolbar-label">Nueva pestaña</span>' +
    '</button>');
  
  // Botones específicos para tablas
  if (type === 'table') {
    buttons.push('<div style="position: relative;">' +
        '<button class="toolbar-btn" onclick="toggleDownloadMenu(this, \'' + element.id + '\')" data-tooltip="Descargar tabla">' +
          '<svg viewBox="0 0 24 24" width="14" height="14">' +
            '<path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>' +
          '</svg>' +
          '<span class="toolbar-label">Descargar</span>' +
        '</button>' +
        '<div class="download-format-menu">' +
          '<button class="format-option" onclick="downloadTable(\'' + element.id + '\', \'csv\')">CSV</button>' +
          '<button class="format-option" onclick="downloadTable(\'' + element.id + '\', \'excel\')">Excel</button>' +
          '<button class="format-option" onclick="downloadTable(\'' + element.id + '\', \'json\')">JSON</button>' +
          '<button class="format-option" onclick="downloadTable(\'' + element.id + '\', \'markdown\')">Markdown</button>' +
          '<button class="format-option" onclick="downloadTable(\'' + element.id + '\', \'latex\')">LaTeX</button>' +
          '<button class="format-option" onclick="downloadTable(\'' + element.id + '\', \'html\')">HTML</button>' +
        '</div>' +
      '</div>');
  }
  
  // Botón copiar para código
  if (type === 'code') {
    buttons.push('<button class="toolbar-btn" onclick="copyElementContent(\'' + element.id + '\')" data-tooltip="Copiar contenido">' +
        '<svg viewBox="0 0 24 24" width="14" height="14">' +
          '<rect x="9" y="9" width="13" height="13" rx="2" ry="2" fill="none" stroke="currentColor" stroke-width="2"/>' +
          '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" fill="none" stroke="currentColor" stroke-width="2"/>' +
        '</svg>' +
        '<span class="toolbar-label">Copiar</span>' +
      '</button>');
  }
  
  toolbar.innerHTML = buttons.join('');
  container.appendChild(toolbar);
  
  // Añadir badge con el tipo
  var badge = document.createElement('span');
  badge.className = 'special-badge';
  badge.textContent = type === 'figure' ? 'Figura' : 
                      type === 'table' ? 'Tabla' : 
                      type === 'code' ? 'Código' : 'Ecuación';
  element.parentNode.insertBefore(badge, element);
}

// Funciones auxiliares para obtener títulos
function getFigureTitle(figure) {
  var caption = figure.querySelector('.image-caption');
  return caption ? caption.textContent.trim() : 'Figura';
}

function getTableTitle(table) {
  return 'Tabla';
}

function getCodeTitle(code) {
  var language = code.querySelector('.code-language');
  return language ? 'Código (' + language.textContent.trim() + ')' : 'Código';
}

// Copiar contenido de un elemento
function copyElementContent(elementId) {
  var element = document.getElementById(elementId);
  if (!element) return;
  
  var text = '';
  
  if (element.classList.contains('code-block-wrapper')) {
    // Para bloques de código, obtener el texto del código
    var codeElement = element.querySelector('code');
    text = codeElement ? codeElement.textContent : element.textContent;
  } else {
    text = element.textContent;
  }
  
  navigator.clipboard.writeText(text).then(function() {
    showToast('Contenido copiado al portapapeles');
  }).catch(function(err) {
    console.error('Error copying:', err);
    showToast('Error al copiar', 3000);
  });
}

// Actualizar lista de elementos especiales para el TOC
function updateSpecialElementsList() {
  var elements = [];
  
  var containers = document.querySelectorAll('.special-element-container');
  for (var i = 0; i < containers.length; i++) {
    var container = containers[i];
    var element = container.querySelector('[id^="figure-"], [id^="table-"], [id^="code-"], [id^="equation-"]');
    if (!element) continue;
    
    var type = container.getAttribute('data-element-type');
    var title = '';
    
    if (type === 'figure') {
      var caption = element.querySelector('.image-caption');
      title = caption ? caption.textContent.trim() : 'Figura';
    } else if (type === 'table') {
      title = 'Tabla';
    } else if (type === 'code') {
      var language = element.querySelector('.code-language');
      title = language ? 'Código (' + language.textContent.trim() + ')' : 'Código';
    } else {
      title = 'Ecuación';
    }
    
    elements.push({
      type: type,
      id: element.id,
      title: title
    });
  }
  
  window.__SPECIAL_ELEMENTS__ = elements;
}

// ========== INICIALIZACIÓN ADICIONAL ==========
document.addEventListener('DOMContentLoaded', function() {
  // Si ya existen elementos, envolverlos después de un pequeño retraso
  setTimeout(wrapSpecialElements, 500);
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