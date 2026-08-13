// Frontend pour API Apps Script uniquement.
;(function(){
	var scanner = null;
	var scannerActif = false;
	var isScanning = false;

	var API_URL = (typeof window !== 'undefined' && window.API_URL) || 'https://script.google.com/macros/s/AKfycbxZJO9eReVbPkHnkBBL6W8_M5CbJBsZk-EORaDjAGC6FrocTxr_rw1RC7Ea12nk1UIy/exec';

	function nowDate() {
		var d = new Date();
		return d.toLocaleDateString('fr-FR');
	}

	function nowTime() {
		var d = new Date();
		return d.toLocaleTimeString('fr-FR');
	}

	// Permissions camera
	function verifierPermissionsCamera(){ if (!navigator.permissions) return; navigator.permissions.query({name:'camera'}).then(function(r){ if (r.state==='denied') document.getElementById('permission-info').style.display='block'; }).catch(()=>{}); }

	// Détecter si Apps Script backend est disponible
	var useBackend = (typeof google !== 'undefined' && google && google.script && google.script.run);

	// Scanner init
	function demarrerScanner(){
		if (typeof Html5QrcodeScanner === 'undefined') {
			document.getElementById('reader').innerHTML = '<div style="padding:20px;color:#ef4444">Bibliothèque QR introuvable</div>';
			return;
		}
		if (scanner){ try { scanner.clear(); } catch(e){} scanner=null; }
		document.getElementById('result').innerHTML=''; document.getElementById('btn-redemarrer').style.display='none';
		try {
			scanner = new Html5QrcodeScanner('reader',{ qrbox:{width:250,height:250}, fps:20 });
			scanner.render(onScanSuccess, onScanError); scannerActif=true; isScanning=true;
		} catch(e){ document.getElementById('reader').innerHTML = '<div style="padding:20px;color:#ef4444">Erreur démarrage scanner</div>'; }
	}

	function onScanSuccess(decodedText){ if (!isScanning) return; if (scanner){ try{scanner.clear()}catch(e){} scannerActif=false; isScanning=false; document.getElementById('btn-redemarrer').style.display='block'; }
		var matricule = decodedText.split('|')[0]||decodedText;
		document.getElementById('result').innerHTML = '<div style="background:#d1fae5;padding:15px;border-radius:8px;color:#065f46">✅ QR Code détecté: <strong>'+matricule+'</strong></div>';
		processDecodedText(matricule);
	}

	function onScanError(err){
		// html5-qrcode envoie beaucoup d'erreurs mineures (QR code parse error). On ignore les erreurs parse pour éviter le spam.
		try {
			var s = String(err || '');
			if (s.indexOf('QR code parse error') !== -1 || s.indexOf('No MultiFormat Readers were able') !== -1) return;
		} catch(e) {}
		console.debug('scan err',err);
	}

	window.redemarrerScanner = function(){ document.getElementById('result').innerHTML=''; document.getElementById('btn-redemarrer').style.display='none'; if (scanner){ try{scanner.clear()}catch(e){} scanner=null;} setTimeout(demarrerScanner,500); };

	window.entrerManuellement = function(){ var input = document.getElementById('matricule-manuel'); var matricule = input.value.trim(); if (!matricule){ afficherToast('Veuillez entrer un matricule','error'); input.focus(); return; } if (scanner){ try{scanner.clear()}catch(e){} isScanning=false;} document.getElementById('result').innerHTML=''; processDecodedText(matricule); input.value=''; };

	function processDecodedText(matricule){ document.getElementById('result').innerHTML='<div style="text-align:center;padding:20px">⏳ Vérification du matricule...</div>';
		if (useBackend) {
			google.script.run
				.withSuccessHandler(function(statut){
					if (statut) {
						if (statut.estPresent) {
							enregistrerSortieBackend(matricule);
						} else {
							enregistrerEntreeBackend(matricule);
						}
					} else {
						afficherErreur('❌ Matricule non trouvé dans la base');
					}
				})
				.withFailureHandler(function(error){ afficherErreur('Erreur: ' + (error.message || error)); })
				.verifierStatut(matricule);
			return;
		}

		if (API_URL && API_URL.indexOf('REMPLACE_PAR_VOTRE_URL') === -1) {
			callApi('scan', matricule, function(response){
				if (response && response.success) {
					handleResult(response, (response.message && response.message.indexOf('Sortie') !== -1) ? 'sortie' : 'entrée');
				} else {
					afficherErreur((response && response.message) ? response.message : '❌ Matricule non trouvé dans la base');
				}
			}, function(error){
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

		var finalUrl = url + '?action=' + encodeURIComponent(action) + '&matricule=' + encodeURIComponent(matricule);
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

	// Backend calls (Apps Script) wrappers
	function enregistrerEntreeBackend(matricule) {
		google.script.run
			.withSuccessHandler(function(result){ handleResult(result,'entrée'); })
			.withFailureHandler(function(error){ afficherErreur('Erreur: ' + (error.message || error)); })
			.enregistrerEntree(matricule);
	}

	function enregistrerSortieBackend(matricule) {
		google.script.run
			.withSuccessHandler(function(result){ handleResult(result,'sortie'); })
			.withFailureHandler(function(error){ afficherErreur('Erreur: ' + (error.message || error)); })
			.enregistrerSortie(matricule);
	}

	function handleResult(result,type){ if (result.success){ afficherSucces(result,type); chargerRapport(); chargerStatistiques(); } else { afficherErreur(result.message); } setTimeout(function(){ if (!isScanning && document.getElementById('btn-redemarrer').style.display==='none') redemarrerScanner(); },2000); }

	function afficherSucces(result,type){ var icon = type==='entrée'?'✅':'🚪'; var title = type==='entrée'?'Entrée enregistrée !':'Sortie enregistrée !'; var color = type==='entrée'?'#10b981':'#ef4444'; document.getElementById('result').innerHTML = '<div class="result-card"><div class="result-header"><span id="result-icon">'+icon+'</span><h2 id="result-title" style="color:'+color+'">'+title+'</h2></div><div id="result-content"><div class="info-item"><span class="label">Matricule:</span><span class="value">'+result.matricule+'</span></div><div class="info-item"><span class="label">Nom:</span><span class="value">'+result.nom+'</span></div><div class="info-item"><span class="label">Date:</span><span class="value">'+result.date+'</span></div><div class="info-item"><span class="label">Heure:</span><span class="value">'+result.heure+'</span></div></div></div>'; afficherToast(result.message,'success'); }

	function afficherErreur(message){ document.getElementById('result').innerHTML = '<div class="result-card" style="border-color:#ef4444"><div class="result-header"><span style="font-size:40px">❌</span><h2 style="color:#ef4444;font-size:22px">Erreur</h2></div><div style="color:#ef4444;text-align:center;padding:10px">'+message+'</div></div>'; afficherToast(message,'error'); }

	function chargerStatistiques(){
		if (!API_URL || API_URL.indexOf('REMPLACE_PAR_VOTRE_URL') !== -1) {
			document.getElementById('total-employes').textContent = '0';
			document.getElementById('present-aujourdhui').textContent = '0';
			document.getElementById('absent-aujourdhui').textContent = '0';
			document.getElementById('rapport-jour').innerHTML = '<p style="color:#666;text-align:center;">Configurez l\'URL Apps Script</p>';
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
			container.innerHTML = '<p style="color:#666;text-align:center;">Aucune donnée. Configurez l\'URL Apps Script.</p>';
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
				container.innerHTML = '<p style="color:#666;text-align:center;">Aucune activité aujourd\'hui</p>';
				return;
			}
			var html = '';
			for (var i = 0; i < rapport.length; i++) {
				var r = rapport[i];
				var statut = r.present ? '✅ Présent' : '❌ Sorti';
				var heure = r.entre || r.sortie || '';
				var statutClass = r.present ? 'statut-present' : 'statut-absent';
				html += '<div class="rapport-item"><div><span class="nom">' + r.nom + '</span><span class="' + statutClass + '">' + statut + '</span></div><div class="heure">' + heure + '</div></div>';
			}
			container.innerHTML = html;
		})
		.catch(function() {
			var container = document.getElementById('rapport-jour');
			container.innerHTML = '<p style="color:#666;text-align:center;">Aucune activité aujourd\'hui</p>';
		});
	}

	function afficherToast(message,type){ var toast = document.createElement('div'); toast.className='toast toast-'+type; toast.textContent = message; document.body.appendChild(toast); setTimeout(function(){ if (toast.parentNode) toast.remove(); },3000); }

	// Init
	window.onload = function(){
		chargerStatistiques();
		chargerRapport();
		verifierPermissionsCamera();
		document.getElementById('matricule-manuel').addEventListener('keypress', function(e){ if (e.key==='Enter') entrerManuellement(); });
		if (document.getElementById('reader')) {
			demarrerScanner();
		}
	};

	window.onbeforeunload = function(){ if (scanner){ try{scanner.clear()}catch(e){} scanner=null; } };

})();

