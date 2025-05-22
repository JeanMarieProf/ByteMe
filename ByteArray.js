/**
 * @license
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Represents a byte array with methods for reading and writing various data types.
 */
class ByteArray {
  /**
   * Initializes a new instance of the ByteArray class.
   * @param {number|ArrayBuffer} initialSizeOrArrayBuffer - The initial size of the buffer in bytes or an existing ArrayBuffer. Defaults to 1024.
   */
  constructor(initialSizeOrArrayBuffer = 1024) {
    if (typeof initialSizeOrArrayBuffer === 'number') {
      this._buffer = new ArrayBuffer(initialSizeOrArrayBuffer);
    } else if (initialSizeOrArrayBuffer instanceof ArrayBuffer) {
      this._buffer = initialSizeOrArrayBuffer;
    } else {
      throw new Error('Invalid argument: initialSizeOrArrayBuffer must be a number or an ArrayBuffer.');
    }

    this._dataView = new DataView(this._buffer);
    this._position = 0;
    this._length = 0; // Represents the actual length of data written, not necessarily the buffer capacity.
  }

  /**
   * Gets the current read/write position within the ByteArray.
   * @type {number}
   */
  get position() {
    return this._position;
  }

  /**
   * Sets the current read/write position within the ByteArray.
   * @param {number} value - The new position.
   */
  set position(value) {
    if (value < 0 || value > this._buffer.byteLength) { // It can be set up to buffer.byteLength to allow writing at the end
      throw new Error('Position out of bounds.');
    }
    this._position = value;
  }

  /**
   * Gets the current length of the data in the ByteArray.
   * This is the extent of the data that has been written or the size of the buffer if initialized with an ArrayBuffer.
   * @type {number}
   */
  get length() {
    return this._length;
  }

  /**
   * Gets the number of bytes available to read from the current position to the end of the data.
   * @type {number}
   */
  get bytesAvailable() {
    return this._length - this._position;
  }

  /**
   * Gets the underlying ArrayBuffer.
   * @type {ArrayBuffer}
   */
  get buffer() {
    return this._buffer;
  }

  /**
   * Gets the DataView used to interact with the ArrayBuffer.
   * @type {DataView}
   * @internal
   */
  get dataView() {
    return this._dataView;
  }

  /**
   * Ensures the buffer has at least `requiredCapacity` bytes.
   * If not, it resizes the buffer. The new size will be the larger of
   * `requiredCapacity` or double the current buffer's byteLength,
   * but not exceeding a maximum practical limit (e.g., 2GB).
   * @param {number} requiredCapacity - The minimum required capacity in bytes.
   * @private
   */
  _ensureCapacity(requiredCapacity) {
    const currentCapacity = this._buffer.byteLength;
    if (currentCapacity < requiredCapacity) {
      let newCapacity = Math.max(requiredCapacity, currentCapacity * 2);
      // Define a practical maximum size, e.g., 2GB (2 * 1024 * 1024 * 1024)
      const MAX_BUFFER_SIZE = 2 * 1024 * 1024 * 1024;
      if (newCapacity > MAX_BUFFER_SIZE) {
        newCapacity = MAX_BUFFER_SIZE;
      }
      if (newCapacity < requiredCapacity) {
        throw new Error(`Required capacity ${requiredCapacity} exceeds maximum buffer size ${MAX_BUFFER_SIZE}.`);
      }
      this.resize(newCapacity);
    }
  }

  /**
   * Resizes the internal ArrayBuffer to newSize.
   * If newSize is smaller than the current data length, data is truncated.
   * If larger, the buffer is expanded, preserving existing content.
   * @param {number} newSize - The new size for the buffer in bytes.
   */
  resize(newSize) {
    if (newSize < 0) {
      throw new Error('New size cannot be negative.');
    }
    const newBuffer = new ArrayBuffer(newSize);
    const newUint8Array = new Uint8Array(newBuffer);
    const oldUint8Array = new Uint8Array(this._buffer);

    const bytesToCopy = Math.min(this._length, newSize);
    newUint8Array.set(oldUint8Array.subarray(0, bytesToCopy));

    this._buffer = newBuffer;
    this._dataView = new DataView(this._buffer);
    this._length = Math.min(this._length, newSize);
    this._position = Math.min(this._position, this._length); // Ensure position is not out of new bounds
  }

