// Constants for Endianness, typically part of ByteArray.js or a shared utility.
// If ByteArray.js defines and exports this, this local definition can be removed
// if using modules (e.g., ES6 modules or CommonJS).
const Endian = {
    BIG_ENDIAN: "bigEndian",
    LITTLE_ENDIAN: "littleEndian"
};

// Standard ZIP format signatures
const LFH_SIGNATURE = 0x04034b50; // Local File Header
const CDFH_SIGNATURE = 0x02014b50; // Central Directory File Header
const EOCD_SIGNATURE = 0x06054b50; // End of Central Directory Record

// Minimum size of the EOCD record (excluding the ZIP comment).
const EOCD_FIXED_SIZE = 22; 

/**
 * Parses the structure of a ZIP file from a ByteArray.
 *
 * @param {ByteArray} zipByteArray The ByteArray object containing the ZIP file data.
 * @returns {object} An object containing the parsed EOCD record, an array of
 *                   central directory entries (augmented with LFH info), and overall metrics.
 * @throws {Error} If the provided object is not a valid ByteArray, or if critical
 *                 ZIP structures (like EOCD or CDFH signatures) are not found or are invalid.
 */
function parseZipStructure(zipByteArray) {
    // Validate the input ByteArray
    if (!zipByteArray || typeof zipByteArray.gotoNum !== 'function' || typeof zipByteArray.setEndian !== 'function') {
        throw new Error("Invalid or incomplete ByteArray object provided to parseZipStructure.");
    }

    // ZIP files use little-endian byte order for multi-byte fields.
    zipByteArray.setEndian(Endian.LITTLE_ENDIAN);

    // Initialize the structure to hold parsed ZIP data.
    const zipStructure = {
        eocdRecord: null,              // Will hold the End of Central Directory Record
        centralDirectoryEntries: [],   // Will hold all Central Directory File Header entries
        metrics: {}                    // Will hold overall ZIP file metrics
    };

    // --- A. Find and Parse the End of Central Directory Record (EOCD) ---
    // The EOCD record is at the end of the ZIP file. We scan backwards from the end.
    // Max comment length is 65535 bytes (0xFFFF), plus the fixed EOCD size.
    const maxEOCDSearchRange = Math.min(zipByteArray.length, 65536 + EOCD_FIXED_SIZE);
    if (!zipByteArray.gotoNum(EOCD_SIGNATURE, 4, true, maxEOCDSearchRange)) {
        throw new Error("Invalid ZIP file: End of Central Directory Record (EOCD) signature not found.");
    }
    const eocdOffset = zipByteArray.position; // Store the offset where EOCD signature was found
    zipByteArray.goto(eocdOffset); // Reset position to the start of the EOCD signature for parsing

    const eocd = {}; // Object to store EOCD fields
    // All fields are read according to PKWARE .ZIP File Format Specification (APPNOTE.TXT)
    eocd.signature = zipByteArray.readUnsignedInt();          // 0x06054b50
    eocd.diskNumber = zipByteArray.readUnsignedShort();       // Number of this disk
    eocd.startDiskNumber = zipByteArray.readUnsignedShort();  // Disk where central directory starts
    eocd.numCentralDirectoryRecordsOnThisDisk = zipByteArray.readUnsignedShort(); // Number of CD entries on this disk
    eocd.totalCentralDirectoryRecords = zipByteArray.readUnsignedShort(); // Total number of CD entries
    eocd.sizeOfCentralDirectory = zipByteArray.readUnsignedInt(); // Size of central directory (bytes)
    eocd.offsetOfCentralDirectory = zipByteArray.readUnsignedInt(); // Offset of start of central directory, relative to start of archive
    eocd.zipCommentLength = zipByteArray.readUnsignedShort(); // Length of .ZIP file comment
    eocd.zipComment = zipByteArray.readUTFBytes(eocd.zipCommentLength); // .ZIP file comment

    eocd.eocdOffset = eocdOffset; // Store the actual offset of this EOCD record
    eocd.eocdSize = EOCD_FIXED_SIZE + eocd.zipCommentLength; // Calculate total size of EOCD

    zipStructure.eocdRecord = eocd;
    zipStructure.metrics = {
        totalCentralDirectoryRecords: eocd.totalCentralDirectoryRecords,
        sizeOfCentralDirectory: eocd.sizeOfCentralDirectory,
        offsetOfCentralDirectory: eocd.offsetOfCentralDirectory,
        zipCommentLength: eocd.zipCommentLength,
        eocdDetectedOffset: eocdOffset
    };

    // Check for ZIP64 indicators in EOCD. This parser doesn't fully support ZIP64,
    // but it's good to warn if such indicators are present.
    if (eocd.diskNumber === 0xFFFF ||
        eocd.startDiskNumber === 0xFFFF ||
        eocd.numCentralDirectoryRecordsOnThisDisk === 0xFFFF ||
        eocd.totalCentralDirectoryRecords === 0xFFFF ||
        eocd.sizeOfCentralDirectory === 0xFFFFFFFF ||
        eocd.offsetOfCentralDirectory === 0xFFFFFFFF) {
        console.warn("Warning: ZIP64 format indicators detected in EOCD. This parser does not fully support ZIP64 archives. Parsed offsets/sizes might be incorrect if the archive is truly ZIP64.");
    }

    // --- B. Parse Central Directory File Headers (CDFH) ---
    // Navigate to the start of the central directory using the offset from EOCD.
    zipByteArray.goto(eocd.offsetOfCentralDirectory);
    for (let i = 0; i < eocd.totalCentralDirectoryRecords; i++) {
        const cdfh = {}; // Object to store CDFH fields
        cdfh.cdfhOffset = zipByteArray.position; // Store the offset of this CDFH record
        
        const cdfhSignature = zipByteArray.readUnsignedInt();
        if (cdfhSignature !== CDFH_SIGNATURE) {
            // This is a critical error. If a CDFH signature is wrong, the CD is likely corrupt.
            console.error(`Critical Error: Invalid Central Directory File Header (CDFH) signature at offset ${cdfh.cdfhOffset}. Expected ${CDFH_SIGNATURE.toString(16)}, found ${cdfhSignature.toString(16)}. Aborting CDFH parsing.`);
            throw new Error(`Invalid CDFH signature at offset ${cdfh.cdfhOffset}. Central directory may be corrupt.`);
        }
        cdfh.signature = cdfhSignature;                       // 0x02014b50
        cdfh.versionMadeBy = zipByteArray.readUnsignedShort();  // Version made by
        cdfh.versionNeededToExtract = zipByteArray.readUnsignedShort(); // Version needed to extract
        cdfh.generalPurposeBitFlag = zipByteArray.readUnsignedShort(); // General purpose bit flag
        cdfh.compressionMethod = zipByteArray.readUnsignedShort(); // Compression method
        cdfh.lastModFileTime = zipByteArray.readUnsignedShort(); // Last mod file time
        cdfh.lastModFileDate = zipByteArray.readUnsignedShort(); // Last mod file date
        cdfh.crc32 = zipByteArray.readUnsignedInt();            // CRC-32
        cdfh.compressedSize = zipByteArray.readUnsignedInt();   // Compressed size
        cdfh.uncompressedSize = zipByteArray.readUnsignedInt(); // Uncompressed size
        cdfh.fileNameLength = zipByteArray.readUnsignedShort(); // File name length (n)
        cdfh.extraFieldLength = zipByteArray.readUnsignedShort(); // Extra field length (m)
        cdfh.fileCommentLength = zipByteArray.readUnsignedShort(); // File comment length (k)
        cdfh.diskNumberStart = zipByteArray.readUnsignedShort(); // Disk number where file starts
        cdfh.internalFileAttributes = zipByteArray.readUnsignedShort(); // Internal file attributes
        cdfh.externalFileAttributes = zipByteArray.readUnsignedInt(); // External file attributes
        cdfh.relativeOffsetOfLocalHeader = zipByteArray.readUnsignedInt(); // Relative offset of local file header

        cdfh.fileName = zipByteArray.readUTFBytes(cdfh.fileNameLength); // File name
        cdfh.extraField = zipByteArray.readBytes(cdfh.extraFieldLength); // Extra field (raw bytes)
        cdfh.fileComment = zipByteArray.readUTFBytes(cdfh.fileCommentLength); // File comment

        // Calculate the total size of this CDFH record. Fixed part is 46 bytes.
        cdfh.cdfhSize = 46 + cdfh.fileNameLength + cdfh.extraFieldLength + cdfh.fileCommentLength;

        // Check for ZIP64 indicators in CDFH fields.
        if (cdfh.compressedSize === 0xFFFFFFFF ||
            cdfh.uncompressedSize === 0xFFFFFFFF ||
            cdfh.relativeOffsetOfLocalHeader === 0xFFFFFFFF ||
            cdfh.diskNumberStart === 0xFFFF) { // diskNumberStart is less common for ZIP64 but is an indicator
            console.warn(`Warning: ZIP64 format indicators detected for file "${cdfh.fileName}". This parser may not fully support ZIP64. Sizes/offsets for this file might rely on ZIP64 extra fields not parsed here.`);
        }

        zipStructure.centralDirectoryEntries.push(cdfh);
    }

    // --- C. Gather Local File Header (LFH) Information ---
    // For each CDFH entry, we now jump to its LFH to get additional info,
    // primarily to calculate the LFH's actual size and thus the data offset.
    for (const cdfhEntry of zipStructure.centralDirectoryEntries) {
        // Check if relativeOffsetOfLocalHeader seems valid (basic check)
        if (cdfhEntry.relativeOffsetOfLocalHeader > zipByteArray.length) {
            console.warn(`Warning: Invalid relativeOffsetOfLocalHeader for file "${cdfhEntry.fileName}" (${cdfhEntry.relativeOffsetOfLocalHeader}). Skipping LFH parsing for this entry.`);
            cdfhEntry.lfhError = `Invalid relativeOffsetOfLocalHeader (${cdfhEntry.relativeOffsetOfLocalHeader}).`;
            cdfhEntry.lfhHeaderSize = 0; // Cannot determine
            cdfhEntry.fileDataOffset = cdfhEntry.relativeOffsetOfLocalHeader; // Best guess, likely wrong
            cdfhEntry.fileDataLength = cdfhEntry.compressedSize;
            continue;
        }
        zipByteArray.goto(cdfhEntry.relativeOffsetOfLocalHeader);
        cdfhEntry.lfhOffset = zipByteArray.position; // Actual offset of LFH
        
        const lfhSignature = zipByteArray.readUnsignedInt();
        if (lfhSignature !== LFH_SIGNATURE) {
            console.warn(`Warning: Invalid Local File Header (LFH) signature for file "${cdfhEntry.fileName}" at offset ${cdfhEntry.lfhOffset}. Expected ${LFH_SIGNATURE.toString(16)}, found ${lfhSignature.toString(16)}. File data might be inaccessible.`);
            // Mark this entry as problematic but don't stop parsing other entries.
            cdfhEntry.lfhError = `Invalid LFH signature. Expected ${LFH_SIGNATURE.toString(16)}, found ${lfhSignature.toString(16)}.`;
            cdfhEntry.lfhHeaderSize = 0; // Cannot reliably determine LFH size
            // fileDataOffset might be just after this supposed LFH, but it's risky.
            // Use compressedSize from CDFH as fileDataLength as a fallback.
            cdfhEntry.fileDataOffset = cdfhEntry.lfhOffset + 30; // A guess, assuming fixed part + 0-len names/extras
            cdfhEntry.fileDataLength = cdfhEntry.compressedSize; 
            continue; 
        }
        cdfhEntry.lfhSignature = lfhSignature; // 0x04034b50
        
        // We only need to read/skip LFH fields up to the variable length parts (file name and extra field)
        // to determine the LFH header's total size.
        // These fields are usually the same as in CDFH but are stored locally here too.
        cdfhEntry.versionNeededToExtractLFH = zipByteArray.readUnsignedShort();
        cdfhEntry.generalPurposeBitFlagLFH = zipByteArray.readUnsignedShort();
        cdfhEntry.compressionMethodLFH = zipByteArray.readUnsignedShort(); // Should match cdfhEntry.compressionMethod
        // Skip LFH's lastModFileTime, lastModFileDate, crc32, compressedSize, uncompressedSize
        // These are 4 + 4 + 4 + 4 = 16 bytes to skip after compressionMethodLFH.
        zipByteArray.position += 16; 
        
        const fileNameLengthLFH = zipByteArray.readUnsignedShort();
        const extraFieldLengthLFH = zipByteArray.readUnsignedShort();

        cdfhEntry.fileNameLengthLFH = fileNameLengthLFH;
        cdfhEntry.extraFieldLengthLFH = extraFieldLengthLFH;
        
        // LFH fixed size is 30 bytes. Total LFH header size is fixed part + lengths of variable parts.
        cdfhEntry.lfhHeaderSize = 30 + fileNameLengthLFH + extraFieldLengthLFH;
        // The actual file data begins immediately after the LFH.
        cdfhEntry.fileDataOffset = cdfhEntry.lfhOffset + cdfhEntry.lfhHeaderSize;
        // fileDataLength is the compressed size, taken from the more reliable CDFH.
        cdfhEntry.fileDataLength = cdfhEntry.compressedSize; 
    }

    return zipStructure;
}

