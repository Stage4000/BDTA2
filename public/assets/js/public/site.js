// ==========================================
// Brooks Dog Training Academy - Custom JavaScript
// ==========================================

// Initialize on DOM load
onDocumentReady(function() {
    // Initialize AOS (Animate On Scroll) if available
    if (typeof AOS !== 'undefined') {
        AOS.init({
            duration: 800,
            easing: 'ease-in-out',
            once: true,
            offset: 100
        });
    }
    
    // Initialize all components
    normalizePublicNavigation();
    initNavigation();
    initBackToTop();
    initContactForm();
    initSmoothScroll();
    initDynamicHomepageSections();
    initLazyImages();
    initStatCounters();
    watchDynamicHomepageSections();
});

window.addEventListener('pageshow', function() {
    normalizePublicNavigation();
});

// ==========================================
// Navigation Functions
// ==========================================
function initNavigation() {
    const navbar = document.querySelector('.navbar');
    const navLinks = document.querySelectorAll('.nav-link');
    const sectionNavLinks = Array.from(navLinks).filter(function (link) {
        return link.hash !== '';
    });
    
    if (!navbar) return;
    
    const updateNavigationState = throttleWithAnimationFrame(function() {
        if (window.scrollY > 50) {
            navbar.classList.add('shadow');
        } else {
            navbar.classList.remove('shadow');
        }

        let current = '';
        const sections = document.querySelectorAll('section[id]');

        sections.forEach(function(section) {
            if (window.pageYOffset >= section.offsetTop - 100) {
                current = section.getAttribute('id') || '';
            }
        });

        sectionNavLinks.forEach(function(link) {
            link.classList.toggle('active', link.hash === '#' + current);
        });
    });

    window.addEventListener('scroll', updateNavigationState, { passive: true });
    updateNavigationState();
    
    // Close mobile menu on link click
    navLinks.forEach(link => {
        link.addEventListener('click', function() {
            const navbarCollapse = document.querySelector('.navbar-collapse');
            if (navbarCollapse && navbarCollapse.classList.contains('show') && typeof bootstrap !== 'undefined') {
                const bsCollapse = new bootstrap.Collapse(navbarCollapse);
                bsCollapse.hide();
            }
        });
    });
}

function normalizePublicNavigation() {
    const navList = document.querySelector('.navbar .navbar-nav');
    if (!navList) return;

    const directoryHref = '/page.php?slug=directory';
    const hasDirectoryLink = Array.from(navList.querySelectorAll('.nav-link')).some(function (link) {
        return link.getAttribute('href') === directoryHref;
    });
    if (!hasDirectoryLink) {
        const blogItem = Array.from(navList.querySelectorAll('.nav-item')).find(function (item) {
            const link = item.querySelector('.nav-link');
            return link && link.textContent.trim() === 'Blog';
        });
        if (!blogItem) return;

        const directoryItem = document.createElement('li');
        directoryItem.className = 'nav-item';

        const directoryLink = document.createElement('a');
        directoryLink.className = 'nav-link';
        directoryLink.href = directoryHref;
        directoryLink.textContent = 'Directory';

        directoryItem.appendChild(directoryLink);
        navList.insertBefore(directoryItem, blogItem);
    }
}

// ==========================================
// Back to Top Button
// ==========================================
function initBackToTop() {
    const backToTopBtn = document.getElementById('backToTop');
    
    if (!backToTopBtn) return;
    
    const updateBackToTopVisibility = throttleWithAnimationFrame(function() {
        backToTopBtn.classList.toggle('d-none', window.scrollY <= 300);
    });

    window.addEventListener('scroll', updateBackToTopVisibility, { passive: true });
    updateBackToTopVisibility();
    
    // Scroll to top on click
    backToTopBtn.addEventListener('click', function(e) {
        e.preventDefault();
        window.scrollTo({
            top: 0,
            behavior: 'smooth'
        });
    });
}

