// ============================================
// CONFIGURATION DE LA BASE DE DONNÉES
// ============================================
var CONFIG = {
  SPREADSHEET_ID: '1JEWXzPYwZ60HWzFB0_BZJcBYmm0QQD29shP23WQ6BVg',
  SHEET_NAME: 'Employe',
  TIMEZONE: 'Africa/Nairobi'
};

// ============================================
// FONCTION PRINCIPALE - DOGET
// ============================================
function doGet(e) {
  var params = normalizeRequestData(e);
  var action = resolveAction(params);
  var hasApiRequest = !!(
    action ||
    params.matricule ||
    params.codeQr ||
    params.qr ||
    params.code ||
    params.type ||
    params.mode ||
    params.endpoint
  );

  // La page HTML est renvoyée uniquement sur l'URL racine du site.
  // Les appels API renvoient seulement des données JSON.
  if (!hasApiRequest) {
    return HtmlService.createHtmlOutputFromFile('index')
      .setTitle('Système de Pointage QR Code')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1');
  }

  return handleApiRequest(e, 'GET');
}

function doPost(e) {
  return handleApiRequest(e, 'POST');
}

function doOptions(e) {
  return createCorsResponse({
    success: true,
    message: 'CORS preflight OK'
  });
}

function handleApiRequest(e, method) {
  var params = normalizeRequestData(e);
  var action = resolveAction(params);
  var matricule = String(params.matricule || params.codeQr || params.qr || params.code || '').trim();

  if (!action && !matricule) {
    return createCorsResponse({
      success: false,
      message: 'Aucune action ni matricule fournis.'
    });
  }

  try {
    switch (action) {
      case 'ping':
        return createCorsResponse({
          success: true,
          message: 'API OK',
          date: getTodayDate(),
          heure: getNowTime(),
          timezone: CONFIG.TIMEZONE
        });

      case 'statut':
      case 'status':
        if (!matricule) {
          return createCorsResponse({ success: false, message: 'Matricule manquant' });
        }
        var statut = verifierStatut(matricule);
        return createCorsResponse(statut ? { success: true, data: statut } : { success: false, message: '❌ Matricule non trouvé' });

      case 'entree':
      case 'checkin':
        if (!matricule) {
          return createCorsResponse({ success: false, message: 'Matricule manquant' });
        }
        var entree = enregistrerEntree(matricule);
        return createCorsResponse(entree);

      case 'sortie':
      case 'checkout':
        if (!matricule) {
          return createCorsResponse({ success: false, message: 'Matricule manquant' });
        }
        var sortie = enregistrerSortie(matricule);
        return createCorsResponse(sortie);

      case 'scan':
      case 'pointage':
        if (!matricule) {
          return createCorsResponse({ success: false, message: 'Matricule manquant' });
        }
        var statutScan = verifierStatut(matricule);
        if (!statutScan) {
          return createCorsResponse({ success: false, message: '❌ Matricule non trouvé dans la base' });
        }
        var result = statutScan.estPresent ? enregistrerSortie(matricule) : enregistrerEntree(matricule);
        return createCorsResponse(result);

      case 'stats':
      case 'statistiques':
        return createCorsResponse(getStatistiques());

      case 'rapport':
      case 'report':
        return createCorsResponse({ success: true, data: getRapportDuJour() });

      default:
        if (matricule) {
          var defaultStatut = verifierStatut(matricule);
          if (!defaultStatut) {
            return createCorsResponse({ success: false, message: '❌ Matricule non trouvé dans la base' });
          }
          var defaultResult = defaultStatut.estPresent ? enregistrerSortie(matricule) : enregistrerEntree(matricule);
          return createCorsResponse(defaultResult);
        }

        return createCorsResponse({
          success: false,
          message: 'Action inconnue.',
          actions: ['ping', 'statut', 'entree', 'sortie', 'scan', 'stats', 'rapport']
        });
    }
  } catch (error) {
    console.error('Erreur handleApiRequest:', error);
    return createCorsResponse({
      success: false,
      message: 'Erreur serveur: ' + error.toString()
    });
  }
}

