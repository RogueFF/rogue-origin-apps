/**
 * Pool Inventory Management - Main App
 */

const API_BASE = 'https://rogue-origin-api.roguefamilyfarms.workers.dev/api/pool';

// State
const state = {
  bins: [],
  balances: [],
  recentActivity: [],
  filters: {
    source: 'all',
    type: 'all',
    cultivar: ''
  }
};

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
  initThemeToggle();
  initFilters();
  initModals();
  initForms();
  loadDashboard();
});

/**
 * Theme toggle
 */
function initThemeToggle() {
  const toggle = document.getElementById('themeToggle');
  const isDark = localStorage.getItem('darkMode') === 'true';
  
  document.body.classList.toggle('dark-mode', isDark);
  
  toggle.addEventListener('click', () => {
    const isDark = document.body.classList.toggle('dark-mode');
    localStorage.setItem('darkMode', isDark);
  });
}

/**
 * Initialize filters
 */
function initFilters() {
  // Source/type filters
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const filterType = btn.dataset.source ? 'source' : 'type';
      const filterValue = btn.dataset.source || btn.dataset.type;
      
      // Update active state
      btn.parentElement.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      // Update state
      state.filters[filterType] = filterValue;
      
      // Re-render bins
      renderBins();
    });
  });
  
  // Cultivar search
  const search = document.getElementById('cultivarSearch');
  search.addEventListener('input', (e) => {
    state.filters.cultivar = e.target.value.toLowerCase();
    renderBins();
  });
  
  // Refresh button
  document.getElementById('refreshBtn').addEventListener('click', () => {
    loadDashboard();
  });
}

/**
 * Initialize modals
 */
function initModals() {
  // Close buttons
  document.querySelectorAll('.modal-close, [data-dismiss="modal"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      closeModal(btn.closest('.modal'));
    });
  });
  
  // Backdrop clicks
  document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
    backdrop.addEventListener('click', () => {
      closeModal(backdrop.closest('.modal'));
    });
  });
  
  // Open intake modal
  document.getElementById('recordIntakeBtn').addEventListener('click', () => {
    openModal('intakeModal');
    populateBinSelect('intakeBin');
  });
  
  // Open dispense modal
  document.getElementById('recordDispenseBtn').addEventListener('click', () => {
    openModal('dispenseModal');
    populateBinSelect('dispenseBin');
  });
}

/**
 * Initialize forms
 */
function initForms() {
  // Intake form
  document.getElementById('intakeForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const binId = document.getElementById('intakeBin').value;
    const weight = parseFloat(document.getElementById('intakeWeight').value);
    const source = document.getElementById('intakeSource').value;
    const notes = document.getElementById('intakeNotes').value;
    
    try {
      await fetch(`${API_BASE}?action=recordTransaction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          binId,
          type: 'intake',
          weight_lbs: weight,
          source_ref: source || null,
          notes: notes || null
        })
      });
      
      showToast('Intake recorded successfully', 'success');
      closeModal(document.getElementById('intakeModal'));
      loadDashboard();
      
      // Reset form
      e.target.reset();
    } catch (error) {
      showToast('Failed to record intake', 'error');
      console.error(error);
    }
  });
  
  // Dispense form
  document.getElementById('dispenseForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const binId = document.getElementById('dispenseBin').value;
    const weight = parseFloat(document.getElementById('dispenseWeight').value);
    const source = document.getElementById('dispenseSource').value;
    const notes = document.getElementById('dispenseNotes').value;
    const packageSize = document.getElementById('packageSize').value;
    const packageCount = parseInt(document.getElementById('packageCount').value) || null;
    
    try {
      await fetch(`${API_BASE}?action=recordTransaction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          binId,
          type: 'dispense',
          weight_lbs: weight,
          source_ref: source || null,
          package_size: packageSize || null,
          package_count: packageCount,
          notes: notes || null
        })
      });
      
      showToast('Dispense recorded successfully', 'success');
      closeModal(document.getElementById('dispenseModal'));
      loadDashboard();
      
      // Reset form
      e.target.reset();
    } catch (error) {
      showToast('Failed to record dispense', 'error');
      console.error(error);
    }
  });
}

/**
 * Load dashboard data
 */
