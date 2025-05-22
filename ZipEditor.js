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

import ByteArray from './ByteArray.js';
import pako from './pako.js';

/**
 * A class for reading and parsing ZIP file structures.
 */
class ZipEditor {
  /**
   * ZIP signature constants.
   * @readonly
   * @enum {number}
   */
  static LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
  static CENTRAL_DIR_SIGNATURE = 0x02014b50;
  static END_OF_CENTRAL_DIR_SIGNATURE = 0x06054b50;

  /**
   * Initializes a new instance of the ZipEditor class.
   */
  constructor() {
    this.zipData = null;
    this.fileEntries = [];
    this.eocd = null; // To store End of Central Directory record details
  }

  /**
   * Generates a new ZIP file as a Blob based on the current file entries,
   * including any modifications.
   * @returns {Blob|null} A Blob representing the new ZIP file, or null on error.
   */
  generateZipBlob() {
    if (!this.fileEntries) {
      console.error('ZipEditor.generateZipBlob: No file entries loaded or available.');
      return null;
    }

    const outputZip = new ByteArray(); 
    const centralDirectoryEntriesMetadata = []; 

    try {
      // Phase 1: Write Local File Headers and File Data
      for (const originalEntry of this.fileEntries) {
        const entryToWrite = { ...originalEntry }; 

        entryToWrite.localHeaderOffset = outputZip.position;

        let fileDataToWrite;

        if (entryToWrite.isModified && entryToWrite.modifiedData) {
          fileDataToWrite = entryToWrite.modifiedData;
          // Metadata (crc32, compressedSize, uncompressedSize, compressionMethod, lastModDate, lastModTime)
          // should already be updated in entryToWrite by updateEntry().
        } else {
          // Entry not modified, extract original compressed data
          if (!this.zipData) {
            console.error('ZipEditor.generateZipBlob: Original zipData is not available for non-modified entry.');
            return null; 
          }
          
          const savedPos = this.zipData.position; // Save current position of original zip data

          this.zipData.position = entryToWrite.localHeaderOffset;
          if (this.zipData.readUnsignedInt(true) !== ZipEditor.LOCAL_FILE_HEADER_SIGNATURE) {
            console.error(`ZipEditor.generateZipBlob: LFH signature mismatch for original entry ${entryToWrite.fileName}. Offset: ${entryToWrite.localHeaderOffset}`);
            this.zipData.position = savedPos; // Restore position
            return null;
          }
          
          // Skip: version(2), flags(2), method(2), time(2), date(2), crc(4), compSize(4), uncompSize(4) = 22 bytes
          this.zipData.position = entryToWrite.localHeaderOffset + 4 + 22; 
          const fileNameLength = this.zipData.readUnsignedShort(true);
          const extraFieldLength = this.zipData.readUnsignedShort(true);
          
          // Position after LFH fixed fields and lengths is start of filename. Skip filename and extra field.
          this.zipData.position += fileNameLength + extraFieldLength;
          
          if (this.zipData.bytesAvailable < entryToWrite.compressedSize) {
             console.error(`ZipEditor.generateZipBlob: Not enough data in original zip for compressed content of ${entryToWrite.fileName}. Needed ${entryToWrite.compressedSize}, available ${this.zipData.bytesAvailable}`);
             this.zipData.position = savedPos; // Restore position
             return null;
          }
          fileDataToWrite = this.zipData.readBytes(entryToWrite.compressedSize);
          this.zipData.position = savedPos; // Restore position
        }
        
        // Ensure lastModifiedDate is a Date object for the helper functions
        if (!(entryToWrite.lastModifiedDate instanceof Date) && entryToWrite.lastModDate && entryToWrite.lastModTime) {
            // Attempt to reconstruct from DOS date/time if JS Date is missing
            // This is a fallback; ideally lastModifiedDate is always a Date object from parsing/update
            const year = ((entryToWrite.lastModDate >> 9) & 0x7F) + 1980;
            const month = ((entryToWrite.lastModDate >> 5) & 0x0F) - 1;
            const day = entryToWrite.lastModDate & 0x1F;
            const hours = (entryToWrite.lastModTime >> 11) & 0x1F;
            const minutes = (entryToWrite.lastModTime >> 5) & 0x3F;
            const seconds = (entryToWrite.lastModTime & 0x1F) * 2;
            entryToWrite.lastModifiedDate = new Date(year, month, day, hours, minutes, seconds);
        } else if (!(entryToWrite.lastModifiedDate instanceof Date)) {
            entryToWrite.lastModifiedDate = new Date(); // Default if no valid date info
        }

        this._writeLocalFileHeader(entryToWrite, outputZip);
        outputZip.writeBytes(fileDataToWrite);

        centralDirectoryEntriesMetadata.push(entryToWrite); 
      }

      // Phase 2: Write Central Directory
      const centralDirStartOffset = outputZip.position;
      for (const cdEntry of centralDirectoryEntriesMetadata) {
        this._writeCentralDirectoryFileHeader(cdEntry, outputZip);
      }
      const centralDirSize = outputZip.position - centralDirStartOffset;

      // Phase 3: Write End of Central Directory Record
      this._writeEndOfCentralDirectoryRecord(
        outputZip,
        centralDirStartOffset,
        centralDirSize,
        centralDirectoryEntriesMetadata.length
      );

      // Phase 4: Create Blob
      const finalZipData = outputZip.slice(0, outputZip.length); // Get a ByteArray representing the written data
      return new Blob([finalZipData.buffer], { type: 'application/zip' });

    } catch (error) {
      console.error('ZipEditor.generateZipBlob: Error during ZIP generation.', error);
      return null;
    }
  }

