(function () {
    'use strict';

    function safeStorageGet(key) {
        try {
            return window.localStorage.getItem(key);
        } catch (error) {
            return null;
        }
    }

    function safeStorageSet(key, value) {
        try {
            window.localStorage.setItem(key, value);
        } catch (error) {
            // Ignore storage failures so the toggle still works for the current page.
        }
    }

    function getTheme() {
        return document.documentElement.getAttribute('data-bs-theme') === 'dark' ? 'dark' : 'light';
    }

    function setTheme(theme) {
        document.documentElement.setAttribute('data-bs-theme', theme);
        safeStorageSet('bdta-theme', theme);
    }

    function getToggleTargets() {
        return Array.prototype.slice.call(document.querySelectorAll('[data-theme-toggle], #darkModeToggle'));
    }

    function updateToggleButton(button) {
        var icon = button.querySelector('[data-theme-icon]') || button.querySelector('#darkModeIcon');
        var label = button.querySelector('[data-theme-label]') || button.querySelector('#darkModeLabel');
        var isDark = getTheme() === 'dark';

        if (icon) {
            icon.className = isDark ? 'fas fa-sun' : 'fas fa-moon';
            if (button.classList.contains('w-100') || button.querySelector('#darkModeLabel')) {
                icon.className += ' me-2';
            }
        }

        if (label) {
            label.textContent = isDark ? 'Light Mode' : 'Dark Mode';
        }
    }

    function updateAllButtons() {
        getToggleTargets().forEach(updateToggleButton);
    }

    function bindToggle(button) {
        if (button.dataset.themeToggleReady === '1') {
            return;
        }

        button.dataset.themeToggleReady = '1';
        button.addEventListener('click', function () {
            setTheme(getTheme() === 'dark' ? 'light' : 'dark');
            updateAllButtons();
        });
    }

    function init() {
        var savedTheme = safeStorageGet('bdta-theme');
        if (savedTheme === 'dark' || savedTheme === 'light') {
            document.documentElement.setAttribute('data-bs-theme', savedTheme);
        }

        getToggleTargets().forEach(bindToggle);
        updateAllButtons();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }

    window.addEventListener('pageshow', updateAllButtons);
}());