async function loadDashboard() {
  const refreshBtn = document.getElementById('refreshBtn');
  refreshBtn.classList.add('spinning');
  
  try {
    // Fetch dashboard summary
    const dashResponse = await fetch(`${API_BASE}?action=getDashboard`);
    const dashData = await dashResponse.json();
    
    // Fetch all balances
    const balanceResponse = await fetch(`${API_BASE}?action=getAllBalances`);
    const balanceData = await balanceResponse.json();
    
    // Update state
    state.balances = balanceData.balances || [];
    state.recentActivity = dashData.recentTransactions || [];
    
    // Render dashboard
    renderSummary(dashData.summary);
    renderBins();
    renderActivity();
    
  } catch (error) {
    showToast('Failed to load dashboard', 'error');
    console.error(error);
  } finally {
    refreshBtn.classList.remove('spinning');
  }
}

/**
 * Render summary stats
 */
function renderSummary(summary) {
  document.getElementById('totalBins').textContent = summary.total_bins || '--';
  document.getElementById('totalWeight').textContent = summary.total_weight_lbs?.toFixed(1) || '--';
  document.getElementById('totalIntakes').textContent = summary.total_intakes_lbs?.toFixed(1) || '--';
  document.getElementById('totalDispenses').textContent = summary.total_dispenses_lbs?.toFixed(1) || '--';
  document.getElementById('lowStockCount').textContent = summary.low_stock_count || '0';
  
  // Highlight low stock card if > 0
  const lowStockCard = document.getElementById('lowStockCard');
  lowStockCard.classList.toggle('alert', summary.low_stock_count > 0);
}

/**
 * Render bin grid
 */
function renderBins() {
  const grid = document.getElementById('binGrid');
  
  // Filter bins
  let filtered = state.balances;
  
  if (state.filters.source !== 'all') {
    filtered = filtered.filter(b => b.source === state.filters.source);
  }
  
  if (state.filters.type !== 'all') {
    filtered = filtered.filter(b => b.type === state.filters.type);
  }
  
  if (state.filters.cultivar) {
    filtered = filtered.filter(b => 
      b.cultivar.toLowerCase().includes(state.filters.cultivar)
    );
  }
  
  // Render
  if (filtered.length === 0) {
    grid.innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: var(--text-secondary);">No bins found</p>';
    return;
  }
  
  grid.innerHTML = filtered.map(bin => {
    const fillPercent = (bin.current_lbs / bin.capacity_lbs) * 100;
    const isLowStock = bin.current_lbs < 3;
    
    return `
      <div class="bin-card ${isLowStock ? 'low-stock' : ''}" data-bin-id="${bin.bin_id}">
        <div class="bin-header">
          <div class="bin-number">${bin.bin_number}</div>
          <div class="bin-badge ${bin.type}">${bin.type}</div>
        </div>
        <div class="bin-cultivar">${bin.cultivar}</div>
        <div class="bin-source">${bin.source}</div>
        <div class="bin-stats">
          <div class="bin-stat">
            <span class="bin-stat-label">Current</span>
            <span class="bin-stat-value">${bin.current_lbs.toFixed(1)} lbs</span>
          </div>
          <div class="bin-stat">
            <span class="bin-stat-label">Capacity</span>
            <span class="bin-stat-value">${bin.capacity_lbs} lbs</span>
          </div>
        </div>
        <div class="bin-fill-bar">
          <div class="bin-fill-progress" style="width: ${Math.min(fillPercent, 100)}%"></div>
        </div>
      </div>
    `;
  }).join('');
  
  // Add click handlers
  grid.querySelectorAll('.bin-card').forEach(card => {
    card.addEventListener('click', () => {
      const binId = card.dataset.binId;
      showBinDetail(binId);
    });
  });
}

/**
 * Render activity list
 */
function renderActivity() {
  const list = document.getElementById('activityList');
  
  if (state.recentActivity.length === 0) {
    list.innerHTML = '<p style="text-align: center; color: var(--text-secondary);">No recent activity</p>';
    return;
  }
  
  list.innerHTML = state.recentActivity.map(item => {
    const iconMap = {
      intake: 'arrow-circle-down',
      dispense: 'arrow-circle-up',
      adjustment: 'wrench',
      waste: 'trash'
    };
    
    const date = new Date(item.created_at);
    const timeStr = date.toLocaleString();
    
    return `
      <div class="activity-item">
        <div class="activity-icon ${item.type}">
          <i class="ph-duotone ph-${iconMap[item.type]}"></i>
        </div>
        <div class="activity-content">
          <div class="activity-title">
            ${item.bin_number} - ${item.cultivar} (${item.type})
          </div>
          <div class="activity-meta">
            ${timeStr}${item.package_size ? ` • ${item.package_count}x ${item.package_size}` : ''}
          </div>
        </div>
        <div class="activity-weight">
          ${item.type === 'intake' ? '+' : '-'}${Math.abs(item.weight_lbs).toFixed(2)} lbs
        </div>
      </div>
    `;
  }).join('');
}