function normalizeRequestData(e) {
  var data = {};
  if (e && e.parameter) {
    Object.keys(e.parameter).forEach(function (key) {
      data[key] = e.parameter[key];
    });
  }

  if (e && e.postData && e.postData.contents) {
    try {
      var parsed = JSON.parse(e.postData.contents);
      if (parsed && typeof parsed === 'object') {
        Object.keys(parsed).forEach(function (key) {
          data[key] = parsed[key];
        });
      }
    } catch (err) {
      // ignore les JSON non valides; on garde le paramètre d'origine
    }
  }

  return data;
}

function resolveAction(params) {
  if (!params) return '';
  var value = params.action || params.type || params.endpoint || params.mode || '';
  return String(value).toLowerCase();
}

function createCorsResponse(payload) {
  var output = ContentService.createTextOutput(JSON.stringify(payload));
  output.setMimeType(ContentService.MimeType.JSON);

  try {
    if (typeof output.setHeader === 'function') {
      output.setHeader('Access-Control-Allow-Origin', '*');
      output.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      output.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    }
  } catch (err) {
    console.warn('CORS headers not set:', err);
  }

  return output;
}

function getTodayDate() {
  return Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'dd/MM/yyyy');
}

function getNowTime() {
  return Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'HH:mm:ss');
}

// ============================================
// FONCTION POUR INCLURE LES FICHIERS HTML (pour compatibilité)
// ============================================
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// ============================================
// OBTENIR LA FEUILLE DE CALCUL
// ============================================
function getSheet() {
  try {
    var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    var sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
    if (!sheet) {
      sheet = ss.getActiveSheet();
    }
    return sheet;
  } catch (error) {
    console.error('Erreur getSheet:', error);
    throw error;
  }
}

// ============================================
// VÉRIFIER LE STATUT D'UN EMPLOYÉ
// ============================================
function verifierStatut(matricule) {
  try {
    if (!matricule) {
      return null;
    }
    // Supporte recherche par matricule OU par code QR (colonne 3)
    var found = findEmployeeRow(matricule);
    if (!found) return null;

    var row = found.row;
    var i = found.index;
    var dateEntree = row[4] || '';
    var dateSortie = row[6] || '';
    var estPresent = (dateEntree !== '' && dateSortie === '');

    return {
      matricule: row[0],
      nom: row[1] || '',
      fonction: row[2] || '',
      codeQr: row[3] || '',
      estPresent: estPresent,
      dateEntree: dateEntree,
      heureEntree: row[5] || '',
      dateSortie: dateSortie,
      heureSortie: row[7] || '',
      ligne: i + 1
    };
  } catch (error) {
    console.error('Erreur verifierStatut:', error);
    return null;
  }
}

// ============================================
// ENREGISTRER L'ENTRÉE
// ============================================
function enregistrerEntree(matricule) {
  try {
    if (!matricule) {
      return {
        success: false,
        message: 'Matricule manquant'
      };
    }
    var now = new Date();
    var timezone = CONFIG.TIMEZONE;
    var dateStr = Utilities.formatDate(now, timezone, 'dd/MM/yyyy');
    var heureStr = Utilities.formatDate(now, timezone, 'HH:mm:ss');

    // Rechercher la ligne par matricule ou par code QR
    var found = findEmployeeRow(matricule);
    if (!found) {
      return { success: false, message: '❌ Matricule non trouvé' };
    }

    var row = found.row;
    var ligne = found.index + 1;

    if (row[4] && row[4] !== '' && !row[6]) {
      return { success: false, message: '⚠️ ' + row[1] + ' est déjà présent(e)', matricule: row[0], nom: row[1] || '' };
    }

    var sheet = getSheet();
    sheet.getRange(ligne, 5).setValue(dateStr);
    sheet.getRange(ligne, 6).setValue(heureStr);
    sheet.getRange(ligne, 7).setValue('');
    sheet.getRange(ligne, 8).setValue('');

    return { success: true, message: '✅ Entrée enregistrée', matricule: row[0], nom: row[1] || '', fonction: row[2] || '', date: dateStr, heure: heureStr };
  } catch (error) {
    console.error('Erreur enregistrerEntree:', error);
    return {
      success: false,
      message: 'Erreur: ' + error.toString()
    };
  }
}