  /**
   * Clears the ByteArray by resetting its position and length to 0.
   * This does not de-allocate the buffer; it prepares the ByteArray for reuse.
   */
  clear() {
    this._position = 0;
    this._length = 0;
    // Optionally, fill with zeros if desired, though not strictly necessary for 'clear'
    // const uint8Array = new Uint8Array(this._buffer);
    // uint8Array.fill(0);
  }

  /**
   * Returns a new ByteArray containing a copy of the bytes from start to end (exclusive).
   * @param {number} start - The starting index (inclusive).
   * @param {number} [end=this.length] - The ending index (exclusive). Defaults to the current length.
   * @returns {ByteArray} A new ByteArray instance with the sliced data.
   */
  slice(start, end = this.length) {
    if (start < 0 || start > this._length || end < start || end > this._length) {
      throw new Error('Slice arguments out of bounds.');
    }
    const slicedBuffer = this._buffer.slice(start, end);
    const newByteArray = new ByteArray(slicedBuffer);
    newByteArray._length = slicedBuffer.byteLength; // Set length to the actual slice length
    return newByteArray;
  }

  /**
   * Reads `length` bytes starting at `offset` from the ByteArray and returns them in a new Uint8Array.
   * This method does not advance the internal position pointer.
   * @param {number} offset - The starting offset from which to read bytes.
   * @param {number} length - The number of bytes to read.
   * @returns {Uint8Array} A new Uint8Array containing the read bytes.
   * @throws {Error} If the read operation goes out of bounds.
   */
  getBytes(offset, length) {
    if (offset < 0 || length < 0 || offset + length > this._length) {
      throw new Error('Read operation out of bounds.');
    }
    const newArray = new Uint8Array(length);
    const sourceArray = new Uint8Array(this._buffer, offset, length);
    newArray.set(sourceArray);
    return newArray;
  }

  /**
   * Writes the data (Uint8Array or another ByteArray) into this ByteArray starting at the specified offset.
   * Updates `length` if writing extends past the current end of the data.
   * This method does not advance the internal position pointer automatically.
   * @param {number} offset - The offset at which to start writing.
   * @param {Uint8Array|ByteArray} data - The data to write.
   * @throws {Error} If offset is out of bounds or if data is not of a supported type.
   */
  setBytes(offset, data) {
    if (offset < 0) {
      throw new Error('Offset cannot be negative.');
    }

    let sourceArray;
    if (data instanceof Uint8Array) {
      sourceArray = data;
    } else if (data instanceof ByteArray) {
      sourceArray = new Uint8Array(data.buffer, 0, data.length);
    } else {
      throw new Error('Data must be a Uint8Array or ByteArray.');
    }

    const requiredCapacity = offset + sourceArray.length;
    this._ensureCapacity(requiredCapacity);

    const destArray = new Uint8Array(this._buffer);
    destArray.set(sourceArray, offset);

    this._length = Math.max(this._length, requiredCapacity);
  }

  /**
   * Moves the internal read/write pointer.
   * @param {number} offset - The offset to move the pointer by.
   * @param {('begin'|'current'|'end')} origin - Reference point for the offset.
   *   - 'begin': Offset is from the start of the buffer.
   *   - 'current': Offset is from the current position.
   *   - 'end': Offset is from the end of the data (current length).
   * @throws {Error} If the new position would be out of bounds.
   */
  seek(offset, origin = 'begin') {
    let newPosition;
    switch (origin) {
      case 'begin':
        newPosition = offset;
        break;
      case 'current':
        newPosition = this._position + offset;
        break;
      case 'end':
        newPosition = this._length + offset; // offset is often negative here
        break;
      default:
        throw new Error("Invalid seek origin. Must be 'begin', 'current', or 'end'.");
    }

    if (newPosition < 0 || newPosition > this._length) { // Position can be at this._length (for writing)
      throw new Error('Seek position out of bounds.');
    }
    this._position = newPosition;
  }


