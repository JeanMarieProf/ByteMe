// Global variable to store the main ByteArray of the loaded ZIP file.
let globalZipByteArray = null;

// Ensure CompressionAlgorithm is available. If it's part of ByteArray.js and not global,
// it might need to be explicitly exposed or defined here.
if (typeof CompressionAlgorithm === 'undefined') {
    console.warn("CompressionAlgorithm enum not found globally, defining for this script.");
    var CompressionAlgorithm = { 
        NONE: 0,    // Typically for "Stored" method
        DEFLATE: 8, // Standard DEFLATE, often implies ZLIB wrapper in contexts like this
        ZLIB: 8,    // Explicitly using ZLIB (which wraps DEFLATE) for method 8
        // The actual value used (e.g., ZLIB or DEFLATE) must match what ByteArray.decompress() expects for method 8.
    };
}

// Defines callbacks for actions triggered by buttons in the UI.
const actionHandlerCallbacks = {
    // Handles the "View Hex" action for the selected item.
    onViewHex: (item) => {
        if (!item) { 
            console.warn("onViewHex called with no item (selectionDetails was undefined)."); 
            const hexViewPanel = document.getElementById('zip-hex-view-panel');
            if (hexViewPanel) hexViewPanel.innerHTML = '<p>No item selected for hex view.</p>';
            return; 
        }
        console.log('View Hex clicked for:', item.name);
        const hexViewPanel = document.getElementById('zip-hex-view-panel');
        const contentViewPanel = document.getElementById('zip-content-view-panel');

        // Resource cleanup: Revoke any existing object URL if switching from image view
        if (contentViewPanel && contentViewPanel.dataset.currentObjectUrl) {
            URL.revokeObjectURL(contentViewPanel.dataset.currentObjectUrl);
            delete contentViewPanel.dataset.currentObjectUrl;
            console.log("Revoked existing object URL from content view (onViewHex).");
        }

        if (hexViewPanel) {
            hexViewPanel.style.display = 'flex'; // Show hex panel
            // Render hex view or show error if data is missing
            if (globalZipByteArray) { 
                displayHexView(globalZipByteArray, item, 'zip-hex-view-panel'); 
            } else {
                console.error("Cannot display hex view: globalZipByteArray not available.");
                hexViewPanel.innerHTML = '<p style="color:red;">Error: ZIP data not available for hex view.</p>';
            }
        } else {
            console.error("Hex view panel (zip-hex-view-panel) not found.");
        }
        if (contentViewPanel) contentViewPanel.style.display = 'none'; // Hide content panel
    },

    // Handles the "View as Text" action for the selected file item.
    onViewAsText: async (item) => { 
        if (!item || !item.data || item.type !== 'file') { 
            console.warn("onViewAsText called with invalid item.", item); 
            const cvp = document.getElementById('zip-content-view-panel');
            if (cvp) cvp.innerHTML = '<p>Cannot display as text: Invalid item selected.</p>';
            return; 
        }
        console.log('View as Text clicked for:', item.name);
        const hexViewPanel = document.getElementById('zip-hex-view-panel');
        const contentViewPanel = document.getElementById('zip-content-view-panel');

        if (!contentViewPanel) {
            console.error("Content view panel (zip-content-view-panel) not found.");
            return;
        }

        // Resource cleanup: Revoke any existing object URL
        if (contentViewPanel.dataset.currentObjectUrl) {
            URL.revokeObjectURL(contentViewPanel.dataset.currentObjectUrl);
            delete contentViewPanel.dataset.currentObjectUrl;
            console.log("Revoked existing object URL from content view (onViewAsText).");
        }
        
        if (hexViewPanel) hexViewPanel.style.display = 'none'; 
        contentViewPanel.style.display = 'flex'; 
        contentViewPanel.innerHTML = `<p>Loading text for <strong>${item.name}</strong>...</p>`; 

        try {
            const fileEntry = item.data;
            if (!fileEntry || typeof fileEntry.fileDataOffset === 'undefined' || typeof fileEntry.compressedSize === 'undefined') {
                throw new Error("File entry data is incomplete or invalid for text view.");
            }
            
            const compressedDataBytes = globalZipByteArray.peekBytes(fileEntry.compressedSize, fileEntry.fileDataOffset);
            let tempByteArray = new ByteArray(compressedDataBytes); 

            let decompressedByteArray;
            if (fileEntry.compressionMethod === 0) { // Stored
                decompressedByteArray = tempByteArray;
            } else if (fileEntry.compressionMethod === 8) { // DEFLATE
                if (typeof tempByteArray.decompress !== 'function') {
                    throw new Error("ByteArray.decompress method not found. Ensure ByteArray.js is loaded and correct.");
                }
                // Assuming ZLIB for method 8, as per typical ZIP implementations.
                await tempByteArray.decompress(CompressionAlgorithm.ZLIB); 
                decompressedByteArray = tempByteArray;
            } else {
                throw new Error(`Unsupported compression method: ${fileEntry.compressionMethod}`);
            }

            // Use .length of the ByteArray which should reflect the current data length after decompression
            const text = decompressedByteArray.readUTFBytes(decompressedByteArray.length); 
            const pre = document.createElement('pre');
            pre.style.whiteSpace = 'pre-wrap'; // Allow text to wrap
            pre.style.wordBreak = 'break-all'; // Break long words if necessary
            pre.textContent = text;
            contentViewPanel.innerHTML = ''; // Clear loading message
            contentViewPanel.appendChild(pre);

        } catch (error) {
            console.error(`Error viewing ${item.name} as text:`, error);
            contentViewPanel.innerHTML = `<p style="color: red;">Failed to display text content for <strong>${item.name}</strong>:<br>${error.message}</p>`;
        }
    },

    // Handles the "View as Image" action for the selected file item.
    onViewAsImage: async (item) => { 
        if (!item || !item.data || item.type !== 'file') { 
            console.warn("onViewAsImage called with invalid item.", item); 
            const cvp = document.getElementById('zip-content-view-panel');
            if (cvp) cvp.innerHTML = '<p>Cannot display as image: Invalid item selected.</p>';
            return; 
        }
        console.log('View as Image clicked for:', item.name);
        const hexViewPanel = document.getElementById('zip-hex-view-panel');
        const contentViewPanel = document.getElementById('zip-content-view-panel');
        
        if (!contentViewPanel) {
            console.error("Content view panel (zip-content-view-panel) not found.");
            return;
        }

        if (hexViewPanel) hexViewPanel.style.display = 'none'; 
        contentViewPanel.style.display = 'flex';
        contentViewPanel.innerHTML = `<p>Loading image for <strong>${item.name}</strong>...</p>`; 

        if (contentViewPanel.dataset.currentObjectUrl) {
            URL.revokeObjectURL(contentViewPanel.dataset.currentObjectUrl);
            delete contentViewPanel.dataset.currentObjectUrl;
            console.log("Revoked previous object URL from content view (onViewAsImage).");
        }

        try {
            const fileEntry = item.data;
            if (!fileEntry || typeof fileEntry.fileDataOffset === 'undefined' || typeof fileEntry.compressedSize === 'undefined') {
                throw new Error("File entry data is incomplete or invalid for image view.");
            }

            const compressedDataBytes = globalZipByteArray.peekBytes(fileEntry.compressedSize, fileEntry.fileDataOffset);
            let tempByteArray = new ByteArray(compressedDataBytes);

            let decompressedByteArray;
            if (fileEntry.compressionMethod === 0) { // Stored
                decompressedByteArray = tempByteArray;
            } else if (fileEntry.compressionMethod === 8) { // DEFLATE
                if (typeof tempByteArray.decompress !== 'function') {
                    throw new Error("ByteArray.decompress method not found. Ensure ByteArray.js is loaded and correct.");
                }
                await tempByteArray.decompress(CompressionAlgorithm.ZLIB);
                decompressedByteArray = tempByteArray;
            } else {
                throw new Error(`Unsupported compression method: ${fileEntry.compressionMethod}`);
            }
            
            contentViewPanel.innerHTML = ''; // Clear loading message

            const imageBytes = decompressedByteArray.toUint8Array(); // Get all bytes from the decompressed array
            const fileNameLower = fileEntry.fileName.toLowerCase();
            let mimeType = '';

            if (fileNameLower.endsWith('.png')) mimeType = 'image/png';
            else if (fileNameLower.endsWith('.jpg') || fileNameLower.endsWith('.jpeg')) mimeType = 'image/jpeg';
            else if (fileNameLower.endsWith('.gif')) mimeType = 'image/gif';
            else if (fileNameLower.endsWith('.bmp')) mimeType = 'image/bmp';
            else if (fileNameLower.endsWith('.webp')) mimeType = 'image/webp';
            else if (fileNameLower.endsWith('.svg')) mimeType = 'image/svg+xml';
            else if (fileNameLower.endsWith('.ico')) mimeType = 'image/x-icon';
            else {
                throw new Error(`Unsupported image type for file: ${fileEntry.fileName}. Cannot determine MIME type.`);
            }

            const blob = new Blob([imageBytes], { type: mimeType });
            const objectURL = URL.createObjectURL(blob);
            contentViewPanel.dataset.currentObjectUrl = objectURL; 

            const img = document.createElement('img');
            img.src = objectURL;
            img.style.maxWidth = '100%';
            img.style.maxHeight = '100%';
            img.style.objectFit = 'contain'; // Ensure image scales nicely within panel
            img.alt = `Image content of ${fileEntry.fileName}`; 
            img.onerror = () => { 
                URL.revokeObjectURL(objectURL); 
                delete contentViewPanel.dataset.currentObjectUrl;
                contentViewPanel.innerHTML = `<p style="color: red;">Error: Browser could not render the image for <strong>${item.name}</strong>. The file might be corrupted or an unsupported subtype.</p>`;
            };
            contentViewPanel.appendChild(img);

        } catch (error) {
            console.error(`Error viewing ${item.name} as image:`, error);
            contentViewPanel.innerHTML = `<p style="color: red;">Failed to display image content for <strong>${item.name}</strong>:<br>${error.message}</p>`;
            if (contentViewPanel.dataset.currentObjectUrl) {
                 URL.revokeObjectURL(contentViewPanel.dataset.currentObjectUrl);
                 delete contentViewPanel.dataset.currentObjectUrl;
                 console.log("Revoked object URL due to error during image loading.");
            }
        }
    }
};