  /**
   * Updates a file entry's content and metadata.
   * @param {string} fileName - The name of the file entry to update.
   * @param {string|Uint8Array} newContent - The new content for the file.
   * @returns {boolean} True if the update was successful, false otherwise.
   */
  updateEntry(fileName, newContent) {
    const entry = this.getEntry(fileName);
    if (!entry) {
      console.error(`ZipEditor.updateEntry: Entry with name "${fileName}" not found.`);
      return false;
    }

    let uncompressedData;
    if (typeof newContent === 'string') {
      uncompressedData = new TextEncoder().encode(newContent);
    } else if (newContent instanceof Uint8Array) {
      uncompressedData = newContent;
    } else {
      console.error('ZipEditor.updateEntry: Unsupported newContent type. Must be string or Uint8Array.');
      return false;
    }

    // Update metadata
    entry.crc32 = this._calculateCRC32(uncompressedData);
    entry.uncompressedSize = uncompressedData.length;

    // Compress data (if applicable)
    if (entry.compressionMethod === 8) { // Deflate
      try {
        entry.modifiedData = pako.deflate(uncompressedData);
        entry.compressedSize = entry.modifiedData.length;
      } catch (err) {
        console.error(`ZipEditor.updateEntry: Error deflating data for "${fileName}". Pako error:`, err);
        return false; // Or handle more gracefully
      }
    } else if (entry.compressionMethod === 0) { // Store
      entry.modifiedData = uncompressedData; // Store uncompressed data directly
      entry.compressedSize = uncompressedData.length;
    } else {
      console.warn(`ZipEditor.updateEntry: Unsupported compression method ${entry.compressionMethod} for file ${fileName}. Storing uncompressed (method 0).`);
      entry.compressionMethod = 0; // Change to Store
      entry.modifiedData = uncompressedData;
      entry.compressedSize = uncompressedData.length;
    }

    // Update timestamps
    const currentDate = new Date();
    entry.lastModDate = ZipEditor._jsDateToDosDate(currentDate); // Static method access
    entry.lastModTime = ZipEditor._jsDateToDosTime(currentDate); // Static method access
    
    // If the original entry had these from parsing, they might be useful to preserve or clear
    // For now, if lastModifiedDate was a property, update it too.
    entry.lastModifiedDate = currentDate; 

    // Mark as modified
    entry.isModified = true;

    // Update the entry in the main list if it was fetched by name
    // This is important if getEntry returns a copy or if we want to ensure the main array is updated.
    // However, if getEntry returns a direct reference, this step might be redundant but harmless.
    const entryIndex = this.fileEntries.findIndex(e => e.fileName === fileName);
    if (entryIndex !== -1) {
        this.fileEntries[entryIndex] = entry;
    } else {
        // This case should ideally not happen if getEntry found it.
        console.warn(`ZipEditor.updateEntry: Could not find entry ${fileName} in fileEntries array after initial find. This might indicate an issue.`);
        // Still, proceed as entry object itself is updated.
    }


    return true;
  }

