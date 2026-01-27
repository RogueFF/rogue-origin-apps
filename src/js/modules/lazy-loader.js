/**
 * Lazy Loader Module
 * Dynamic loading of heavy libraries only when needed
 */

// Track loaded libraries
const loadedLibraries = {
  chartjs: false,
  muuri: false,
  phosphor: false
};

// Track loading promises to avoid duplicate loads
const loadingPromises = {};

/**
 * Load a script dynamically
 * @param {string} url - Script URL
 * @param {string} key - Unique key for the library
 * @returns {Promise<void>}
 */
function loadScript(url, key) {
  if (loadedLibraries[key]) {
    return Promise.resolve();
  }

  if (loadingPromises[key]) {
    return loadingPromises[key];
  }

  loadingPromises[key] = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = url;
    script.async = true;
    script.onload = () => {
      loadedLibraries[key] = true;
      delete loadingPromises[key];
      resolve();
    };
    script.onerror = () => {
      delete loadingPromises[key];
      reject(new Error(`Failed to load script: ${url}`));
    };
    document.head.appendChild(script);
  });

  return loadingPromises[key];
}

/**
 * Lazy load Chart.js and its plugins
 * @returns {Promise<void>}
 */
export async function loadChartJs() {
  if (loadedLibraries.chartjs) {
    return Promise.resolve();
  }

  try {
    await loadScript('https://cdn.jsdelivr.net/npm/chart.js@4.4.1', 'chartjs');
    await loadScript('https://cdn.jsdelivr.net/npm/chartjs-plugin-datalabels@2.2.0', 'chartjs-datalabels');
    
    // Register ChartDataLabels plugin
    if (typeof Chart !== 'undefined' && typeof ChartDataLabels !== 'undefined') {
      Chart.register(ChartDataLabels);
    }
    
    console.log('✅ Chart.js loaded lazily');
    return Promise.resolve();
  } catch (error) {
    console.error('Failed to load Chart.js:', error);
    throw error;
  }
}

/**
 * Lazy load Muuri.js
 * @returns {Promise<void>}
 */
export async function loadMuuri() {
  if (loadedLibraries.muuri) {
    return Promise.resolve();
  }

  try {
    await loadScript('https://cdn.jsdelivr.net/npm/muuri@0.9.5/dist/muuri.min.js', 'muuri');
    console.log('✅ Muuri.js loaded lazily');
    return Promise.resolve();
  } catch (error) {
    console.error('Failed to load Muuri.js:', error);
    throw error;
  }
}

/**
 * Lazy load Phosphor Icons
 * @returns {Promise<void>}
 */
export async function loadPhosphor() {
  if (loadedLibraries.phosphor) {
    return Promise.resolve();
  }

  try {
    await loadScript('https://unpkg.com/@phosphor-icons/web', 'phosphor');
    console.log('✅ Phosphor Icons loaded lazily');
    return Promise.resolve();
  } catch (error) {
    console.error('Failed to load Phosphor Icons:', error);
    throw error;
  }
}

/**
 * Create an intersection observer for lazy loading
 * @param {Function} callback - Callback when element is visible
 * @param {Object} options - Intersection observer options
 * @returns {IntersectionObserver}
 */
export function createLazyObserver(callback, options = {}) {
  const defaultOptions = {
    root: null,
    rootMargin: '50px', // Load slightly before entering viewport
    threshold: 0.01
  };

  const observerOptions = { ...defaultOptions, ...options };

  return new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        callback(entry.target);
        observer.unobserve(entry.target);
      }
    });
  }, observerOptions);
}

/**
 * Observe an element and load Chart.js when it becomes visible
 * @param {HTMLElement} element - Element to observe
 * @returns {IntersectionObserver}
 */
export function observeForCharts(element) {
  const observer = createLazyObserver(async () => {
    await loadChartJs();
  });
  observer.observe(element);
  return observer;
}

/**
 * Observe an element and load Muuri when it becomes visible
 * @param {HTMLElement} element - Element to observe
 * @returns {IntersectionObserver}
 */
export function observeForGrid(element) {
  const observer = createLazyObserver(async () => {
    await loadMuuri();
  });
  observer.observe(element);
  return observer;
}

/**
 * Check if a library is loaded
 * @param {string} key - Library key
 * @returns {boolean}
 */
export function isLoaded(key) {
  return loadedLibraries[key] || false;
}
