# LMNP Compta

Outil web pour loueurs meublés non professionnels (**LMNP au réel**). On saisit les recettes locatives et les dépenses de chaque année, l'application calcule en temps réel le **compte de résultat** et le **bilan**, génère le **FEC** (fichier des écritures comptables) et met en forme la **liasse fiscale** (tableaux 2033).

> **v2** — multi-exercices avec report d'une année sur l'autre + liasse fiscale.

## Lancer

Aucune installation, aucune dépendance npm. Deux options :

- **Le plus simple** : ouvrir `index.html` dans un navigateur (double-clic).
- **Avec un serveur local** (recommandé) :
  ```
  node server.js
  ```
  puis ouvrir http://localhost:4321

## Fonctionnement

Parcours en 6 étapes :

1. **Le bien** — désignation, apport de départ, emprunt initial (données communes à tous les exercices).
2. **Recettes** — loyers encaissés (compte 706) de l'exercice sélectionné.
3. **Dépenses** — charges déductibles classées par catégorie (chaque catégorie = un compte comptable).
4. **Amortissements & financement** — immeuble (hors terrain), mobilier, travaux, avec **année d'acquisition** ; capital emprunté restant dû.
5. **Synthèse** — compte de résultat et bilan de l'exercice.
6. **Liasse fiscale** — tableaux 2033 mis en forme + détermination du résultat fiscal.

Une **barre des exercices** (sous le menu) permet d'ajouter/supprimer des années et de basculer de l'une à l'autre. Les recettes, dépenses, synthèse et liasse sont propres à l'exercice sélectionné ; le report (résultat, amortissements, déficits) se calcule automatiquement d'une année sur l'autre.

Les données sont enregistrées **localement** dans le navigateur (`localStorage`). Rien n'est envoyé en ligne.

## Exports

- **Bilan** (`.csv`) — actif / passif de l'exercice.
- **Compte de résultat** (`.csv`) — produits / charges / résultat.
- **FEC** (`.txt`) — 18 colonnes tabulées, format DGFiP, journaux AN / BQ / AC / OD. À-nouveaux reconstitués depuis la clôture de l'exercice précédent (cumul d'amortissement, report à nouveau, emprunt). Chaque écriture est équilibrée.
- **Liasse fiscale** (`.csv`) — synthèse des tableaux 2033-A/B/C/D + détermination du résultat fiscal.
- **Imprimer / PDF** — vue imprimable de la synthèse ou de la liasse.

## Modèle comptable & fiscal

- Amortissement linéaire avec **report multi-années** : `cumul(année)` calculé depuis l'année d'acquisition, la dernière année absorbe l'arrondi. Immeuble amorti sur `valeur × (1 − %terrain)`.
- **Article 39 C** : l'amortissement ne peut créer ni aggraver un déficit. La part non déductible devient un **amortissement réputé différé (ARD)**, reporté sans limite et déduit dès qu'il y a du bénéfice.
- **Déficits ordinaires** reportables 10 ans, imputés sur les bénéfices fiscaux des exercices suivants.
- Passage **résultat comptable → résultat fiscal** explicité (réintégrations / déductions / imputation des déficits). Le résultat fiscal est le montant à reporter sur la **2042-C-PRO**.
- Bilan équilibré par construction (la trésorerie est la variable d'ajustement, capitaux propres = apport + report cumulé + résultat).

## Limites connues (pistes v3)

- Pas encore de gestion : TVA, plusieurs biens simultanés, prorata temporis la 1ʳᵉ année, plus-values de cession, échéancier d'emprunt détaillé (ventilation capital/intérêts automatique).
- Catégories de charges figées (à rendre paramétrables).
- La liasse couvre les tableaux 2033 essentiels au LMNP ; pas de génération du formulaire 2031 officiel ni de télétransmission EDI-TDFC.
- Modèle simplifié : à valider avec un expert-comptable / centre de gestion avant dépôt réel.

## Structure

```
index.html              page unique (6 étapes + barre des exercices)
assets/css/styles.css   styles + animations
assets/js/app.js        état multi-exercices, calcul chaîné, liasse, exports
server.js               mini serveur statique (preview)
```
