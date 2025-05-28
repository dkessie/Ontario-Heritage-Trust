document.addEventListener('DOMContentLoaded', () => {
    const defaultLang = 'en';
    let currentLang = localStorage.getItem('preferredLang') || defaultLang;
    let translations = {};
    let mapInitialized = false;

    const langButtons = {
        en: document.getElementById('lang-en'),
        fr: document.getElementById('lang-fr')
    };

    const navLinks = document.querySelectorAll('.site-navigation .nav-link');
    const pageSections = document.querySelectorAll('.page-section');

    async function loadTranslations(lang) {
        try {
            const response = await fetch(`i18n/${lang}.json`);
            if (!response.ok) {
                throw new Error(`Failed to load ${lang}.json: ${response.statusText}`);
            }
            translations = await response.json();
            applyTranslations();
            localStorage.setItem('preferredLang', lang);
            currentLang = lang;
            updateLangButtonStates();
            document.documentElement.lang = lang; // Update HTML lang attribute
        } catch (error) {
            console.error("Error loading translations:", error);
            if (lang !== 'en') { // Fallback to English if error and not already English
                loadTranslations('en');
            }
        }
    }

    function applyTranslations() {
        document.querySelectorAll('[data-i18n-key]').forEach(el => {
            const key = el.getAttribute('data-i18n-key');
            const translation = getNestedTranslation(key);
            if (translation) {
                el.innerHTML = translation; // Use innerHTML to support simple HTML in translations (like ©)
            }
        });
        document.querySelectorAll('[data-i18n-title-key]').forEach(el => {
            const key = el.getAttribute('data-i18n-title-key');
            const translation = getNestedTranslation(key);
            if (translation) {
                el.setAttribute('title', translation);
            }
        });
        // Special case for placeholders if any
        document.querySelectorAll('[data-i18n-placeholder-key]').forEach(el => {
            const key = el.getAttribute('data-i18n-placeholder-key');
            const translation = getNestedTranslation(key);
            if (translation) {
                el.setAttribute('placeholder', translation);
            }
        });

        // Update dynamic text in map script if map is initialized
        if (mapInitialized && typeof window.updateMapUIText === 'function') {
            window.updateMapUIText();
        }
    }

    function getNestedTranslation(keyString) {
        if (!translations) return null;
        return keyString.split('.').reduce((obj, key) => obj && obj[key], translations) || null;
    }
    
    // Expose for map script
    window.getTranslatedString = (keyString, replacements) => {
        let translated = getNestedTranslation(keyString);
        if (translated && replacements) {
            for (const placeholder in replacements) {
                translated = translated.replace(`{${placeholder}}`, replacements[placeholder]);
            }
        }
        return translated || keyString; // Fallback to key if not found
    };

    function updateLangButtonStates() {
        Object.values(langButtons).forEach(btn => btn.classList.remove('active'));
        if (langButtons[currentLang]) {
            langButtons[currentLang].classList.add('active');
        }
    }

    Object.entries(langButtons).forEach(([lang, button]) => {
        button.addEventListener('click', () => loadTranslations(lang));
    });

    function showPage(targetPageId) {
        pageSections.forEach(section => {
            section.classList.remove('active');
        });
        const targetSection = document.getElementById(targetPageId);
        if (targetSection) {
            targetSection.classList.add('active');
        }

        if (targetPageId === 'map-page' && !mapInitialized) {
            if (typeof initializeApp === 'function') { // Check if map script's init function exists
                initializeApp(); // This is from your original script.js
                mapInitialized = true;
            } else {
                console.error("Map initialization function (initializeApp) not found.");
            }
        }
        window.scrollTo(0,0); // Scroll to top on page change
    }

    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            navLinks.forEach(l => l.classList.remove('active'));
            link.classList.add('active');
            
            const targetPageId = link.getAttribute('data-section');
            showPage(targetPageId);

            // Update URL hash for bookmarking/navigation
            history.pushState(null, null, link.getAttribute('href'));
        });
    });

    // Handle hash changes (e.g. back/forward buttons or direct link)
    function handleHashChange() {
        const hash = window.location.hash || '#home'; // Default to home
        const targetLink = document.querySelector(`.site-navigation .nav-link[href="${hash}"]`);
        if (targetLink) {
            navLinks.forEach(l => l.classList.remove('active'));
            targetLink.classList.add('active');
            showPage(targetLink.getAttribute('data-section'));
        } else {
            showPage('home-page'); // Fallback to home if hash is invalid
        }
    }

    window.addEventListener('popstate', handleHashChange); // For back/forward
    
    // Initial load
    loadTranslations(currentLang).then(() => {
        handleHashChange(); // Show initial page based on hash or default
    });
});