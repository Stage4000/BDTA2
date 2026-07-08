(function () {
    'use strict';

    function initSearchableSelect(select) {
        if (!select || select.dataset.searchableReady === '1') {
            return;
        }

        select.dataset.searchableReady = '1';

        var searchWrapper = document.createElement('div');
        searchWrapper.className = 'mb-2';

        var searchInput = document.createElement('input');
        searchInput.type = 'search';
        searchInput.className = 'form-control';
        searchInput.placeholder = select.dataset.searchPlaceholder || 'Search...';
        searchInput.setAttribute('aria-label', select.dataset.searchPlaceholder || 'Search');

        var originalOptions = Array.prototype.map.call(select.options, function (option) {
            return {
                value: option.value,
                text: option.text,
                selected: option.selected,
                disabled: option.disabled
            };
        });

        function renderOptions() {
            var searchTerm = searchInput.value.trim().toLowerCase();
            var currentValue = select.value;
            select.innerHTML = '';

            var matches = originalOptions.filter(function (option) {
                return option.value === '' ||
                    option.value === currentValue ||
                    option.text.toLowerCase().indexOf(searchTerm) !== -1;
            });

            if (matches.length === 0) {
                var noMatchOption = document.createElement('option');
                noMatchOption.value = '';
                noMatchOption.textContent = 'No matches found';
                noMatchOption.disabled = true;
                select.appendChild(noMatchOption);
                return;
            }

            matches.forEach(function (optionData) {
                var option = document.createElement('option');
                option.value = optionData.value;
                option.textContent = optionData.text;
                option.disabled = optionData.disabled;
                option.selected = optionData.value === currentValue;
                select.appendChild(option);
            });
        }

        searchInput.addEventListener('input', renderOptions);
        if (select.form) {
            select.form.addEventListener('reset', function () {
                searchInput.value = '';
                renderOptions();
            });
        }

        select.parentNode.insertBefore(searchWrapper, select);
        searchWrapper.appendChild(searchInput);
    }

    function init() {
        Array.prototype.forEach.call(document.querySelectorAll('select[data-searchable-select]'), initSearchableSelect);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
}());
