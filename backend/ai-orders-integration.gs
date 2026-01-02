// =====================================================
// AI AGENT - Orders Integration
// Add these snippets to your existing Production Code.gs
// =====================================================

// =====================================================
// 1. Update gatherProductionContext() to include orders
// =====================================================

/*
In your existing gatherProductionContext() function, add this near the end
before the return statement:

  // Get orders data
  const ordersData = getOrdersSummary();

Then include ordersData in the returned object.
*/

// =====================================================
// 2. Update buildSystemPrompt() to include orders section
// =====================================================

/*
Add this section to your buildSystemPrompt() function,
after the existing data sections:
*/

function buildOrdersPromptSection(ordersData) {
  if (!ordersData || !ordersData.orders || ordersData.orders.length === 0) {
    return `
ORDERS
• No active orders currently`;
  }

  let section = `
ACTIVE ORDERS (${ordersData.activeOrders} orders)
• Total pending: ${ordersData.pendingKg} kg
• In progress: ${ordersData.inProgressKg} kg remaining
• Ready to ship: ${ordersData.readyToShipKg} kg

Order Details:`;

  ordersData.orders.forEach(order => {
    const remaining = order.totalKg - order.completedKg;
    section += `
  ${order.customer} (${order.id}):
    • ${order.totalKg} kg total, ${order.completedKg} kg done (${order.percentComplete}%)
    • ${remaining} kg remaining
    • Status: ${order.status}
    • Due: ${order.dueDate || 'Not set'}`;
  });

  return section;
}

// =====================================================
// 3. Example of updated buildSystemPrompt()
// =====================================================

/*
Your buildSystemPrompt function should include something like this:

function buildSystemPrompt(context, sessionCorrections) {
  // ... existing code ...

  let prompt = `You are the Rogue Origin production assistant...`;

  // ... existing sections ...

  // Add orders section
  if (context.orders) {
    prompt += buildOrdersPromptSection(context.orders);
  }

  // ... rest of existing code ...

  return prompt;
}
*/

// =====================================================
// 4. Example questions the AI can now answer:
// =====================================================

/*
With orders integrated, the AI can answer:

- "When will the Hamburg order be done?"
  → Based on current rate and remaining kg, estimates completion

- "What orders are we working on?"
  → Lists active orders with progress

- "How much do we have ready to ship?"
  → Shows ready-to-ship kg total

- "What's the status of ORD-001?"
  → Shows specific order details

- "How many kg do we need to complete this week?"
  → Sums up in-progress order requirements
*/

// =====================================================
// 5. Order ETA Calculation Helper
// =====================================================

/**
 * Calculate estimated completion time for an order
 * based on current production rate
 */
function calculateOrderETA(order, currentRate, trimmers) {
  if (!order || !currentRate || !trimmers) return null;

  const remainingKg = order.totalKg - order.completedKg;
  const remainingLbs = remainingKg * 2.205;

  // Calculate hours needed
  const lbsPerHour = trimmers * currentRate;
  const hoursNeeded = remainingLbs / lbsPerHour;

  // Convert to work days (7.5 effective hours per day)
  const daysNeeded = hoursNeeded / 7.5;

  // Calculate estimated completion date (excluding weekends)
  const today = new Date();
  let workDays = Math.ceil(daysNeeded);
  let eta = new Date(today);

  while (workDays > 0) {
    eta.setDate(eta.getDate() + 1);
    const dayOfWeek = eta.getDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) { // Skip weekends
      workDays--;
    }
  }

  return {
    remainingKg: remainingKg,
    remainingLbs: remainingLbs,
    hoursNeeded: Math.round(hoursNeeded * 10) / 10,
    daysNeeded: Math.round(daysNeeded * 10) / 10,
    estimatedCompletion: eta.toISOString().split('T')[0],
    onTrack: order.dueDate ? eta <= new Date(order.dueDate) : null
  };
}

// =====================================================
// 6. Full context gathering with orders
// =====================================================

/**
 * Example of complete context gathering function
 * Modify your existing gatherProductionContext to include this
 */
function gatherProductionContextWithOrders() {
  // Get existing production context (your current function)
  // const productionContext = gatherProductionContext();

  // Get orders summary
  const ordersData = getOrdersSummary();

  // If we have orders and production data, calculate ETAs
  if (ordersData && ordersData.orders) {
    // Assuming you have access to current rate and trimmers
    // const currentRate = productionContext.rates.targetRate || 1.0;
    // const trimmers = productionContext.crew.currentTrimmers || 6;

    // Add ETA to each order
    ordersData.orders = ordersData.orders.map(order => {
      // const eta = calculateOrderETA(order, currentRate, trimmers);
      return {
        ...order,
        // eta: eta
      };
    });
  }

  return {
    // ...productionContext,
    orders: ordersData
  };
}