/**
 * Show bin detail modal
 */
async function showBinDetail(binId) {
  try {
    // Fetch bin details
    const binResponse = await fetch(`${API_BASE}?action=getBin&binId=${binId}`);
    const binData = await binResponse.json();
    
    // Fetch transactions
    const txResponse = await fetch(`${API_BASE}?action=getTransactions&binId=${binId}&limit=20`);
    const txData = await txResponse.json();
    
    // Render modal
    const bin = binData.bin;
    const transactions = txData.transactions;
    
    document.getElementById('binDetailTitle').innerHTML = `
      <i class="ph-duotone ph-package"></i>
      ${bin.bin_number} - ${bin.cultivar}
    `;
    
    document.getElementById('binDetailContent').innerHTML = `
      <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 1rem; margin-bottom: 1.5rem;">
        <div class="stat-card">
          <div class="stat-content">
            <div class="stat-value">${bin.current_lbs.toFixed(1)} lbs</div>
            <div class="stat-label">Current Balance</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-content">
            <div class="stat-value">${bin.total_intakes_lbs.toFixed(1)} lbs</div>
            <div class="stat-label">Total Intakes</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-content">
            <div class="stat-value">${bin.total_dispenses_lbs.toFixed(1)} lbs</div>
            <div class="stat-label">Total Dispenses</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-content">
            <div class="stat-value">${bin.capacity_lbs} lbs</div>
            <div class="stat-label">Capacity</div>
          </div>
        </div>
      </div>
      
      <h3 style="margin-bottom: 1rem; font-size: 1.125rem;">Recent Transactions</h3>
      <div class="activity-list">
        ${transactions.length === 0 ? '<p style="text-align: center; color: var(--text-secondary);">No transactions yet</p>' :
          transactions.map(tx => {
            const date = new Date(tx.created_at);
            const iconMap = {
              intake: 'arrow-circle-down',
              dispense: 'arrow-circle-up',
              adjustment: 'wrench',
              waste: 'trash'
            };
            
            return `
              <div class="activity-item">
                <div class="activity-icon ${tx.type}">
                  <i class="ph-duotone ph-${iconMap[tx.type]}"></i>
                </div>
                <div class="activity-content">
                  <div class="activity-title">${tx.type}</div>
                  <div class="activity-meta">
                    ${date.toLocaleString()}${tx.package_size ? ` • ${tx.package_count}x ${tx.package_size}` : ''}
                    ${tx.notes ? `<br>${tx.notes}` : ''}
                  </div>
                </div>
                <div class="activity-weight">
                  ${tx.type === 'intake' ? '+' : '-'}${Math.abs(tx.weight_lbs).toFixed(2)} lbs
                </div>
              </div>
            `;
          }).join('')
        }
      </div>
    `;
    
    openModal('binDetailModal');
    
  } catch (error) {
    showToast('Failed to load bin details', 'error');
    console.error(error);
  }
}

/**
 * Populate bin select dropdowns
 */
function populateBinSelect(selectId) {
  const select = document.getElementById(selectId);
  select.innerHTML = '<option value="">Select bin...</option>' +
    state.balances.map(bin => 
      `<option value="${bin.bin_id}">${bin.bin_number} - ${bin.cultivar} (${bin.current_lbs.toFixed(1)} lbs)</option>`
    ).join('');
}

/**
 * Modal helpers
 */
function openModal(modalId) {
  document.getElementById(modalId).classList.add('active');
}

function closeModal(modal) {
  modal.classList.remove('active');
}

/**
 * Toast notifications
 */
function showToast(message, type = 'success') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <i class="ph-duotone ph-${type === 'success' ? 'check-circle' : 'x-circle'}"></i>
    <span class="toast-message">${message}</span>
  `;
  
  container.appendChild(toast);
  
  setTimeout(() => {
    toast.remove();
  }, 3000);
}