// ==========================================
// Contact Form
// ==========================================
function initContactForm() {
    const contactForm = document.getElementById('contactForm');
    const formMessage = document.getElementById('formMessage');
    
    if (!contactForm || !formMessage) return;
    
    contactForm.addEventListener('submit', function(e) {
        e.preventDefault();
        
        // Get form values
        const name = document.getElementById('name').value;
        const email = document.getElementById('email').value;
        const phone = document.getElementById('phone').value;
        const service = document.getElementById('service').value;
        const message = document.getElementById('message').value;
        
        // Validate form
        if (!name || !email || !message) {
            setStatusMessage(formMessage, 'Please fill in all required fields.', 'error');
            return;
        }
        
        if (!validateEmail(email)) {
            setStatusMessage(formMessage, 'Please enter a valid email address.', 'error');
            return;
        }

        const turnstileToken = typeof window.bdtaGetTurnstileResponse === 'function'
            ? window.bdtaGetTurnstileResponse(contactForm)
            : '';
        const turnstileWidget = contactForm.querySelector('.bdta-turnstile');
        if (turnstileWidget && !turnstileToken) {
            setStatusMessage(formMessage, 'Please confirm you are not a robot and try again.', 'error');
            return;
        }
        
        const submitBtn = contactForm.querySelector('button[type="submit"]');
        const originalButtonHTML = submitBtn.innerHTML;
        // This fixed template does not interpolate user-controlled values.
        // nosemgrep
        submitBtn.innerHTML = '<span class="loading"></span> Sending...';
        submitBtn.disabled = true;
        
        fetchJson('/backend/public/api_contact.php', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name: name,
                email: email,
                phone: phone,
                service: service,
                message: message,
                turnstile_token: turnstileToken
            })
        })
            .then(data => {
                if (!data.success) {
                    throw new Error(data.error || 'Unable to send message.');
                }

                contactForm.reset();
                if (typeof window.bdtaResetTurnstile === 'function') {
                    window.bdtaResetTurnstile(contactForm);
                }
                setStatusMessage(formMessage, 'Thank you for contacting us! We\'ll get back to you within 24 hours.', 'success');
            })
            .catch(error => {
                setStatusMessage(formMessage, error.message || 'Unable to send message right now. Please try again.', 'error');
            })
            .finally(() => {
                // Restoring the original static button markup captured before the loading state.
                // nosemgrep
                submitBtn.innerHTML = originalButtonHTML;
                submitBtn.disabled = false;
            });
    });
}

// ==========================================
// Helper Functions
// ==========================================

function onDocumentReady(callback) {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', callback, { once: true });
    } else {
        callback();
    }
}

function throttleWithAnimationFrame(callback) {
    let queued = false;

    return function throttledCallback() {
        if (queued) {
            return;
        }

        queued = true;
        window.requestAnimationFrame(function() {
            queued = false;
            callback();
        });
    };
}

function fetchJson(url, options) {
    return fetch(url, options).then(function(response) {
        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
            throw new Error('Unable to complete that request right now. Please try again.');
        }

        return response.json().then(function(data) {
            if (!response.ok) {
                throw new Error((data && data.error) || 'Unable to complete that request right now. Please try again.');
            }

            return data;
        });
    });
}

function clearChildren(node) {
    while (node.firstChild) {
        node.removeChild(node.firstChild);
    }
}

// Validate email format
function validateEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
}

function setStatusMessage(container, message, type) {
    if (!container) {
        return;
    }

    const alertClass = type === 'success' ? 'alert-success-custom' : 'alert-error-custom';
    const alert = document.createElement('div');
    alert.className = 'alert-custom ' + alertClass;
    alert.textContent = message;

    clearChildren(container);
    container.appendChild(alert);

    // Auto-hide after 5 seconds
    setTimeout(function() {
        clearChildren(container);
    }, 5000);
}

// Show form message
function showFormMessage(message, type) {
    setStatusMessage(document.getElementById('formMessage'), message, type);
}

// Smooth scroll to section
function initSmoothScroll() {
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function(e) {
            const href = this.getAttribute('href');
            
            // Skip if it's just "#"
            if (href === '#' || href === '#!') {
                e.preventDefault();
                return;
            }
            
            const target = document.querySelector(href);
            if (target) {
                e.preventDefault();
                const offsetTop = target.offsetTop - 80; // Account for fixed navbar
                
                window.scrollTo({
                    top: offsetTop,
                    behavior: 'smooth'
                });
            }
        });
    });
}

// ==========================================
// Additional Interactive Features
// ==========================================

