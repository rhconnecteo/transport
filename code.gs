// ============================================
// CONFIGURATION DE LA BASE DE DONNÉES
// ============================================
var CONFIG = {
  SPREADSHEET_ID: '1JEWXzPYwZ60HWzFB0_BZJcBYmm0QQD29shP23WQ6BVg',
  EMPLOYEE_SHEET_NAME: 'Employe',
  PRESENCE_SHEET_NAME: 'Fiche de présence',
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

  console.log('API request action:', action, 'mode:', params.mode, 'matricule:', matricule);

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

      case 'ajouter':
      case 'ajout':
      case 'create':
      case 'nouveau':
        var nouveau = ajouterEmploye(
          params.matricule,
          params.nom,
          params.fonction,
          params.codeQr || params.code || '-'
        );
        return createCorsResponse(nouveau);

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

        var employeScan = findEmployeeRow(matricule);
        if (!employeScan) {
          return createCorsResponse({ success: false, message: '❌ Matricule non trouvé dans la base Employe' });
        }

        var statutScan = verifierStatut(matricule);
        if (!statutScan) {
          return createCorsResponse({ success: false, message: '❌ Matricule non trouvé dans la base Employe' });
        }
        var forcedMode = String(params.mode || params.type || params.action || '').toLowerCase();
        var result;
        if (forcedMode === 'sortie' || forcedMode === 'checkout') {
          result = enregistrerSortie(matricule);
        } else if (forcedMode === 'entree' || forcedMode === 'checkin') {
          result = enregistrerEntree(matricule);
        } else {
          result = statutScan.estPresent ? enregistrerSortie(matricule) : enregistrerEntree(matricule);
        }
        return createCorsResponse(result);

      case 'stats':
      case 'statistiques':
        return createCorsResponse(getStatistiques());

      case 'rapport':
      case 'report':
        return createCorsResponse({ success: true, data: getRapportDuJour() });

      default:
        if (matricule) {
          var employeeDefault = findEmployeeRow(matricule);
          if (!employeeDefault) {
            return createCorsResponse({ success: false, message: '❌ Matricule non trouvé dans la base Employe' });
          }

          var defaultStatut = verifierStatut(matricule);
          if (!defaultStatut) {
            return createCorsResponse({ success: false, message: '❌ Matricule non trouvé dans la base Employe' });
          }

          var forcedModeDefault = String(params.mode || params.type || params.action || '').toLowerCase();
          var defaultResult;
          if (forcedModeDefault === 'sortie' || forcedModeDefault === 'checkout') {
            defaultResult = enregistrerSortie(matricule);
          } else if (forcedModeDefault === 'entree' || forcedModeDefault === 'checkin') {
            defaultResult = enregistrerEntree(matricule);
          } else {
            defaultResult = defaultStatut.estPresent ? enregistrerSortie(matricule) : enregistrerEntree(matricule);
          }
          return createCorsResponse(defaultResult);
        }

        return createCorsResponse({
          success: false,
          message: 'Action inconnue.',
          actions: ['ping', 'ajouter', 'statut', 'entree', 'sortie', 'scan', 'stats', 'rapport']
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

function normalizeText(value) {
  return String(value == null ? '' : value).trim().replace(/\s+/g, ' ');
}

function formatCellDate(cell) {
  if (cell == null || cell === '') return '';
  try {
    if (Object.prototype.toString.call(cell) === '[object Date]') {
      return Utilities.formatDate(cell, CONFIG.TIMEZONE, 'dd/MM/yyyy');
    }
  } catch (e) {}
  return String(cell).trim();
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
// OBTENIR LES FEUILLES
// ============================================
function getSheet() {
  try {
    var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    var sheet = ss.getSheetByName(CONFIG.EMPLOYEE_SHEET_NAME);
    if (!sheet) {
      sheet = ss.getActiveSheet();
    }
    return sheet;
  } catch (error) {
    console.error('Erreur getSheet:', error);
    throw error;
  }
}

function getEmployeeSheet() {
  var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  var sheet = ss.getSheetByName(CONFIG.EMPLOYEE_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.EMPLOYEE_SHEET_NAME);
    sheet.appendRow(['Matricule', 'Nom et Prénoms', 'Fonction', 'Code QR']);
  }
  return sheet;
}

function getPresenceSheet() {
  var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  var sheet = ss.getSheetByName(CONFIG.PRESENCE_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.PRESENCE_SHEET_NAME);
    sheet.appendRow(['Matricule', 'Date d\'entrée', 'Heure d\'entrée', 'Date de sortie', 'Heure de sortie']);
  }
  return sheet;
}

function getEmployeeByMatricule(matricule) {
  var found = findEmployeeRow(matricule);
  if (!found) return null;
  return {
    matricule: found.row[0],
    nom: found.row[1] || '',
    fonction: found.row[2] || '',
    codeQr: found.row[3] || ''
  };
}

// ============================================
// VÉRIFIER LE STATUT D'UN EMPLOYÉ
// ============================================
function verifierStatut(matricule) {
  try {
    if (!matricule) {
      return null;
    }

    var employee = findEmployeeRow(matricule);
    if (!employee) return null;

    var sheet = getPresenceSheet();
    var data = sheet.getDataRange().getValues();
    var today = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'dd/MM/yyyy');
    var normalizedMatricule = normalizeText(matricule);
    var foundRow = null;
    var foundIndex = -1;

    for (var i = data.length - 1; i >= 1; i--) {
      var row = data[i];
      if (normalizeText(row[0]) !== normalizedMatricule) continue;
      var rowDateEntree = formatCellDate(row[1]);
      var rowDateSortie = formatCellDate(row[3]);
      console.log('verifierStatut: checking row', i + 1, 'matricule=', row[0], 'dateEntree=', rowDateEntree, 'dateSortie=', rowDateSortie);
      if (rowDateEntree === today && (rowDateSortie === '' || rowDateSortie == null)) {
        foundRow = row;
        foundIndex = i;
        break;
      }
    }

    if (!foundRow) {
      // Try to find any row for today to return useful info (e.g., sortie already enregistrée)
      var anyRow = null;
      var anyIndex = -1;
      for (var j = data.length - 1; j >= 1; j--) {
        var r = data[j];
        if (normalizeText(r[0]) !== normalizedMatricule) continue;
        if (formatCellDate(r[1]) === today) {
          anyRow = r;
          anyIndex = j;
          break;
        }
      }

      return {
        matricule: employee.row[0],
        nom: employee.row[1] || '',
        fonction: employee.row[2] || '',
        codeQr: employee.row[3] || '',
        estPresent: false,
        dateEntree: anyRow ? (anyRow[1] || '') : '',
        heureEntree: anyRow ? (anyRow[2] || '') : '',
        dateSortie: anyRow ? (anyRow[3] || '') : '',
        heureSortie: anyRow ? (anyRow[4] || '') : '',
        ligne: anyIndex !== -1 ? (anyIndex + 1) : 0
      };
    }

    return {
      matricule: employee.row[0],
      nom: employee.row[1] || '',
      fonction: employee.row[2] || '',
      codeQr: employee.row[3] || '',
      estPresent: true,
      dateEntree: foundRow[1] || '',
      heureEntree: foundRow[2] || '',
      dateSortie: foundRow[3] || '',
      heureSortie: foundRow[4] || '',
      ligne: foundIndex !== -1 ? (foundIndex + 1) : 0
    };
  } catch (error) {
    console.error('Erreur verifierStatut:', error);
    return null;
  }
}

// ============================================
// ENREGISTRER L'ENTRÉE
// ============================================
function appendPresenceRow(employeeRow, dateStr, heureStr) {
  var sheet = getPresenceSheet();
  sheet.appendRow([
    employeeRow[0],
    dateStr,
    heureStr,
    '',
    ''
  ]);
  return true;
}

function enregistrerEntree(matricule) {
  try {
    if (!matricule) {
      return { success: false, message: 'Matricule manquant' };
    }

    var employee = findEmployeeRow(matricule);
    if (!employee) {
      return { success: false, message: '❌ Matricule non trouvé dans la base Employe' };
    }

    var sheet = getPresenceSheet();
    var data = sheet.getDataRange().getValues();
    var today = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'dd/MM/yyyy');
    var normalizedMatricule = normalizeText(matricule);

    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (normalizeText(row[0]) === normalizedMatricule && formatCellDate(row[1]) === today && (formatCellDate(row[3]) === '' || formatCellDate(row[3]) == null)) {
        return {
          success: false,
          message: '⚠️ ' + (employee.row[1] || '') + ' a déjà fait l\'entrée aujourd\'hui',
          matricule: employee.row[0],
          nom: employee.row[1] || ''
        };
      }
    }

    var now = new Date();
    var dateStr = Utilities.formatDate(now, CONFIG.TIMEZONE, 'dd/MM/yyyy');
    var heureStr = Utilities.formatDate(now, CONFIG.TIMEZONE, 'HH:mm:ss');

    appendPresenceRow(employee.row, dateStr, heureStr);

    return {
      success: true,
      message: '✅ Entrée enregistrée',
      matricule: employee.row[0],
      nom: employee.row[1] || '',
      fonction: employee.row[2] || '',
      date: dateStr,
      heure: heureStr
    };
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
      return { success: false, message: 'Matricule manquant' };
    }

    var employee = findEmployeeRow(matricule);
    if (!employee) {
      return { success: false, message: '❌ Matricule non trouvé dans la base Employe' };
    }

    var sheet = getPresenceSheet();
    var data = sheet.getDataRange().getValues();
    var today = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'dd/MM/yyyy');
    var normalizedMatricule = normalizeText(matricule);
    var targetRowIndex = -1;

    for (var i = data.length - 1; i >= 1; i--) {
      var row = data[i];
      if (normalizeText(row[0]) === normalizedMatricule && formatCellDate(row[1]) === today && (formatCellDate(row[3]) === '' || formatCellDate(row[3]) == null)) {
        targetRowIndex = i + 1;
        break;
      }
    }

    if (targetRowIndex === -1) {
      // Try to find any row for today to provide a clearer message
      var anyIdx = -1;
      for (var k = data.length - 1; k >= 1; k--) {
        var rr = data[k];
        if (normalizeText(rr[0]) !== normalizedMatricule) continue;
        if (formatCellDate(rr[1]) === today) {
          anyIdx = k;
          break;
        }
      }

      if (anyIdx !== -1) {
        var anyRow = data[anyIdx];
        var sortieVal = formatCellDate(anyRow[3]);
        if (sortieVal && sortieVal !== '') {
          return {
            success: false,
            message: '⚠️ ' + (employee.row[1] || '') + " a déjà validé la sortie aujourd'hui (" + sortieVal + ")",
            matricule: employee.row[0],
            nom: employee.row[1] || ''
          };
        }
        // If entry exists but loop didn't find it due to format issues, still indicate entry exists
        return {
          success: false,
          message: '⚠️ ' + (employee.row[1] || '') + " a une entrée aujourd'hui mais la ligne n'a pas pu être mise à jour automatiquement.",
          matricule: employee.row[0],
          nom: employee.row[1] || ''
        };
      }

      return {
        success: false,
        message: '⚠️ ' + (employee.row[1] || '') + " n'a pas encore validé l'entrée aujourd'hui",
        matricule: employee.row[0],
        nom: employee.row[1] || ''
      };
    }

    var now = new Date();
    var dateStr = Utilities.formatDate(now, CONFIG.TIMEZONE, 'dd/MM/yyyy');
    var heureStr = Utilities.formatDate(now, CONFIG.TIMEZONE, 'HH:mm:ss');

    sheet.getRange(targetRowIndex, 4).setValue(dateStr);
    sheet.getRange(targetRowIndex, 5).setValue(heureStr);

    return {
      success: true,
      message: '✅ Sortie enregistrée',
      matricule: employee.row[0],
      nom: employee.row[1] || '',
      fonction: employee.row[2] || '',
      date: dateStr,
      heure: heureStr
    };
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
    var employeeSheet = getEmployeeSheet();
    var employeeData = employeeSheet.getDataRange().getValues();
    var total = 0;

    for (var i = 1; i < employeeData.length; i++) {
      if (employeeData[i][0] && employeeData[i][0] !== '') total++;
    }

    var presenceSheet = getPresenceSheet();
    var presenceData = presenceSheet.getDataRange().getValues();
    var present = 0;
    var seen = {};
    var today = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'dd/MM/yyyy');

    for (var j = 1; j < presenceData.length; j++) {
      var row = presenceData[j];
      var matricule = String(row[0] || '').trim();
      var dateEntree = String(row[1] || '').trim();
      var dateSortie = String(row[3] || '').trim();

      if (!matricule || dateEntree !== today || dateSortie !== '') continue;
      if (!seen[matricule]) {
        seen[matricule] = true;
        present++;
      }
    }

    return {
      total: total,
      present: present,
      absent: total - present,
      aujourdhui: today
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
    var sheet = getPresenceSheet();
    var data = sheet.getDataRange().getValues();
    var rapport = [];
    var aujourdhui = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'dd/MM/yyyy');

    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      var matricule = String(row[0] || '').trim();
      var dateEntree = String(row[1] || '').trim();
      var dateSortie = String(row[3] || '').trim();

      if (!matricule) continue;
      if (dateEntree === aujourdhui || dateSortie === aujourdhui) {
        var employee = getEmployeeByMatricule(matricule) || { nom: '', fonction: '' };
        rapport.push({
          matricule: matricule,
          nom: employee.nom || '',
          fonction: employee.fonction || '',
          entre: dateEntree === aujourdhui ? row[2] || '' : '',
          sortie: dateSortie === aujourdhui ? row[4] || '' : '',
          present: (dateEntree === aujourdhui && dateSortie === '')
        });
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
    var target = normalizeText(key);
    var targetLower = target.toLowerCase();

    for (var i = 0; i < data.length; i++) {
      var row = data[i];
      var matricule = row[0] ? normalizeText(row[0]) : '';
      var codeQr = row[3] ? normalizeText(row[3]) : '';

      if (matricule.toLowerCase() === targetLower || codeQr.toLowerCase() === targetLower) {
        return { row: row, index: i };
      }
    }
    return null;
  } catch (e) {
    console.error('Erreur findEmployeeRow:', e);
    return null;
  }
}

