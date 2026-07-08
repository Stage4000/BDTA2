(function () {
    'use strict';

    function safeStorageSet(key, value) {
        try {
            window.localStorage.setItem(key, value);
        } catch (error) {
            // Ignore storage failures so auth pages still toggle for the current session.
        }
    }

    function updateToggle() {
        var isDark = document.documentElement.getAttribute('data-bs-theme') === 'dark';
        var icon = document.getElementById('darkModeIcon');
        var label = document.getElementById('darkModeLabel');

        if (icon) {
            icon.className = isDark ? 'fas fa-sun' : 'fas fa-moon';
        }

        if (label) {
            label.textContent = isDark ? 'Light Mode' : 'Dark Mode';
        }
    }

    function init() {
        var btn = document.getElementById('darkModeToggle');

        updateToggle();

        if (!btn) {
            return;
        }

        btn.addEventListener('click', function () {
            var next = document.documentElement.getAttribute('data-bs-theme') === 'dark' ? 'light' : 'dark';

            document.documentElement.setAttribute('data-bs-theme', next);
            safeStorageSet('bdta-theme', next);
            updateToggle();
        });
    }

    init();
}());