// Lazy load images (if using actual images)
function initLazyImages() {
    if ('IntersectionObserver' in window) {
        const imageObserver = new IntersectionObserver(function(entries, observer) {
            entries.forEach(function(entry) {
                if (entry.isIntersecting) {
                    const img = entry.target;
                    if (img.dataset.src) {
                        img.src = img.dataset.src;
                        img.classList.add('fade-in-up');
                        observer.unobserve(img);
                    }
                }
            });
        });
        
        const images = document.querySelectorAll('img[data-src]');
        images.forEach(function(img) {
            imageObserver.observe(img);
        });
    }
}

// Counter animation for statistics
function animateCounter(element, target, suffix = '', duration = 2000) {
    let start = 0;
    const increment = target / (duration / 16); // 60fps
    
    const timer = setInterval(function() {
        start += increment;
        if (start >= target) {
            element.textContent = target + suffix;
            clearInterval(timer);
        } else {
            element.textContent = Math.floor(start) + suffix;
        }
    }, 16);
}

// Initialize counters when they come into view
function initStatCounters() {
    const stats = document.querySelectorAll('.stat-item h3');
    if ('IntersectionObserver' in window && stats.length > 0) {
        const statsObserver = new IntersectionObserver(function(entries) {
            entries.forEach(function(entry) {
                if (entry.isIntersecting) {
                    const target = entry.target;
                    const text = target.textContent.trim();
                    const number = parseInt(text.replace(/\D/g, ''));
                    const suffix = text.replace(/[0-9]/g, '').trim();
                    
                    if (number && !isNaN(number)) {
                        target.textContent = '0' + suffix;
                        animateCounter(target, number, suffix, 2000);
                        statsObserver.unobserve(target);
                    }
                }
            });
        }, { threshold: 0.5 });
        
        stats.forEach(function(stat) {
            statsObserver.observe(stat);
        });
    }
}

// ==========================================
// Dynamic Services Section
// ==========================================
function initDynamicHomepageSections() {
    loadServices();
    loadPackages();
    loadEvents();
}

function loadServices() {
    var grid    = document.getElementById('services-grid');
    var loading = document.getElementById('services-loading');
    var empty   = document.getElementById('services-empty');

    if (!grid || grid.getAttribute('data-bdta-loaded') === '1' || grid.getAttribute('data-bdta-loading') === '1') return;

    grid.setAttribute('data-bdta-loading', '1');

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

    fetchJson('backend/public/api_services.php')
        .then(function(data) {
            if (loading) loading.remove();

            var services = (data && Array.isArray(data.services)) ? data.services : [];
            if (services.length === 0) {
                grid.removeAttribute('data-bdta-loading');
                grid.setAttribute('data-bdta-loaded', '1');
                if (empty) empty.classList.remove('d-none');
                return;
            }

            services.forEach(function(service, idx) {
                var delay = ((idx % 3) + 1) * 100;
                var priceText = getServicePriceText(service.price);
                var detailBits = [];

                if (service.duration_minutes > 0) {
                    detailBits.push(service.duration_minutes + ' min');
                }
                if (service.location) {
                    detailBits.push(service.location);
                }

                var typeBadge = service.type_label
                    ? '<span class="badge bg-warning text-dark mb-3">' + escapeHtml(service.type_label) + '</span>'
                    : '';
                var detailsHtml = detailBits.length > 0
                    ? '<p class="text-muted small mb-3"><i class="fas fa-circle-info text-primary me-1"></i>' + escapeHtml(detailBits.join(' • ')) + '</p>'
                    : '';
                var bulletPointsHtml = renderBulletSection(service.bullet_points, "What's Included");
                var ctaHtml = service.booking_url
                    ? '<a href="' + escapeHtml(service.booking_url) + '" class="btn btn-primary mt-auto">'
                      + '<i class="fas fa-calendar-check me-2"></i>Book Now</a>'
                    : '<a href="/#contact" class="btn btn-outline-primary mt-auto">Contact Us</a>';

                var col = document.createElement('div');
                col.className = 'col-md-6 col-lg-4';
                col.setAttribute('data-aos', 'fade-up');
                col.setAttribute('data-aos-delay', delay);
                // Dynamic text below is escaped with escapeHtml() or renderBulletSection() before insertion.
                // nosemgrep
                col.innerHTML = '<div class="service-card card h-100 border-0 shadow-sm hover-lift">'
                    + '<div class="card-body p-4 d-flex flex-column">'
                    + '<div class="service-icon bg-primary bg-opacity-10 rounded-circle d-inline-flex align-items-center justify-content-center mb-4" style="width:80px;height:80px;">'
                    + '<i class="fas fa-dog text-primary fs-2"></i></div>'
                    + typeBadge
                    + '<h4 class="fw-bold mb-2">' + escapeHtml(service.name) + '</h4>'
                    + '<p class="text-primary fw-bold fs-5 mb-2">' + escapeHtml(priceText) + '</p>'
                    + (service.description ? '<p class="text-muted mb-3">' + escapeHtml(service.description) + '</p>' : '')
                    + detailsHtml
                    + bulletPointsHtml
                    + ctaHtml
                    + '</div></div>';
                grid.appendChild(col);
            });

            grid.removeAttribute('data-bdta-loading');
            grid.setAttribute('data-bdta-loaded', '1');
            if (typeof AOS !== 'undefined') { AOS.refreshHard(); }
        })
        .catch(function() {
            grid.removeAttribute('data-bdta-loading');
            if (loading) loading.remove();
            if (empty) empty.classList.remove('d-none');
        });
}

