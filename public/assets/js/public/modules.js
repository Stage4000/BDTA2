// ==========================================
// BDTA Dynamic Modules – Services, Packages & Events
// ==========================================
// Initialises any `.bdta-services-module`, `.bdta-packages-module`, and `.bdta-events-module` sections
// found on the page.  Designed to run on pages served by page.php, index.php,
// and inside the GrapesJS editor canvas (added to canvas.scripts).
//
// Works alongside the public site bundle in assets/js/public/site.js, which handles the homepage's
// ID-based #services-grid / #packages-grid / #events-grid; these class-based selectors are
// used exclusively for blocks added through the site editor.
// ==========================================

(function () {
    'use strict';

    // ---- Shared utilities ----

    /** Escape a string for safe insertion as HTML text content */
    function escH(s) {
        if (s === null || s === undefined) return '';
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    /** Format a HH:MM time string to a human-readable 12-hour format */
    function fmtTime(timeStr) {
        if (!timeStr) return '';
        var parts = timeStr.split(':');
        if (parts.length < 2) return timeStr;
        var h = parseInt(parts[0], 10);
        var m = parseInt(parts[1], 10);
        if (isNaN(h) || isNaN(m)) return timeStr;
        var ampm = h >= 12 ? 'PM' : 'AM';
        h = h % 12 || 12;
        return h + ':' + (m < 10 ? '0' + m : m) + ' ' + ampm;
    }

    function sanitizeClassNames(classNames, fallback) {
        if (typeof classNames !== 'string' || !/^[A-Za-z0-9 _-]+$/.test(classNames)) return fallback;
        return classNames;
    }

    function renderBulletSection(points, title, wrapperClass) {
        if (!Array.isArray(points) || points.length === 0) return '';

        var safeWrapperClass = sanitizeClassNames(wrapperClass || 'mb-4', 'mb-4');
        var html = '<div class="' + safeWrapperClass + '">';
        if (title) {
            html += '<div class="fw-semibold text-dark small text-uppercase mb-2">' + escH(title) + '</div>';
        }
        html += '<ul class="list-unstyled mb-0">';
        points.forEach(function (point) {
            html += '<li class="mb-2 d-flex align-items-start">'
                + '<i class="fas fa-circle-check text-success me-2 mt-1"></i>'
                + '<span>' + escH(point) + '</span>'
                + '</li>';
        });
        html += '</ul></div>';
        return html;
    }

    // ---- Services module ----

    function initServices(sec) {
        sec.setAttribute('data-bdta-loaded', '1');
        var grid    = sec.querySelector('.bdta-services-grid');
        var loading = sec.querySelector('.bdta-services-loading');
        var empty   = sec.querySelector('.bdta-services-empty');
        if (!grid) {
            if (loading) loading.remove();
            if (empty) empty.classList.remove('d-none');
            return;
        }

        function getServicePriceText(price) {
            var numericPrice = Number(price);
            if (!Number.isFinite(numericPrice) || numericPrice < 0) {
                return 'Contact Us';
            }
            if (numericPrice === 0) {
                return 'Free';
            }
            return '$' + numericPrice.toFixed(2);
        }

        fetch('/backend/public/api_services.php')
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (loading) loading.remove();
                var services = (data && Array.isArray(data.services)) ? data.services : [];
                if (services.length === 0) {
                    if (empty) empty.classList.remove('d-none');
                    return;
                }
                services.forEach(function (service) {
                    var priceText = getServicePriceText(service.price);
                    var detailBits = [];
                    if (service.duration_minutes > 0) {
                        detailBits.push(service.duration_minutes + ' min');
                    }
                    if (service.location) {
                        detailBits.push(service.location);
                    }

                    var typeBadge = service.type_label
                        ? '<span class="badge bg-warning text-dark mb-3">' + escH(service.type_label) + '</span>'
                        : '';
                    var detailsHtml = detailBits.length > 0
                        ? '<p class="text-muted small mb-3"><i class="fas fa-circle-info text-primary me-1"></i>' + escH(detailBits.join(' • ')) + '</p>'
                        : '';
                    var bulletPointsHtml = renderBulletSection(service.bullet_points, "What's Included");
                    var ctaHtml = service.booking_url
                        ? '<a href="' + escH(service.booking_url) + '" class="btn btn-primary mt-auto">'
                          + '<i class="fas fa-calendar-check me-2"></i>Book Now</a>'
                        : '<a href="/#contact" class="btn btn-outline-primary mt-auto">Contact Us</a>';

                    var col = document.createElement('div');
                    col.className = 'col-md-6 col-lg-4';
                    // Dynamic text below is escaped with escH() or renderBulletSection() before insertion.
                    // nosemgrep
                    col.innerHTML = '<div class="service-card card h-100 border-0 shadow-sm">'
                        + '<div class="card-body p-4 d-flex flex-column">'
                        + '<div class="service-icon bg-primary bg-opacity-10 rounded-circle d-inline-flex align-items-center justify-content-center mb-4" style="width:80px;height:80px;">'
                        + '<i class="fas fa-dog text-primary fs-2"></i></div>'
                        + typeBadge
                        + '<h4 class="fw-bold mb-2">' + escH(service.name) + '</h4>'
                        + '<p class="text-primary fw-bold fs-5 mb-2">' + escH(priceText) + '</p>'
                        + (service.description ? '<p class="text-muted mb-3">' + escH(service.description) + '</p>' : '')
                        + detailsHtml
                        + bulletPointsHtml
                        + ctaHtml
                        + '</div></div>';
                    grid.appendChild(col);
                });
            })
            .catch(function () {
                if (loading) loading.remove();
                if (empty) empty.classList.remove('d-none');
            });
    }

    // ---- Packages module ----

    function initPackages(sec) {
        sec.setAttribute('data-bdta-loaded', '1');
        var grid    = sec.querySelector('.bdta-packages-grid');
        var loading = sec.querySelector('.bdta-packages-loading');
        var empty   = sec.querySelector('.bdta-packages-empty');
        if (!grid) return;

        fetch('/backend/public/api_packages.php')
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (loading) loading.remove();
                var pkgs = (data && Array.isArray(data.packages)) ? data.packages : [];
                if (pkgs.length === 0) {
                    if (empty) empty.classList.remove('d-none');
                    return;
                }
                pkgs.forEach(function (pkg) {
                    var priceText = pkg.price > 0
                        ? '$' + Number(pkg.price).toFixed(2)
                        : 'Contact Us';

                    var itemsHtml = '';
                    if (pkg.items && pkg.items.length > 0) {
                        itemsHtml = '<div class="fw-semibold text-dark small text-uppercase mb-2">Credits Included</div>';
                        itemsHtml += '<ul class="list-unstyled mb-4">';
                        pkg.items.forEach(function (item) {
                            itemsHtml += '<li class="mb-2">'
                                + '<i class="fas fa-check-circle text-success me-2"></i>'
                                + escH(item.quantity + '\u00d7 ' + item.apt_type_name)
                                + '</li>';
                        });
                        itemsHtml += '</ul>';
                    }

                    var bulletPointsHtml = renderBulletSection(pkg.bullet_points, "What's Included");

                    var expiryHtml = pkg.expiration_days
                        ? '<small class="text-muted d-block mb-3">Credits valid for ' + pkg.expiration_days + ' days</small>'
                        : '';

                    var ctaHtml = pkg.purchase_url
                        ? '<a href="' + escH(pkg.purchase_url) + '" class="btn btn-primary mt-auto" target="_blank" rel="noopener">'
                          + '<i class="fas fa-shopping-cart me-2"></i>Purchase Package</a>'
                        : '<a href="/#contact" class="btn btn-outline-primary mt-auto">Contact Us</a>';

                    var col = document.createElement('div');
                    col.className = 'col-md-6 col-lg-4';
                    // All interpolated values are escaped with escH() before insertion into this fixed template.
                    // nosemgrep
                    col.innerHTML = '<div class="service-card card h-100 border-0 shadow-sm">'
                        + '<div class="card-body p-4 d-flex flex-column">'
                        + '<div class="service-icon bg-primary bg-opacity-10 rounded-circle d-inline-flex align-items-center justify-content-center mb-4" style="width:80px;height:80px;">'
                        + '<i class="fas fa-box-open text-primary fs-2"></i></div>'
                        + '<h4 class="fw-bold mb-2">' + escH(pkg.name) + '</h4>'
                        + '<p class="text-primary fw-bold fs-5 mb-2">' + escH(priceText) + '</p>'
                        + (pkg.description ? '<p class="text-muted mb-3">' + escH(pkg.description) + '</p>' : '')
                        + bulletPointsHtml + itemsHtml + expiryHtml + ctaHtml
                        + '</div></div>';
                    grid.appendChild(col);
                });
            })
            .catch(function () {
                if (loading) loading.remove();
                if (empty) empty.classList.remove('d-none');
            });
    }

    // ---- Events module ----

    function initEvents(sec) {
        sec.setAttribute('data-bdta-loaded', '1');
        var grid    = sec.querySelector('.bdta-events-grid');
        var loading = sec.querySelector('.bdta-events-loading');
        var empty   = sec.querySelector('.bdta-events-empty');
        if (!grid) return;

        fetch('/backend/public/api_events.php')
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (loading) loading.remove();
                var evts = (data && Array.isArray(data.events)) ? data.events : [];
                if (evts.length === 0) {
                    if (empty) empty.classList.remove('d-none');
                    return;
                }
                evts.forEach(function (evt) {
                    var isGroup = evt.type === 'group_class';
                    var isMini  = evt.type === 'mini_session';
                    var booked  = !!evt.fully_booked;

                    var dateObj = evt.date ? new Date(evt.date + 'T00:00:00') : null;
                    var dateStr = dateObj
                        ? dateObj.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
                        : '';

                    var timeStr = fmtTime(evt.start_time);
                    if (isGroup) {
                        timeStr += ' (' + evt.duration_minutes + ' min)';
                    } else if (isMini) {
                        timeStr = fmtTime(evt.start_time) + ' \u2013 ' + fmtTime(evt.end_time);
                    }

                    var priceText = evt.price > 0
                        ? '$' + Number(evt.price).toFixed(2)
                        : 'Contact Us';

                    var typeBadge = isGroup
                        ? '<span class="badge bg-primary mb-3">Group Class</span>'
                        : '<span class="badge bg-info text-dark mb-3">Mini Sessions</span>';

                    var locHtml = ((isMini && evt.location) || (isGroup && evt.location))
                        ? '<p class="mb-1 small"><i class="fas fa-location-dot text-primary me-1"></i>' + escH(evt.location) + '</p>'
                        : '';

                    var topicHtml = (isMini && evt.topic)
                        ? '<p class="mb-2 small"><i class="fas fa-tag text-secondary me-1"></i>' + escH(evt.topic) + '</p>'
                        : '';

                    var ctaHtml;
                    if (booked) {
                        ctaHtml = '<span class="badge bg-danger py-2 px-3 mt-auto">Fully Booked</span>';
                    } else if (evt.booking_url) {
                        ctaHtml = '<a href="' + escH(evt.booking_url) + '" class="btn btn-sm btn-primary mt-auto" target="_blank" rel="noopener">'
                            + '<i class="fas fa-calendar-check me-1"></i>Book Now</a>';
                    } else {
                        ctaHtml = '<a href="/#contact" class="btn btn-sm btn-outline-primary mt-auto">Register</a>';
                    }

                    var bulletPointsHtml = renderBulletSection(evt.bullet_points, "What You'll Learn", 'mb-3');

                    var col = document.createElement('div');
                    col.className = 'col-md-6 col-lg-4';
                    // All interpolated values are escaped with escH() before insertion into this fixed template.
                    // nosemgrep
                    col.innerHTML = '<div class="card h-100 border-0 shadow-sm' + (booked ? ' opacity-75' : '') + '">'
                        + '<div class="card-body p-4 d-flex flex-column">'
                        + '<div class="mb-2"><i class="fas fa-calendar-days text-primary fs-1"></i></div>'
                        + typeBadge
                        + '<h5 class="fw-bold mb-2">' + escH(evt.name) + '</h5>'
                        + (evt.description ? '<p class="text-muted mb-2 small">' + escH(evt.description) + '</p>' : '')
                        + bulletPointsHtml
                        + '<div class="mb-2">'
                        + (dateStr ? '<p class="mb-1 small"><i class="fas fa-calendar text-primary me-1"></i>' + escH(dateStr) + '</p>' : '')
                        + '<p class="mb-1 small"><i class="fas fa-clock text-primary me-1"></i>' + escH(timeStr) + '</p>'
                        + locHtml + topicHtml
                        + '<p class="mb-0 small fw-bold"><i class="fas fa-tag text-primary me-1"></i>' + escH(priceText) + '</p>'
                        + '</div>'
                        + ctaHtml
                        + '</div></div>';
                    grid.appendChild(col);
                });
            })
            .catch(function () {
                if (loading) loading.remove();
                if (empty) empty.classList.remove('d-none');
            });
    }

    // ---- Initialisation ----

    function init() {
        document.querySelectorAll('.bdta-services-module:not([data-bdta-loaded])').forEach(initServices);
        document.querySelectorAll('.bdta-packages-module:not([data-bdta-loaded])').forEach(initPackages);
        document.querySelectorAll('.bdta-events-module:not([data-bdta-loaded])').forEach(initEvents);
    }

    function watchForDynamicModules() {
        if (typeof MutationObserver === 'undefined' || !document.body) {
            return;
        }

        var pending = false;
        var observer = new MutationObserver(function (mutations) {
            var shouldInit = mutations.some(function (mutation) {
                return Array.prototype.some.call(mutation.addedNodes, function (node) {
                    return node.nodeType === 1
                        && (
                            node.matches('.bdta-services-module, .bdta-packages-module, .bdta-events-module')
                            || node.querySelector('.bdta-services-module, .bdta-packages-module, .bdta-events-module')
                        );
                });
            });

            if (!shouldInit || pending) {
                return;
            }

            pending = true;
            window.requestAnimationFrame(function () {
                pending = false;
                init();
            });
        });

        observer.observe(document.body, { childList: true, subtree: true });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
            init();
            watchForDynamicModules();
        });
    } else {
        init();
        watchForDynamicModules();
    }
})();