  /**
   * Helper to convert input value to Uint8Array for find/findBack methods.
   * @param {number|string|Uint8Array|ByteArray} value - The value to convert.
   * @param {boolean} caseSensitive - For string conversion.
   * @returns {Uint8Array} The value as a Uint8Array.
   * @private
   */
  _normalizeSearchValue(value, caseSensitive = true) {
    if (typeof value === 'number') { // Single byte
      if (value < 0 || value > 255) throw new Error("Byte value out of range (0-255).");
      return new Uint8Array([value]);
    } else if (typeof value === 'string') {
      const stringToSearch = caseSensitive ? value : value.toLowerCase();
      return new TextEncoder().encode(stringToSearch);
    } else if (value instanceof Uint8Array) {
      return value;
    } else if (value instanceof ByteArray) {
      return new Uint8Array(value.buffer, 0, value.length);
    }
    throw new Error('Unsupported value type for find. Must be number, string, Uint8Array, or ByteArray.');
  }

  /**
   * Searches for a value within the ByteArray.
   * @param {number|string|Uint8Array|ByteArray} value - The value to search for. If string, it's UTF-8 encoded.
   * @param {number} [startPosition=0] - The position to start searching from.
   * @param {boolean} [caseSensitive=true] - If searching for a string, whether the search is case-sensitive.
   * @returns {number} The starting index of the found value, or -1 if not found.
   */
  find(value, startPosition = 0, caseSensitive = true) {
    if (startPosition < 0 || startPosition >= this._length) return -1;

    const searchValueBytes = this._normalizeSearchValue(value, caseSensitive);
    if (searchValueBytes.length === 0) return -1; // Cannot find empty value

    const mainBufferView = new Uint8Array(this._buffer, 0, this._length);

    for (let i = startPosition; i <= this._length - searchValueBytes.length; i++) {
      let found = true;
      for (let j = 0; j < searchValueBytes.length; j++) {
        const mainByte = caseSensitive ? mainBufferView[i + j] : String.fromCharCode(mainBufferView[i + j]).toLowerCase().charCodeAt(0);
        const searchByte = searchValueBytes[j]; // searchValueBytes is already case-adjusted if needed
        if (mainByte !== searchByte) {
          found = false;
          break;
        }
      }
      if (found) {
        return i;
      }
    }
    return -1;
  }

  /**
   * Searches backward for a value within the ByteArray.
   * @param {number|string|Uint8Array|ByteArray} value - The value to search for.
   * @param {number} [startPosition=this.length-1] - The position to start searching backward from.
   * @param {boolean} [caseSensitive=true] - If searching for a string, whether the search is case-sensitive.
   * @returns {number} The starting index of the found value, or -1 if not found.
   */
  findBack(value, startPosition = -1, caseSensitive = true) {
    if (startPosition === -1) startPosition = this._length -1; // Default to end of data
    if (startPosition < 0 || startPosition >= this._length) return -1;


    const searchValueBytes = this._normalizeSearchValue(value, caseSensitive);
    if (searchValueBytes.length === 0) return -1;

    const mainBufferView = new Uint8Array(this._buffer, 0, this._length);

    for (let i = startPosition; i >= searchValueBytes.length - 1; i--) {
      let found = true;
      // Check from i backwards, so the actual start index would be i - searchValueBytes.length + 1
      const actualStartIndex = i - searchValueBytes.length + 1;
      if(actualStartIndex < 0) continue;

      for (let j = 0; j < searchValueBytes.length; j++) {
        const mainByte = caseSensitive ? mainBufferView[actualStartIndex + j] : String.fromCharCode(mainBufferView[actualStartIndex + j]).toLowerCase().charCodeAt(0);
        const searchByte = searchValueBytes[j];
        if (mainByte !== searchByte) {
          found = false;
          break;
        }
      }
      if (found) {
        return actualStartIndex;
      }
    }
    return -1;
  }

