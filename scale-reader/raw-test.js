/**
 * Raw serial data test - show EVERYTHING coming from COM3
 */
const { SerialPort } = require('serialport');

const port = new SerialPort({
  path: 'COM3',
  baudRate: 9600,
  dataBits: 8,
  stopBits: 1,
  parity: 'none',
  autoOpen: false
});

console.log('\n=== RAW Serial Monitor ===');
console.log('Opening COM3...\n');

port.open((err) => {
  if (err) {
    console.error('Error opening port:', err.message);
    return;
  }

  console.log('✓ Port open - listening for ANY data...');
  console.log('  Press HOLD button on scale now!\n');

  let dataCount = 0;

  // Listen for absolutely ANY data
  port.on('data', (data) => {
    dataCount++;
    console.log(`\n[${dataCount}] Received ${data.length} bytes:`);
    console.log('  HEX:', data.toString('hex'));
    console.log('  ASCII:', data.toString('ascii'));
    console.log('  Raw:', data);
  });

  // Try sending various commands
  setTimeout(() => {
    console.log('\n--- Sending test commands ---');
    port.write('W\r\n', () => console.log('Sent: W\\r\\n'));
  }, 2000);

  setTimeout(() => {
    port.write('P\r\n', () => console.log('Sent: P\\r\\n'));
  }, 3000);

  setTimeout(() => {
    port.write('\x05', () => console.log('Sent: ENQ (0x05)'));
  }, 4000);

  setTimeout(() => {
    if (dataCount === 0) {
      console.log('\n\n⚠️  NO DATA RECEIVED!');
      console.log('   The scale is not sending serial data.');
      console.log('   It might be configured as:');
      console.log('   - Keyboard wedge (HID device)');
      console.log('   - Requires special software');
      console.log('   - Wrong port settings\n');
    }
    process.exit(0);
  }, 10000);
});

port.on('error', (err) => {
  console.error('\nSerial error:', err.message);
});