// ==========================================
// Dynamic Packages Section
// ==========================================
function loadPackages() {
    var grid    = document.getElementById('packages-grid');
    var loading = document.getElementById('packages-loading');
    var empty   = document.getElementById('packages-empty');

    if (!grid || grid.getAttribute('data-bdta-loaded') === '1' || grid.getAttribute('data-bdta-loading') === '1') return;

    grid.setAttribute('data-bdta-loading', '1');

    fetchJson('backend/public/api_packages.php')
        .then(function(data) {
            if (loading) loading.remove();

            var packages = (data && Array.isArray(data.packages)) ? data.packages : [];
            if (packages.length === 0) {
                grid.removeAttribute('data-bdta-loading');
                grid.setAttribute('data-bdta-loaded', '1');
                if (empty) empty.classList.remove('d-none');
                return;
            }

            packages.forEach(function(pkg, idx) {
                var delay = ((idx % 3) + 1) * 100;
                var priceText = pkg.price > 0
                    ? '$' + pkg.price.toFixed(2)
                    : 'Contact Us';

                // Build "What's Included" list
                var itemsHtml = '';
                if (pkg.items && pkg.items.length > 0) {
                    itemsHtml = '<div class="fw-semibold text-dark small text-uppercase mb-2">Credits Included</div>';
                    itemsHtml += '<ul class="list-unstyled mb-4">';
                    pkg.items.forEach(function(item) {
                        itemsHtml += '<li class="mb-2">'
                            + '<i class="fas fa-check-circle text-success me-2"></i>'
                            + escapeHtml(item.quantity + '× ' + item.apt_type_name)
                            + '</li>';
                    });
                    itemsHtml += '</ul>';
                }

                var bulletPointsHtml = renderBulletSection(pkg.bullet_points, "What's Included");

                // Expiry note
                var expiryHtml = pkg.expiration_days
                    ? '<small class="text-muted d-block mb-3">Credits valid for ' + pkg.expiration_days + ' days</small>'
                    : '';

                // CTA button
                var ctaHtml = pkg.purchase_url
                    ? '<a href="' + escapeHtml(pkg.purchase_url) + '" class="btn btn-primary mt-auto" target="_blank" rel="noopener">'
                      + '<i class="fas fa-shopping-cart me-2"></i>Purchase Package</a>'
                    : '<a href="/#contact" class="btn btn-outline-primary mt-auto">Contact Us</a>';

                var col = document.createElement('div');
                col.className = 'col-md-6 col-lg-4';
                col.setAttribute('data-aos', 'fade-up');
                col.setAttribute('data-aos-delay', delay);
                // All interpolated values are escaped with escapeHtml() before insertion into this fixed template.
                // nosemgrep
                col.innerHTML = '<div class="service-card card h-100 border-0 shadow-sm hover-lift">'
                    + '<div class="card-body p-4 d-flex flex-column">'
                    + '<div class="service-icon bg-primary bg-opacity-10 rounded-circle d-inline-flex align-items-center justify-content-center mb-4" style="width:80px;height:80px;">'
                    + '<i class="fas fa-box-open text-primary fs-2"></i></div>'
                    + '<h4 class="fw-bold mb-2">' + escapeHtml(pkg.name) + '</h4>'
                    + '<p class="text-primary fw-bold fs-5 mb-2">' + escapeHtml(priceText) + '</p>'
                    + (pkg.description ? '<p class="text-muted mb-3">' + escapeHtml(pkg.description) + '</p>' : '')
                    + bulletPointsHtml
                    + itemsHtml
                    + expiryHtml
                    + ctaHtml
                    + '</div></div>';
                grid.appendChild(col);
            });

            grid.removeAttribute('data-bdta-loading');
            grid.setAttribute('data-bdta-loaded', '1');
            // Re-init AOS so new cards animate in
            if (typeof AOS !== 'undefined') { AOS.refreshHard(); }
        })
        .catch(function() {
            grid.removeAttribute('data-bdta-loading');
            if (loading) loading.remove();
            if (empty) empty.classList.remove('d-none');
        });
}