  /**
   * Searches for `value` starting from `fromPosition`. If found, moves the internal `position`
   * to the start of the found `value` and returns `true`. Otherwise, returns `false`.
   * @param {number|string|Uint8Array|ByteArray} value - The value to search for.
   * @param {number} [fromPosition=this.position] - The position to start searching from.
   * @param {boolean} [caseSensitive=true] - For string searches, case sensitivity.
   * @returns {boolean} True if found and position moved, false otherwise.
   */
  seekToValue(value, fromPosition = -1, caseSensitive = true) {
    if (fromPosition === -1) fromPosition = this._position;
    const foundIndex = this.find(value, fromPosition, caseSensitive);
    if (foundIndex !== -1) {
      this._position = foundIndex;
      return true;
    }
    return false;
  }

  /**
   * Searches backward for `value` starting from `fromPosition`. If found, moves `position`
   * to the start of the found `value` and returns `true`. Otherwise, returns `false`.
   * @param {number|string|Uint8Array|ByteArray} value - The value to search backward for.
   * @param {number} [fromPosition=this.position] - The position to start searching backward from.
   *                                                Note: search is from this position towards the beginning.
   * @param {boolean} [caseSensitive=true] - For string searches, case sensitivity.
   * @returns {boolean} True if found and position moved, false otherwise.
   */
  seekBackToValue(value, fromPosition = -1, caseSensitive = true) {
    if (fromPosition === -1) fromPosition = this._position;
    // If fromPosition is the start of the buffer, findBack needs a valid starting index
    // findBack searches from an index, so if fromPosition is 0, it should search at index 0.
    // this._length -1 is the default for findBack, so if fromPosition is near end, it's fine.
    const startSearchIdx = (fromPosition >= this._length && this._length > 0) ? this._length -1 : fromPosition;

    const foundIndex = this.findBack(value, startSearchIdx, caseSensitive);
    if (foundIndex !== -1) {
      this._position = foundIndex;
      return true;
    }
    return false;
  }

  // Read Methods (advancing the position)

  /**
   * Checks if `count` bytes can be read from the current position.
   * @param {number} count - Number of bytes to check.
   * @throws {Error} If not enough bytes are available.
   * @private
   */
  _checkReadCapacity(count) {
    if (this.bytesAvailable < count) {
      throw new Error(`Not enough bytes available to read. Requested: ${count}, Available: ${this.bytesAvailable}`);
    }
  }

  /**
   * Reads a single unsigned byte from the ByteArray and advances the position.
   * @returns {number} The byte read (0-255).
   */
  readByte() {
    this._checkReadCapacity(1);
    const value = this._dataView.getUint8(this._position);
    this._position += 1;
    return value;
  }

  /**
   * Reads `length` bytes from the ByteArray into a new Uint8Array and advances the position.
   * @param {number} length - The number of bytes to read.
   * @returns {Uint8Array} A new Uint8Array containing the read bytes.
   */
  readBytes(length) {
    this._checkReadCapacity(length);
    const result = new Uint8Array(this._buffer, this._position, length);
    this._position += length;
    return new Uint8Array(result); // Return a copy
  }

  /**
   * Reads a boolean value (byte) from the ByteArray and advances the position.
   * Returns true if the byte is non-zero, false otherwise.
   * @returns {boolean} The boolean value read.
   */
  readBoolean() {
    return this.readByte() !== 0;
  }