// ============================================
// ENREGISTRER LA SORTIE
// ============================================
function enregistrerSortie(matricule) {
  try {
    if (!matricule) {
      return {
        success: false,
        message: 'Matricule manquant'
      };
    }
    var now = new Date();
    var timezone = CONFIG.TIMEZONE;
    var dateStr = Utilities.formatDate(now, timezone, 'dd/MM/yyyy');
    var heureStr = Utilities.formatDate(now, timezone, 'HH:mm:ss');

    var found = findEmployeeRow(matricule);
    if (!found) return { success: false, message: '❌ Matricule non trouvé' };

    var row = found.row;
    var ligne = found.index + 1;

    if (row[6] && row[6] !== '') {
      return { success: false, message: '⚠️ ' + row[1] + ' est déjà sorti(e)', matricule: row[0], nom: row[1] || '' };
    }

    if (!row[4] || row[4] === '') {
      return { success: false, message: '⚠️ ' + row[1] + " n'a pas d'entrée enregistrée", matricule: row[0], nom: row[1] || '' };
    }

    var sheet = getSheet();
    sheet.getRange(ligne, 7).setValue(dateStr);
    sheet.getRange(ligne, 8).setValue(heureStr);

    return { success: true, message: '✅ Sortie enregistrée', matricule: row[0], nom: row[1] || '', fonction: row[2] || '', date: dateStr, heure: heureStr };
  } catch (error) {
    console.error('Erreur enregistrerSortie:', error);
    return {
      success: false,
      message: 'Erreur: ' + error.toString()
    };
  }
}

// ============================================
// OBTENIR LES STATISTIQUES
// ============================================
function getStatistiques() {
  try {
    var sheet = getSheet();
    var data = sheet.getDataRange().getValues();
    var total = 0;
    var present = 0;
    var aujourdhui = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'dd/MM/yyyy');

    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (row[0] && row[0] !== '') {
        total++;

        var dateEntree = row[4] || '';
        var dateSortie = row[6] || '';

        if (dateEntree !== '' && dateSortie === '') {
          present++;
        }
      }
    }

    return {
      total: total,
      present: present,
      absent: total - present,
      aujourdhui: aujourdhui
    };
  } catch (error) {
    console.error('Erreur getStatistiques:', error);
    return {
      total: 0,
      present: 0,
      absent: 0,
      aujourdhui: ''
    };
  }
}

// ============================================
// RAPPORT DU JOUR
// ============================================
function getRapportDuJour() {
  try {
    var sheet = getSheet();
    var data = sheet.getDataRange().getValues();
    var rapport = [];
    var aujourdhui = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'dd/MM/yyyy');

    for (var i = 1; i < data.length; i++) {
      var row = data[i];

      if (row[0] && row[0] !== '') {
        var dateEntree = row[4] || '';
        var dateSortie = row[6] || '';

        if (dateEntree === aujourdhui || dateSortie === aujourdhui) {
          rapport.push({
            matricule: row[0],
            nom: row[1] || '',
            fonction: row[2] || '',
            entre: dateEntree === aujourdhui ? row[5] || '' : '',
            sortie: dateSortie === aujourdhui ? row[7] || '' : '',
            present: (dateEntree === aujourdhui && dateSortie === '')
          });
        }
      }
    }

    return rapport;
  } catch (error) {
    console.error('Erreur getRapportDuJour:', error);
    return [];
  }
}

// ============================================
// FONCTION DE TEST
// ============================================
function testConnexion() {
  try {
    var sheet = getSheet();
    var nom = sheet.getName();
    var nbLignes = sheet.getLastRow();

    return {
      success: true,
      message: 'Connexion réussie',
      nomFeuille: nom,
      nbLignes: nbLignes
    };
  } catch (error) {
    return {
      success: false,
      message: 'Erreur: ' + error.toString()
    };
  }
}

// ============================================
// TROUVER LIGNE D'UN EMPLOYÉ PAR MATRICULE OU CODE QR
// ============================================
function findEmployeeRow(key) {
  try {
    if (!key) return null;
    var sheet = getSheet();
    var data = sheet.getDataRange().getValues();

    for (var i = 0; i < data.length; i++) {
      var row = data[i];
      // colonne 0 = matricule, colonne 3 = code QR (si utilisé)
      if (row[0] && row[0].toString() === key.toString()) return { row: row, index: i };
      if (row[3] && row[3].toString() === key.toString()) return { row: row, index: i };
    }
    return null;
  } catch (e) {
    console.error('Erreur findEmployeeRow:', e);
    return null;
  }
}