// ==========================================
// Dynamic Events Section
// ==========================================
function loadEvents() {
    var grid    = document.getElementById('events-grid');
    var loading = document.getElementById('events-loading');
    var empty   = document.getElementById('events-empty');

    if (!grid || grid.getAttribute('data-bdta-loaded') === '1' || grid.getAttribute('data-bdta-loading') === '1') return;

    grid.setAttribute('data-bdta-loading', '1');

    fetchJson('backend/public/api_events.php')
        .then(function(data) {
            if (loading) loading.remove();

            var events = (data && Array.isArray(data.events)) ? data.events : [];
            if (events.length === 0) {
                grid.removeAttribute('data-bdta-loading');
                grid.setAttribute('data-bdta-loaded', '1');
                if (empty) empty.classList.remove('d-none');
                return;
            }

            events.forEach(function(evt, idx) {
                var delay = ((idx % 3) + 1) * 100;
                var isGroupClass  = evt.type === 'group_class';
                var isMiniSession = evt.type === 'mini_session';
                var fullyBooked   = !!evt.fully_booked;

                // Format date
                var dateObj  = evt.date ? new Date(evt.date + 'T00:00:00') : null;
                var dateStr  = dateObj ? dateObj.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) : '';

                // Format times
                var timeStr = formatTime(evt.start_time);
                if (isGroupClass) {
                    // For group class: show single slot start time + duration
                    timeStr += ' (' + evt.duration_minutes + ' min)';
                } else if (isMiniSession) {
                    // For mini session: show availability window
                    timeStr = formatTime(evt.start_time) + ' – ' + formatTime(evt.end_time);
                }

                // Price
                var priceText = evt.price > 0 ? '$' + evt.price.toFixed(2) : 'Contact Us';

                // Type badge
                var typeBadge = isGroupClass
                    ? '<span class="badge bg-primary mb-3">Group Class</span>'
                    : '<span class="badge bg-info text-dark mb-3">Mini Sessions</span>';

                // Location (mini sessions and group classes)
                var locationHtml = ((isMiniSession && evt.location) || (isGroupClass && evt.location))
                    ? '<p class="mb-1 small"><i class="fas fa-location-dot text-primary me-1"></i>' + escapeHtml(evt.location) + '</p>'
                    : '';

                // Topic (mini sessions only)
                var topicHtml = (isMiniSession && evt.topic)
                    ? '<p class="mb-2 small"><i class="fas fa-tag text-secondary me-1"></i>' + escapeHtml(evt.topic) + '</p>'
                    : '';

                // Fully booked badge or CTA
                var ctaHtml;
                if (fullyBooked) {
                    ctaHtml = '<span class="badge bg-danger py-2 px-3 mt-auto">Fully Booked</span>';
                } else if (evt.booking_url) {
                    ctaHtml = '<a href="' + escapeHtml(evt.booking_url) + '" class="btn btn-sm btn-primary mt-auto" target="_blank" rel="noopener">'
                        + '<i class="fas fa-calendar-check me-1"></i>Book Now</a>';
                } else {
                    ctaHtml = '<a href="/#contact" class="btn btn-sm btn-outline-primary mt-auto">Register</a>';
                }

                var bulletPointsHtml = renderBulletSection(evt.bullet_points, "What You'll Learn", 'mb-3');

                var col = document.createElement('div');
                col.className = 'col-md-6 col-lg-4';
                col.setAttribute('data-aos', 'fade-up');
                col.setAttribute('data-aos-delay', delay);
                // All interpolated values are escaped with escapeHtml() before insertion into this fixed template.
                // nosemgrep
                col.innerHTML = '<div class="card h-100 border-0 shadow-sm hover-lift' + (fullyBooked ? ' opacity-75' : '') + '">'
                    + '<div class="card-body p-4 d-flex flex-column">'
                    + '<div class="mb-2"><i class="fas fa-calendar-days text-primary fs-1"></i></div>'
                    + typeBadge
                    + '<h5 class="fw-bold mb-2">' + escapeHtml(evt.name) + '</h5>'
                    + (evt.description ? '<p class="text-muted mb-2 small">' + escapeHtml(evt.description) + '</p>' : '')
                    + bulletPointsHtml
                    + '<div class="mb-2">'
                    + (dateStr ? '<p class="mb-1 small"><i class="fas fa-calendar text-primary me-1"></i>' + escapeHtml(dateStr) + '</p>' : '')
                    + '<p class="mb-1 small"><i class="fas fa-clock text-primary me-1"></i>' + escapeHtml(timeStr) + '</p>'
                    + locationHtml
                    + topicHtml
                    + '<p class="mb-0 small fw-bold"><i class="fas fa-tag text-primary me-1"></i>' + escapeHtml(priceText) + '</p>'
                    + '</div>'
                    + ctaHtml
                    + '</div></div>';
                grid.appendChild(col);
            });

            grid.removeAttribute('data-bdta-loading');
            grid.setAttribute('data-bdta-loaded', '1');
            // Re-init AOS so new cards animate in
            if (typeof AOS !== 'undefined') { AOS.refreshHard(); }
        })
        .catch(function() {
            grid.removeAttribute('data-bdta-loading');
            if (loading) loading.remove();
            if (empty) empty.classList.remove('d-none');
        });
}

