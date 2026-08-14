// Frontend pour API Apps Script uniquement.
;(function(){
    var scanner = null;
    var isScanning = false;
    var selectedMode = 'entree';
    var API_URL = (typeof window !== 'undefined' && window.API_URL) || 'https://script.google.com/macros/s/AKfycbxaZ_I39i8Wwdf56P-hriJF1J3d3gAiWrjRf1MCRmMt6eSwDVRJKkIocmwqR-7rwrYg/exec';
    var useBackend = (typeof google !== 'undefined' && google && google.script && google.script.run);

    function setMode(mode) {
        selectedMode = (mode === 'sortie') ? 'sortie' : 'entree';
        var buttons = document.querySelectorAll('.mode-btn');
        buttons.forEach(function(btn){
            btn.classList.toggle('active', btn.getAttribute('data-mode') === selectedMode);
        });
    }

    function getModeLabel() {
        return selectedMode === 'sortie' ? 'Sortie' : 'Entrée';
    }

    function verifierPermissionsCamera(){
        if (!navigator.permissions) return;
        navigator.permissions.query({name:'camera'}).then(function(r){
            if (r.state === 'denied') {
                var info = document.getElementById('permission-info');
                if (info) info.style.display = 'block';
            }
        }).catch(function(){});
    }

    function demarrerScanner(){
        if (typeof Html5QrcodeScanner === 'undefined') {
            document.getElementById('reader').innerHTML = '<div style="padding:20px;color:#ef4444;text-align:center;">Bibliothèque QR introuvable</div>';
            return;
        }
        if (scanner) {
            try { scanner.clear(); } catch(e) {}
            scanner = null;
        }
        document.getElementById('result').innerHTML = '';
        document.getElementById('btn-redemarrer').style.display = 'none';
        try {
            scanner = new Html5QrcodeScanner('reader', { qrbox: { width: 250, height: 250 }, fps: 20 });
            scanner.render(onScanSuccess, onScanError);
            isScanning = true;
        } catch (e) {
            document.getElementById('reader').innerHTML = '<div style="padding:20px;color:#ef4444;text-align:center;">Erreur démarrage scanner</div>';
        }
    }

    function onScanSuccess(decodedText){
        if (!isScanning) return;
        if (scanner) {
            try { scanner.clear(); } catch(e) {}
            scanner = null;
            isScanning = false;
        }
        document.getElementById('btn-redemarrer').style.display = 'block';

        var matricule = (decodedText || '').toString().split('|')[0].trim() || (decodedText || '').toString().trim();
        document.getElementById('result').innerHTML = '<div class="result-card" style="background: rgba(34,197,94,0.08); border-color: rgba(34,197,94,0.4);"><div class="result-header"><span id="result-icon">📷</span><h2 id="result-title" style="color:#166534;">QR détecté</h2></div><div style="color:#166534; font-weight:700;">' + matricule + '</div></div>';
        processDecodedText(matricule);
    }

    function onScanError(err){
        try {
            var s = String(err || '');
            if (s.indexOf('QR code parse error') !== -1 || s.indexOf('No MultiFormat Readers were able') !== -1) return;
        } catch (e) {}
        console.debug('scan err', err);
    }

    function processDecodedText(matricule){
        if (!matricule) {
            afficherErreur('Veuillez saisir un matricule ou scanner un QR valide.');
            return;
        }

        document.getElementById('result').innerHTML = '<div class="result-card"><div class="result-header"><span id="result-icon">⏳</span><h2 id="result-title" style="color:#1d4ed8;">Vérification...</h2></div><div style="color:#1d4ed8; font-weight:600;">Mode : ' + getModeLabel() + '</div></div>';

        if (useBackend) {
            google.script.run
                .withSuccessHandler(function(statut){
                    if (!statut) {
                        afficherErreur('❌ Matricule non trouvé dans la base');
                        return;
                    }

                    if (selectedMode === 'entree') {
                        if (statut.estPresent) {
                            afficherErreur('⚠️ Cette personne a déjà fait l\'entrée aujourd\'hui');
                        } else {
                            enregistrerEntreeBackend(matricule);
                        }
                        return;
                    }

                    // For 'sortie' mode: always attempt to record sortie (even if no entry exists)
                    enregistrerSortieBackend(matricule);
                })
                .withFailureHandler(function(error){ afficherErreur('Erreur: ' + (error.message || error)); })
                .verifierStatut(matricule);
            return;
        }

        if (API_URL && API_URL.indexOf('REMPLACE_PAR_VOTRE_URL') === -1) {
            // First fetch status to mirror google.script.run behavior and provide clearer messages
            callApi('statut', matricule, function(statusResp){
                var statut = (statusResp && statusResp.success && statusResp.data) ? statusResp.data : (statusResp || {});
                if (!statut || !statut.matricule) {
                    afficherErreur('❌ Matricule non trouvé dans la base');
                    return;
                }

                    if (selectedMode === 'entree') {
                        if (statut.estPresent) {
                            afficherErreur('⚠️ Cette personne a déjà fait l\'entrée aujourd\'hui');
                        } else {
                            callApi('entree', matricule, function(response){ handleResult(response, 'entrée'); }, function(err){ afficherErreur('Erreur API: ' + (err && err.message ? err.message : 'Impossible de contacter le backend')); });
                        }
                        return;
                    }

                    // For 'sortie' mode: allow registering sortie even if no entry exists today
                    callApi('sortie', matricule, function(response){ handleResult(response, 'sortie'); }, function(err){ afficherErreur('Erreur API: ' + (err && err.message ? err.message : 'Impossible de contacter le backend')); });
            }, function(error){
                afficherErreur('Erreur API: ' + (error && error.message ? error.message : 'Impossible de contacter le backend'));
            });
            return;
        }

        afficherErreur('Configurez l\'URL de l\'API Apps Script dans window.API_URL.');
    }

    function ajouterCollaborateur(){
        var matricule = document.getElementById('matricule-nouveau').value.trim();
        var nom = document.getElementById('nom-nouveau').value.trim();
        var fonction = document.getElementById('fonction-nouveau').value.trim();
        var codeQr = document.getElementById('codeqr-nouveau').value.trim();

        if (!matricule || !nom || !fonction) {
            afficherErreur('Veuillez remplir au minimum : matricule, nom et fonction.');
            return;
        }

        var payload = {
            matricule: matricule,
            nom: nom,
            fonction: fonction,
            codeQr: codeQr || '-'
        };

        if (useBackend) {
            google.script.run
                .withSuccessHandler(function(result){
                    if (result && result.success) {
                        afficherSucces(result, 'ajout');
                        document.getElementById('matricule-nouveau').value = '';
                        document.getElementById('nom-nouveau').value = '';
                        document.getElementById('fonction-nouveau').value = '';
                        document.getElementById('codeqr-nouveau').value = '';
                        chargerStatistiques();
                        chargerRapport();
                    } else {
                        afficherErreur(result && result.message ? result.message : 'Impossible d\'ajouter le collaborateur.');
                    }
                })
                .withFailureHandler(function(error){ afficherErreur('Erreur: ' + (error.message || error)); })
                .ajouterEmploye(payload.matricule, payload.nom, payload.fonction, payload.codeQr);
            return;
        }

        if (API_URL && API_URL.indexOf('REMPLACE_PAR_VOTRE_URL') === -1) {
            fetch(API_URL + '?action=ajouter&matricule=' + encodeURIComponent(payload.matricule) + '&nom=' + encodeURIComponent(payload.nom) + '&fonction=' + encodeURIComponent(payload.fonction) + '&codeQr=' + encodeURIComponent(payload.codeQr), {
                method: 'GET',
                headers: { 'Accept': 'application/json' }
            })
            .then(function(response) {
                if (!response.ok) throw new Error('HTTP ' + response.status);
                return response.json();
            })
            .then(function(result) {
                if (result && result.success) {
                    afficherSucces(result, 'ajout');
                    document.getElementById('matricule-nouveau').value = '';
                    document.getElementById('nom-nouveau').value = '';
                    document.getElementById('fonction-nouveau').value = '';
                    document.getElementById('codeqr-nouveau').value = '';
                    chargerStatistiques();
                    chargerRapport();
                } else {
                    afficherErreur((result && result.message) ? result.message : 'Impossible d\'ajouter le collaborateur.');
                }
            })
            .catch(function(error){
                afficherErreur('Erreur API: ' + (error && error.message ? error.message : 'Impossible de contacter le backend'));
            });
            return;
        }

        afficherErreur('Configurez l\'URL de l\'API Apps Script dans window.API_URL.');
    }

    function callApi(action, matricule, onSuccess, onError) {
        var url = API_URL;
        if (!url || url.indexOf('REMPLACE_PAR_VOTRE_URL') !== -1) {
            if (onError) onError({ message: 'Configurez API_URL avec l\'URL de déploiement de votre Apps Script.' });
            return;
        }

        var finalUrl = url + '?action=' + encodeURIComponent(action) + '&mode=' + encodeURIComponent(selectedMode) + '&matricule=' + encodeURIComponent(matricule);
        fetch(finalUrl, {
            method: 'GET',
            headers: { 'Accept': 'application/json' }
        })
        .then(function(response) {
            if (!response.ok) {
                throw new Error('HTTP ' + response.status);
            }
            return response.json();
        })
        .then(function(data) {
            if (onSuccess) onSuccess(data || {});
        })
        .catch(function(error) {
            if (onError) onError(error);
        });
    }

    function enregistrerEntreeBackend(matricule) {
        google.script.run
            .withSuccessHandler(function(result){ handleResult(result, 'entrée'); })
            .withFailureHandler(function(error){ afficherErreur('Erreur: ' + (error.message || error)); })
            .enregistrerEntree(matricule);
    }

    function enregistrerSortieBackend(matricule) {
        google.script.run
            .withSuccessHandler(function(result){ handleResult(result, 'sortie'); })
            .withFailureHandler(function(error){ afficherErreur('Erreur: ' + (error.message || error)); })
            .enregistrerSortie(matricule);
    }

    function handleResult(result, type){
        if (result && result.success) {
            afficherSucces(result, type);
            chargerRapport();
            chargerStatistiques();
        } else {
            afficherErreur((result && result.message) ? result.message : 'Erreur inconnue');
        }

        setTimeout(function(){
            if (!isScanning && document.getElementById('btn-redemarrer') && document.getElementById('btn-redemarrer').style.display === 'none') {
                redemarrerScanner();
            }
        }, 1800);
    }

    function afficherSucces(result, type){
        var icon = type === 'entrée' ? '✅' : type === 'sortie' ? '🚪' : '👤';
        var title = type === 'entrée' ? 'Entrée enregistrée' : type === 'sortie' ? 'Sortie enregistrée' : 'Collaborateur ajouté';
        var color = type === 'entrée' ? '#166534' : type === 'sortie' ? '#991b1b' : '#1d4ed8';
        document.getElementById('result').innerHTML = '<div class="result-card"><div class="result-header"><span id="result-icon">' + icon + '</span><h2 id="result-title" style="color:' + color + ';">' + title + '</h2></div><div id="result-content"><div class="info-item"><span class="label">Matricule:</span><span class="value">' + (result.matricule || '') + '</span></div><div class="info-item"><span class="label">Nom:</span><span class="value">' + (result.nom || '') + '</span></div><div class="info-item"><span class="label">Date:</span><span class="value">' + (result.date || '') + '</span></div><div class="info-item"><span class="label">Heure:</span><span class="value">' + (result.heure || '') + '</span></div></div></div>';
        afficherToast(result.message || title, 'success');
    }

    function afficherErreur(message){
        var clean = String(message || 'Erreur');
        document.getElementById('result').innerHTML = '<div class="result-card" style="border:1px solid rgba(239,68,68,0.5); background: rgba(254,242,242,0.92);"><div class="result-header"><span style="font-size:36px">❌</span><h2 style="color:#991b1b; font-size:22px;">Erreur</h2></div><div style="color:#991b1b; text-align:center; padding:10px; font-weight:600;">' + clean + '</div></div>';
        afficherToast(clean, 'error');
    }

    function afficherToast(message,type){
        var toast = document.createElement('div');
        toast.className = 'toast toast-' + type;
        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(function(){
            if (toast.parentNode) toast.parentNode.removeChild(toast);
        }, 3200);
    }

    function chargerStatistiques(){
        if (!API_URL || API_URL.indexOf('REMPLACE_PAR_VOTRE_URL') !== -1) {
            document.getElementById('total-employes').textContent = '0';
            document.getElementById('present-aujourdhui').textContent = '0';
            document.getElementById('absent-aujourdhui').textContent = '0';
            document.getElementById('rapport-jour').innerHTML = '<p style="color: rgba(255,255,255,0.75); text-align:center;">Configurez l\'URL Apps Script.</p>';
            return;
        }

        fetch(API_URL + '?action=stats', {
            method: 'GET',
            headers: { 'Accept': 'application/json' }
        })
        .then(function(response) {
            if (!response.ok) throw new Error('HTTP ' + response.status);
            return response.json();
        })
        .then(function(stats) {
            if (!stats || stats.total === undefined) {
                throw new Error('Statistiques non disponibles');
            }
            document.getElementById('total-employes').textContent = stats.total;
            document.getElementById('present-aujourdhui').textContent = stats.present;
            document.getElementById('absent-aujourdhui').textContent = stats.absent;
            document.getElementById('present-aujourdhui').className = 'stat-number present';
            document.getElementById('absent-aujourdhui').className = 'stat-number absent';
        })
        .catch(function() {
            document.getElementById('total-employes').textContent = '0';
            document.getElementById('present-aujourdhui').textContent = '0';
            document.getElementById('absent-aujourdhui').textContent = '0';
        });
    }

    function chargerRapport(){
        if (!API_URL || API_URL.indexOf('REMPLACE_PAR_VOTRE_URL') !== -1) {
            var container = document.getElementById('rapport-jour');
            container.innerHTML = '<p style="color: rgba(255,255,255,0.75); text-align:center;">Aucune donnée. Configurez l\'URL Apps Script.</p>';
            return;
        }

        fetch(API_URL + '?action=rapport', {
            method: 'GET',
            headers: { 'Accept': 'application/json' }
        })
        .then(function(response) {
            if (!response.ok) throw new Error('HTTP ' + response.status);
            return response.json();
        })
        .then(function(result) {
            var rapport = result && result.data ? result.data : result;
            var container = document.getElementById('rapport-jour');
            if (!rapport || rapport.length === 0) {
                container.innerHTML = '<p style="color: rgba(255,255,255,0.75); text-align:center;">Aucune activité aujourd\'hui</p>';
                return;
            }

            var html = '';
            for (var i = 0; i < rapport.length; i++) {
                var r = rapport[i];
                var statut = r.present ? '✅ Présent' : '🚪 Sorti';
                var heure = r.entre || r.sortie || '';
                var statutClass = r.present ? 'statut-present' : 'statut-absent';
                html += '<div class="rapport-item"><div><span class="nom">' + (r.nom || '') + '</span><span class="' + statutClass + '">' + statut + '</span></div><div class="heure">' + heure + '</div></div>';
            }
            container.innerHTML = html;
        })
        .catch(function() {
            var container = document.getElementById('rapport-jour');
            container.innerHTML = '<p style="color: rgba(255,255,255,0.75); text-align:center;">Aucune activité aujourd\'hui</p>';
        });
    }

    window.redemarrerScanner = function(){
        document.getElementById('result').innerHTML = '';
        document.getElementById('btn-redemarrer').style.display = 'none';
        if (scanner) {
            try { scanner.clear(); } catch(e) {}
            scanner = null;
        }
        setTimeout(demarrerScanner, 300);
    };

    window.onload = function(){
        setMode('entree');
        document.querySelectorAll('.mode-btn').forEach(function(btn){
            btn.addEventListener('click', function(){ setMode(btn.getAttribute('data-mode')); });
        });

        var addBtn = document.getElementById('btn-ajouter-employe');
        if (addBtn) {
            addBtn.addEventListener('click', ajouterCollaborateur);
        }

        chargerStatistiques();
        chargerRapport();
        verifierPermissionsCamera();

        if (document.getElementById('reader')) {
            demarrerScanner();
        }
    };

    window.onbeforeunload = function(){
        if (scanner) {
            try { scanner.clear(); } catch(e) {}
            scanner = null;
        }
    };
})();