  /**
   * Loads ZIP data from various sources and parses its structure.
   * @param {File|ArrayBuffer|ByteArray} source - The source of the ZIP data.
   * @returns {Promise<boolean>} True if loading and parsing are successful, false otherwise.
   */
  async load(source) {
    try {
      if (source instanceof File) {
        const arrayBuffer = await source.arrayBuffer();
        this.zipData = new ByteArray(arrayBuffer);
      } else if (source instanceof ArrayBuffer) {
        this.zipData = new ByteArray(source);
      } else if (source instanceof ByteArray) {
        this.zipData = source;
      } else {
        console.error('ZipEditor.load: Unsupported source type.');
        this._resetState();
        return false;
      }

      if (!this.zipData || this.zipData.length === 0) {
        console.error('ZipEditor.load: Zip data is empty or invalid.');
        this._resetState();
        return false;
      }

      if (!this._findEndOfCentralDirectoryRecord()) {
        console.error('ZipEditor.load: End of Central Directory Record not found or parsing failed.');
        this._resetState(); // EOCD finding is critical
        return false;
      }

      if (!this._parseCentralDirectory()) {
        console.error('ZipEditor.load: Failed to parse Central Directory.');
        // Keep EOCD if found, but clear entries as CD parsing failed
        this.fileEntries = [];
        return false;
      }

      return true;
    } catch (error) {
      console.error('ZipEditor.load: Error during loading or parsing.', error);
      this._resetState();
      return false;
    }
  }
  
  /**
   * Resets the internal state of the ZipEditor.
   * @private
   */
  _resetState() {
    this.zipData = null;
    this.fileEntries = [];
    this.eocd = null;
  }