// Initializes the main archive explorer UI.
// - zipByteArray: An instance of ByteArray containing the ZIP file data.
// - targetDomElementId: The ID of the DOM element where the UI should be rendered.
function initArchiveExplorer(zipByteArray, targetDomElementId) {
    globalZipByteArray = zipByteArray; 

    const targetElement = document.getElementById(targetDomElementId);
    if (!targetElement) {
        console.error(`Error: Target DOM element with ID "${targetDomElementId}" not found. UI initialization aborted.`);
        return;
    }
    targetElement.innerHTML = ''; 

    // --- Create Core UI Structure ---
    const archiveUiContainer = document.createElement('div');
    archiveUiContainer.id = 'archive-ui-container';

    const zipExplorerPanel = document.createElement('div');
    zipExplorerPanel.id = 'zip-explorer-panel';
    // Placeholder will be replaced by populateFileExplorer or error message
    zipExplorerPanel.innerHTML = '<p>Loading file list...</p>'; 

    const zipMainPanel = document.createElement('div');
    zipMainPanel.id = 'zip-main-panel';

    const zipActionButtons = document.createElement('div');
    zipActionButtons.id = 'zip-action-buttons';
    zipActionButtons.innerHTML = '<p>Select an item to see actions.</p>'; // Initial placeholder

    const zipHexViewPanel = document.createElement('div');
    zipHexViewPanel.id = 'zip-hex-view-panel';
    zipHexViewPanel.style.display = 'flex'; // Default to show hex view
    zipHexViewPanel.innerHTML = '<p>Select an item to view its hex representation.</p>'; // Initial placeholder

    const zipContentViewPanel = document.createElement('div');
    zipContentViewPanel.id = 'zip-content-view-panel';
    zipContentViewPanel.style.display = 'none'; // Default to hide content view
    zipContentViewPanel.innerHTML = '<p>Select a file and an action (e.g., "View as Text") to see content here.</p>'; // Initial placeholder

    zipMainPanel.appendChild(zipActionButtons);
    zipMainPanel.appendChild(zipHexViewPanel);
    archiveUiContainer.appendChild(zipExplorerPanel);
    archiveUiContainer.appendChild(zipMainPanel);
    archiveUiContainer.appendChild(zipContentViewPanel);
    targetElement.appendChild(archiveUiContainer);

    // --- Apply CSS ---
    // (CSS remains largely the same as provided previously, ensuring it's applied once)
    const styleId = 'archive-explorer-styles';
    if (!document.getElementById(styleId)) {
        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
            #archive-ui-container { display: flex; flex-direction: row; height: 90vh; border: 1px solid black; font-family: Arial, sans-serif; }
            #zip-explorer-panel { width: 20%; border-right: 1px solid gray; padding: 10px; overflow-y: auto; background-color: #f8f9fa; }
            #zip-main-panel { width: 50%; display: flex; flex-direction: column; border-right: 1px solid gray; }
            #zip-action-buttons { height: 50px; border-bottom: 1px solid lightgray; margin-bottom: 0; padding: 10px; background-color: #e9ecef; display: flex; align-items: center; }
            #zip-hex-view-panel { flex-grow: 1; overflow-y: auto; padding: 10px; background-color: #ffffff; }
            #zip-content-view-panel { width: 30%; padding: 10px; overflow-y: auto; background-color: #ffffff; }
            /* Styles for explorer list items */
            #zip-explorer-panel ul { list-style-type: none; padding-left: 0; margin-left: 0; }
            #zip-explorer-panel ul li { padding: 4px 8px; cursor: pointer; border-bottom: 1px solid #eee; }
            #zip-explorer-panel ul li:hover { background-color: #e9ecef; }
            .selected-explorer-item { background-color: #007bff !important; color: white !important; }
            /* Styles for hex view */
            .hex-offset { color: #888; margin-right: 10px; }
            .hex-byte { margin-right: 2px; }
            .hex-ascii-char { margin-right: 1px; }
            .zip-lfh { background-color: rgba(173, 216, 230, 0.3); }
            .zip-file-data { background-color: rgba(144, 238, 144, 0.3); }
            .zip-eocd { background-color: rgba(255, 182, 193, 0.3); }
            .zip-cdfh { background-color: rgba(255, 255, 150, 0.3); }
            .zip-full-cd { background-color: rgba(211, 211, 211, 0.2); }
            /* Button styling */
            #zip-action-buttons button { padding: 5px 10px; font-size: 0.9em; margin-right: 5px; border: 1px solid #ccc; background-color: #fff; border-radius: 3px; cursor: pointer; }
            #zip-action-buttons button:hover { background-color: #f0f0f0; }
            /* Error message styling */
            .error-message-container { padding: 20px; text-align: center; color: #721c24; background-color: #f8d7da; border: 1px solid #f5c6cb; border-radius: .25rem; }
            .error-message-container h2 { color: #721c24; margin-bottom: 10px; }
        `;
        document.head.appendChild(style);
    }
    
    // --- Parse ZIP and Populate UI ---
    if (typeof parseZipStructure === 'function') {
        try {
            if (!zipByteArray || zipByteArray.length === 0) {
                throw new Error("Provided ZIP data is empty or invalid.");
            }
            const zipStructure = parseZipStructure(zipByteArray); 
            if (zipStructure && zipStructure.centralDirectoryEntries) {
                populateFileExplorer(zipStructure, 'zip-explorer-panel', handleExplorerSelection);
                // Optionally, select the first item or EOCD by default
                if (zipStructure.centralDirectoryEntries.length > 0) {
                    // Simulate a click on the first file entry, if available
                    // This would require modifying populateFileExplorer to return the list items
                    // or querySelector here. For now, user must click.
                } else if (zipStructure.eocdRecord) {
                    // actionHandlerCallbacks.onViewHex({ type: 'eocd', data: zipStructure.eocdRecord, name: 'EOCD Record' });
                }
            } else {
                // This case implies parseZipStructure returned null or an invalid structure
                throw new Error("Failed to parse ZIP structure or no central directory entries found.");
            }
        } catch (error) {
            console.error("Error during ZIP parsing or initial UI population:", error);
            targetElement.innerHTML = `<div class="error-message-container">
                <h2><span style="font-size:1.5em;">⚠️</span> Error Loading ZIP File</h2>
                <p>Could not parse the ZIP file. The file may be corrupted or not a valid ZIP format.</p>
                <p><strong>Details:</strong> ${error.message}</p>
                <p><em>Please check the console for more technical information.</em></p>
            </div>`;
        }
    } else {
        console.error("parseZipStructure function not found. Ensure zip_parser.js is loaded correctly.");
        targetElement.innerHTML = `<div class="error-message-container">
            <h2><span style="font-size:1.5em;">⚠️</span> Initialization Error</h2>
            <p>The ZIP parsing library (zip_parser.js) is not loaded correctly.</p>
            <p>Please ensure all scripts are loaded in the correct order and that the file is accessible.</p>
        </div>`;
    }
}

// Handles item selection from the file explorer panel.
// This function is the primary callback when a user clicks an item in the explorer.
// It coordinates updates to the hex view, action buttons, and panel visibility.
function handleExplorerSelection(selectedItem) {
    if (!selectedItem) {
        console.warn("handleExplorerSelection called with undefined selectedItem.");
        return;
    }
    console.log("Item selected:", selectedItem.name, "Type:", selectedItem.type); 

    // Update visual selection in the explorer panel
    const explorerPanel = document.getElementById('zip-explorer-panel'); 
    if (explorerPanel) {
        const listItems = explorerPanel.querySelectorAll('li');
        listItems.forEach(li => li.classList.remove('selected-explorer-item'));
    } else {
        console.warn("Explorer panel (zip-explorer-panel) not found for selection styling.");
    }

    if (selectedItem.targetElement) { 
        selectedItem.targetElement.classList.add('selected-explorer-item');
    } else {
        // If targetElement is not passed, we can't style selection via click.
        // This might happen if called programmatically without a DOM event.
        console.warn("selectedItem.targetElement is undefined. Cannot apply selection style directly.");
    }

    // Trigger the "View Hex" action by default for any selection.
    // onViewHex handles showing the hex panel and hiding the content panel.
    if (actionHandlerCallbacks.onViewHex) {
        actionHandlerCallbacks.onViewHex(selectedItem);
    } else {
        console.error("onViewHex callback not defined. Default hex view cannot be shown.");
        // Fallback: Manually try to show hex view, though this is not ideal
        const hexViewPanel = document.getElementById('zip-hex-view-panel');
        const contentViewPanel = document.getElementById('zip-content-view-panel');
        if(hexViewPanel) hexViewPanel.style.display = 'flex';
        if(contentViewPanel) contentViewPanel.style.display = 'none';
        if (globalZipByteArray && hexViewPanel) {
            displayHexView(globalZipByteArray, selectedItem, 'zip-hex-view-panel');
        } else if(hexViewPanel) {
            hexViewPanel.innerHTML = '<p style="color: red;">Error: ZIP data not available for hex view.</p>';
        }
    }
    
    // Update action buttons based on the new selection
    updateActionButtons(selectedItem, 'zip-action-buttons', actionHandlerCallbacks);
}

// Dynamically updates the action buttons based on the currently selected item.
function updateActionButtons(selectionDetails, buttonsPanelId, actionCallbacks) {
    const buttonsPanelElement = document.getElementById(buttonsPanelId);
    if (!buttonsPanelElement) {
        console.error(`Error: Buttons panel element with ID "${buttonsPanelId}" not found.`);
        return;
    }
    buttonsPanelElement.innerHTML = ''; // Clear existing buttons

    if (!selectionDetails || !actionCallbacks) {
        console.error("Missing selectionDetails or actionCallbacks for updateActionButtons.");
        buttonsPanelElement.innerHTML = '<p>Error: Cannot determine actions.</p>';
        return;
    }

    const createButton = (text, onClickAction) => {
        const button = document.createElement('button');
        button.textContent = text;
        button.addEventListener('click', onClickAction);
        buttonsPanelElement.appendChild(button);
        return button;
    };

    if (actionCallbacks.onViewHex) {
        createButton('View Hex', () => actionCallbacks.onViewHex(selectionDetails));
    }

    if (selectionDetails.type === 'file') {
        const fileEntry = selectionDetails.data; 
        if (fileEntry && fileEntry.fileName) {
            const fileNameLower = fileEntry.fileName.toLowerCase();
            const textExtensions = ['.txt', '.json', '.xml', '.html', '.js', '.css', '.log', '.csv', '.md', '.yaml', '.ini', '.cfg', '.inf', '.nfo', '.diz', '.bat', '.sh', '.ps1'];
            if (textExtensions.some(ext => fileNameLower.endsWith(ext))) {
                if (actionCallbacks.onViewAsText) {
                    createButton('View as Text', () => actionCallbacks.onViewAsText(selectionDetails));
                }
            }

            const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg', '.ico'];
            if (imageExtensions.some(ext => fileNameLower.endsWith(ext))) {
                if (actionCallbacks.onViewAsImage) {
                    createButton('View as Image', () => actionCallbacks.onViewAsImage(selectionDetails));
                }
            }
        }
    }
}

// Renders the hex dump of a selected portion of the ZIP file.
function displayHexView(zipByteArray, selectionDetails, hexPanelId) {
    const hexPanelElement = document.getElementById(hexPanelId);
    if (!hexPanelElement) {
        console.error(`Error: Hex view panel element with ID "${hexPanelId}" not found.`);
        return;
    }
    hexPanelElement.innerHTML = ''; // Clear previous hex content

    if (!zipByteArray || typeof zipByteArray.peekBytes !== 'function') {
        console.error("Error: Invalid or missing zipByteArray for displayHexView.");
        if (hexPanelElement) hexPanelElement.innerHTML = '<p style="color: red;">Hex View Error: ZIP data is not available or invalid.</p>';
        return;
    }
    if (!selectionDetails || !selectionDetails.type || !selectionDetails.data) {
        console.error("Error: Invalid selectionDetails for displayHexView.");
        if (hexPanelElement) hexPanelElement.innerHTML = '<p style="color: red;">Hex View Error: Invalid selection details.</p>';
        return;
    }

    let viewOffset = 0; 
    let viewLength = 0;
    const colorRegions = []; 

    switch (selectionDetails.type) {
        case 'file':
            const fileEntry = selectionDetails.data;
            viewOffset = fileEntry.lfhOffset;
            const fileDataLength = (typeof fileEntry.fileDataLength === 'number' && !isNaN(fileEntry.fileDataLength)) ? fileEntry.fileDataLength : 0;
            const lfhHeaderSize = (typeof fileEntry.lfhHeaderSize === 'number' && !isNaN(fileEntry.lfhHeaderSize)) ? fileEntry.lfhHeaderSize : 0;
            viewLength = lfhHeaderSize + fileDataLength;

            if (lfhHeaderSize > 0) {
                colorRegions.push({ start: fileEntry.lfhOffset, end: fileEntry.lfhOffset + lfhHeaderSize, cssClass: 'zip-lfh', regionName: 'Local File Header' });
            }
            if (fileDataLength > 0 && typeof fileEntry.fileDataOffset === 'number') { // Ensure fileDataOffset is valid
                 colorRegions.push({ start: fileEntry.fileDataOffset, end: fileEntry.fileDataOffset + fileDataLength, cssClass: 'zip-file-data', regionName: 'File Data' });
            }
            break;
        case 'eocd':
            const eocdRecord = selectionDetails.data;
            viewOffset = eocdRecord.eocdOffset;
            viewLength = eocdRecord.eocdSize;
            colorRegions.push({ start: eocdRecord.eocdOffset, end: eocdRecord.eocdOffset + eocdRecord.eocdSize, cssClass: 'zip-eocd', regionName: 'EOCD Record' });
            break;
        case 'full_cd':
            const cdData = selectionDetails.data;
            viewOffset = cdData.offset;
            viewLength = cdData.size;
            colorRegions.push({ start: cdData.offset, end: cdData.offset + cdData.size, cssClass: 'zip-full-cd', regionName: 'Central Directory' });
            if (cdData.entries) {
                cdData.entries.forEach(cdfhEntry => {
                    colorRegions.push({ start: cdfhEntry.cdfhOffset, end: cdfhEntry.cdfhOffset + cdfhEntry.cdfhSize, cssClass: 'zip-cdfh', regionName: 'CDFH: ' + cdfhEntry.fileName });
                });
            }
            break;
        default:
            console.error(`Unknown selection type: ${selectionDetails.type}`);
            if (hexPanelElement) hexPanelElement.innerHTML = `<p style="color: red;">Hex View Error: Unknown selection type "${selectionDetails.type}".</p>`;
            return;
    }
    
    if (viewLength === 0) {
        if (hexPanelElement) {
            hexPanelElement.innerHTML = `<p>Selection: <strong>${selectionDetails.name || 'Unknown Item'}</strong></p>
                                         <p>(This item is empty or has zero length data to display in hex view)</p>`;
        }
        return; // Nothing to display
    }

    // Clamp viewLength if it exceeds the bounds of the zipByteArray
    if (viewOffset + viewLength > zipByteArray.length) {
        console.warn(`Warning: Calculated view (offset ${viewOffset}, length ${viewLength}) exceeds zipByteArray length (${zipByteArray.length}). Clamping viewLength.`);
        viewLength = zipByteArray.length - viewOffset;
        if (viewLength < 0) viewLength = 0;
         if (viewLength === 0 && hexPanelElement) { // If clamping results in zero length
            hexPanelElement.innerHTML = `<p>Selection: <strong>${selectionDetails.name || 'Unknown Item'}</strong></p><p>(Error: View range out of bounds after clamping)</p>`;
            return;
        }
    }

    const pre = document.createElement('pre');
    pre.style.fontFamily = 'monospace';
    pre.style.whiteSpace = 'pre'; 

    let htmlContent = '';
    const bytesPerLine = 16;

    for (let i = 0; i < viewLength; i++) {
        const currentByteOffsetInZip = viewOffset + i;

        if (i % bytesPerLine === 0) {
            if (i > 0) htmlContent += '\n'; 
            htmlContent += `<span class="hex-offset">${currentByteOffsetInZip.toString(16).padStart(8, '0')}</span> `;
        }

        const byteValue = zipByteArray.peekBytes(1, currentByteOffsetInZip)[0];
        let byteClasses = ['hex-byte'];
        for (const region of colorRegions) {
            if (currentByteOffsetInZip >= region.start && currentByteOffsetInZip < region.end) {
                byteClasses.push(region.cssClass);
            }
        }
        htmlContent += `<span class="${byteClasses.join(' ')}">${byteValue.toString(16).padStart(2, '0')}</span> `;

        if ((i + 1) % bytesPerLine === 0 || i === viewLength - 1) {
            const lineStartOffsetInZip = viewOffset + (i - (i % bytesPerLine));
            
            if (i === viewLength - 1 && (i + 1) % bytesPerLine !== 0) {
                const remainingBytes = bytesPerLine - ((i % bytesPerLine) + 1);
                htmlContent += '   '.repeat(remainingBytes); 
            }
            htmlContent += ' | '; // Separator

            for (let j = 0; j < bytesPerLine; j++) {
                const asciiByteOffsetInZip = lineStartOffsetInZip + j;
                if (asciiByteOffsetInZip < viewOffset + viewLength) { 
                    const charByte = zipByteArray.peekBytes(1, asciiByteOffsetInZip)[0];
                    const char = (charByte >= 32 && charByte <= 126) ? String.fromCharCode(charByte).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : '.';
                    
                    let currentAsciiClasses = ['hex-ascii-char'];
                     for (const region of colorRegions) {
                        if (asciiByteOffsetInZip >= region.start && asciiByteOffsetInZip < region.end) {
                            currentAsciiClasses.push(region.cssClass);
                        }
                    }
                    htmlContent += `<span class="${currentAsciiClasses.join(' ')}">${char}</span>`;
                } else {
                    htmlContent += ' '; 
                }
            }
        }
    }
    pre.innerHTML = htmlContent;
    hexPanelElement.appendChild(pre);
}

// Populates the file explorer panel with entries from the parsed ZIP structure.
function populateFileExplorer(zipStructure, explorerPanelId, onItemSelectedCallback) {
    const explorerPanelElement = document.getElementById(explorerPanelId);
    if (!explorerPanelElement) {
        console.error(`Error: Explorer panel element with ID "${explorerPanelId}" not found.`);
        return;
    }
    explorerPanelElement.innerHTML = ''; // Clear "Loading file list..." or previous content

    const ul = document.createElement('ul');
    
    // Populate Files
    if (zipStructure && zipStructure.centralDirectoryEntries && zipStructure.centralDirectoryEntries.length > 0) {
        zipStructure.centralDirectoryEntries.forEach((fileEntry, index) => {
            const li = document.createElement('li');
            li.textContent = fileEntry.fileName || `[Unnamed File ${index + 1}]`;
            li.title = fileEntry.fileName || `[Unnamed File ${index + 1}]`; // Tooltip for long names
            li.dataset.fileIndex = index;
            li.dataset.itemType = 'file';
            li.addEventListener('click', (event) => {
                onItemSelectedCallback({ type: 'file', data: fileEntry, name: fileEntry.fileName, targetElement: event.currentTarget });
            });
            ul.appendChild(li);
        });
    } else {
        const li = document.createElement('li');
        li.textContent = '(No files found in archive)';
        li.style.fontStyle = 'italic';
        ul.appendChild(li);
    }

    // Populate Structural Items (EOCD, Full CD)
    if (zipStructure && zipStructure.eocdRecord) {
        const liEocd = document.createElement('li');
        liEocd.textContent = 'EOCD Record';
        liEocd.title = 'End of Central Directory Record';
        liEocd.dataset.itemType = 'eocd';
        liEocd.style.marginTop = '10px'; 
        liEocd.addEventListener('click', (event) => {
            onItemSelectedCallback({ type: 'eocd', data: zipStructure.eocdRecord, name: 'EOCD Record', targetElement: event.currentTarget });
        });
        ul.appendChild(liEocd);
    }

    if (zipStructure && zipStructure.metrics && zipStructure.centralDirectoryEntries) {
        const liFullCD = document.createElement('li');
        liFullCD.textContent = 'Central Directory (Full)';
        liFullCD.title = 'Complete Central Directory Structure';
        liFullCD.dataset.itemType = 'full_cd';
        liFullCD.addEventListener('click', (event) => {
            onItemSelectedCallback({
                type: 'full_cd',
                data: {
                    offset: zipStructure.metrics.offsetOfCentralDirectory,
                    size: zipStructure.metrics.sizeOfCentralDirectory,
                    entries: zipStructure.centralDirectoryEntries 
                },
                name: 'Central Directory (Full)',
                targetElement: event.currentTarget
            });
        });
        ul.appendChild(liFullCD);
    }
    explorerPanelElement.appendChild(ul);
}
// Note: CSS injection part from previous populateFileExplorer was merged into initArchiveExplorer's style block.
