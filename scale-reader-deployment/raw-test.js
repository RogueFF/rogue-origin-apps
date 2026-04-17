/**
 * Raw serial data test — prints every byte the scale sends.
 * Use this to verify wiring + protocol before running the full reader.
 *
 * Usage:  node raw-test.js COM5        (Windows)
 *         node raw-test.js /dev/ttyUSB0 (Linux/Mac)
 *         node raw-test.js              (defaults to COM3)
 */
const { SerialPort } = require('serialport');

const portPath = process.argv.find(a => /^(COM\d+|\/dev\/)/.test(a)) || 'COM3';

const port = new SerialPort({
  path: portPath,
  baudRate: 9600,
  dataBits: 8,
  stopBits: 1,
  parity: 'none',
  autoOpen: false
});

console.log('\n=== RAW Serial Monitor ===');
console.log(`Opening ${portPath}...\n`);

port.open((err) => {
  if (err) {
    console.error('Error opening port:', err.message);
    console.error('Tip: check Device Manager for the right COM#, and close any other program using the port.');
    return;
  }

  console.log(`✓ Port open — listening for ANY data from ${portPath}`);
  console.log('  Put something on the scale, or press PRINT on the indicator.\n');

  let dataCount = 0;

  port.on('data', (data) => {
    dataCount++;
    console.log(`[${dataCount}] ${data.length} bytes`);
    console.log('  HEX:  ', data.toString('hex'));
    console.log('  ASCII:', JSON.stringify(data.toString('ascii')));
  });

  // Try the common OHAUS + legacy commands
  setTimeout(() => {
    console.log('\n--- Sending OHAUS Print command: P\\r\\n ---');
    port.write('P\r\n');
  }, 2000);

  setTimeout(() => {
    console.log('\n--- Sending legacy NCI command: W\\r\\n ---');
    port.write('W\r\n');
  }, 4000);

  setTimeout(() => {
    console.log('\n--- Sending ENQ (0x05) ---');
    port.write('\x05');
  }, 6000);

  setTimeout(() => {
    if (dataCount === 0) {
      console.log('\n\n⚠️  NO DATA RECEIVED after 10s.');
      console.log('   Check:');
      console.log('   - Indicator RS-232 baud (should be 9600, 8-N-1)');
      console.log('   - Indicator Print mode (set to On-Demand or Continuous)');
      console.log('   - Cable gender/orientation + straight-through (not null-modem)');
      console.log('   - COM# in Device Manager matches the arg you passed\n');
    } else {
      console.log(`\n✓ Received ${dataCount} data events. Parser can work with this.`);
    }
    process.exit(0);
  }, 10000);
});

port.on('error', (err) => {
  console.error('\nSerial error:', err.message);
});
