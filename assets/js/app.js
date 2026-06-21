/* =====================================================================
   LMNP Compta — moteur (v2)
   Multi-exercices avec report (déficits 10 ans, amortissements différés
   art. 39 C) + génération de la liasse fiscale (tableaux 2033).
   Aucune dépendance externe. Données persistées dans localStorage.
   ===================================================================== */

(() => {
  'use strict';

  /* ---------- Plan comptable (simplifié, location meublée) ---------- */
  const COMPTE_LOYERS = { num: '706000', lib: 'Loyers — locations meublées' };

  const CATEGORIES_CHARGES = [
    { compte: '606100', lib: 'Eau, énergie, fournitures' },
    { compte: '606300', lib: 'Petit équipement / petit mobilier' },
    { compte: '613200', lib: 'Charges de copropriété' },
    { compte: '615000', lib: 'Entretien et réparations' },
    { compte: '616100', lib: 'Assurances (PNO, GLI)' },
    { compte: '622000', lib: 'Honoraires & frais de gestion' },
    { compte: '622600', lib: 'Honoraires comptables' },
    { compte: '627000', lib: 'Frais et commissions bancaires' },
    { compte: '635100', lib: 'Taxe foncière' },
    { compte: '635400', lib: 'Cotisation foncière (CFE)' },
    { compte: '661100', lib: "Intérêts d'emprunt" },
    { compte: '616000', lib: 'Autres charges déductibles' },
  ];

  const COMPTE_DOTATION = { num: '681100', lib: 'Dotations aux amortissements' };

  const IMMO = {
    immeuble: { brut: '213000', lib: 'Constructions', amort: '281300', terrain: '211000', terrainLib: 'Terrains' },
    mobilier: { brut: '218400', lib: 'Mobilier', amort: '281840' },
    travaux:  { brut: '213500', lib: 'Installations & agencements', amort: '281350' },
  };
  const C_CAPITAL  = { num: '101000', lib: 'Capital / apport' };
  const C_REPORT   = { num: '110000', lib: 'Report à nouveau' };
  const C_EMPRUNT  = { num: '164000', lib: "Emprunts établissements de crédit" };
  const C_BANQUE   = { num: '512000', lib: 'Banque' };
  const C_CCA      = { num: '455000', lib: "Compte courant d'associé" };
  const C_RESULTAT = { num: '120000', lib: "Résultat de l'exercice" };

  const DEFICIT_REPORT_ANS = 10;

  /* ---------- État applicatif ---------- */
  const STORAGE_KEY = 'lmnp-compta-v1';

  const thisYear = new Date().getFullYear();

  const defaultState = () => ({
    schema: 2,
    bien: { nom: '', adresse: '', debut: '', apport: 0, empruntInitial: 0 },
    immobilisations: {
      immeuble: { val: 0, terrain: 15, duree: 30, acq: thisYear - 1 },
      mobilier: { val: 0, duree: 7, acq: thisYear - 1 },
      travaux:  { val: 0, duree: 10, acq: thisYear - 1 },
    },
    exercices: [
      { annee: thisYear - 1, recettes: [], depenses: [], emprunt: 0 },
    ],
    courant: thisYear - 1,
  });

  function migrate(raw) {
    if (!raw) return defaultState();
    let data;
    try { data = JSON.parse(raw); } catch (e) { return defaultState(); }
    if (data.schema === 2) return Object.assign(defaultState(), data);

    // Migration depuis la v1 (un seul exercice à plat)
    const base = defaultState();
    const annee = parseInt(data.bien?.exercice) || (thisYear - 1);
    const acq = (data.bien?.debut ? parseInt(data.bien.debut.slice(0, 4)) : annee) || annee;
    base.bien.nom = data.bien?.nom || '';
    base.bien.adresse = data.bien?.adresse || '';
    base.bien.debut = data.bien?.debut || '';
    base.bien.apport = data.bien?.apport || 0;
    base.bien.empruntInitial = data.emprunt || 0;
    if (data.amort) {
      base.immobilisations.immeuble = { val: data.amort.immeuble?.val || 0, terrain: data.amort.immeuble?.terrain ?? 15, duree: data.amort.immeuble?.duree || 30, acq };
      base.immobilisations.mobilier = { val: data.amort.mobilier?.val || 0, duree: data.amort.mobilier?.duree || 7, acq };
      base.immobilisations.travaux  = { val: data.amort.travaux?.val || 0, duree: data.amort.travaux?.duree || 10, acq };
    }
    base.exercices = [{ annee, recettes: data.recettes || [], depenses: data.depenses || [], emprunt: data.emprunt || 0 }];
    base.courant = annee;
    return base;
  }

  let state = migrate(localStorage.getItem(STORAGE_KEY));
  function save() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }

  /* ---------- Utilitaires ---------- */
  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];
  const uid = () => Math.random().toString(36).slice(2, 9);
  const num = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
  const fmtEUR = (n) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n || 0);
  const fmtNum = (n) => new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), 2600);
  }

  const sortedExercices = () => [...state.exercices].sort((a, b) => a.annee - b.annee);
  const getEx = (annee) => state.exercices.find((e) => e.annee === annee);
  const courant = () => getEx(state.courant) || sortedExercices()[0];

  /* ---------- Amortissements (base & cumul par composante) ---------- */
  function baseAmortissable(key, comp) {
    if (key === 'immeuble') return num(comp.val) * (1 - num(comp.terrain) / 100);
    return num(comp.val);
  }
  function cumulAmort(key, comp, annee) {
    const base = baseAmortissable(key, comp);
    const duree = num(comp.duree);
    if (!base || !duree) return 0;
    const elapsed = Math.min(Math.max(annee - num(comp.acq) + 1, 0), duree);
    if (elapsed <= 0) return 0;
    if (elapsed >= duree) return base; // dernière année : absorbe l'arrondi
    return (base / duree) * elapsed;
  }
  function dotationAnnuelle(key, comp, annee) {
    return cumulAmort(key, comp, annee) - cumulAmort(key, comp, annee - 1);
  }
  function dotationsExercice(annee) {
    const im = state.immobilisations;
    return {
      immeuble: dotationAnnuelle('immeuble', im.immeuble, annee),
      mobilier: dotationAnnuelle('mobilier', im.mobilier, annee),
      travaux:  dotationAnnuelle('travaux', im.travaux, annee),
      get total() { return this.immeuble + this.mobilier + this.travaux; },
    };
  }

  /* ---------- Calcul chaîné de tous les exercices ---------- */
  function computeAll() {
    const list = sortedExercices();
    const results = {};
    let ardStock = 0;            // amortissements réputés différés (stock)
    let deficits = [];           // [{annee, montant}] déficits reportables
    let reportCumule = 0;        // somme des résultats comptables antérieurs

    const im = state.immobilisations;
    const immoBrut = num(im.immeuble.val) + num(im.mobilier.val) + num(im.travaux.val);
    const apport = num(state.bien.apport);

    for (const ex of list) {
      const annee = ex.annee;
      const recettes = ex.recettes.reduce((s, r) => s + num(r.montant), 0);

      const chargesParCompte = {};
      ex.depenses.forEach((d) => {
        const c = d.compte || '616000';
        chargesParCompte[c] = (chargesParCompte[c] || 0) + num(d.montant);
      });
      const chargesCourantes = Object.values(chargesParCompte).reduce((s, v) => s + v, 0);

      const dot = dotationsExercice(annee);
      const dotation = dot.total;

      // Résultat comptable (amortissement comptabilisé en totalité)
      const resultatAvantAmort = recettes - chargesCourantes;
      const resultatComptable = resultatAvantAmort - dotation;

      // --- Application de l'art. 39 C : amortissement non déductible -> ARD ---
      let reintegration = 0;  // dotation de l'exercice non déductible (devient ARD)
      let deductionARD = 0;   // ARD antérieurs déduits cette année
      const ardDebut = ardStock;
      if (resultatAvantAmort >= dotation) {
        // toute la dotation passe ; on peut déduire en plus une partie de l'ARD
        deductionARD = Math.min(ardStock, resultatAvantAmort - dotation);
        ardStock -= deductionARD;
      } else if (resultatAvantAmort >= 0) {
        // on ne déduit qu'une partie de la dotation
        reintegration = dotation - resultatAvantAmort;
        ardStock += reintegration;
      } else {
        // résultat négatif : toute la dotation est différée
        reintegration = dotation;
        ardStock += dotation;
      }
      const resultatFiscalAvantDeficit = resultatComptable + reintegration - deductionARD;

      // --- Imputation des déficits reportables (10 ans) ---
      deficits = deficits.filter((d) => annee - d.annee < DEFICIT_REPORT_ANS);
      let deficitsImputes = 0;
      let resultatFiscal = resultatFiscalAvantDeficit;
      if (resultatFiscal > 0) {
        for (const d of deficits) {
          if (resultatFiscal <= 0) break;
          const imp = Math.min(d.montant, resultatFiscal);
          d.montant -= imp; resultatFiscal -= imp; deficitsImputes += imp;
        }
        deficits = deficits.filter((d) => d.montant > 0.005);
      } else if (resultatFiscal < 0) {
        deficits.push({ annee, montant: -resultatFiscal });
      }
      const deficitRestant = deficits.reduce((s, d) => s + d.montant, 0);

      // --- Bilan (équilibré par construction) ---
      const cumulAmortFin = cumulAmort('immeuble', im.immeuble, annee) + cumulAmort('mobilier', im.mobilier, annee) + cumulAmort('travaux', im.travaux, annee);
      const immoNet = immoBrut - cumulAmortFin;
      const emprunt = num(ex.emprunt);
      const capitauxPropres = apport + reportCumule + resultatComptable;
      const treso = capitauxPropres + emprunt - immoNet;

      results[annee] = {
        annee, recettes, chargesParCompte, chargesCourantes, dot, dotation,
        resultatAvantAmort, resultatComptable,
        reintegration, deductionARD, ardDebut, ardFin: ardStock,
        resultatFiscalAvantDeficit, deficitsImputes, resultatFiscal, deficitRestant,
        deficitsSnapshot: deficits.map((d) => ({ ...d })),
        immoBrut, cumulAmortFin, immoNet, emprunt, apport, reportCumule, capitauxPropres, treso,
      };

      reportCumule += resultatComptable;
    }
    return results;
  }

  /* ---------- Compteurs animés ---------- */
  function animateValue(el, to) {
    const from = parseFloat(el.dataset.cur || '0');
    el.dataset.cur = to;
    const start = performance.now(), dur = 650;
    const step = (now) => {
      const p = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = fmtEUR(from + (to - from) * eased);
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /* ---------- Rendu global ---------- */
  function refresh() {
    const all = computeAll();
    const c = all[state.courant];
    if (!c) return;

    animateValue($('#statRecettes'), c.recettes);
    animateValue($('#statCharges'), c.chargesCourantes);
    animateValue($('#statAmort'), c.dotation);
    animateValue($('#statResultat'), c.resultatFiscal);

    const lv = $('#liveResultValue');
    lv.textContent = fmtEUR(c.resultatFiscal);
    lv.classList.toggle('pos', c.resultatFiscal >= 0);
    lv.classList.toggle('neg', c.resultatFiscal < 0);
    $('#liveExercice').textContent = 'Exercice ' + c.annee;

    $('#totalRecettes').textContent = fmtEUR(c.recettes);
    $('#totalDepenses').textContent = fmtEUR(c.chargesCourantes);

    const dot = dotationsExercice(state.courant);
    $('#am_immeuble_dot').textContent = fmtEUR(dot.immeuble);
    $('#am_mobilier_dot').textContent = fmtEUR(dot.mobilier);
    $('#am_travaux_dot').textContent = fmtEUR(dot.travaux);
    $('#am_total_dot').textContent = fmtEUR(dot.total);

    renderCompteResultat(c);
    renderBilan(c);
    renderLiasse(all, c);
  }

  function line(lbl, val, acc) {
    const accHtml = acc ? `<span class="acc">${acc}</span>` : '';
    return `<div class="line"><span class="lbl">${accHtml}${lbl}</span><span class="val">${fmtEUR(val)}</span></div>`;
  }

  function renderCompteResultat(c) {
    const lignes = Object.entries(c.chargesParCompte).sort((a, b) => a[0].localeCompare(b[0]))
      .map(([compte, montant]) => { const cat = CATEGORIES_CHARGES.find((x) => x.compte === compte); return line(cat ? cat.lib : compte, montant, compte); }).join('');
    $('#crBody').innerHTML = `
      <div class="line section-title"><span class="lbl">Produits d'exploitation</span><span></span></div>
      ${line(COMPTE_LOYERS.lib, c.recettes, COMPTE_LOYERS.num)}
      <div class="line total"><span class="lbl">Total des produits</span><span class="val">${fmtEUR(c.recettes)}</span></div>
      <div class="line section-title"><span class="lbl">Charges d'exploitation</span><span></span></div>
      ${lignes || '<div class="line"><span class="lbl">—</span><span class="val">0,00 €</span></div>'}
      ${line(COMPTE_DOTATION.lib, c.dotation, COMPTE_DOTATION.num)}
      <div class="line total"><span class="lbl">Total des charges</span><span class="val">${fmtEUR(c.chargesCourantes + c.dotation)}</span></div>
      <div class="line result ${c.resultatComptable >= 0 ? 'pos' : 'neg'}">
        <span class="lbl">Résultat comptable</span><span class="val">${fmtEUR(c.resultatComptable)}</span></div>`;
    const tag = $('#crResultatTag');
    tag.textContent = c.resultatComptable >= 0 ? 'Bénéfice' : 'Perte';
    tag.className = 'tag ' + (c.resultatComptable >= 0 ? 'tag-ok' : 'tag-bad');
  }

  function renderBilan(c) {
    const totalActif = c.immoNet + c.treso;
    const totalPassif = c.capitauxPropres + c.emprunt;
    $('#bilanBody').innerHTML = `
      <div class="bilan-col"><h4>Actif</h4>
        ${line('Immobilisations brutes', c.immoBrut)}
        ${line('− Amortissements cumulés', -c.cumulAmortFin)}
        ${line('Immobilisations nettes', c.immoNet)}
        ${line('Disponibilités', c.treso, C_BANQUE.num)}
        <div class="line total"><span class="lbl">Total actif</span><span class="val">${fmtEUR(totalActif)}</span></div></div>
      <div class="bilan-col"><h4>Passif</h4>
        ${line('Capital / apport', c.apport, C_CAPITAL.num)}
        ${line('Report à nouveau', c.reportCumule, C_REPORT.num)}
        ${line("Résultat de l'exercice", c.resultatComptable, C_RESULTAT.num)}
        ${line('Emprunts', c.emprunt, C_EMPRUNT.num)}
        <div class="line total"><span class="lbl">Total passif</span><span class="val">${fmtEUR(totalPassif)}</span></div></div>`;
    const eq = Math.abs(totalActif - totalPassif) < 0.01;
    const b = $('#bilanEquilibre');
    b.textContent = eq ? 'Équilibré' : 'Écart ' + fmtEUR(totalActif - totalPassif);
    b.className = 'tag ' + (eq ? 'tag-ok' : 'tag-bad');
  }

  /* ---------- Tableaux de saisie (exercice courant) ---------- */
  const esc = (s) => (s == null ? '' : String(s).replace(/"/g, '&quot;').replace(/</g, '&lt;'));

  function renderRecettes() {
    const ex = courant();
    const tb = $('#tableRecettes tbody');
    if (!ex.recettes.length) { tb.innerHTML = `<tr class="empty-row"><td colspan="5">Aucune recette pour ${ex.annee}. Cliquez sur « Ajouter une recette ».</td></tr>`; return; }
    tb.innerHTML = ex.recettes.map((r) => `
      <tr data-id="${r.id}">
        <td><input type="date" data-f="date" value="${r.date || ''}"></td>
        <td><input type="text" data-f="locataire" placeholder="Nom du locataire" value="${esc(r.locataire)}"></td>
        <td><input type="text" data-f="libelle" placeholder="Loyer + charges mars" value="${esc(r.libelle)}"></td>
        <td><input type="number" step="0.01" class="cell-num" data-f="montant" placeholder="0,00" value="${r.montant ?? ''}"></td>
        <td><button class="row-del" title="Supprimer" data-del>×</button></td></tr>`).join('');
  }
  function renderDepenses() {
    const ex = courant();
    const tb = $('#tableDepenses tbody');
    if (!ex.depenses.length) { tb.innerHTML = `<tr class="empty-row"><td colspan="5">Aucune dépense pour ${ex.annee}. Cliquez sur « Ajouter une dépense ».</td></tr>`; return; }
    const opts = (sel) => CATEGORIES_CHARGES.map((c) => `<option value="${c.compte}" ${c.compte === sel ? 'selected' : ''}>${c.compte.slice(0, 3)} — ${c.lib}</option>`).join('');
    tb.innerHTML = ex.depenses.map((d) => `
      <tr data-id="${d.id}">
        <td><input type="date" data-f="date" value="${d.date || ''}"></td>
        <td><select data-f="compte">${opts(d.compte)}</select></td>
        <td><input type="text" data-f="libelle" placeholder="Facture / fournisseur" value="${esc(d.libelle)}"></td>
        <td><input type="number" step="0.01" class="cell-num" data-f="montant" placeholder="0,00" value="${d.montant ?? ''}"></td>
        <td><button class="row-del" title="Supprimer" data-del>×</button></td></tr>`).join('');
  }

  /* ---------- Barre des exercices ---------- */
  function renderExerciceBar() {
    const bar = $('#exerciceBar');
    const list = sortedExercices();
    bar.innerHTML = list.map((e) => `
      <button class="ex-chip ${e.annee === state.courant ? 'active' : ''}" data-annee="${e.annee}">
        <span>${e.annee}</span>
        ${list.length > 1 ? `<i class="ex-del" data-del-ex="${e.annee}" title="Supprimer l'exercice">×</i>` : ''}
      </button>`).join('') +
      `<button class="ex-add" id="exAdd" title="Ajouter l'exercice suivant">+ Exercice</button>`;
  }

  function switchExercice(annee) {
    state.courant = annee; save();
    renderExerciceBar(); renderRecettes(); renderDepenses(); bootEmprunt(); refresh();
  }

  /* ---------- Champs statiques ---------- */
  function bindStaticFields() {
    const map = [
      ['#bien_nom', (v) => state.bien.nom = v],
      ['#bien_adresse', (v) => state.bien.adresse = v],
      ['#bien_debut', (v) => { state.bien.debut = v; }],
      ['#bien_apport', (v) => state.bien.apport = num(v)],
      ['#bien_emprunt_init', (v) => state.bien.empruntInitial = num(v)],
      ['#am_immeuble_val', (v) => state.immobilisations.immeuble.val = num(v)],
      ['#am_immeuble_terrain', (v) => state.immobilisations.immeuble.terrain = num(v)],
      ['#am_immeuble_duree', (v) => state.immobilisations.immeuble.duree = num(v)],
      ['#am_immeuble_acq', (v) => state.immobilisations.immeuble.acq = num(v)],
      ['#am_mobilier_val', (v) => state.immobilisations.mobilier.val = num(v)],
      ['#am_mobilier_duree', (v) => state.immobilisations.mobilier.duree = num(v)],
      ['#am_mobilier_acq', (v) => state.immobilisations.mobilier.acq = num(v)],
      ['#am_travaux_val', (v) => state.immobilisations.travaux.val = num(v)],
      ['#am_travaux_duree', (v) => state.immobilisations.travaux.duree = num(v)],
      ['#am_travaux_acq', (v) => state.immobilisations.travaux.acq = num(v)],
    ];
    map.forEach(([sel, set]) => { const el = $(sel); if (el) el.addEventListener('input', () => { set(el.value); save(); refresh(); }); });

    // emprunt restant : propre à l'exercice courant
    $('#fin_emprunt').addEventListener('input', (e) => { courant().emprunt = num(e.target.value); save(); refresh(); });
  }

  function bindTables() {
    [['#tableRecettes', 'recettes'], ['#tableDepenses', 'depenses']].forEach(([tsel, coll]) => {
      const table = $(tsel);
      table.addEventListener('input', (e) => {
        const tr = e.target.closest('tr[data-id]'); if (!tr) return;
        const item = courant()[coll].find((x) => x.id === tr.dataset.id); if (!item) return;
        item[e.target.dataset.f] = e.target.value; save(); refresh();
      });
      table.addEventListener('click', (e) => {
        if (!e.target.closest('[data-del]')) return;
        const tr = e.target.closest('tr[data-id]');
        const ex = courant(); ex[coll] = ex[coll].filter((x) => x.id !== tr.dataset.id);
        save(); coll === 'recettes' ? renderRecettes() : renderDepenses(); refresh();
      });
    });
    $$('.add-row').forEach((btn) => btn.addEventListener('click', () => {
      const ex = courant();
      if (btn.dataset.target === 'recettes') { ex.recettes.push({ id: uid(), date: '', locataire: '', libelle: '', montant: '' }); save(); renderRecettes(); }
      else { ex.depenses.push({ id: uid(), date: '', compte: CATEGORIES_CHARGES[0].compte, libelle: '', montant: '' }); save(); renderDepenses(); }
      refresh();
    }));
  }

  function bindExerciceBar() {
    $('#exerciceBar').addEventListener('click', (e) => {
      if (e.target.closest('#exAdd')) {
        const max = Math.max(...state.exercices.map((x) => x.annee));
        const prev = getEx(max);
        state.exercices.push({ annee: max + 1, recettes: [], depenses: [], emprunt: prev ? num(prev.emprunt) : 0 });
        switchExercice(max + 1); toast('Exercice ' + (max + 1) + ' ajouté'); return;
      }
      const del = e.target.closest('[data-del-ex]');
      if (del) {
        e.stopPropagation();
        const annee = parseInt(del.dataset.delEx);
        if (state.exercices.length <= 1) return;
        if (!confirm('Supprimer l\'exercice ' + annee + ' et toutes ses saisies ?')) return;
        state.exercices = state.exercices.filter((x) => x.annee !== annee);
        if (state.courant === annee) state.courant = sortedExercices()[0].annee;
        save(); switchExercice(state.courant); return;
      }
      const chip = e.target.closest('.ex-chip');
      if (chip) switchExercice(parseInt(chip.dataset.annee));
    });
  }

  /* ---------- Liasse fiscale (tableaux 2033) ---------- */
  function chargesGroupes(c) {
    let achats = 0, servicesExt = 0, impots = 0, financieres = 0, autres = 0;
    Object.entries(c.chargesParCompte).forEach(([compte, m]) => {
      const p = compte.slice(0, 2);
      if (p === '60') achats += m;
      else if (p === '61' || p === '62') servicesExt += m;
      else if (p === '63') impots += m;
      else if (p === '66') financieres += m;
      else autres += m;
    });
    return { achats, servicesExt, impots, financieres, autres };
  }

  function renderLiasse(all, c) {
    const g = chargesGroupes(c);
    const im = state.immobilisations;

    // 2033-B — Compte de résultat simplifié
    const resExploit = c.recettes - (g.achats + g.servicesExt + g.impots + g.autres + c.dotation);
    $('#l2033b').innerHTML = liasseTable('2033-B — Compte de résultat simplifié', [
      ['s', "Produits d'exploitation"],
      ['', "Chiffre d'affaires (loyers)", c.recettes],
      ['t', 'Total des produits d\'exploitation', c.recettes],
      ['s', "Charges d'exploitation"],
      ['', 'Achats', g.achats],
      ['', 'Autres charges externes', g.servicesExt],
      ['', 'Impôts, taxes et versements assimilés', g.impots],
      ['', 'Dotations aux amortissements', c.dotation],
      ['', 'Autres charges', g.autres],
      ['t', 'Total des charges d\'exploitation', g.achats + g.servicesExt + g.impots + c.dotation + g.autres],
      ['r', "Résultat d'exploitation", resExploit],
      ['s', 'Résultat financier'],
      ['', 'Charges financières (intérêts d\'emprunt)', g.financieres],
      ['r', 'Résultat financier', -g.financieres],
      ['R', c.resultatComptable >= 0 ? 'Résultat comptable (bénéfice)' : 'Résultat comptable (perte)', c.resultatComptable],
    ]);

    // 2033-A — Bilan simplifié
    $('#l2033a').innerHTML = liasseTable('2033-A — Bilan simplifié', [
      ['s', 'ACTIF'],
      ['', 'Immobilisations corporelles — brut', c.immoBrut],
      ['', 'Amortissements', c.cumulAmortFin],
      ['', 'Immobilisations corporelles — net', c.immoNet],
      ['', 'Disponibilités', c.treso],
      ['t', 'Total actif', c.immoNet + c.treso],
      ['s', 'PASSIF'],
      ['', 'Capital / apport', c.apport],
      ['', 'Report à nouveau', c.reportCumule],
      ['', "Résultat de l'exercice", c.resultatComptable],
      ['', 'Emprunts et dettes assimilées', c.emprunt],
      ['t', 'Total passif', c.capitauxPropres + c.emprunt],
    ]);

    // 2033-C — Immobilisations & amortissements
    const rows = [['s', 'Immobilisations — valeurs brutes']];
    const comps = [['immeuble', im.immeuble, 'Terrains + constructions'], ['mobilier', im.mobilier, 'Mobilier & équipement'], ['travaux', im.travaux, 'Installations & agencements']];
    comps.forEach(([k, comp, lbl]) => rows.push(['', lbl, num(comp.val)]));
    rows.push(['t', 'Total immobilisations brutes', c.immoBrut]);
    rows.push(['s', 'Amortissements']);
    comps.forEach(([k, comp, lbl]) => {
      const deb = cumulAmort(k, comp, c.annee - 1), dotc = dotationAnnuelle(k, comp, c.annee), fin = cumulAmort(k, comp, c.annee);
      rows.push(['3', lbl, deb, dotc, fin]);
    });
    rows.push(['t', 'Total amortissements', c.cumulAmortFin]);
    $('#l2033c').innerHTML = liasseTable('2033-C — Immobilisations & amortissements', rows, ['', 'À l\'ouverture', 'Dotation', 'À la clôture']);

    // 2033-D — Déficits & amortissements réputés différés
    $('#l2033d').innerHTML = liasseTable('2033-D — Déficits & amortissements différés', [
      ['s', 'Amortissements réputés différés (art. 39 C)'],
      ['', "Stock à l'ouverture", c.ardDebut],
      ['', 'Dotation différée de l\'exercice', c.reintegration],
      ['', 'ARD déduits cette année', c.deductionARD],
      ['t', 'Stock à la clôture (reportable sans limite)', c.ardFin],
      ['s', 'Déficits ordinaires reportables (10 ans)'],
      ['', 'Déficits imputés cette année', c.deficitsImputes],
      ['', 'Déficit créé cette année', c.resultatFiscalAvantDeficit < 0 ? -c.resultatFiscalAvantDeficit : 0],
      ['t', 'Déficit restant à reporter', c.deficitRestant],
    ]);

    // Synthèse fiscale : passage résultat comptable -> résultat fiscal
    $('#l2031').innerHTML = liasseTable('Détermination du résultat fiscal', [
      ['', 'Résultat comptable', c.resultatComptable],
      ['', '+ Réintégration : amortissements différés', c.reintegration],
      ['', '− Déduction : ARD antérieurs imputés', -c.deductionARD],
      ['t', 'Résultat fiscal avant déficits', c.resultatFiscalAvantDeficit],
      ['', '− Déficits antérieurs imputés', -c.deficitsImputes],
      ['R', c.resultatFiscal >= 0 ? 'Résultat fiscal (à déclarer)' : 'Déficit de l\'exercice (à reporter)', c.resultatFiscal],
    ]);
    const tag = $('#liasseTag');
    tag.textContent = 'Exercice ' + c.annee;
  }

  function liasseTable(title, rows, head) {
    const headHtml = head ? `<div class="lt-row lt-head"><span class="lt-lbl"></span>${head.slice(1).map((h) => `<span class="lt-val">${h}</span>`).join('')}</div>` : '';
    const body = rows.map((r) => {
      const type = r[0];
      if (type === 's') return `<div class="lt-row lt-section"><span class="lt-lbl">${r[1]}</span></div>`;
      const cls = type === 'R' ? 'lt-result' : type === 'r' ? 'lt-subresult' : type === 't' ? 'lt-total' : '';
      if (type === '3') return `<div class="lt-row ${cls}"><span class="lt-lbl">${r[1]}</span><span class="lt-val">${fmtEUR(r[2])}</span><span class="lt-val">${fmtEUR(r[3])}</span><span class="lt-val">${fmtEUR(r[4])}</span></div>`;
      return `<div class="lt-row ${cls}"><span class="lt-lbl">${r[1]}</span><span class="lt-val">${fmtEUR(r[2])}</span></div>`;
    }).join('');
    return `<div class="lt-title">${title}</div>${headHtml}${body}`;
  }

  /* ---------- Exports ---------- */
  function download(filename, content, mime = 'text/plain') {
    const blob = new Blob(['﻿' + content], { type: mime + ';charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }
  function toCSV(rows) {
    return rows.map((r) => r.map((cell) => { const s = String(cell ?? ''); return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(';')).join('\r\n');
  }

  function exportCompteResultat() {
    const c = computeAll()[state.courant];
    const rows = [['Compte', 'Libellé', 'Montant']];
    rows.push(['', "PRODUITS D'EXPLOITATION", '']);
    rows.push([COMPTE_LOYERS.num, COMPTE_LOYERS.lib, fmtNum(c.recettes)]);
    rows.push(['', "CHARGES D'EXPLOITATION", '']);
    Object.entries(c.chargesParCompte).sort((a, b) => a[0].localeCompare(b[0])).forEach(([compte, m]) => {
      const cat = CATEGORIES_CHARGES.find((x) => x.compte === compte);
      rows.push([compte, cat ? cat.lib : compte, fmtNum(m)]);
    });
    rows.push([COMPTE_DOTATION.num, COMPTE_DOTATION.lib, fmtNum(c.dotation)]);
    rows.push(['', 'RÉSULTAT COMPTABLE', fmtNum(c.resultatComptable)]);
    download(`compte_resultat_${c.annee}.csv`, toCSV(rows), 'text/csv');
    toast('Compte de résultat ' + c.annee + ' exporté');
  }

  function exportBilan() {
    const c = computeAll()[state.courant];
    const rows = [['ACTIF', 'Montant', 'PASSIF', 'Montant']];
    rows.push(['Immobilisations brutes', fmtNum(c.immoBrut), 'Capital / apport', fmtNum(c.apport)]);
    rows.push(['− Amortissements', fmtNum(-c.cumulAmortFin), 'Report à nouveau', fmtNum(c.reportCumule)]);
    rows.push(['Immobilisations nettes', fmtNum(c.immoNet), "Résultat de l'exercice", fmtNum(c.resultatComptable)]);
    rows.push(['Disponibilités', fmtNum(c.treso), 'Emprunts', fmtNum(c.emprunt)]);
    rows.push(['TOTAL ACTIF', fmtNum(c.immoNet + c.treso), 'TOTAL PASSIF', fmtNum(c.capitauxPropres + c.emprunt)]);
    download(`bilan_${c.annee}.csv`, toCSV(rows), 'text/csv');
    toast('Bilan ' + c.annee + ' exporté');
  }

  function exportLiasse() {
    const all = computeAll();
    const c = all[state.courant];
    const g = chargesGroupes(c);
    const rows = [['Tableau', 'Ligne', 'Montant']];
    const add = (t, l, m) => rows.push([t, l, fmtNum(m)]);
    add('2033-B', "Chiffre d'affaires (loyers)", c.recettes);
    add('2033-B', 'Achats', g.achats);
    add('2033-B', 'Autres charges externes', g.servicesExt);
    add('2033-B', 'Impôts et taxes', g.impots);
    add('2033-B', 'Dotations aux amortissements', c.dotation);
    add('2033-B', 'Charges financières', g.financieres);
    add('2033-B', 'Résultat comptable', c.resultatComptable);
    add('2033-A', 'Immobilisations nettes', c.immoNet);
    add('2033-A', 'Disponibilités', c.treso);
    add('2033-A', 'Capital', c.apport);
    add('2033-A', 'Report à nouveau', c.reportCumule);
    add('2033-A', 'Résultat', c.resultatComptable);
    add('2033-A', 'Emprunts', c.emprunt);
    add('2033-C', 'Immobilisations brutes', c.immoBrut);
    add('2033-C', 'Amortissements cumulés', c.cumulAmortFin);
    add('2033-D', 'ARD stock clôture', c.ardFin);
    add('2033-D', 'Déficit restant à reporter', c.deficitRestant);
    add('2031', 'Résultat comptable', c.resultatComptable);
    add('2031', 'Réintégration amort. différés', c.reintegration);
    add('2031', 'Déduction ARD antérieurs', -c.deductionARD);
    add('2031', 'Déficits antérieurs imputés', -c.deficitsImputes);
    add('2031', c.resultatFiscal >= 0 ? 'RÉSULTAT FISCAL' : 'DÉFICIT À REPORTER', c.resultatFiscal);
    download(`liasse_fiscale_${c.annee}.csv`, toCSV(rows), 'text/csv');
    toast('Liasse fiscale ' + c.annee + ' exportée');
  }

  /* ---------- Export FEC (exercice courant) ---------- */
  function exportFEC() {
    const all = computeAll();
    const c = all[state.courant];
    const ex = courant();
    const annee = c.annee;
    const cloture = `${annee}1231`, ouverture = `${annee}0101`;
    const cols = ['JournalCode', 'JournalLib', 'EcritureNum', 'EcritureDate', 'CompteNum', 'CompteLib', 'CompAuxNum', 'CompAuxLib', 'PieceRef', 'PieceDate', 'EcritureLib', 'Debit', 'Credit', 'EcritureLet', 'DateLet', 'ValidDate', 'Montantdevise', 'Idevise'];
    const lines = [cols.join('\t')];
    let ecr = 0;
    const fecDate = (d) => { if (!d) return cloture; const p = d.split('-'); return p.length === 3 ? p.join('') : cloture; };
    const mt = (n) => fmtNum(n).replace(/\s/g, '');
    const push = (o) => lines.push([o.jc, o.jl, o.num, o.date, o.compte, o.compteLib, o.auxNum || '', o.auxLib || '', o.piece || '', o.pieceDate || o.date, o.lib, mt(o.debit || 0), mt(o.credit || 0), '', '', cloture, '', ''].join('\t'));

    // À-nouveaux = bilan d'ouverture (clôture de l'exercice précédent, ou acquisition)
    const im = state.immobilisations;
    const immVal = num(im.immeuble.val), mobVal = num(im.mobilier.val), travVal = num(im.travaux.val);
    const terrainVal = immVal * num(im.immeuble.terrain) / 100, constructionVal = immVal - terrainVal;
    const cumulOuv = cumulAmort('immeuble', im.immeuble, annee - 1) + cumulAmort('mobilier', im.mobilier, annee - 1) + cumulAmort('travaux', im.travaux, annee - 1);
    const list = sortedExercices();
    const idx = list.findIndex((e) => e.annee === annee);
    const prev = idx > 0 ? all[list[idx - 1].annee] : null;
    const reportOuv = prev ? prev.reportCumule + prev.resultatComptable : 0;
    const empruntOuv = prev ? prev.emprunt : num(state.bien.empruntInitial);
    const apport = num(state.bien.apport);
    const immoNetOuv = (immVal + mobVal + travVal) - cumulOuv;
    const tresoOuv = (apport + reportOuv) + empruntOuv - immoNetOuv;

    ecr++;
    const an = (compte, lib, debit, credit) => push({ jc: 'AN', jl: 'À-nouveaux', num: ecr, date: ouverture, compte, compteLib: lib, piece: 'OUV', pieceDate: ouverture, lib: "Bilan d'ouverture", debit, credit });
    if (terrainVal) an(IMMO.immeuble.terrain, IMMO.immeuble.terrainLib, terrainVal, 0);
    if (constructionVal) an(IMMO.immeuble.brut, IMMO.immeuble.lib, constructionVal, 0);
    if (mobVal) an(IMMO.mobilier.brut, IMMO.mobilier.lib, mobVal, 0);
    if (travVal) an(IMMO.travaux.brut, IMMO.travaux.lib, travVal, 0);
    if (tresoOuv > 0) an(C_BANQUE.num, C_BANQUE.lib, tresoOuv, 0);
    if (cumulOuv) an('281000', 'Amortissements des immobilisations', 0, cumulOuv);
    if (apport) an(C_CAPITAL.num, C_CAPITAL.lib, 0, apport);
    if (reportOuv > 0) an(C_REPORT.num, C_REPORT.lib, 0, reportOuv);
    if (reportOuv < 0) an(C_REPORT.num, C_REPORT.lib, -reportOuv, 0);
    if (empruntOuv) an(C_EMPRUNT.num, C_EMPRUNT.lib, 0, empruntOuv);
    if (tresoOuv < 0) an(C_CCA.num, C_CCA.lib, 0, -tresoOuv);

    // Banque : recettes
    ex.recettes.forEach((r, i) => {
      const m = num(r.montant); if (!m) return; ecr++;
      const date = fecDate(r.date), piece = 'L' + String(i + 1).padStart(3, '0');
      const lib = `Loyer ${r.locataire || ''} ${r.libelle || ''}`.trim() || 'Encaissement loyer';
      push({ jc: 'BQ', jl: 'Banque', num: ecr, date, compte: C_BANQUE.num, compteLib: C_BANQUE.lib, piece, lib, debit: m, credit: 0 });
      push({ jc: 'BQ', jl: 'Banque', num: ecr, date, compte: COMPTE_LOYERS.num, compteLib: COMPTE_LOYERS.lib, auxNum: '411' + String(i + 1).padStart(3, '0'), auxLib: r.locataire || 'Locataire', piece, lib, debit: 0, credit: m });
    });
    // Achats : dépenses
    ex.depenses.forEach((d, i) => {
      const m = num(d.montant); if (!m) return; ecr++;
      const date = fecDate(d.date), piece = 'A' + String(i + 1).padStart(3, '0');
      const cat = CATEGORIES_CHARGES.find((x) => x.compte === d.compte) || { compte: d.compte, lib: 'Charge' };
      const lib = d.libelle || cat.lib;
      push({ jc: 'AC', jl: 'Achats', num: ecr, date, compte: cat.compte, compteLib: cat.lib, piece, lib, debit: m, credit: 0 });
      push({ jc: 'AC', jl: 'Achats', num: ecr, date, compte: C_BANQUE.num, compteLib: C_BANQUE.lib, piece, lib, debit: 0, credit: m });
    });
    // OD : dotations aux amortissements
    [['immeuble', IMMO.immeuble], ['mobilier', IMMO.mobilier], ['travaux', IMMO.travaux]].forEach(([k, info], i) => {
      const v = dotationAnnuelle(k, im[k], annee); if (v <= 0) return; ecr++;
      const piece = 'AM' + String(i + 1).padStart(3, '0'), lib = 'Dotation amortissement ' + info.lib;
      push({ jc: 'OD', jl: 'Opérations diverses', num: ecr, date: cloture, compte: COMPTE_DOTATION.num, compteLib: COMPTE_DOTATION.lib, piece, lib, debit: v, credit: 0 });
      push({ jc: 'OD', jl: 'Opérations diverses', num: ecr, date: cloture, compte: info.amort, compteLib: 'Amortissements ' + info.lib, piece, lib, debit: 0, credit: v });
    });

    download(`FEC_${annee}.txt`, lines.join('\r\n'), 'text/plain');
    toast(`FEC ${annee} exporté — ${ecr} écritures`);
  }

  function bindExports() {
    $('#exportBilan').addEventListener('click', exportBilan);
    $('#exportCR').addEventListener('click', exportCompteResultat);
    $('#exportFEC').addEventListener('click', exportFEC);
    $('#exportLiasse').addEventListener('click', exportLiasse);
    $('#btnPrint').addEventListener('click', () => window.print());
    $('#btnPrintLiasse').addEventListener('click', () => { document.body.classList.add('print-liasse'); window.print(); setTimeout(() => document.body.classList.remove('print-liasse'), 500); });
    $('#btnReset').addEventListener('click', () => { if (confirm('Réinitialiser toutes les données ?')) { state = defaultState(); save(); bootAll(); toast('Données réinitialisées'); } });
  }

  /* ---------- Navigation ---------- */
  function goStep(name) {
    $$('.panel').forEach((p) => p.classList.toggle('active', p.dataset.panel === name));
    let reached = true;
    $$('.step').forEach((s) => {
      const active = s.dataset.step === name;
      s.classList.toggle('active', active);
      s.classList.toggle('done', reached && !active);
      if (active) reached = false;
    });
    const perEx = ['recettes', 'depenses', 'synthese', 'liasse'].includes(name);
    $('#exerciceBar').classList.toggle('hidden', !perEx);
    window.scrollTo({ top: $('.stepper').offsetTop - 80, behavior: 'smooth' });
  }
  function bindNav() {
    $$('.step').forEach((s) => s.addEventListener('click', () => goStep(s.dataset.step)));
    $$('.next').forEach((b) => b.addEventListener('click', () => goStep(b.dataset.next)));
    $('#btnStart').addEventListener('click', () => goStep('bien'));
    $('#btnGoSynthese').addEventListener('click', (e) => { e.preventDefault(); goStep('synthese'); });
  }

  function bindReveal() {
    const obs = new IntersectionObserver((entries) => entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('in'); obs.unobserve(en.target); } }), { threshold: 0.12 });
    $$('.reveal').forEach((el) => obs.observe(el));
  }

  /* ---------- Initialisation / amorçage des champs ---------- */
  const setVal = (sel, v) => { const el = $(sel); if (el) el.value = (v == null || v === 0) ? '' : v; };
  function bootEmprunt() { setVal('#fin_emprunt', courant().emprunt); }
  function bootAll() {
    const im = state.immobilisations;
    setVal('#bien_nom', state.bien.nom);
    setVal('#bien_adresse', state.bien.adresse);
    setVal('#bien_debut', state.bien.debut);
    setVal('#bien_apport', state.bien.apport);
    setVal('#bien_emprunt_init', state.bien.empruntInitial);
    setVal('#am_immeuble_val', im.immeuble.val); setVal('#am_immeuble_terrain', im.immeuble.terrain); setVal('#am_immeuble_duree', im.immeuble.duree); setVal('#am_immeuble_acq', im.immeuble.acq);
    setVal('#am_mobilier_val', im.mobilier.val); setVal('#am_mobilier_duree', im.mobilier.duree); setVal('#am_mobilier_acq', im.mobilier.acq);
    setVal('#am_travaux_val', im.travaux.val); setVal('#am_travaux_duree', im.travaux.duree); setVal('#am_travaux_acq', im.travaux.acq);
    bootEmprunt();
    renderExerciceBar(); renderRecettes(); renderDepenses(); refresh();
  }

  function init() {
    bootAll();
    bindStaticFields();
    bindTables();
    bindExerciceBar();
    bindExports();
    bindNav();
    bindReveal();
  }
  document.addEventListener('DOMContentLoaded', init);
})();