  /**
   * Finds and parses the End of Central Directory (EOCD) record.
   * @returns {boolean} True if found and parsed, false otherwise.
   * @private
   */
  _findEndOfCentralDirectoryRecord() {
    const ba = this.zipData;
    const minEocdSize = 22; // Fixed size part of EOCD
    const maxCommentSize = 0xFFFF; // Max ZIP comment length
    const maxScanLength = minEocdSize + maxCommentSize;
    // Determine how far back to scan: from end of file up to maxScanLength or beginning of file
    const searchStartOffset = Math.max(0, ba.length - maxScanLength);

    // Search backward for the EOCD signature
    // The loop should go from (ba.length - minEocdSize) down to searchStartOffset
    for (let i = ba.length - minEocdSize; i >= searchStartOffset; i--) {
      ba.position = i;
      if (ba.bytesAvailable < 4) continue; // Ensure enough bytes for signature
      
      const signature = ba.readUnsignedInt(true); // EOCD signature is little-endian
      
      if (signature === ZipEditor.END_OF_CENTRAL_DIR_SIGNATURE) {
        ba.position = i; // Reset position to start of signature for parsing

        // EOCD Record Structure (all little-endian)
        // signature (4 bytes) - already read
        ba.readUnsignedInt(true); // Skip signature
        const diskNumber = ba.readUnsignedShort(true);
        const startDiskNumber = ba.readUnsignedShort(true);
        const numCentralDirEntriesOnDisk = ba.readUnsignedShort(true);
        const totalCentralDirEntries = ba.readUnsignedShort(true);
        const centralDirSize = ba.readUnsignedInt(true);
        const centralDirOffset = ba.readUnsignedInt(true);
        const commentLength = ba.readUnsignedShort(true);

        // Basic validation for multi-disk (not fully supported but check)
        if (diskNumber !== 0 || startDiskNumber !== 0 || numCentralDirEntriesOnDisk !== totalCentralDirEntries) {
          console.warn('ZipEditor: Multi-disk ZIP files are not fully supported. Information might be incomplete.');
        }
        
        // Validate offset and size
        if (centralDirOffset + centralDirSize > ba.length) {
            console.error('ZipEditor._findEndOfCentralDirectoryRecord: Central directory offset or size is out of bounds.');
            this.eocd = null;
            return false;
        }


        let comment = '';
        if (commentLength > 0) {
          if (ba.bytesAvailable >= commentLength) {
            comment = ba.readString(commentLength, 'utf-8');
          } else {
            console.warn('ZipEditor._findEndOfCentralDirectoryRecord: EOCD comment length exceeds available bytes. Comment might be truncated.');
            comment = ba.readString(ba.bytesAvailable, 'utf-8');
          }
        }
        
        this.eocd = {
          numEntries: numCentralDirEntriesOnDisk, // As per problem description, maps to numCentralDirEntriesOnDisk
          totalNumEntries: totalCentralDirEntries,
          size: centralDirSize, // As per problem description, maps to centralDirSize
          offset: centralDirOffset, // As per problem description, maps to centralDirOffset
          commentLength: commentLength,
          comment: comment,
          // Store raw values too if needed for other operations later
          diskNumber, 
          startDiskNumber,
        };
        return true;
      }
    }

    console.error('ZipEditor._findEndOfCentralDirectoryRecord: End of Central Directory Record signature not found.');
    this.eocd = null;
    return false;
  }

  /**
   * Parses the Central Directory File Headers.
   * @returns {boolean} True if parsing is successful, false otherwise.
   * @private
   */
  _parseCentralDirectory() {
    if (!this.eocd || this.eocd.offset < 0 || this.eocd.offset >= this.zipData.length) {
      console.error('ZipEditor._parseCentralDirectory: EOCD record not available or central directory offset is invalid.');
      return false;
    }

    const ba = this.zipData;
    ba.position = this.eocd.offset;
    this.fileEntries = []; // Initialize/clear previous entries

    for (let i = 0; i < this.eocd.totalNumEntries; i++) {
      if (ba.bytesAvailable < 46) { // Minimum fixed size of a central directory entry
        console.error(`ZipEditor._parseCentralDirectory: Insufficient data for entry ${i + 1}. Expected 46 bytes, got ${ba.bytesAvailable}.`);
        this.fileEntries = []; // Clear partially parsed entries
        return false;
      }
      
      const signature = ba.readUnsignedInt(true);
      if (signature !== ZipEditor.CENTRAL_DIR_SIGNATURE) {
        console.error(`ZipEditor._parseCentralDirectory: Invalid Central Directory File Header signature at entry ${i + 1}. Expected ${ZipEditor.CENTRAL_DIR_SIGNATURE.toString(16)}, got ${signature.toString(16)}.`);
        this.fileEntries = []; // Clear partially parsed entries
        return false;
      }

      const entry = {};
      // Central Directory File Header Structure (all little-endian unless specified)
      entry.versionMadeBy = ba.readUnsignedShort(true);
      entry.versionNeeded = ba.readUnsignedShort(true); // versionNeededToExtract
      entry.flags = ba.readUnsignedShort(true);
      entry.compressionMethod = ba.readUnsignedShort(true);
      entry.lastModTime = ba.readUnsignedShort(true);
      entry.lastModDate = ba.readUnsignedShort(true);
      entry.crc32 = ba.readUnsignedInt(true);
      entry.compressedSize = ba.readUnsignedInt(true);
      entry.uncompressedSize = ba.readUnsignedInt(true);
      const fileNameLength = ba.readUnsignedShort(true);
      const extraFieldLength = ba.readUnsignedShort(true);
      const fileCommentLength = ba.readUnsignedShort(true);
      entry.diskNumberStart = ba.readUnsignedShort(true); // Ignore for now
      entry.internalAttributes = ba.readUnsignedShort(true); // Ignore for now
      entry.externalAttributes = ba.readUnsignedInt(true); // Ignore for now
      entry.localHeaderOffset = ba.readUnsignedInt(true);

      // Ensure enough bytes for variable length fields
      if (ba.bytesAvailable < fileNameLength + extraFieldLength + fileCommentLength) {
          console.error(`ZipEditor._parseCentralDirectory: Insufficient data for variable length fields of entry ${i + 1}.`);
          this.fileEntries = [];
          return false;
      }

      entry.fileName = ba.readString(fileNameLength, 'utf-8');
      
      // Skip extraField: this.zipData.seek(extraFieldLength, 'current')
      // ByteArray.seek takes (offset, origin = 'begin').
      // To seek from current position, we directly modify position.
      if (extraFieldLength > 0) {
        // entry.extraField = ba.readBytes(extraFieldLength); // If we needed to store it
        ba.position += extraFieldLength;
      }
      
      entry.fileComment = ba.readString(fileCommentLength, 'utf-8');
      
      // Add other fields from the list if they are not directly named above but are part of the entry object
      // The problem specifies: { fileName, compressedSize, uncompressedSize, compressionMethod, crc32, localHeaderOffset, flags, lastModTime, lastModDate, fileComment, ... }
      // All these are covered by the `entry` object population.

      this.fileEntries.push(entry);
    }
    
    if (this.fileEntries.length !== this.eocd.totalNumEntries) {
        console.warn(`ZipEditor._parseCentralDirectory: Parsed ${this.fileEntries.length} entries, but EOCD expected ${this.eocd.totalNumEntries}. ZIP file might be truncated or EOCD record inaccurate.`);
        // Potentially return false if strict parsing is required.
    }

    return true;
  }

