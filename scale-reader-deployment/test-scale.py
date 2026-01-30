#!/usr/bin/env python3
"""
Scale Connection Tester
Finds the Brecknell GP100 scale and reads weight data
"""

import serial
import serial.tools.list_ports
import time
import re

def find_scale_port():
    """Find COM port for the scale"""
    ports = serial.tools.list_ports.comports()

    print("\n" + "="*60)
    print("Available COM Ports:")
    print("="*60)

    for i, port in enumerate(ports, 1):
        print(f"\n{i}. {port.device}")
        print(f"   Description: {port.description}")
        print(f"   Manufacturer: {port.manufacturer}")

    if not ports:
        print("\nNo COM ports found!")
        return None

    print("\n" + "="*60)
    choice = input("\nEnter port number to test (or port name like COM3): ")

    # Handle numeric choice
    if choice.isdigit():
        idx = int(choice) - 1
        if 0 <= idx < len(ports):
            return ports[idx].device

    # Handle direct port name
    return choice.upper()

def test_scale(port, baudrate=9600):
    """Test reading from the scale"""
    print(f"\n{'='*60}")
    print(f"Connecting to scale on {port}...")
    print(f"Baudrate: {baudrate}, Data bits: 8, Stop bits: 1, Parity: None")
    print(f"{'='*60}\n")

    try:
        ser = serial.Serial(
            port=port,
            baudrate=baudrate,
            bytesize=serial.EIGHTBITS,
            stopbits=serial.STOPBITS_ONE,
            parity=serial.PARITY_NONE,
            timeout=1
        )

        print(f"✓ Connected to {port}\n")
        print("Reading weight data (Ctrl+C to stop)...\n")
        print(f"{'Time':<12} {'Raw Data':<30} {'Weight':<15}")
        print("-" * 60)

        while True:
            if ser.in_waiting:
                # Read line from scale
                raw_data = ser.readline()

                try:
                    # Decode and strip
                    data = raw_data.decode('ascii', errors='ignore').strip()

                    if data:
                        # Parse weight (Brecknell format: "  4.72 kg" or similar)
                        match = re.search(r'([\d.]+)\s*(kg|lb)', data, re.IGNORECASE)

                        timestamp = time.strftime("%H:%M:%S.%f")[:-3]

                        if match:
                            weight = float(match.group(1))
                            unit = match.group(2).lower()

                            # Convert lbs to kg if needed
                            if unit == 'lb':
                                weight_kg = weight * 0.453592
                                print(f"{timestamp:<12} {data:<30} {weight:.2f} {unit} ({weight_kg:.2f} kg)")
                            else:
                                print(f"{timestamp:<12} {data:<30} {weight:.2f} {unit}")
                        else:
                            print(f"{timestamp:<12} {data:<30} (unparsed)")

                except Exception as e:
                    print(f"Error decoding: {raw_data} - {e}")

            time.sleep(0.1)

    except serial.SerialException as e:
        print(f"\n✗ Error: {e}")
        print("\nTroubleshooting:")
        print("  - Check the scale is powered on")
        print("  - Verify USB cable is connected")
        print("  - Try a different COM port")
        print("  - Close any other apps using the port")
        return False

    except KeyboardInterrupt:
        print("\n\n" + "="*60)
        print("Test stopped by user")
        print("="*60 + "\n")
        return True

    finally:
        if 'ser' in locals() and ser.is_open:
            ser.close()
            print(f"Disconnected from {port}")

def main():
    print("\n" + "="*60)
    print("  Brecknell GP100 Scale Connection Tester")
    print("="*60)

    port = find_scale_port()

    if not port:
        print("\nNo port selected. Exiting.")
        return

    test_scale(port)

if __name__ == '__main__':
    main()
