/**
 * ScoreboardDOM - DOM manipulation utilities with element caching
 * Reduces repeated getElementById calls from 42+ per render cycle to 1 per element
 */
(function(window) {
  'use strict';

  var elementCache = {};

  var ScoreboardDOM = {
    /**
     * Get element by ID with caching
     * @param {string} id - Element ID
     * @returns {HTMLElement|null} Cached or newly fetched element
     */
    get: function(id) {
      if (!elementCache[id]) {
        elementCache[id] = document.getElementById(id);
      }
      return elementCache[id];
    },

    /**
     * Clear the element cache (use after DOM structural changes)
     */
    clearCache: function() {
      elementCache = {};
    },

    /**
     * Safely set text content of an element
     * @param {string} id - Element ID
     * @param {string|number} text - Text content to set
     */
    setText: function(id, text) {
      var el = this.get(id);
      if (el) el.textContent = text;
    },

    /**
     * Safely set HTML content of an element
     * @param {string} id - Element ID
     * @param {string} html - HTML content to set
     */
    setHTML: function(id, html) {
      var el = this.get(id);
      if (el) el.innerHTML = html;
    },

    /**
     * Toggle a class on an element
     * @param {string} id - Element ID
     * @param {string} className - Class name to toggle
     * @param {boolean} [force] - Optional force state (true=add, false=remove)
     */
    toggleClass: function(id, className, force) {
      var el = this.get(id);
      if (el) el.classList.toggle(className, force);
    },

    /**
     * Add a class to an element
     * @param {string} id - Element ID
     * @param {string} className - Class name to add
     */
    addClass: function(id, className) {
      var el = this.get(id);
      if (el) el.classList.add(className);
    },

    /**
     * Remove a class from an element
     * @param {string} id - Element ID
     * @param {string} className - Class name to remove
     */
    removeClass: function(id, className) {
      var el = this.get(id);
      if (el) el.classList.remove(className);
    },

    /**
     * Show an element
     * @param {string} id - Element ID
     */
    show: function(id) {
      var el = this.get(id);
      if (el) el.style.display = '';
    },

    /**
     * Hide an element
     * @param {string} id - Element ID
     */
    hide: function(id) {
      var el = this.get(id);
      if (el) el.style.display = 'none';
    },

    /**
     * Set inline style property on an element
     * @param {string} id - Element ID
     * @param {string} prop - CSS property name
     * @param {string} value - CSS property value
     */
    setStyle: function(id, prop, value) {
      var el = this.get(id);
      if (el) el.style[prop] = value;
    },

    /**
     * Set multiple inline styles on an element
     * @param {string} id - Element ID
     * @param {Object} styles - Object with CSS property-value pairs
     */
    setStyles: function(id, styles) {
      var el = this.get(id);
      if (el && styles) {
        for (var prop in styles) {
          if (styles.hasOwnProperty(prop)) {
            el.style[prop] = styles[prop];
          }
        }
      }
    },

    /**
     * Set an attribute on an element
     * @param {string} id - Element ID
     * @param {string} attr - Attribute name
     * @param {string} value - Attribute value
     */
    setAttribute: function(id, attr, value) {
      var el = this.get(id);
      if (el) el.setAttribute(attr, value);
    },

    /**
     * Check if an element has a class
     * @param {string} id - Element ID
     * @param {string} className - Class name to check
     * @returns {boolean} True if element has the class
     */
    hasClass: function(id, className) {
      var el = this.get(id);
      return el ? el.classList.contains(className) : false;
    },

    /**
     * Check if an element exists in the DOM
     * @param {string} id - Element ID
     * @returns {boolean} True if element exists
     */
    exists: function(id) {
      return this.get(id) !== null;
    },

    /**
     * Append child element to an element
     * @param {string} id - Parent element ID
     * @param {HTMLElement} child - Child element to append
     */
    appendChild: function(id, child) {
      var el = this.get(id);
      if (el && child) el.appendChild(child);
    },

    /**
     * Remove all children from an element
     * @param {string} id - Element ID
     */
    clearChildren: function(id) {
      var el = this.get(id);
      if (el) el.innerHTML = '';
    }
  };

  // Expose to window
  window.ScoreboardDOM = ScoreboardDOM;

})(window);
