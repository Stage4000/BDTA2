(function (window, document) {
    'use strict';

    function getWidgetElement(scope) {
        if (!scope || !scope.querySelector) {
            return null;
        }

        return scope.querySelector('.bdta-turnstile[data-widget-id]');
    }

    function renderWidgets() {
        if (!window.turnstile || !document.querySelectorAll) {
            return;
        }

        document.querySelectorAll('.bdta-turnstile[data-sitekey]').forEach(function (element) {
            if (element.getAttribute('data-widget-id')) {
                return;
            }

            const widgetId = window.turnstile.render(element, {
                sitekey: element.getAttribute('data-sitekey'),
                theme: element.getAttribute('data-theme') || 'auto'
            });

            element.setAttribute('data-widget-id', String(widgetId));
        });
    }

    window.bdtaRenderTurnstileWidgets = renderWidgets;

    window.bdtaGetTurnstileResponse = function (scope) {
        if (!scope || !scope.querySelector) {
            return '';
        }

        const responseField = scope.querySelector('input[name="cf-turnstile-response"]');
        if (responseField && responseField.value) {
            return responseField.value;
        }

        const widgetElement = getWidgetElement(scope);
        if (!widgetElement || !window.turnstile) {
            return '';
        }

        return window.turnstile.getResponse(widgetElement.getAttribute('data-widget-id')) || '';
    };

    window.bdtaResetTurnstile = function (scope) {
        const widgetElement = getWidgetElement(scope);
        if (!widgetElement || !window.turnstile) {
            return;
        }

        window.turnstile.reset(widgetElement.getAttribute('data-widget-id'));
    };

    document.addEventListener('DOMContentLoaded', renderWidgets, { once: true });
})(window, document);
