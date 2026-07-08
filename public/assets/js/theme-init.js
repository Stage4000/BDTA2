(function () {
    'use strict';

    function safeStorageGet(key) {
        try {
            return window.localStorage.getItem(key);
        } catch (error) {
            return null;
        }
    }

    var saved = safeStorageGet('bdta-theme');
    var theme = (saved === 'dark' || saved === 'light') ? saved : 'light';

    document.documentElement.setAttribute('data-bs-theme', theme);
}());