  /**
   * Reads a 16-bit signed integer from the ByteArray and advances the position.
   * @param {boolean} [littleEndian=false] - Specifies if the number is stored in little-endian format.
   * @returns {number} The 16-bit signed integer.
   */
  readShort(littleEndian = false) {
    this._checkReadCapacity(2);
    const value = this._dataView.getInt16(this._position, littleEndian);
    this._position += 2;
    return value;
  }

  /**
   * Reads a 16-bit unsigned integer from the ByteArray and advances the position.
   * @param {boolean} [littleEndian=false] - Specifies if the number is stored in little-endian format.
   * @returns {number} The 16-bit unsigned integer.
   */
  readUnsignedShort(littleEndian = false) {
    this._checkReadCapacity(2);
    const value = this._dataView.getUint16(this._position, littleEndian);
    this._position += 2;
    return value;
  }

  /**
   * Reads a 32-bit signed integer from the ByteArray and advances the position.
   * @param {boolean} [littleEndian=false] - Specifies if the number is stored in little-endian format.
   * @returns {number} The 32-bit signed integer.
   */
  readInt(littleEndian = false) {
    this._checkReadCapacity(4);
    const value = this._dataView.getInt32(this._position, littleEndian);
    this._position += 4;
    return value;
  }

  /**
   * Reads a 32-bit unsigned integer from the ByteArray and advances the position.
   * @param {boolean} [littleEndian=false] - Specifies if the number is stored in little-endian format.
   * @returns {number} The 32-bit unsigned integer.
   */
  readUnsignedInt(littleEndian = false) {
    this._checkReadCapacity(4);
    const value = this._dataView.getUint32(this._position, littleEndian);
    this._position += 4;
    return value;
  }

  /**
   * Reads a 32-bit float from the ByteArray and advances the position.
   * @param {boolean} [littleEndian=false] - Specifies if the number is stored in little-endian format.
   * @returns {number} The 32-bit float.
   */
  readFloat(littleEndian = false) {
    this._checkReadCapacity(4);
    const value = this._dataView.getFloat32(this._position, littleEndian);
    this._position += 4;
    return value;
  }

  /**
   * Reads a 64-bit float (double) from the ByteArray and advances the position.
   * @param {boolean} [littleEndian=false] - Specifies if the number is stored in little-endian format.
   * @returns {number} The 64-bit float.
   */
  readDouble(littleEndian = false) {
    this._checkReadCapacity(8);
    const value = this._dataView.getFloat64(this._position, littleEndian);
    this._position += 8;
    return value;
  }

  /**
   * Reads `length` bytes from the ByteArray, decodes them as a string, and advances the position.
   * @param {number} length - The number of bytes to read for the string.
   * @param {string} [encoding='utf-8'] - The character encoding to use.
   * @returns {string} The decoded string.
   */
  readString(length, encoding = 'utf-8') {
    this._checkReadCapacity(length);
    const bytes = new Uint8Array(this._buffer, this._position, length);
    this._position += length;
    const decoder = new TextDecoder(encoding);
    return decoder.decode(bytes);
  }

  /**
   * Alias for `readString(length, 'utf-8')`.
   * @param {number} length - The number of bytes to read for the string.
   * @returns {string} The decoded UTF-8 string.
   */
  readUTFBytes(length) {
    return this.readString(length, 'utf-8');
  }