// Example Usage (for testing in Node.js environment):
// This section is for command-line testing if this script is run directly.
// It requires 'fs' module for file system access and ByteArray.js (and its Endian)
// to be in the same directory or accessible via require.
/*
if (typeof require !== 'undefined' && require.main === module) {
    const fs = require('fs');
    // Assuming ByteArray.js is in the same directory and exports ByteArray and Endian
    // Adjust path if necessary, e.g., const { ByteArray, Endian } = require('./ByteArray');
    // For this example, we'll assume ByteArray and Endian are globally available or defined within this file.

    if (process.argv.length < 3) {
        console.log("Usage: node zip_parser.js <path_to_zip_file>");
        process.exit(1);
    }
    const filePath = process.argv[2];
    try {
        const fileBuffer = fs.readFileSync(filePath);
        // Create a ByteArray from the file buffer.
        // Note: fileBuffer.buffer is the underlying ArrayBuffer.
        // .slice() is used to ensure we get a copy of the buffer segment that fs.readFileSync might manage.
        const zipData = new ByteArray(fileBuffer.buffer.slice(fileBuffer.byteOffset, fileBuffer.byteOffset + fileBuffer.byteLength));
        
        console.log(`Parsing ZIP file: ${filePath}`);
        const parsedStructure = parseZipStructure(zipData);
        
        // Output the parsed structure as JSON.
        // Custom replacer for JSON.stringify to handle Uint8Array and BigInt.
        console.log("\n--- Full Parsed Structure (JSON) ---");
        console.log(JSON.stringify(parsedStructure, (key, value) => {
            if (value instanceof Uint8Array) {
                return `Uint8Array(length:${value.length}, firstBytes:${value.slice(0, Math.min(16, value.length)).join(',')})`;
            }
            if (typeof value === 'bigint') {
                return value.toString() + 'n'; // For BigInt serialization
            }
            return value;
        }, 2));
        
        console.log("\n--- Basic File Listing ---");
        if (parsedStructure.centralDirectoryEntries && parsedStructure.centralDirectoryEntries.length > 0) {
            parsedStructure.centralDirectoryEntries.forEach((entry, index) => {
                console.log(
                    `[${index + 1}] File: ${entry.fileName || '(no name)'} ` +
                    `(Size C/U: ${entry.compressedSize}/${entry.uncompressedSize}, ` +
                    `Method: ${entry.compressionMethod}, ` +
                    `LFH Offset: 0x${entry.lfhOffset ? entry.lfhOffset.toString(16) : 'N/A'}, ` +
                    `Data Offset: 0x${entry.fileDataOffset ? entry.fileDataOffset.toString(16) : 'N/A'})`
                );
                if(entry.lfhError) console.warn(`  -> LFH Error: ${entry.lfhError}`);
                if(entry.fileComment) console.log(`  -> Comment: ${entry.fileComment}`);
            });
        } else {
            console.log("(No files found in central directory)");
        }
        if (parsedStructure.eocdRecord && parsedStructure.eocdRecord.zipComment) {
            console.log(`\nArchive Comment: ${parsedStructure.eocdRecord.zipComment}`);
        }

    } catch (error) {
        console.error("\n--- Error Parsing ZIP File ---");
        console.error("Message:", error.message);
        if (error.stack) {
            console.error("Stack:", error.stack);
        }
    }
}
*/
// If using in Node.js, uncomment the following lines:
// const fs = require('fs');
// const { ByteArray, Endian } = require('./ByteArray'); // Assuming ByteArray.js is in the same directory and exports ByteArray and Endian

