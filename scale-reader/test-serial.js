/**
 * Quick serial port test - sends commands to scale
 */
const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');

const port = new SerialPort({
  path: 'COM3',
  baudRate: 9600,
  dataBits: 8,
  stopBits: 1,
  parity: 'none',
});

const parser = port.pipe(new ReadlineParser({ delimiter: '\r\n' }));

console.log('\n=== Serial Port Test ===');
console.log('Listening for data from scale...\n');

// Listen for any data
port.on('data', (data) => {
  console.log('Raw data (hex):', data.toString('hex'));
  console.log('Raw data (ascii):', data.toString('ascii'));
});

parser.on('data', (data) => {
  console.log('Parsed line:', data);
});

port.on('error', (err) => {
  console.error('Serial error:', err.message);
});

// Try sending some common scale commands
setTimeout(() => {
  console.log('\nSending commands to scale...');

  // Common commands for Brecknell/Salter scales
  port.write('P\r\n');  // Print/Send weight

  setTimeout(() => {
    port.write('W\r\n');  // Weight request
  }, 1000);

  setTimeout(() => {
    port.write('Z\r\n');  // Zero/Tare
  }, 2000);

  setTimeout(() => {
    console.log('\nTest complete. Press Ctrl+C to exit.');
  }, 3000);

}, 2000);