  /**
   * Reads bytes from the ByteArray until a null terminator (0x00) is found or `maxLength` is reached.
   * Decodes the sequence (excluding the terminator) as a string and advances the position.
   * @param {number} [maxLength=Infinity] - The maximum number of bytes to scan for the null terminator.
   * @param {string} [encoding='utf-8'] - The character encoding to use.
   * @returns {string} The decoded string.
   * @throws {Error} If a null terminator is not found within `maxLength` and `maxLength` is not Infinity.
   */
  readNullTerminatedString(maxLength = Infinity, encoding = 'utf-8') {
    let foundNull = false;
    let stringLength = 0;
    const maxScanLength = Math.min(maxLength, this.bytesAvailable);

    for (let i = 0; i < maxScanLength; i++) {
      if (this._dataView.getUint8(this._position + i) === 0) {
        foundNull = true;
        break;
      }
      stringLength++;
    }

    if (!foundNull && maxLength !== Infinity && this.bytesAvailable >= maxLength && this._dataView.getUint8(this._position + stringLength -1) !== 0 ) {
        // If maxLength is a hard limit (not Infinity) and no null was found within it
        // but we had enough bytes to check up to maxLength.
        // This implies the string is exactly maxLength and not null-terminated within that length.
        // If we are at the end of buffer and no null found, it's an error unless maxLength was reached.
         if (stringLength === maxLength && this.bytesAvailable >= maxLength) {
             // String is exactly maxLength, not necessarily an error by itself, proceed to read.
         } else if (maxLength !== Infinity) {
            throw new Error(`Null terminator not found within maxLength (${maxLength} bytes).`);
         }
    }


    const str = this.readString(stringLength, encoding);
    if (foundNull) {
      this._position += 1; // Advance past the null terminator
    }
    return str;
  }

  // Write Methods (advancing the position, auto-resizing)

  /**
   * Prepares for writing `count` bytes by ensuring capacity and updating length.
   * @param {number} count - Number of bytes to be written.
   * @private
   */
  _prepareToWrite(count) {
    const requiredCapacity = this._position + count;
    this._ensureCapacity(requiredCapacity);
    this._length = Math.max(this._length, requiredCapacity);
  }

  /**
   * Writes a single byte to the ByteArray and advances the position.
   * @param {number} value - The byte value to write (0-255).
   */
  writeByte(value) {
    if (value < 0 || value > 255 || !Number.isInteger(value)) {
      throw new Error('Value must be an integer between 0 and 255.');
    }
    this._prepareToWrite(1);
    this._dataView.setUint8(this._position, value);
    this._position += 1;
  }

  /**
   * Writes data to the ByteArray and advances the position.
   * @param {Uint8Array|ByteArray|number[]} data - The data to write.
   *        If an array of numbers, each number is treated as a byte.
   */
  writeBytes(data) {
    let bytesToWrite;
    if (data instanceof Uint8Array) {
      bytesToWrite = data;
    } else if (data instanceof ByteArray) {
      bytesToWrite = new Uint8Array(data.buffer, 0, data.length);
    } else if (Array.isArray(data)) {
      // Assuming it's an array of numbers (bytes)
      try {
        bytesToWrite = Uint8Array.from(data);
      } catch (e) {
        throw new Error('If data is an array, it must be an array of numbers (bytes). Original error: ' + e.message);
      }
    } else {
      throw new Error('Unsupported data type for writeBytes. Must be Uint8Array, ByteArray, or an array of numbers.');
    }

    if (bytesToWrite.length === 0) return;

    this._prepareToWrite(bytesToWrite.length);
    new Uint8Array(this._buffer).set(bytesToWrite, this._position);
    this._position += bytesToWrite.length;
  }

  /**
   * Writes a boolean value (byte) to the ByteArray and advances the position.
   * Writes 1 for true, 0 for false.
   * @param {boolean} value - The boolean value to write.
   */
  writeBoolean(value) {
    this.writeByte(value ? 1 : 0);
  }

  /**
   * Writes a 16-bit signed integer to the ByteArray and advances the position.
   * @param {number} value - The 16-bit signed integer to write.
   * @param {boolean} [littleEndian=false] - Specifies if the number should be stored in little-endian format.
   */
  writeShort(value, littleEndian = false) {
    this._prepareToWrite(2);
    this._dataView.setInt16(this._position, value, littleEndian);
    this._position += 2;
  }

