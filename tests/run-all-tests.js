#!/usr/bin/env node
/**
 * Test Runner Script
 * Runs all test suites and generates a summary report
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🧪 Rogue Origin Apps - Test Suite Runner\n');
console.log('═'.repeat(60));

const testSuites = [
  { name: 'Baseline Tests', file: 'baseline.test.js' },
  { name: 'Iframe Navigation Tests', file: 'iframe-navigation.test.js' },
  { name: 'Page Loading Tests', file: 'page-loading.test.js' }
];

const results = {
  passed: 0,
  failed: 0,
  total: 0,
  suites: []
};

console.log('\n📋 Running Test Suites...\n');

for (const suite of testSuites) {
  console.log(`\n▶️  ${suite.name}`);
  console.log('─'.repeat(60));

  try {
    const output = execSync(`npm test -- ${suite.file}`, {
      cwd: __dirname,
      encoding: 'utf8',
      stdio: 'pipe'
    });

    // Parse Jest output for results
    const passMatch = output.match(/(\d+) passed/);
    const failMatch = output.match(/(\d+) failed/);
    const totalMatch = output.match(/(\d+) total/);

    const suiteResult = {
      name: suite.name,
      passed: passMatch ? parseInt(passMatch[1]) : 0,
      failed: failMatch ? parseInt(failMatch[1]) : 0,
      total: totalMatch ? parseInt(totalMatch[1]) : 0,
      status: 'PASSED'
    };

    if (suiteResult.failed > 0) {
      suiteResult.status = 'FAILED';
    }

    results.suites.push(suiteResult);
    results.passed += suiteResult.passed;
    results.failed += suiteResult.failed;
    results.total += suiteResult.total;

    console.log(output);
    console.log(`✅ ${suite.name}: ${suiteResult.passed}/${suiteResult.total} passed`);

  } catch (error) {
    console.error(`❌ ${suite.name}: FAILED`);
    console.error(error.stdout || error.message);

    results.suites.push({
      name: suite.name,
      passed: 0,
      failed: 1,
      total: 1,
      status: 'ERROR',
      error: error.message
    });
    results.failed += 1;
    results.total += 1;
  }
}

// Generate summary report
console.log('\n' + '═'.repeat(60));
console.log('📊 TEST SUMMARY REPORT');
console.log('═'.repeat(60));
console.log(`\nTotal Tests: ${results.total}`);
console.log(`✅ Passed: ${results.passed}`);
console.log(`❌ Failed: ${results.failed}`);
console.log(`📈 Success Rate: ${((results.passed / results.total) * 100).toFixed(1)}%`);

console.log('\n📋 Suite Breakdown:');
results.suites.forEach(suite => {
  const icon = suite.status === 'PASSED' ? '✅' : '❌';
  console.log(`  ${icon} ${suite.name}: ${suite.passed}/${suite.total} passed`);
});

// Save detailed results to JSON
const reportPath = path.join(__dirname, 'test-results.json');
fs.writeFileSync(reportPath, JSON.stringify(results, null, 2));
console.log(`\n💾 Detailed results saved to: ${reportPath}`);

// Exit with error code if tests failed
if (results.failed > 0) {
  console.log('\n⚠️  Some tests failed. Review the output above for details.\n');
  process.exit(1);
} else {
  console.log('\n🎉 All tests passed!\n');
  process.exit(0);
}
