import argparse
import sys

def main():
    parser = argparse.ArgumentParser(description="Displays the hex content of a ZIP file.")
    parser.add_argument("zip_filepath", help="The path to the ZIP file.")
    args = parser.parse_args()

    try:
        with open(args.zip_filepath, 'rb') as f:
            file_content = f.read()
        # print(f"Successfully read {args.zip_filepath}, {len(file_content)} bytes.") # Remove this line

        # Hex dump implementation
        bytes_per_line = 16
        for i in range(0, len(file_content), bytes_per_line):
            offset = i
            line_bytes = file_content[i:i+bytes_per_line]

            # Print offset
            print(f"{offset:08x}: ", end="")

            # Print hex bytes
            hex_representation = " ".join(f"{b:02x}" for b in line_bytes)
            print(f"{hex_representation:<48}", end="") # Pad to align ASCII part

            # Print ASCII representation
            ascii_representation = ""
            for byte in line_bytes:
                if 32 <= byte <= 126: # Printable ASCII characters
                    ascii_representation += chr(byte)
                else:
                    ascii_representation += "."
            print(f" {ascii_representation}")

    except FileNotFoundError:
        print(f"Error: File not found: {args.zip_filepath}", file=sys.stderr)
        sys.exit(1)
    except IOError:
        print(f"Error: Could not read file: {args.zip_filepath}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
