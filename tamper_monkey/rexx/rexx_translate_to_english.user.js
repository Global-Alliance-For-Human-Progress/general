// ==UserScript==
// @name         Rexx Translate to English
// @namespace    http://tampermonkey.net/
// @version      2026.10.02
// @description  Translates the French rexx portal UI (My Workday, time management, absences) into near-native English, including dates and decimal numbers
// @author       Liam
// @match        https://energie360.rexx-systems.com/*
// @run-at       document-end
// @updateURL    https://raw.githubusercontent.com/Global-Alliance-For-Human-Progress/general/main/tamper_monkey/rexx/rexx_translate_to_english.user.js
// @downloadURL  https://raw.githubusercontent.com/Global-Alliance-For-Human-Progress/general/main/tamper_monkey/rexx/rexx_translate_to_english.user.js
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // ---------------------------------------------------------------
    // Glossary (French -> English). Matching is case-insensitive and whole-word,
    // longest phrase first. If a key starts with a capital letter and the text
    // starts lowercase, the English result is lowercased too ("pris" -> "taken").
    // Add new phrases here as you find untranslated ones.
    // ---------------------------------------------------------------
    const GLOSSARY = [
        // Page / navigation
        ["Sauter la barre latérale", "Skip sidebar"],
        ["Mon calendrier", "My calendar"],
        ["Ma gestion temporelle", "My time management"],
        ["Mes absences", "My absences"],
        ["Mon espace de travail", "My workday"],
        ["Aperçu", "Overview"],
        ["Accueil", "Home"],
        ["Déconnexion", "Log out"],
        ["Se déconnecter", "Log out"],
        ["Profil", "Profile"],
        ["Paramètres", "Settings"],
        ["Aide", "Help"],

        // Calendar
        ["Sem.", "Wk"],
        ["lun.", "Mon"], ["mar.", "Tue"], ["mer.", "Wed"], ["jeu.", "Thu"],
        ["ven.", "Fri"], ["sam.", "Sat"], ["dim.", "Sun"],
        ["Lundi", "Monday"], ["Mardi", "Tuesday"], ["Mercredi", "Wednesday"],
        ["Jeudi", "Thursday"], ["Vendredi", "Friday"], ["Samedi", "Saturday"],
        ["Dimanche", "Sunday"],
        ["janv.", "Jan"], ["févr.", "Feb"], ["avr.", "Apr"], ["juil.", "Jul"],
        ["sept.", "Sep"], ["oct.", "Oct"], ["nov.", "Nov"], ["déc.", "Dec"],
        ["janvier", "January"], ["février", "February"], ["mars", "March"],
        ["avril", "April"], ["mai", "May"], ["juin", "June"], ["juillet", "July"],
        ["août", "August"], ["septembre", "September"], ["octobre", "October"],
        ["novembre", "November"], ["décembre", "December"],
        ["Aujourd'hui", "Today"],
        ["Hier", "Yesterday"],
        ["Demain", "Tomorrow"],

        // Time management
        ["Solde de saisie des temps", "Time tracking balance"],
        ["Solde des heures", "Hours balance"],
        ["Solde d'heures", "Hours balance"],
        ["Solde", "Balance"],
        ["Consigne", "Target"],
        ["Réel", "Actual"],
        ["Modèle de temps de travail", "Working time model"],
        ["Temps de travail", "Working time"],
        ["Temps complet", "Full time"],
        ["Temps partiel", "Part time"],
        ["Jours de travail régulières", "Regular working days"],
        ["Jours de travail réguliers", "Regular working days"],
        ["Heures par semaine", "Hours per week"],
        ["Groupes de jours fériés", "Public holiday groups"],
        ["Jours fériés", "Public holidays"],
        ["Heures de consigne", "Target hours"],
        ["Heurs de consigne", "Target hours"],
        ["Contrat Année précédente", "Contract previous year"],
        ["Total cible horaire", "Total target hours"],
        ["Heures réelles", "Actual hours"],
        ["Heures Différence Total", "Total hours difference"],
        ["Heures de travail", "Working hours"],
        ["Heures supplémentaires", "Overtime"],
        ["Heures", "Hours"],
        ["Pas de données trouvées.", "No data found."],
        ["Aucune donnée", "No data"],

        // Absences / leave
        ["Synthèse détaillée des absences/Enregistrements spéciaux", "Detailed absence summary / special entries"],
        ["Vacances", "Vacation"],
        ["Droit actuel + Congés restants", "Current entitlement + remaining leave"],
        ["Droit actuel", "Current entitlement"],
        ["Congés restants Année précédente", "Remaining leave previous year"],
        ["Congés restants année actuelle", "Remaining leave current year"],
        ["Congés restants", "Remaining leave"],
        ["Total des droits", "Total entitlement"],
        ["Remarque (Droit)", "Note (entitlement)"],
        ["Remarque", "Note"],
        ["réservé année actuelle", "Booked current year"],
        ["Pris", "Taken"],
        ["Approuvé", "Approved"],
        ["Planifiés", "Planned"],
        ["Planifié", "Planned"],
        ["Prévu", "Planned"],
        ["Maladie", "Sick leave"],
        ["Somme de tous les types de réservations maladie", "Sum of all sick leave booking types"],
        ["Congé exceptionnel", "Special leave"],
        ["Congé pour l'autre parent", "Leave for the other parent"],
        ["Total de toutes les absences de ce type dans l'exercice en cours.", "Total of all absences of this type in the current fiscal year."],
        ["Congé maternité", "Maternity leave"],
        ["Congé paternité", "Paternity leave"],
        ["Congé", "Leave"],
        ["Absences", "Absences"],
        ["Absence", "Absence"],

        // Units
        ["Jours", "Days"],
        ["Jour", "Day"],

        // Common buttons / labels
        ["Enregistrer", "Save"],
        ["Annuler", "Cancel"],
        ["Supprimer", "Delete"],
        ["Modifier", "Edit"],
        ["Ajouter", "Add"],
        ["Valider", "Confirm"],
        ["Refuser", "Reject"],
        ["Fermer", "Close"],
        ["Rechercher", "Search"],
        ["Précédent", "Previous"],
        ["Suivant", "Next"],
        ["Envoyer", "Submit"],
        ["Demande", "Request"],
        ["Statut", "Status"],
        ["Date de début", "Start date"],
        ["Date de fin", "End date"],
    ];

    // ---------------------------------------------------------------
    const norm = s => s.replace(/[‘’]/g, "'").replace(/\\'/g, "'");
    const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const map = new Map();
    for (const [fr, en] of GLOSSARY) map.set(norm(fr).toLowerCase(), [fr, en]);

    const keys = [...map.keys()].sort((a, b) => b.length - a.length);
    // Whole-word match: not preceded/followed by a letter.
    const phraseRe = new RegExp('(?<![\\p{L}])(?:' + keys.map(escapeRe).join('|') + ')(?![\\p{L}])', 'giu');

    function translate(text) {
        if (!/[\p{L}\d]/u.test(text)) return text;
        let out = norm(text).replace(phraseRe, match => {
            const [fr, en] = map.get(match.toLowerCase());
            const srcLower = match[0] === match[0].toLowerCase();
            const keyUpper = fr[0] !== fr[0].toLowerCase();
            return srcLower && keyUpper ? en[0].toLowerCase() + en.slice(1) : en;
        });
        // Decimal comma -> point (0,0 -> 0.0, 40,00 -> 40.00)
        out = out.replace(/(\d),(\d+)(?!\d)/g, '$1.$2');
        return out;
    }

    // ---------------------------------------------------------------
    const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'PRE', 'NOSCRIPT']);
    const ATTRS = ['title', 'placeholder', 'aria-label', 'alt', 'data-original-title'];

    function translateText(node) {
        const parent = node.parentElement;
        if (parent && SKIP.has(parent.tagName)) return;
        const original = node.nodeValue;
        if (!original || !original.trim()) return;
        const result = translate(original);
        if (result !== original) node.nodeValue = result;
    }

    function translateElement(el) {
        if (SKIP.has(el.tagName)) return;
        for (const attr of ATTRS) {
            const v = el.getAttribute(attr);
            if (v) {
                const t = translate(v);
                if (t !== v) el.setAttribute(attr, t);
            }
        }
        if (el.tagName === 'INPUT' && /^(button|submit|reset)$/i.test(el.type) && el.value) {
            const t = translate(el.value);
            if (t !== el.value) el.value = t;
        }
    }

    function translateTree(root) {
        if (root.nodeType === Node.TEXT_NODE) return translateText(root);
        if (root.nodeType !== Node.ELEMENT_NODE) return;
        translateElement(root);
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
        let n;
        while ((n = walker.nextNode())) {
            if (n.nodeType === Node.TEXT_NODE) translateText(n);
            else translateElement(n);
        }
    }

    // Batch mutations into one pass per frame.
    let pending = new Set();
    let scheduled = false;
    function flush() {
        scheduled = false;
        const nodes = pending;
        pending = new Set();
        for (const n of nodes) if (n.isConnected) translateTree(n);
    }
    new MutationObserver(mutations => {
        for (const m of mutations) {
            if (m.type === 'childList') m.addedNodes.forEach(n => pending.add(n));
            else pending.add(m.target);
        }
        if (!scheduled) {
            scheduled = true;
            requestAnimationFrame(flush);
        }
    }).observe(document.documentElement, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ATTRS,
    });

    translateTree(document.documentElement);
    document.documentElement.lang = 'en';
})();