  /**
   * Gets the array of parsed file entry objects.
   * @returns {Array<Object>} The array of file entries.
   */
  getEntries() {
    return this.fileEntries;
  }

  /**
   * Gets a specific file entry by its name.
   * @param {string} fileName - The name of the file to find.
   * @returns {Object|null} The file entry object, or null if not found.
   */
  getEntry(fileName) {
    return this.fileEntries.find(entry => entry.fileName === fileName) || null;
  }

  // --- ZIP Generation Helper Methods ---

  /**
   * Converts a JavaScript Date object to MS-DOS time format.
   * @param {Date} jsDate - The JavaScript Date object.
   * @returns {number} The MS-DOS time.
   * @private
   */
  static _jsDateToDosTime(jsDate) {
    if (!jsDate) jsDate = new Date(); // Default to now if no date provided
    const hours = jsDate.getHours();
    const minutes = jsDate.getMinutes();
    const seconds = Math.floor(jsDate.getSeconds() / 2); // DOS time stores seconds / 2
    return (hours << 11) | (minutes << 5) | seconds;
  }

  /**
   * Converts a JavaScript Date object to MS-DOS date format.
   * @param {Date} jsDate - The JavaScript Date object.
   * @returns {number} The MS-DOS date.
   * @private
   */
  static _jsDateToDosDate(jsDate) {
    if (!jsDate) jsDate = new Date(); // Default to now if no date provided
    const year = jsDate.getFullYear() - 1980; // DOS year is offset from 1980
    const month = jsDate.getMonth() + 1; // JS month is 0-11, DOS is 1-12
    const day = jsDate.getDate();
    return (year << 9) | (month << 5) | day;
  }

  /**
   * Calculates the CRC32 checksum of the data.
   * @param {Uint8Array} data - The uncompressed file data.
   * @returns {number} The CRC32 checksum.
   * @private
   */
  _calculateCRC32(data) {
    return pako.crc32(data);
  }