  /**
   * Writes a 16-bit unsigned integer to the ByteArray and advances the position.
   * @param {number} value - The 16-bit unsigned integer to write.
   * @param {boolean} [littleEndian=false] - Specifies if the number should be stored in little-endian format.
   */
  writeUnsignedShort(value, littleEndian = false) {
    this._prepareToWrite(2);
    this._dataView.setUint16(this._position, value, littleEndian);
    this._position += 2;
  }

  /**
   * Writes a 32-bit signed integer to the ByteArray and advances the position.
   * @param {number} value - The 32-bit signed integer to write.
   * @param {boolean} [littleEndian=false] - Specifies if the number should be stored in little-endian format.
   */
  writeInt(value, littleEndian = false) {
    this._prepareToWrite(4);
    this._dataView.setInt32(this._position, value, littleEndian);
    this._position += 4;
  }

  /**
   * Writes a 32-bit unsigned integer to the ByteArray and advances the position.
   * @param {number} value - The 32-bit unsigned integer to write.
   * @param {boolean} [littleEndian=false] - Specifies if the number should be stored in little-endian format.
   */
  writeUnsignedInt(value, littleEndian = false) {
    this._prepareToWrite(4);
    this._dataView.setUint32(this._position, value, littleEndian);
    this._position += 4;
  }

  /**
   * Writes a 32-bit float to the ByteArray and advances the position.
   * @param {number} value - The 32-bit float to write.
   * @param {boolean} [littleEndian=false] - Specifies if the number should be stored in little-endian format.
   */
  writeFloat(value, littleEndian = false) {
    this._prepareToWrite(4);
    this._dataView.setFloat32(this._position, value, littleEndian);
    this._position += 4;
  }

  /**
   * Writes a 64-bit float (double) to the ByteArray and advances the position.
   * @param {number} value - The 64-bit float to write.
   * @param {boolean} [littleEndian=false] - Specifies if the number should be stored in little-endian format.
   */
  writeDouble(value, littleEndian = false) {
    this._prepareToWrite(8);
    this._dataView.setFloat64(this._position, value, littleEndian);
    this._position += 8;
  }

  /**
   * Encodes a string using the specified encoding, writes its bytes to the ByteArray, and advances the position.
   * @param {string} value - The string to write.
   * @param {string} [encoding='utf-8'] - The character encoding to use.
   */
  writeString(value, encoding = 'utf-8') {
    const encoder = new TextEncoder(encoding); // Note: TextEncoder only supports 'utf-8', 'utf-16le', 'utf-16be' in some envs or always utf-8 by spec.
                                            // For broader encoding support, a library might be needed.
                                            // However, the constructor for TextEncoder itself doesn't take encoding in modern browsers, it's always UTF-8.
                                            // Let's assume 'utf-8' is the primary target. If other encodings are needed, this needs adjustment.
    if (encoding.toLowerCase() !== 'utf-8' && typeof TextEncoder.prototype.encodeInto === 'undefined') {
        // A simple polyfill or check for TextEncoder encoding support might be too complex for this scope.
        // Sticking to UTF-8 if advanced encoding isn't directly available or specified.
        // Modern TextEncoder API encodes to UTF-8 by default. The `encoding` parameter is more of a hint here.
        // For true multi-encoding, one would use a library.
    }
    const bytes = new TextEncoder().encode(value); // Always UTF-8
    this.writeBytes(bytes);
  }

  /**
   * Alias for `writeString(value, 'utf-8')`.
   * @param {string} value - The string to write.
   */
  writeUTFBytes(value) {
    this.writeString(value, 'utf-8');
  }

}

