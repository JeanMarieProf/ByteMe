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
import { ByteArray } from './ByteArray.js'; // Ensure ByteArray is imported

let selectedFiles = []; // Stores { id: uniqueId, fileObject: file }
let currentZipEditor = null;
let draggedItemId = null; // For drag-and-drop

document.addEventListener('DOMContentLoaded', () => {
    const fileInput = document.getElementById('fileInput');
    const archiveButton = document.getElementById('archiveButton');
    const fileList = document.getElementById('fileList');
    const messageArea = document.getElementById('messageArea');

    function showMessage(message, type = 'info') { // French messages
        messageArea.textContent = message;
        // Adapt type to French for CSS classes if needed, or use generic types
        if (type === 'succes') messageArea.className = 'success';
        else if (type === 'erreur') messageArea.className = 'error';
        else messageArea.className = 'info'; // Default or 'info'
    }

    function updateArchiveButtonVisibility() {
        archiveButton.style.display = selectedFiles.length > 0 ? 'inline-block' : 'none';
    }

    fileInput.addEventListener('change', () => {
        showMessage(''); // Clear previous messages
        const files = fileInput.files;

        for (const file of files) {
            const uniqueId = Date.now() + '-' + Math.random().toString(36).substring(2, 9);
            selectedFiles.push({ id: uniqueId, fileObject: file });

            const li = document.createElement('li');
            li.textContent = file.name;
            li.setAttribute('draggable', true);
            li.dataset.fileId = uniqueId;

            const removeButton = document.createElement('button');
            removeButton.textContent = '✖';
            removeButton.style.marginLeft = '10px';
            removeButton.style.cursor = 'pointer';
            removeButton.style.border = 'none';
            removeButton.style.background = 'transparent';
            removeButton.style.color = 'red';


            removeButton.addEventListener('click', (event) => {
                event.stopPropagation(); // Prevent triggering other listeners like drag/drop
                const fileIdToRemove = event.target.parentElement.dataset.fileId;

                selectedFiles = selectedFiles.filter(f => f.id !== fileIdToRemove);
                event.target.parentElement.remove();

                updateArchiveButtonVisibility();
                showMessage('Fichier supprimé.', 'info');
            });

            li.appendChild(removeButton);
            fileList.appendChild(li);
        }
        updateArchiveButtonVisibility();
        // Clear the file input to allow selecting the same file again if removed
        fileInput.value = ''; 
    });

    // Drag-and-Drop Functionality
    fileList.addEventListener('dragstart', (event) => {
        if (event.target.tagName === 'LI') {
            draggedItemId = event.target.dataset.fileId;
            event.dataTransfer.effectAllowed = 'move';
            event.target.style.opacity = '0.5'; // Visual cue
        }
    });

    fileList.addEventListener('dragover', (event) => {
        event.preventDefault(); // Necessary to allow drop
        event.dataTransfer.dropEffect = 'move';
    });

    fileList.addEventListener('drop', (event) => {
        event.preventDefault();
        if (event.target.tagName === 'UL' && draggedItemId) { // Dropped on empty area
            const draggedElement = fileList.querySelector(`li[data-file-id="${draggedItemId}"]`);
            if (draggedElement) {
                fileList.appendChild(draggedElement); // Move to end
                // Reorder selectedFiles array
                const draggedFileIndex = selectedFiles.findIndex(f => f.id === draggedItemId);
                if (draggedFileIndex > -1) {
                    const [draggedItem] = selectedFiles.splice(draggedFileIndex, 1);
                    selectedFiles.push(draggedItem);
                }
            }
        } else {
            const targetLi = event.target.closest('li');
            if (targetLi) {
                const droppedOnId = targetLi.dataset.fileId;
                if (draggedItemId && droppedOnId && draggedItemId !== droppedOnId) {
                    const draggedElement = fileList.querySelector(`li[data-file-id="${draggedItemId}"]`);
                    if (draggedElement) {
                        // Decide whether to insert before or after based on mouse position relative to target's midpoint
                        const rect = targetLi.getBoundingClientRect();
                        const midpoint = rect.top + rect.height / 2;
                        if (event.clientY < midpoint) {
                            fileList.insertBefore(draggedElement, targetLi);
                        } else {
                            fileList.insertBefore(draggedElement, targetLi.nextSibling);
                        }

                        // Reorder selectedFiles array
                        const draggedFileIndex = selectedFiles.findIndex(f => f.id === draggedItemId);
                        let droppedOnIndex = selectedFiles.findIndex(f => f.id === droppedOnId);

                        if (draggedFileIndex > -1 && droppedOnIndex > -1) {
                            const [draggedItem] = selectedFiles.splice(draggedFileIndex, 1);
                            // Adjust index if dragged item was before dropped item
                            if (draggedFileIndex < droppedOnIndex) {
                                 // If inserting after, the effective index might need adjustment
                                if (event.clientY >= midpoint) { // Inserted after targetLi
                                    // no change needed as splice already shifted items
                                } else { // Inserted before targetLi
                                    // no change needed
                                }
                            }
                             // Re-calculate droppedOnIndex after splice if necessary
                            droppedOnIndex = selectedFiles.findIndex(f => f.id === droppedOnId);
                            if (event.clientY < midpoint) { // Inserted before targetLi
                                selectedFiles.splice(droppedOnIndex, 0, draggedItem);
                            } else { // Inserted after targetLi
                                 selectedFiles.splice(droppedOnIndex + 1, 0, draggedItem);
                            }
                        }
                    }
                }
            }
        }
         if (draggedItemId) {
            const draggedElement = fileList.querySelector(`li[data-file-id="${draggedItemId}"]`);
            if (draggedElement) draggedElement.style.opacity = ''; // Reset visual cue
        }
        draggedItemId = null;
    });
    
    fileList.addEventListener('dragend', () => {
        if (draggedItemId) { // Reset opacity if drag was cancelled
             const draggedElement = fileList.querySelector(`li[data-file-id="${draggedItemId}"]`);
            if (draggedElement) draggedElement.style.opacity = '';
        }
        draggedItemId = null;
    });


    archiveButton.addEventListener('click', async () => {
        if (selectedFiles.length === 0) {
            showMessage('Veuillez sélectionner des fichiers à archiver.', 'erreur');
            return;
        }

        currentZipEditor = new ZipEditor();
        // No need to set currentZipEditor.fileEntries = []; ZipEditor constructor handles initialization
        showMessage('Traitement de l\'archive en cours...', 'info');

        try {
            for (const selectedFile of selectedFiles) {
                const fileEntryObj = selectedFile.fileObject; // Actual File object
                const fileContentArrayBuffer = await fileEntryObj.arrayBuffer();
                const fileDataUint8Array = new Uint8Array(fileContentArrayBuffer);

                let compressionMethod = 8; // Default to Deflate
                const binaryTypes = ['image/', 'application/zip', 'application/pdf', 'application/octet-stream'];
                const knownBinaryExtensions = ['.zip', '.jpg', '.jpeg', '.png', '.gif', '.pdf', '.mp3', '.mp4', '.docx', '.xlsx', '.pptx'];

                if (binaryTypes.some(type => fileEntryObj.type.startsWith(type)) || 
                    knownBinaryExtensions.some(ext => fileEntryObj.name.toLowerCase().endsWith(ext))) {
                    compressionMethod = 0; // Store for common binary types
                }
                
                // Prepare the entry for ZipEditor's internal structure
                const entry = {
                    fileName: fileEntryObj.name,
                    fileComment: '', // Optional
                    internalFileAttributes: 0, // Default
                    externalFileAttributes: 0, // Default
                    isModified: true, // Mark as new/modified
                    lastModifiedDate: new Date(fileEntryObj.lastModified),
                    uncompressedSize: fileDataUint8Array.length,
                    // crc32, lastModDate, lastModTime, modifiedData, compressedSize, compressionMethod will be set
                };

                // These static methods are part of the ZipEditor class
                entry.lastModDate = ZipEditor._jsDateToDosDate(entry.lastModifiedDate);
                entry.lastModTime = ZipEditor._jsDateToDosTime(entry.lastModifiedDate);
                entry.crc32 = ZipEditor._crc32(fileDataUint8Array);

                if (compressionMethod === 0) { // Store
                    entry.compressionMethod = 0;
                    entry.modifiedData = fileDataUint8Array; // Already a Uint8Array
                    entry.compressedSize = fileDataUint8Array.length;
                } else { // Deflate
                    entry.compressionMethod = 8;
                    const dataToCompress = new ByteArray(fileDataUint8Array.buffer.slice(0)); // Create new buffer slice
                    dataToCompress.length = fileDataUint8Array.length; // Set length on ByteArray correctly
                    await dataToCompress.deflate(); // Perform compression
                    
                    // Ensure modifiedData is a Uint8Array view of the compressed buffer
                    entry.modifiedData = new Uint8Array(dataToCompress.buffer, 0, dataToCompress.length);
                    entry.compressedSize = entry.modifiedData.length;
                }
                currentZipEditor.fileEntries.push(entry);
            }

            const newZipBlob = currentZipEditor.generateZipBlob();

            if (newZipBlob) {
                const downloadLink = document.createElement('a');
                downloadLink.href = URL.createObjectURL(newZipBlob);
                downloadLink.download = 'archive.zip';
                document.body.appendChild(downloadLink);
                downloadLink.click();
                document.body.removeChild(downloadLink);
                URL.revokeObjectURL(downloadLink.href);
                showMessage('Archive créée et téléchargée avec succès !', 'succes');
            } else {
                showMessage('Erreur lors de la création de l\'archive. Le blob est vide.', 'erreur');
            }
        } catch (error) {
            console.error('Erreur archivage:', error);
            showMessage(`Erreur technique lors de l\'archivage: ${error.message}`, 'erreur');
        } finally {
            // Reset UI after archiving attempt
            // fileInput.value = ''; // Already cleared on file selection change
            selectedFiles = [];
            fileList.innerHTML = '';
            updateArchiveButtonVisibility();
        }
    });

    // Initial setup
    updateArchiveButtonVisibility();
});
