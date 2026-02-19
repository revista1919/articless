const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
// ... al inicio del archivo, junto a los otros require
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
// ========== CONFIGURACIÓN ==========
const ARTICLES_JSON = path.join(__dirname, 'articles.json');
const OUTPUT_HTML_DIR = path.join(__dirname, 'articles');
const DOMAIN = 'https://www.revistacienciasestudiantes.com';

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
  
  // Obtener primer autor
  let firstAuthor = '';
  if (typeof article.autores === 'string') {
    firstAuthor = article.autores.split(';')[0].split(' ').pop().toLowerCase();
  } else if (Array.isArray(article.autores) && article.autores.length > 0) {
    const first = article.autores[0];
    if (typeof first === 'string') {
      firstAuthor = first.split(' ').pop().toLowerCase();
    } else if (first.name) {
      firstAuthor = first.name.split(' ').pop().toLowerCase();
    } else if (first.lastName) {
      firstAuthor = first.lastName.toLowerCase();
    }
  }
  
  // Formatear autores para BibTeX
  let authorsForBib = '';
  if (typeof article.autores === 'string') {
    authorsForBib = article.autores.replace(/;/g, ' and ');
  } else if (Array.isArray(article.autores)) {
    authorsForBib = article.autores.map(a => {
      if (typeof a === 'string') return a;
      if (a.name) return a.name;
      if (a.firstName || a.lastName) return `${a.firstName || ''} ${a.lastName || ''}`.trim();
      return '';
    }).join(' and ');
  }
  
  const key = `${firstAuthor}${year}${article.numeroArticulo}`;
  return `@article{${key},
  author = {${authorsForBib}},
  title = {${article.titulo}},
  journal = {Revista Nacional de las Ciencias para Estudiantes},
  year = {${year}},
  volume = {${article.volumen}},
  number = {${article.numero}},
  pages = {${article.primeraPagina}-${article.ultimaPagina}},
  issn = {3087-2839},
  url = {${DOMAIN}/articles/article-${generateSlug(article.titulo)}-${article.numeroArticulo}.html}
}`.trim();
}

// ========== ICONOS SVG ==========
const oaSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 53" width="24" height="36" style="vertical-align:middle; margin-right:4px;">
  <path fill="#F48120" d="M18 21.3c-8.7 0-15.8 7.1-15.8 15.8S9.3 52.9 18 52.9s15.8-7.1 15.8-15.8S26.7 21.3 18 21.3zm0 25.1c-5.1 0-9.3-4.2-9.3-9.3s4.2-9.3 9.3-9.3 9.3 4.2 9.3 9.3-4.2 9.3-9.3 9.3z"/>
  <path fill="#F48120" d="M18 0c-7.5 0-13.6 6.1-13.6 13.6V23h6.5v-9.4c0-3.9 3.2-7.1 7.1-7.1s7.1 3.2 7.1 7.1V32h6.5V13.6C31.6 6.1 25.5 0 18 0z"/>
  <circle fill="#F48120" cx="18" cy="37.1" r="4.8"/>
</svg>`;

const orcidSvg = `<svg viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg" width="16" height="16"> <circle cx="128" cy="128" r="120" fill="#A6CE39"/> <g fill="#FFFFFF"> <rect x="71" y="78" width="17" height="102"/> <circle cx="79.5" cy="56" r="11"/> <path d="M103 78 v102 h41.5 c28.2 0 51-22.8 51-51 s-22.8-51-51-51 H103 zm17 17 h24.5 c18.8 0 34 15.2 34 34 s-15.2 34-34 34 H120 V95 z" fill-rule="evenodd"/> </g> </svg>`;

const emailSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle; color: #005a7d;">
  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
  <polyline points="22,6 12,13 2,6"></polyline>