// For environments that support module exports
// if (typeof module !== 'undefined' && module.exports) {
//   module.exports = ByteArray;
// }
export default ByteArray;

  // Native Compression/Decompression using Compression Streams API

  /**
   * Compresses the ByteArray's content in-place using the specified algorithm.
   * @param {string} algorithm - The compression algorithm (e.g., 'deflate-raw').
   * @returns {Promise<void>} A promise that resolves when compression is complete or rejects on error.
   * @throws {Error} If CompressionStream is not supported or if the algorithm is unsupported.
   */
  async compress(algorithm = 'deflate-raw') {
    if (typeof CompressionStream === 'undefined') {
      throw new Error('CompressionStream API not supported in this browser.');
    }
    if (algorithm !== 'deflate-raw' && algorithm !== 'deflate' && algorithm !== 'gzip') { // deflate-raw is the primary target
      // Note: 'deflate' and 'gzip' are other valid values for CompressionStream
      throw new Error(`Unsupported compression algorithm: ${algorithm}. Only 'deflate-raw', 'deflate', 'gzip' are typically supported by CompressionStream.`);
    }

    try {
      const uncompressedDataBuffer = this.slice(0, this.length).buffer;
      if (uncompressedDataBuffer.byteLength === 0) {
        this.clear(); // Handles empty buffer case, already compressed effectively
        return;
      }

      const cs = new CompressionStream(algorithm);
      const writer = cs.writable.getWriter();
      writer.write(uncompressedDataBuffer);
      writer.close();

      const reader = cs.readable.getReader();
      const chunks = [];
      let totalSize = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        chunks.push(value);
        totalSize += value.byteLength;
      }

      const compressedData = new Uint8Array(totalSize);
      let offset = 0;
      for (const chunk of chunks) {
        compressedData.set(chunk, offset);
        offset += chunk.byteLength;
      }

      this._buffer = compressedData.buffer;
      this._dataView = new DataView(this._buffer);
      this._length = compressedData.byteLength;
      this._position = 0;

    } catch (error) {
      console.error(`ByteArray.compress: Error during compression with ${algorithm}.`, error);
      throw error; // Re-throw the error for the caller to handle
    }
  }

  /**
   * Decompresses the ByteArray's content in-place using the specified algorithm.
   * @param {string} algorithm - The decompression algorithm (e.g., 'deflate-raw').
   * @returns {Promise<void>} A promise that resolves when decompression is complete or rejects on error.
   * @throws {Error} If DecompressionStream is not supported or if the algorithm is unsupported.
   */
  async decompress(algorithm = 'deflate-raw') {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('DecompressionStream API not supported in this browser.');
    }
     if (algorithm !== 'deflate-raw' && algorithm !== 'deflate' && algorithm !== 'gzip') {
      throw new Error(`Unsupported decompression algorithm: ${algorithm}. Only 'deflate-raw', 'deflate', 'gzip' are typically supported by DecompressionStream.`);
    }

    try {
      const compressedDataBuffer = this.slice(0, this.length).buffer;
       if (compressedDataBuffer.byteLength === 0) {
        this.clear(); // Handles empty buffer case
        return;
      }

      const ds = new DecompressionStream(algorithm);
      const writer = ds.writable.getWriter();
      writer.write(compressedDataBuffer);
      writer.close();

      const reader = ds.readable.getReader();
      const chunks = [];
      let totalSize = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        chunks.push(value);
        totalSize += value.byteLength;
      }

      const decompressedData = new Uint8Array(totalSize);
      let offset = 0;
      for (const chunk of chunks) {
        decompressedData.set(chunk, offset);
        offset += chunk.byteLength;
      }

      this._buffer = decompressedData.buffer;
      this._dataView = new DataView(this._buffer);
      this._length = decompressedData.byteLength;
      this._position = 0;

    } catch (error) {
      console.error(`ByteArray.decompress: Error during decompression with ${algorithm}.`, error);
      throw error;
    }
  }

  /**
   * Convenience method to decompress the ByteArray using 'deflate-raw'.
   * Modifies the ByteArray in-place.
   * @returns {Promise<void>}
   */
  async inflate() {
    await this.decompress('deflate-raw');
  }

  /**
   * Convenience method to compress the ByteArray using 'deflate-raw'.
   * Modifies the ByteArray in-place.
   * @returns {Promise<void>}
   */
  async deflate() {
    await this.compress('deflate-raw');
  }