function ajouterEmploye(matricule, nom, fonction, codeQr) {
  try {
    matricule = String(matricule || '').trim();
    nom = String(nom || '').trim();
    fonction = String(fonction || '').trim();
    codeQr = String(codeQr || '-').trim();
    var codeQrValide = (codeQr && codeQr !== '-') ? codeQr : '';

    if (!matricule || !nom || !fonction) {
      return { success: false, message: 'Matricule, nom et fonction sont obligatoires.' };
    }

    var existeMatricule = !!findEmployeeRow(matricule);
    var existeCodeQr = !!(codeQrValide && findEmployeeRow(codeQrValide));

    if (existeMatricule || existeCodeQr) {
      return { success: false, message: '⚠️ Ce collaborateur existe déjà dans la base.' };
    }

    var now = new Date();
    var dateCreation = Utilities.formatDate(now, CONFIG.TIMEZONE, 'dd/MM/yyyy');
    var heureCreation = Utilities.formatDate(now, CONFIG.TIMEZONE, 'HH:mm:ss');

    var sheet = getSheet();
    sheet.appendRow([
      matricule,
      nom,
      fonction,
      codeQr,
      '',
      '',
      '',
      ''
    ]);

    return {
      success: true,
      message: '✅ Collaborateur ajouté avec succès',
      matricule: matricule,
      nom: nom,
      fonction: fonction,
      codeQr: codeQr,
      date: dateCreation,
      heure: heureCreation
    };
  } catch (error) {
    console.error('Erreur ajouterEmploye:', error);
    return {
      success: false,
      message: 'Erreur: ' + error.toString()
    };
  }
}