// Example Usage (for testing in Node.js environment):
/*
if (require.main === module) {
    if (process.argv.length < 3) {
        console.log("Usage: node zip_parser.js <path_to_zip_file>");
        process.exit(1);
    }
    const filePath = process.argv[2];
    try {
        const fileBuffer = fs.readFileSync(filePath);
        const zipData = new ByteArray(fileBuffer.buffer.slice(fileBuffer.byteOffset, fileBuffer.byteOffset + fileBuffer.byteLength));
        const parsedStructure = parseZipStructure(zipData);
        console.log(JSON.stringify(parsedStructure, (key, value) => {
            if (value instanceof Uint8Array) {
                return `Uint8Array(length:${value.length})`; // More readable than full array
            }
            if (typeof value === 'bigint') {
                return value.toString() + 'n'; // For BigInt serialization
            }
            return value;
        }, 2));
        
        console.log("\n--- Basic File Listing ---");
        parsedStructure.centralDirectoryEntries.forEach(entry => {
            console.log(
                `File: ${entry.fileName}, ` +
                `Compressed: ${entry.compressedSize}, ` +
                `Uncompressed: ${entry.uncompressedSize}, ` +
                `LFH Offset: ${entry.lfhOffset}, ` +
                `Data Offset: ${entry.fileDataOffset}`
            );
            if(entry.lfhError) console.warn(`  Error: ${entry.lfhError}`);
        });

    } catch (error) {
        console.error("Error parsing ZIP file:", error.message);
        console.error(error.stack);
    }
}
*/
