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

import ZipEditor from './ZipEditor.js';
// ByteArray.js is imported by ZipEditor.js, so it doesn't strictly need to be imported here
// unless directly used in test.js for other purposes. For now, it's not directly used here.

let currentZipEditor = null;
let originalFileName = 'document.docx'; // Default filename

document.addEventListener('DOMContentLoaded', () => {
    const docxFileInput = document.getElementById('docxFileInput');
    const loadButton = document.getElementById('loadButton');
    const saveButton = document.getElementById('saveButton');
    const xmlContentDisplay = document.getElementById('xmlContentDisplay');
    const messageArea = document.getElementById('messageArea');

    function showMessage(message, type = 'info') {
        messageArea.textContent = message;
        messageArea.className = type; // 'success', 'error', or reset to empty for info
    }

    loadButton.addEventListener('click', async () => {
        xmlContentDisplay.value = '';
        showMessage(''); // Clear previous messages

        const file = docxFileInput.files[0];
        if (!file) {
            showMessage('Please select a .docx file first.', 'error');
            saveButton.style.display = 'none';
            currentZipEditor = null;
            return;
        }
        originalFileName = file.name; // Store original filename

        currentZipEditor = new ZipEditor(); // Assign to the global variable

        try {
            showMessage('Loading and parsing DOCX file...', 'info');
            const loadSuccess = await currentZipEditor.load(file);

            if (!loadSuccess) {
                showMessage('Failed to load or parse the DOCX file. Check console for details.', 'error');
                saveButton.style.display = 'none';
                currentZipEditor = null;
                return;
            }

            showMessage('File loaded. Extracting word/document.xml...', 'info');
            const xmlContent = currentZipEditor.extractEntry('word/document.xml', 'string');

            if (xmlContent === null || typeof xmlContent === 'undefined') {
                const entryExists = currentZipEditor.getEntry('word/document.xml');
                if (!entryExists) {
                     showMessage('word/document.xml not found in the DOCX file.', 'error');
                } else {
                    showMessage('word/document.xml found, but could not be extracted or is empty. Check console for details (e.g., pako decompression issue if using placeholder).', 'error');
                }
                xmlContentDisplay.value = ''; 
                saveButton.style.display = 'none';
            } else {
                xmlContentDisplay.value = xmlContent;
                showMessage('word/document.xml loaded and displayed successfully. You can now edit the content.', 'success');
                saveButton.style.display = 'inline-block'; // Show save button
                if (xmlContent === '' && currentZipEditor.getEntry('word/document.xml')?.uncompressedSize > 0) {
                    showMessage('word/document.xml extracted, but content is empty. This might be due to the pako.js placeholder. Full pako library is needed for actual decompression.', 'warning');
                } else if (xmlContent === '') {
                     showMessage('word/document.xml extracted and it is an empty file.', 'success');
                }
            }

        } catch (error) {
            console.error('Error during DOCX processing:', error);
            showMessage(`An error occurred: ${error.message}`, 'error');
            xmlContentDisplay.value = ''; 
            saveButton.style.display = 'none';
            currentZipEditor = null;
        }
    });

    saveButton.addEventListener('click', () => {
        if (!currentZipEditor) {
            showMessage('No DOCX file loaded or an error occurred during loading. Please load a file first.', 'error');
            return;
        }

        const modifiedXmlContent = xmlContentDisplay.value;
        
        try {
            showMessage('Updating word/document.xml content...', 'info');
            const updateSuccess = currentZipEditor.updateEntry('word/document.xml', modifiedXmlContent);

            if (!updateSuccess) {
                showMessage('Failed to update word/document.xml content. Check console for details.', 'error');
                return;
            }

            showMessage('Generating new DOCX file...', 'info');
            const newDocxBlob = currentZipEditor.generateZipBlob();

            if (!newDocxBlob) {
                showMessage('Failed to generate the new DOCX file. Check console for details.', 'error');
                return;
            }

            // Trigger Download
            const downloadLink = document.createElement('a');
            downloadLink.href = URL.createObjectURL(newDocxBlob);
            
            // Suggest a filename for the download
            const baseName = originalFileName.endsWith('.docx') ? originalFileName.slice(0, -5) : originalFileName;
            downloadLink.download = `${baseName}_modified.docx`;
            
            document.body.appendChild(downloadLink);
            downloadLink.click();
            document.body.removeChild(downloadLink);
            URL.revokeObjectURL(downloadLink.href);

            showMessage('Modified DOCX file saved and download initiated.', 'success');

        } catch (error) {
            console.error('Error during DOCX saving process:', error);
            showMessage(`An error occurred during saving: ${error.message}`, 'error');
        }
    });
});