</svg>`;

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
    // Asumiendo que el artículo tiene un array de authorIds en el mismo orden que los autores
    const articleAuthorId = article && article.authorIds ? article.authorIds[index] : null;
    
    // Buscar información del autor usando nuestra función de matching
    const authorInfo = findAuthorInfo(author, articleAuthorId);
    
    // Construir HTML del autor
    let authorHtml = '';
    
    if (authorInfo && authorInfo.slug) {
      // Tiene slug, crear enlace
      authorHtml += `<a href="/team/${authorInfo.slug}.html" class="author-link"`;
      
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
function processCodeBlocks(html) {
  if (!html) return html;
  
  const $ = cheerio.load(html, { decodeEntities: false });
  
  // Procesar bloques de código
  $('pre code, pre').each((i, el) => {
    const $el = $(el);
    const code = $el.text();
    
    // Detectar lenguaje (simplificado)
    let language = '';
    const classAttr = $el.attr('class') || '';
    if (classAttr.includes('language-')) {
      language = classAttr.split('language-')[1].split(' ')[0];
    } else if (classAttr.includes('lang-')) {
      language = classAttr.split('lang-')[1].split(' ')[0];
    }
    
    // Envolver en contenedor con botón de copiar
    const codeId = `code-${Math.random().toString(36).substr(2, 9)}`;
    const codeHtml = `
      <div class="code-block-wrapper">
        <div class="code-header">
          <span class="code-language">${language || 'código'}</span>
          <button class="code-copy-btn" onclick="copyCode('${codeId}', this)" title="Copiar código">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
            Copiar
          </button>
        </div>
        <pre id="${codeId}" class="code-block ${language ? `language-${language}` : ''}"><code>${code.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre>
      </div>
    `;
    
    $el.parent().replaceWith(codeHtml);
  });
  
  // Procesar tablas
  $('table').each((i, el) => {
    const $el = $(el);
    $el.addClass('article-table');
    $el.wrap('<div class="table-wrapper"></div>');
  });
  
  // Procesar imágenes
  $('img').each((i, el) => {
    const $el = $(el);
    const alt = $el.attr('alt') || '';
    const src = $el.attr('src') || '';
    
    if (src && !src.startsWith('http') && !src.startsWith('data:')) {
      // Imagen local - mantener ruta relativa
      $el.attr('src', src);
    }
    
    $el.addClass('article-image');
    if (alt) {
      $el.wrap('<figure class="image-figure"></figure>');
      $el.after(`<figcaption class="image-caption">${alt}</figcaption>`);
    }
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
  
  const articleSlug = `${generateSlug(article.titulo)}-${article.numeroArticulo}`;

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
    emailSvg
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
    emailSvg
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
  emailSvg
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
      codeCopied: '✓ Copiado'
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
      codeCopied: '✓ Copied'
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

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: 'Lora', serif;
      line-height: 1.7;
      color: var(--text-main);
      background-color: #fff;
      margin: 0;
      overflow-x: hidden;
    }

    /* Top Navigation */
    .top-nav {
      border-bottom: 1px solid var(--border-color);
      padding: 1rem 2rem;
      background: #fff;
      position: sticky;
      top: 0;
      z-index: 1000;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-family: 'Inter', sans-serif;
    }

    .journal-name {
      font-weight: 700;
      font-size: 1rem;
      color: var(--nature-black);
      text-decoration: none;
      letter-spacing: -0.02em;
    }

    .journal-name:hover {
      color: var(--nature-blue);
    }

    .issn-badge {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.75rem;
      background: var(--bg-soft);
      padding: 4px 12px;
      border-radius: 20px;
      border: 1px solid var(--border-color);
      color: var(--text-light);
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

    /* ===== CODE BLOCKS - ESTILO ÉPICO ===== */
    .code-block-wrapper {
      margin: 2.5rem 0;
      border: none;
      border-radius: 12px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.1);
      background: var(--code-bg);
      overflow: hidden;
    }

    .code-header {
      background: var(--code-header-bg);
      border-bottom: 1px solid rgba(255,255,255,0.1);
      padding: 0.75rem 1.25rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .code-language {
      color: #a9b1d6;
      font-weight: 700;
      letter-spacing: 1px;
      font-size: 0.8rem;
      text-transform: uppercase;
    }

    .code-copy-btn {
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 4px;
      padding: 0.3rem 0.8rem;
      font-size: 0.7rem;
      font-family: 'Inter', sans-serif;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      color: #a9b1d6;
      transition: all 0.2s;
    }

    .code-copy-btn:hover {
      background: var(--nature-blue);
      border-color: var(--nature-blue);
      color: white;
    }

    .code-copy-btn svg {
      width: 14px;
      height: 14px;
    }

    .code-block {
      margin: 0;
      padding: 1.5rem;
      background: transparent;
      color: var(--code-text);
      line-height: 1.6;
      font-size: 0.85rem;
      overflow-x: auto;
      scrollbar-color: #444 transparent;
      font-family: 'JetBrains Mono', monospace;
    }

    .code-block code {
      font-family: 'JetBrains Mono', monospace;
      text-shadow: 0 0 2px rgba(0,0,0,0.3);
    }

    /* ===== TABLES - ESTILO ACADÉMICO BOOKTABS ===== */
    .table-wrapper {
      overflow-x: auto;
      margin: 3rem 0;
      border-top: 2px solid var(--nature-black);
      border-bottom: 2px solid var(--nature-black);
      padding: 0.5rem 0;
    }

    .article-table {
      width: 100%;
      border-collapse: collapse;
      font-family: 'Inter', sans-serif;
      font-size: 0.9rem;
      color: var(--text-main);
      max-width: 100%;
      overflow-x: auto;
      display: block;
    }

    .article-table th {
      border-bottom: 1.5px solid var(--nature-black);
      background: transparent;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      padding: 12px 15px;
      color: var(--nature-black);
      text-align: left;
    }

    .article-table td {
      padding: 12px 15px;
      border: none;
      border-bottom: 1px solid #eee;
    }

    .article-table tr:last-child td {
      border-bottom: none;
    }

    .article-table tr:hover {
      background-color: var(--bg-soft);
    }

    /* ===== EQUATIONS - SOBRÍAS Y PROTAGONISTAS ===== */
    .MathJax_Display, .math-container {
      margin: 3rem 0 !important;
      padding: 2rem;
      background: linear-gradient(to right, transparent, var(--bg-soft), transparent);
      border-top: 1px solid var(--border-color);
      border-bottom: 1px solid var(--border-color);
      transition: transform 0.3s ease;
      overflow-x: auto;
    }

    .math-container:hover {
      transform: scale(1.01);
    }

    /* ===== LISTS - DESPLAZADAS A LA DERECHA ===== */
    .article-content ol, 
    .article-content ul {
      margin: 1.5rem 0 1.5rem 4rem;
      padding-left: 0;
    }

    .article-content li {
      margin-bottom: 0.75rem;
      position: relative;
    }

    .article-content ol {
      counter-reset: my-counter;
      list-style: none;
    }

    .article-content ol li::before {
      content: counter(my-counter) ".";
      counter-increment: my-counter;
      position: absolute;
      left: -2.5rem;
      font-weight: 700;
      color: var(--nature-blue);
      font-family: 'Inter', sans-serif;
    }

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

    /* Figures */
    .image-figure {
      margin: 2rem 0;
      text-align: center;
    }

    .article-image {
      max-width: 100%;
      height: auto;
      border-radius: 4px;
    }

    .image-caption {
      margin-top: 0.5rem;
      font-size: 0.9rem;
      color: var(--text-muted);
      font-style: italic;
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

    /* Right Sidebar with Tabs */
    .right-sidebar {
      position: sticky;
      top: 100px;
      height: fit-content;
      font-family: 'Inter', sans-serif;
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
      .article-content ol, 
      .article-content ul {
        margin: 1.5rem 0 1.5rem 2rem;
      }
      blockquote {
        margin: 2rem 1.5rem;
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
      .article-content ol, 
      .article-content ul {
        margin: 1.5rem 0 1.5rem 1rem;
      }
      blockquote {
        margin: 1.5rem 1rem;
      }
    }
  </style>
</head>
<body>
  <nav class="top-nav">
    <a href="/" class="journal-name">Revista Nacional de las Ciencias para Estudiantes</a>
    <div class="issn-badge">ISSN: 3087-2839 (Online)</div>
  </nav>

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

  <footer style="text-align: center; padding: 3rem 2rem; border-top: 1px solid var(--border-color); font-family: 'Inter', sans-serif; font-size: 0.8rem; color: var(--text-light);">
    <p>&copy; ${new Date().getFullYear()} Revista Nacional de las Ciencias para Estudiantes. ISSN 3087-2839</p>
    <p style="margin-top: 0.5rem;">
      <a href="${isSpanish ? '/es/article' : '/en/article'}" style="color: var(--nature-blue); text-decoration: none;">${t.backToCatalog}</a> 
      <span style="margin: 0 0.5rem;">|</span> 
      <a href="/" style="color: var(--nature-blue); text-decoration: none;">${t.backToHome}</a>
      <span style="margin: 0 0.5rem;">|</span> 
      <a href="/articles/article-${articleSlug}${isSpanish ? 'EN' : ''}.html" style="color: var(--nature-blue); text-decoration: none;">${t.viewOtherLang}</a>
    </p>
  </footer>

  <script>
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
        
        btn.innerHTML = '${t.codeCopied}';
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

    // ========== GENERATE TABLE OF CONTENTS ==========
    document.addEventListener('DOMContentLoaded', () => {
      const tocList = document.getElementById('toc-list');
      const headings = document.querySelectorAll('.article-container h2');
      
      headings.forEach((heading, index) => {
        if (heading.id === 'citations' || heading.closest('.citation-box')) return;
        
        const id = heading.id || 'section-' + index;
        heading.id = id;
        
        const li = document.createElement('li');
        li.className = 'toc-item';
        const link = document.createElement('a');
        link.href = '#' + id;
        link.textContent = heading.textContent;
        link.addEventListener('click', (e) => {
          e.preventDefault();
          document.getElementById(id).scrollIntoView({ behavior: 'smooth' });
        });
        li.appendChild(link);
        tocList.appendChild(li);
      });

      // Smooth scroll for all internal links
      document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
          const href = this.getAttribute('href');
          if (href === '#') return;
          
          const target = document.querySelector(href);
          if (target) {
            e.preventDefault();
            target.scrollIntoView({ behavior: 'smooth' });
          }
        });
      });

      // Active section highlighting
      const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            document.querySelectorAll('.toc-item a').forEach(link => {
              link.classList.remove('active');
              if (link.getAttribute('href') === '#' + entry.target.id) {
                link.classList.add('active');
              }
            });
          }
        });
      }, { threshold: 0.3, rootMargin: '-80px 0px -80px 0px' });

      document.querySelectorAll('.article-container h2').forEach(h => observer.observe(h));
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
        
        btn.innerText = '${t.copied}';
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
      
      try {
        document.execCommand('copy');
        btn.innerText = '${t.copied}';
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

    // ========== MATHJAX ==========
    if (window.MathJax) {
      MathJax.typesetPromise();
    }
  </script>
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
            const articleSlug = `${generateSlug(article.titulo)}-${article.numeroArticulo}`;
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
            const articleSlug = `${generateSlug(article.titulo)}-${article.numeroArticulo}`;
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