/**
 * Event Cleanup System Tests
 * Verifies that event listeners are properly tracked and cleaned up
 * 
 * Run this test by loading it in the browser console after page load
 */

import {
  registerEventListener,
  unregisterEventListener,
  cleanupAllListeners,
  getListenerStats,
  debugListeners
} from '../src/js/modules/event-cleanup.js';

/**
 * Test Suite: Event Cleanup System
 */
export function runEventCleanupTests() {
  console.log('========================================');
  console.log('Event Cleanup System Tests');
  console.log('========================================\n');

  let passed = 0;
  let failed = 0;

  // Test 1: Register and track a listener
  console.log('Test 1: Register and track a listener');
  try {
    const handler = () => console.log('Click handler');
    const id = registerEventListener(document.body, 'click', handler);
    
    if (id > 0) {
      console.log('✓ PASS: Listener registered with ID:', id);
      passed++;
    } else {
      console.error('✗ FAIL: Invalid listener ID returned');
      failed++;
    }
  } catch (error) {
    console.error('✗ FAIL: Error registering listener:', error);
    failed++;
  }

  // Test 2: Check listener statistics
  console.log('\nTest 2: Check listener statistics');
  try {
    const stats = getListenerStats();
    
    if (stats.total >= 1 && stats.byEventType.click >= 1) {
      console.log('✓ PASS: Statistics show registered listeners:', stats);
      passed++;
    } else {
      console.error('✗ FAIL: Statistics incorrect:', stats);
      failed++;
    }
  } catch (error) {
    console.error('✗ FAIL: Error getting statistics:', error);
    failed++;
  }

  // Test 3: Unregister a specific listener
  console.log('\nTest 3: Unregister a specific listener');
  try {
    const handler = () => console.log('Temp handler');
    const id = registerEventListener(document.body, 'mouseover', handler);
    const removed = unregisterEventListener(id);
    
    if (removed) {
      console.log('✓ PASS: Listener unregistered successfully');
      passed++;
    } else {
      console.error('✗ FAIL: Failed to unregister listener');
      failed++;
    }
  } catch (error) {
    console.error('✗ FAIL: Error unregistering listener:', error);
    failed++;
  }

  // Test 4: Register multiple listeners
  console.log('\nTest 4: Register multiple listeners');
  try {
    const ids = [];
    for (let i = 0; i < 5; i++) {
      const handler = () => console.log(`Handler ${i}`);
      ids.push(registerEventListener(document, `custom${i}`, handler));
    }
    
    if (ids.length === 5 && ids.every(id => id > 0)) {
      console.log('✓ PASS: Multiple listeners registered:', ids);
      passed++;
    } else {
      console.error('✗ FAIL: Failed to register all listeners');
      failed++;
    }
  } catch (error) {
    console.error('✗ FAIL: Error registering multiple listeners:', error);
    failed++;
  }

  // Test 5: Cleanup all listeners
  console.log('\nTest 5: Cleanup all listeners');
  try {
    console.log('Before cleanup:');
    debugListeners();
    
    const count = cleanupAllListeners();
    const statsAfter = getListenerStats();
    
    if (count > 0 && statsAfter.total === 0) {
      console.log(`✓ PASS: All ${count} listeners cleaned up successfully`);
      passed++;
    } else {
      console.error('✗ FAIL: Cleanup incomplete. Remaining:', statsAfter.total);
      failed++;
    }
  } catch (error) {
    console.error('✗ FAIL: Error during cleanup:', error);
    failed++;
  }

  // Test 6: Verify cleanup prevents leaks
  console.log('\nTest 6: Verify cleanup prevents leaks');
  try {
    // Register listeners
    const ids = [];
    for (let i = 0; i < 10; i++) {
      const handler = () => console.log(`Test handler ${i}`);
      ids.push(registerEventListener(window, 'resize', handler));
    }
    
    // Get initial event listener count (if possible)
    const statsBefore = getListenerStats();
    console.log('Registered 10 resize listeners:', statsBefore);
    
    // Cleanup
    cleanupAllListeners();
    const statsAfter = getListenerStats();
    
    if (statsAfter.total === 0) {
      console.log('✓ PASS: No memory leak - all listeners removed');
      passed++;
    } else {
      console.error('✗ FAIL: Memory leak detected - listeners remain:', statsAfter);
      failed++;
    }
  } catch (error) {
    console.error('✗ FAIL: Error in leak prevention test:', error);
    failed++;
  }

  // Summary
  console.log('\n========================================');
  console.log('Test Summary');
  console.log('========================================');
  console.log(`Total Tests: ${passed + failed}`);
  console.log(`✓ Passed: ${passed}`);
  console.log(`✗ Failed: ${failed}`);
  console.log(`Success Rate: ${((passed / (passed + failed)) * 100).toFixed(1)}%`);
  console.log('========================================\n');

  return { passed, failed, total: passed + failed };
}

/**
 * Test actual page listener accumulation
 * Load the page multiple times and check for listener buildup
 */
export function testListenerAccumulation() {
  console.log('========================================');
  console.log('Listener Accumulation Test');
  console.log('========================================\n');
  
  console.log('📊 Current listener statistics:');
  debugListeners();
  
  const stats = getListenerStats();
  console.log('\n📈 Analysis:');
  console.log(`Total active listeners: ${stats.total}`);
  console.log('Listeners by event type:', stats.byEventType);
  console.log('Listeners by target:', stats.byTarget);
  
  if (stats.total > 50) {
    console.warn('⚠️ WARNING: High listener count detected. Possible memory leak!');
  } else if (stats.total > 30) {
    console.warn('⚠️ CAUTION: Elevated listener count. Monitor for growth.');
  } else {
    console.log('✓ Listener count is within normal range.');
  }
  
  console.log('\n💡 To test for leaks:');
  console.log('1. Note the current listener count');
  console.log('2. Navigate away and back to this page');
  console.log('3. Run this test again');
  console.log('4. If count increases each time, there\'s a leak');
  
  return stats;
}

// Auto-run tests if in development mode
if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
  console.log('Development mode detected - Event cleanup tests available');
  console.log('Run: runEventCleanupTests() to test the cleanup system');
  console.log('Run: testListenerAccumulation() to check for memory leaks\n');
  
  // Make functions available in console
  window.runEventCleanupTests = runEventCleanupTests;
  window.testListenerAccumulation = testListenerAccumulation;
  window.debugListeners = debugListeners;
}