  /**
   * Writes the Local File Header for an entry to the target ByteArray.
   * Assumes entry.localHeaderOffset has been set to targetByteArray.position before calling.
   * @param {Object} entry - The file entry object.
   * @param {ByteArray} targetByteArray - The ByteArray instance for output.
   * @private
   */
  _writeLocalFileHeader(entry, targetByteArray) {
    // entry.localHeaderOffset should be set to targetByteArray.position BEFORE this call
    
    targetByteArray.writeInt(ZipEditor.LOCAL_FILE_HEADER_SIGNATURE, true); // Signature
    targetByteArray.writeShort(entry.versionNeeded || 20, true); // Version needed to extract (e.g., 20 for PKZip 2.0)
    targetByteArray.writeShort(entry.flags || 0, true); // General purpose bit flag
    targetByteArray.writeShort(entry.compressionMethod, true); // Compression method (0 for Store, 8 for Deflate)
    
    const jsDate = entry.lastModifiedDate instanceof Date ? entry.lastModifiedDate : new Date();
    targetByteArray.writeShort(ZipEditor._jsDateToDosTime(jsDate), true); // Last mod file time
    targetByteArray.writeShort(ZipEditor._jsDateToDosDate(jsDate), true); // Last mod file date

    targetByteArray.writeInt(entry.crc32 || 0, true); // CRC-32
    targetByteArray.writeInt(entry.compressedSize || 0, true); // Compressed size
    targetByteArray.writeInt(entry.uncompressedSize || 0, true); // Uncompressed size

    const fileNameBytes = new TextEncoder().encode(entry.fileName);
    targetByteArray.writeShort(fileNameBytes.length, true); // File name length
    targetByteArray.writeShort(0, true); // Extra field length (0 for now)

    targetByteArray.writeBytes(fileNameBytes); // File name
    // targetByteArray.writeBytes(entry.extraField || new Uint8Array(0)); // Extra field (if any)
  }

  /**
   * Writes the Central Directory File Header for an entry to the target ByteArray.
   * @param {Object} entry - The file entry object.
   * @param {ByteArray} targetByteArray - The ByteArray instance for output.
   * @private
   */
  _writeCentralDirectoryFileHeader(entry, targetByteArray) {
    targetByteArray.writeInt(ZipEditor.CENTRAL_DIR_SIGNATURE, true); // Signature
    targetByteArray.writeShort(entry.versionMadeBy || 20, true); // Version made by (e.g., 20 for PKZip 2.0 DOS)
    targetByteArray.writeShort(entry.versionNeeded || 20, true); // Version needed to extract
    targetByteArray.writeShort(entry.flags || 0, true); // General purpose bit flag
    targetByteArray.writeShort(entry.compressionMethod, true); // Compression method
    
    const jsDate = entry.lastModifiedDate instanceof Date ? entry.lastModifiedDate : new Date();
    targetByteArray.writeShort(ZipEditor._jsDateToDosTime(jsDate), true); // Last mod file time
    targetByteArray.writeShort(ZipEditor._jsDateToDosDate(jsDate), true); // Last mod file date
    
    targetByteArray.writeInt(entry.crc32 || 0, true); // CRC-32
    targetByteArray.writeInt(entry.compressedSize || 0, true); // Compressed size
    targetByteArray.writeInt(entry.uncompressedSize || 0, true); // Uncompressed size

    const fileNameBytes = new TextEncoder().encode(entry.fileName);
    targetByteArray.writeShort(fileNameBytes.length, true); // File name length
    targetByteArray.writeShort(0, true); // Extra field length (0 for now)
    targetByteArray.writeShort(0, true); // File comment length (0 for now)
    targetByteArray.writeShort(0, true); // Disk number start (0)
    targetByteArray.writeShort(entry.internalFileAttributes || 0, true); // Internal file attributes
    targetByteArray.writeInt(entry.externalFileAttributes || 0, true); // External file attributes
    targetByteArray.writeInt(entry.localHeaderOffset, true); // Relative offset of local header

    targetByteArray.writeBytes(fileNameBytes); // File name
    // targetByteArray.writeBytes(entry.extraField || new Uint8Array(0)); // Extra field (if any)
    // targetByteArray.writeBytes(entry.fileCommentBytes || new Uint8Array(0)); // File comment (if any)
  }

