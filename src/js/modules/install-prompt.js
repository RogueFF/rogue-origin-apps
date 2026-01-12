/**
 * PWA Install Prompt Module
 * Handles the "Add to Home Screen" installation prompt
 */

let deferredPrompt = null;

/**
 * Initialize install prompt functionality
 */
export function initInstallPrompt() {
  const installBtn = document.getElementById('install-btn');

  // Listen for beforeinstallprompt event (not supported on iOS)
  window.addEventListener('beforeinstallprompt', (e) => {
    console.log('📱 PWA install prompt available');

    // Prevent the mini-infobar from appearing on mobile
    e.preventDefault();

    // Store the event for later use
    deferredPrompt = e;

    // Show the install button
    if (installBtn) {
      installBtn.style.display = 'flex';
      installBtn.classList.add('show');
    }
  });

  // Handle install button click
  if (installBtn) {
    installBtn.addEventListener('click', async () => {
      if (!deferredPrompt) {
        console.log('⚠️ No install prompt available');
        return;
      }

      // Show the install prompt
      deferredPrompt.prompt();

      // Wait for the user's response
      const { outcome } = await deferredPrompt.userChoice;
      console.log(`📊 User response to install prompt: ${outcome}`);

      // Clear the deferred prompt
      deferredPrompt = null;

      // Hide the install button
      installBtn.style.display = 'none';
      installBtn.classList.remove('show');
    });
  }

  // Track successful installation
  window.addEventListener('appinstalled', () => {
    console.log('✅ PWA installed successfully!');

    // Hide the install button
    if (installBtn) {
      installBtn.style.display = 'none';
      installBtn.classList.remove('show');
    }

    // Clear the deferred prompt
    deferredPrompt = null;

    // Optional: Show success message
    showInstallSuccess();
  });

  // Check if already installed (display-mode: standalone)
  if (window.matchMedia('(display-mode: standalone)').matches) {
    console.log('✅ App is running in standalone mode (installed)');

    // Hide install button since app is already installed
    if (installBtn) {
      installBtn.style.display = 'none';
    }
  }

  // iOS detection - show custom install instructions
  if (isIOS() && !isInStandaloneMode()) {
    showIOSInstallInstructions();
  }
}

/**
 * Detect if device is iOS
 */
function isIOS() {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) && !window.MSStream;
}

/**
 * Check if app is running in standalone mode
 */
function isInStandaloneMode() {
  return window.matchMedia('(display-mode: standalone)').matches ||
         window.navigator.standalone === true;
}

/**
 * Show iOS-specific install instructions
 */
function showIOSInstallInstructions() {
  const installBtn = document.getElementById('install-btn');

  if (installBtn && !isInStandaloneMode()) {
    // Modify button text for iOS
    installBtn.innerHTML = '<span style="font-size: 20px;">⬆️</span> Add to Home Screen';
    installBtn.style.display = 'flex';
    installBtn.classList.add('show', 'ios');

    // Show instructions on click
    installBtn.addEventListener('click', () => {
      showIOSModal();
    });
  }
}

/**
 * Show iOS installation instructions modal
 */
function showIOSModal() {
  const modal = document.createElement('div');
  modal.className = 'install-modal';
  modal.innerHTML = `
    <div class="install-modal-content">
      <h2>Install Rogue Origin</h2>
      <p>To install this app on your iPhone or iPad:</p>
      <ol>
        <li>Tap the Share button <span style="font-size: 24px;">⬆️</span> in Safari</li>
        <li>Scroll down and tap "Add to Home Screen" <span style="font-size: 20px;">➕</span></li>
        <li>Tap "Add" in the top right corner</li>
      </ol>
      <button onclick="this.closest('.install-modal').remove()">Got it!</button>
    </div>
  `;

  document.body.appendChild(modal);

  // Close on background click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  });
}

/**
 * Show install success message
 */
function showInstallSuccess() {
  const message = document.createElement('div');
  message.className = 'install-success';
  message.innerHTML = `
    <div class="install-success-content">
      <span style="font-size: 48px;">✅</span>
      <h3>App Installed!</h3>
      <p>Rogue Origin has been added to your home screen</p>
    </div>
  `;

  document.body.appendChild(message);

  // Auto-remove after 3 seconds
  setTimeout(() => {
    message.classList.add('fade-out');
    setTimeout(() => message.remove(), 300);
  }, 3000);
}

/**
 * Check if install prompt should be shown
 */
export function shouldShowInstallPrompt() {
  // Don't show if already installed
  if (isInStandaloneMode()) {
    return false;
  }

  // Don't show if user previously dismissed
  const dismissed = localStorage.getItem('install-prompt-dismissed');
  if (dismissed) {
    const dismissedTime = parseInt(dismissed);
    const daysSinceDismissed = (Date.now() - dismissedTime) / (1000 * 60 * 60 * 24);

    // Show again after 7 days
    if (daysSinceDismissed < 7) {
      return false;
    }
  }

  return true;
}

/**
 * Dismiss install prompt
 */
export function dismissInstallPrompt() {
  localStorage.setItem('install-prompt-dismissed', Date.now().toString());

  const installBtn = document.getElementById('install-btn');
  if (installBtn) {
    installBtn.style.display = 'none';
    installBtn.classList.remove('show');
  }
}