function watchDynamicHomepageSections() {
    if (typeof MutationObserver === 'undefined' || !document.body) {
        return;
    }

    var pending = false;
    var observer = new MutationObserver(function(mutations) {
        var shouldInit = mutations.some(function(mutation) {
            return Array.prototype.some.call(mutation.addedNodes, function(node) {
                return node.nodeType === 1
                    && (
                        node.matches('#services-grid, #packages-grid, #events-grid')
                        || node.querySelector('#services-grid, #packages-grid, #events-grid')
                    );
            });
        });

        if (!shouldInit || pending) {
            return;
        }

        pending = true;
        window.requestAnimationFrame(function() {
            pending = false;
            initDynamicHomepageSections();
        });
    });

    observer.observe(document.body, { childList: true, subtree: true });
}

// ==========================================
// Shared Utilities
// ==========================================

/** Escape a string for safe insertion as HTML text content */
function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/** Format a HH:MM time string to a human-readable 12-hour format */
function formatTime(timeStr) {
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
    if (typeof classNames !== 'string' || !/^[A-Za-z0-9 _-]+$/.test(classNames)) {
        return fallback;
    }
    return classNames;
}

function renderBulletSection(points, title, wrapperClass) {
    if (!Array.isArray(points) || points.length === 0) {
        return '';
    }

    var safeWrapperClass = sanitizeClassNames(wrapperClass || 'mb-4', 'mb-4');
    var html = '<div class="' + safeWrapperClass + '">';
    if (title) {
        html += '<div class="fw-semibold text-dark small text-uppercase mb-2">' + escapeHtml(title) + '</div>';
    }
    html += '<ul class="list-unstyled mb-0">';
    points.forEach(function(point) {
        html += '<li class="mb-2 d-flex align-items-start">'
            + '<i class="fas fa-circle-check text-success me-2 mt-1"></i>'
            + '<span>' + escapeHtml(point) + '</span>'
            + '</li>';
    });
    html += '</ul></div>';
    return html;
}