  /**
   * Writes the End of Central Directory (EOCD) record.
   * @param {ByteArray} targetByteArray - The ByteArray for output.
   * @param {number} centralDirOffset - Offset of the start of the Central Directory.
   * @param {number} centralDirSize - Total size of the Central Directory.
   * @param {number} numEntries - Total number of entries in the Central Directory.
   * @private
   */
  _writeEndOfCentralDirectoryRecord(targetByteArray, centralDirOffset, centralDirSize, numEntries) {
    targetByteArray.writeInt(ZipEditor.END_OF_CENTRAL_DIR_SIGNATURE, true); // EOCD signature
    targetByteArray.writeShort(0, true); // Disk number (0)
    targetByteArray.writeShort(0, true); // Start disk number (0)
    targetByteArray.writeShort(numEntries, true); // Number of entries on this disk
    targetByteArray.writeShort(numEntries, true); // Total number of entries
    targetByteArray.writeInt(centralDirSize, true); // Size of Central Directory
    targetByteArray.writeInt(centralDirOffset, true); // Offset of Central Directory
    targetByteArray.writeShort(0, true); // ZIP comment length (0 for now)
    // targetByteArray.writeBytes(zipCommentBytes || new Uint8Array(0)); // ZIP comment (if any)
  }

  /**
   * Extracts a file entry's data.
   * @param {Object|string} entryOrFileName - The file entry object or the name of the file.
   * @param {'string'|'bytearray'|'uint8array'} [outputFormat='string'] - The desired output format.
   * @returns {string|ByteArray|Uint8Array|null} The extracted data in the specified format, or null on error.
   */
  extractEntry(entryOrFileName, outputFormat = 'string') {
    let entry;
    if (typeof entryOrFileName === 'string') {
      entry = this.getEntry(entryOrFileName);
      if (!entry) {
        console.error(`ZipEditor.extractEntry: Entry with name "${entryOrFileName}" not found.`);
        return null;
      }
    } else if (typeof entryOrFileName === 'object' && entryOrFileName !== null && entryOrFileName.fileName) {
      entry = entryOrFileName;
    } else {
      console.error('ZipEditor.extractEntry: Invalid argument. Must be an entry object or a file name string.');
      return null;
    }

    if (!this.zipData) {
      console.error('ZipEditor.extractEntry: ZIP data not loaded. Call load() first.');
      return null;
    }

    const ba = this.zipData;
    try {
      ba.position = entry.localHeaderOffset;

      // 1. Parse Local File Header
      if (ba.bytesAvailable < 30) { // Minimum size of Local File Header
          console.error('ZipEditor.extractEntry: Insufficient data for Local File Header.');
          return null;
      }
      const signature = ba.readUnsignedInt(true);
      if (signature !== ZipEditor.LOCAL_FILE_HEADER_SIGNATURE) {
        console.error(`ZipEditor.extractEntry: Invalid Local File Header signature. Expected ${ZipEditor.LOCAL_FILE_HEADER_SIGNATURE.toString(16)}, got ${signature.toString(16)}.`);
        return null;
      }

      // Skip fields: version needed (2), flags (2), compression method (2), mod time (2), mod date (2), 
      // crc32 (4), compressed size (4), uncompressed size (4). Total 22 bytes.
      ba.position += 22; 

      const fileNameLength = ba.readUnsignedShort(true);
      const extraFieldLength = ba.readUnsignedShort(true);

      // Skip file name and extra field
      if (ba.bytesAvailable < fileNameLength + extraFieldLength) {
          console.error('ZipEditor.extractEntry: Insufficient data for file name or extra field in Local File Header.');
          return null;
      }
      ba.position += fileNameLength;
      ba.position += extraFieldLength;

      // Current position is at the start of compressed data

      // 2. Read Compressed Data
      if (entry.compressedSize === 0 && entry.uncompressedSize === 0) { // Handle empty files
         // If it's a directory or an explicitly empty file.
        if (entry.fileName.endsWith('/')) { // Typically indicates a directory
             console.warn(`ZipEditor.extractEntry: Attempting to extract a directory entry "${entry.fileName}" as file data. Returning empty for specified format.`);
        }
        // For empty files, uncompressedData will be an empty Uint8Array
        let uncompressedData = new Uint8Array(0);
         // Proceed to formatting output for empty data
         switch (outputFormat) {
            case 'string':
              return '';
            case 'bytearray':
              const emptyBa = new ByteArray(0);
              emptyBa._length = 0; // Ensure length is explicitly 0
              return emptyBa;
            case 'uint8array':
              return uncompressedData;
            default:
              console.error(`ZipEditor.extractEntry: Unknown output format "${outputFormat}".`);
              return null;
          }
      }
      
      if (ba.bytesAvailable < entry.compressedSize) {
          console.error('ZipEditor.extractEntry: Insufficient data for compressed file content.');
          return null;
      }
      const compressedFileData = ba.readBytes(entry.compressedSize);

      // 3. Decompress Data
      let uncompressedData = null;
      if (entry.compressionMethod === 8) { // Deflate
        try {
          uncompressedData = pako.inflate(compressedFileData);
        } catch (err) {
          console.error(`ZipEditor.extractEntry: Error decompressing data for "${entry.fileName}". Pako error:`, err);
          return null;
        }
      } else if (entry.compressionMethod === 0) { // Store (no compression)
        uncompressedData = compressedFileData;
      } else {
        console.error(`ZipEditor.extractEntry: Unsupported compression method ${entry.compressionMethod} for "${entry.fileName}".`);
        return null;
      }

      // 4. Verify Uncompressed Size
      if (uncompressedData && uncompressedData.length !== entry.uncompressedSize) {
        console.warn(`ZipEditor.extractEntry: Uncompressed data size (${uncompressedData.length}) does not match expected size (${entry.uncompressedSize}) for "${entry.fileName}". Data might be corrupt.`);
        // Continue, but with a warning. Or return null? For now, continue.
      }
      
      if (!uncompressedData) { // Should have been caught by compression method checks or pako error
          console.error(`ZipEditor.extractEntry: Decompression resulted in null data for "${entry.fileName}".`);
          return null;
      }


      // 5. Format Output
      switch (outputFormat) {
        case 'string':
          try {
            return new TextDecoder('utf-8').decode(uncompressedData);
          } catch (decodeError) {
            console.error(`ZipEditor.extractEntry: Error decoding data to UTF-8 string for "${entry.fileName}".`, decodeError);
            return null;
          }
        case 'bytearray':
          // Assuming ByteArray constructor can take Uint8Array or ArrayBuffer
          // If ByteArray(initialSizeOrArrayBuffer)
          const newBa = new ByteArray(uncompressedData.buffer.slice(uncompressedData.byteOffset, uncompressedData.byteOffset + uncompressedData.byteLength));
          // The ByteArray constructor from ArrayBuffer might set length to buffer.byteLength
          // We need to ensure its internal _length reflects the uncompressedData.length
          newBa._length = uncompressedData.length;
          return newBa;
        case 'uint8array':
          return uncompressedData;
        default:
          console.error(`ZipEditor.extractEntry: Unknown output format "${outputFormat}".`);
          return null;
      }
    } catch (error) {
      console.error(`ZipEditor.extractEntry: An unexpected error occurred while extracting "${entry.fileName}".`, error);
      return null;
    }
  }
}

// For environments that support module exports (e.g., Node.js)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ZipEditor;
}
// Check if ByteArray is loaded, especially for browser environments without modules
// else if (typeof ByteArray === 'undefined') {
//  console.error("ZipEditor: ByteArray class is not available. Please ensure ByteArray.js is loaded before ZipEditor.js.");
// }
