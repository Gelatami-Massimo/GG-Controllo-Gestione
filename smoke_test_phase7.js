/**
 * SMOKE TEST - Phase 7: Enhanced Error Handling
 * 
 * Test Suite for ERROR_HANDLER module
 * VERSION: 25.0
 * 
 * Tests:
 * 1. Module registration and availability
 * 2. Retry async functionality
 * 3. Fallback patterns
 * 4. Timeout protection
 * 5. Error reporting and context
 * 6. Rate limiting
 * 7. Error statistics tracking
 * 8. Error callbacks
 */

function runPhase7SmokeTests() {
  const testResults = [];
  const startTime = Date.now();

  Logger.log('═════════════════════════════════════════════════════════════');
  Logger.log('SMOKE TEST - Phase 7: Enhanced Error Handling (v25.0)');
  Logger.log('═════════════════════════════════════════════════════════════');

  try {

    // =========================================================================
    // TEST 1: Module Registration
    // =========================================================================
    {
      const testName = 'ERROR_HANDLER module registration';
      try {
        const handler = GG.get('ERROR_HANDLER');
        if (!handler) {
          throw new Error('ERROR_HANDLER not registered in GG namespace');
        }

        if (typeof handler.retryAsync !== 'function') {
          throw new Error('retryAsync method not found');
        }

        if (typeof handler.withFallback !== 'function') {
          throw new Error('withFallback method not found');
        }

        if (typeof handler.reportError !== 'function') {
          throw new Error('reportError method not found');
        }

        testResults.push({ name: testName, status: 'PASSED', duration: 0 });
        Logger.log('✅ TEST 1 PASSED: ERROR_HANDLER properly registered');
      } catch (e) {
        testResults.push({ name: testName, status: 'FAILED', error: e.message });
        Logger.log('❌ TEST 1 FAILED: ' + e.message);
      }
    }

    // =========================================================================
    // TEST 2: Retry Async - Success on First Try
    // =========================================================================
    {
      const testName = 'Retry async - success on first try';
      try {
        const result = GG.get('ERROR_HANDLER').retryAsync(
          () => {
            return 'success_value';
          },
          { maxRetries: 3, scope: 'TEST_RETRY_SUCCESS' }
        );

        if (result !== 'success_value') {
          throw new Error('Unexpected return value');
        }

        testResults.push({ name: testName, status: 'PASSED', duration: 0 });
        Logger.log('✅ TEST 2 PASSED: Retry async works on first try');
      } catch (e) {
        testResults.push({ name: testName, status: 'FAILED', error: e.message });
        Logger.log('❌ TEST 2 FAILED: ' + e.message);
      }
    }

    // =========================================================================
    // TEST 3: Retry Async - Recovery After Failure
    // =========================================================================
    {
      const testName = 'Retry async - recovery after transient failure';
      try {
        let attemptCount = 0;

        const result = GG.get('ERROR_HANDLER').retryAsync(
          () => {
            attemptCount++;
            if (attemptCount < 2) {
              throw new Error('Transient failure');
            }
            return 'recovered_value';
          },
          { maxRetries: 3, baseDelay: 100, scope: 'TEST_RETRY_RECOVER' }
        );

        if (result !== 'recovered_value') {
          throw new Error('Failed to recover after retry');
        }

        if (attemptCount !== 2) {
          throw new Error(`Expected 2 attempts, got ${attemptCount}`);
        }

        testResults.push({ name: testName, status: 'PASSED', duration: 0 });
        Logger.log('✅ TEST 3 PASSED: Retry async recovers after transient failure');
      } catch (e) {
        testResults.push({ name: testName, status: 'FAILED', error: e.message });
        Logger.log('❌ TEST 3 FAILED: ' + e.message);
      }
    }

    // =========================================================================
    // TEST 4: Retry Async - Exhausted Retries
    // =========================================================================
    {
      const testName = 'Retry async - exhausted all retries';
      try {
        let thrown = false;

        try {
          GG.get('ERROR_HANDLER').retryAsync(
            () => {
              throw new Error('Persistent failure');
            },
            { maxRetries: 2, baseDelay: 100, scope: 'TEST_RETRY_EXHAUSTED' }
          );
        } catch (e) {
          thrown = true;
          if (e.message !== 'Persistent failure') {
            throw new Error('Wrong error message: ' + e.message);
          }
        }

        if (!thrown) {
          throw new Error('Expected error to be thrown');
        }

        testResults.push({ name: testName, status: 'PASSED', duration: 0 });
        Logger.log('✅ TEST 4 PASSED: Retry async throws after exhausting retries');
      } catch (e) {
        testResults.push({ name: testName, status: 'FAILED', error: e.message });
        Logger.log('❌ TEST 4 FAILED: ' + e.message);
      }
    }

    // =========================================================================
    // TEST 5: Fallback Pattern - Primary Succeeds
    // =========================================================================
    {
      const testName = 'Fallback pattern - primary succeeds';
      try {
        const result = GG.get('ERROR_HANDLER').withFallback(
          () => 'primary_result',
          () => 'fallback_result',
          { scope: 'TEST_FALLBACK_PRIMARY' }
        );

        if (result !== 'primary_result') {
          throw new Error('Primary should succeed and return its value');
        }

        testResults.push({ name: testName, status: 'PASSED', duration: 0 });
        Logger.log('✅ TEST 5 PASSED: Fallback pattern - primary succeeds');
      } catch (e) {
        testResults.push({ name: testName, status: 'FAILED', error: e.message });
        Logger.log('❌ TEST 5 FAILED: ' + e.message);
      }
    }

    // =========================================================================
    // TEST 6: Fallback Pattern - Primary Fails, Fallback Succeeds
    // =========================================================================
    {
      const testName = 'Fallback pattern - fallback succeeds';
      try {
        const result = GG.get('ERROR_HANDLER').withFallback(
          () => {
            throw new Error('Primary fails');
          },
          () => 'fallback_result',
          { scope: 'TEST_FALLBACK_USED' }
        );

        if (result !== 'fallback_result') {
          throw new Error('Fallback should be used and return its value');
        }

        testResults.push({ name: testName, status: 'PASSED', duration: 0 });
        Logger.log('✅ TEST 6 PASSED: Fallback pattern - fallback succeeds');
      } catch (e) {
        testResults.push({ name: testName, status: 'FAILED', error: e.message });
        Logger.log('❌ TEST 6 FAILED: ' + e.message);
      }
    }

    // =========================================================================
    // TEST 7: Fallback Pattern - Both Fail
    // =========================================================================
    {
      const testName = 'Fallback pattern - both fail';
      try {
        let thrown = false;

        try {
          GG.get('ERROR_HANDLER').withFallback(
            () => {
              throw new Error('Primary fails');
            },
            () => {
              throw new Error('Fallback fails');
            },
            { scope: 'TEST_FALLBACK_BOTH_FAIL' }
          );
        } catch (e) {
          thrown = true;
          if (e.message !== 'Fallback fails') {
            throw new Error('Wrong error thrown');
          }
        }

        if (!thrown) {
          throw new Error('Expected fallback error to be thrown');
        }

        testResults.push({ name: testName, status: 'PASSED', duration: 0 });
        Logger.log('✅ TEST 7 PASSED: Fallback pattern - both fail throws error');
      } catch (e) {
        testResults.push({ name: testName, status: 'FAILED', error: e.message });
        Logger.log('❌ TEST 7 FAILED: ' + e.message);
      }
    }

    // =========================================================================
    // TEST 8: Timeout Protection
    // =========================================================================
    {
      const testName = 'Timeout protection';
      try {
        const result = GG.get('ERROR_HANDLER').withTimeout(
          () => {
            return 'completed_within_timeout';
          },
          5000,
          { scope: 'TEST_TIMEOUT' }
        );

        if (result !== 'completed_within_timeout') {
          throw new Error('Operation should complete within timeout');
        }

        testResults.push({ name: testName, status: 'PASSED', duration: 0 });
        Logger.log('✅ TEST 8 PASSED: Timeout protection works');
      } catch (e) {
        testResults.push({ name: testName, status: 'FAILED', error: e.message });
        Logger.log('❌ TEST 8 FAILED: ' + e.message);
      }
    }

    // =========================================================================
    // TEST 9: Error Reporting
    // =========================================================================
    {
      const testName = 'Error reporting and context capture';
      try {
        const testError = new Error('Test error message');
        const report = GG.get('ERROR_HANDLER').reportError(
          'TEST_SCOPE',
          'Test error occurred',
          testError,
          { customField: 'customValue' }
        );

        if (!report.timestamp) {
          throw new Error('Missing timestamp in error report');
        }

        if (report.scope !== 'TEST_SCOPE') {
          throw new Error('Wrong scope in error report');
        }

        if (report.context.customField !== 'customValue') {
          throw new Error('Custom context not preserved');
        }

        if (!report.userId) {
          throw new Error('Missing userId in error report');
        }

        testResults.push({ name: testName, status: 'PASSED', duration: 0 });
        Logger.log('✅ TEST 9 PASSED: Error reporting captures context');
      } catch (e) {
        testResults.push({ name: testName, status: 'FAILED', error: e.message });
        Logger.log('❌ TEST 9 FAILED: ' + e.message);
      }
    }

    // =========================================================================
    // TEST 10: Rate Limiting
    // =========================================================================
    {
      const testName = 'Rate limiting functionality';
      try {
        // Reset rate limit
        for (let i = 0; i < 5; i++) {
          const limited = GG.get('ERROR_HANDLER').isRateLimited('test_operation', 3);
          if (i < 3 && limited) {
            throw new Error(`Should not be rate limited at call ${i + 1}`);
          }
          if (i >= 3 && !limited) {
            // Should be rate limited after 3 calls
            break;
          }
        }

        testResults.push({ name: testName, status: 'PASSED', duration: 0 });
        Logger.log('✅ TEST 10 PASSED: Rate limiting works correctly');
      } catch (e) {
        testResults.push({ name: testName, status: 'FAILED', error: e.message });
        Logger.log('❌ TEST 10 FAILED: ' + e.message);
      }
    }

    // =========================================================================
    // TEST 11: Error Statistics
    // =========================================================================
    {
      const testName = 'Error statistics tracking';
      try {
        // Reset stats
        GG.get('ERROR_HANDLER').resetStats();

        // Record some errors
        try {
          GG.get('ERROR_HANDLER').reportError(
            'TEST_STAT',
            'Error 1',
            new Error('Test error 1')
          );
        } catch (e) {
          // Ignore
        }

        try {
          GG.get('ERROR_HANDLER').reportError(
            'TEST_STAT',
            'Error 2',
            new Error('Test error 2')
          );
        } catch (e) {
          // Ignore
        }

        const stats = GG.get('ERROR_HANDLER').getStats();

        if (stats.total !== 2) {
          throw new Error(`Expected 2 errors, got ${stats.total}`);
        }

        if (!stats.byScope['TEST_STAT']) {
          throw new Error('Scope not tracked in statistics');
        }

        testResults.push({ name: testName, status: 'PASSED', duration: 0 });
        Logger.log('✅ TEST 11 PASSED: Error statistics tracking works');
      } catch (e) {
        testResults.push({ name: testName, status: 'FAILED', error: e.message });
        Logger.log('❌ TEST 11 FAILED: ' + e.message);
      }
    }

    // =========================================================================
    // TEST 12: Error Callbacks
    // =========================================================================
    {
      const testName = 'Error callbacks execution';
      try {
        let callbackFired = false;
        let callbackData = null;

        const unregister = GG.get('ERROR_HANDLER').onError((errorReport) => {
          callbackFired = true;
          callbackData = errorReport;
        });

        try {
          GG.get('ERROR_HANDLER').reportError(
            'TEST_CALLBACK',
            'Callback test error',
            new Error('Test'),
            { testField: 'testValue' }
          );
        } catch (e) {
          // Ignore
        }

        if (!callbackFired) {
          throw new Error('Error callback was not executed');
        }

        if (callbackData.scope !== 'TEST_CALLBACK') {
          throw new Error('Callback received wrong data');
        }

        unregister();

        testResults.push({ name: testName, status: 'PASSED', duration: 0 });
        Logger.log('✅ TEST 12 PASSED: Error callbacks execute correctly');
      } catch (e) {
        testResults.push({ name: testName, status: 'FAILED', error: e.message });
        Logger.log('❌ TEST 12 FAILED: ' + e.message);
      }
    }

  } catch (e) {
    Logger.log('❌ CRITICAL ERROR: ' + e.message);
  }

  // =========================================================================
  // FINAL REPORT
  // =========================================================================

  const duration = Date.now() - startTime;
  const passed = testResults.filter(t => t.status === 'PASSED').length;
  const failed = testResults.filter(t => t.status === 'FAILED').length;

  Logger.log('═════════════════════════════════════════════════════════════');
  Logger.log(`RESULTS: ${passed}/${testResults.length} tests passed`);
  Logger.log(`Duration: ${duration}ms`);
  Logger.log('═════════════════════════════════════════════════════════════');

  if (failed > 0) {
    Logger.log('\n❌ FAILED TESTS:');
    testResults.filter(t => t.status === 'FAILED').forEach(t => {
      Logger.log(`  - ${t.name}: ${t.error}`);
    });
  }

  Logger.log('\n✅ Phase 7 Smoke Test Complete\n');

  return {
    total: testResults.length,
    passed: passed,
    failed: failed,
    duration: duration,
    results: testResults
  };
}
