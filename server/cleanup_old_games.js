#!/usr/bin/env node

/**
 * Cleanup script to remove all leftover game directories
 * Run this once to clean up existing mess, then the new automatic cleanup will handle future games
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

async function removeDirectory(dirPath) {
    return new Promise((resolve) => {
        if (fs.existsSync(dirPath)) {
            const rmProcess = spawn('rm', ['-rf', dirPath]);
            rmProcess.on('close', (code) => {
                if (code === 0) {
                    console.log(`✅ Removed: ${dirPath}`);
                } else {
                    console.log(`❌ Failed to remove: ${dirPath}`);
                }
                resolve();
            });
            rmProcess.on('error', (error) => {
                console.log(`❌ Error removing ${dirPath}: ${error.message}`);
                resolve();
            });
        } else {
            resolve();
        }
    });
}

async function cleanupOldGames() {
    console.log('🧹 Starting cleanup of old game directories...\n');
    
    const outputsDir = path.join(__dirname, 'ml_models', 'outputs');
    const modelsDir = path.join(__dirname, 'ml_models', 'models');
    
    let totalCleaned = 0;
    
    // Clean outputs directory
    if (fs.existsSync(outputsDir)) {
        const outputDirs = fs.readdirSync(outputsDir, { withFileTypes: true })
            .filter(dirent => dirent.isDirectory())
            .map(dirent => dirent.name);
        
        console.log(`Found ${outputDirs.length} directories in outputs/`);
        for (const dir of outputDirs) {
            await removeDirectory(path.join(outputsDir, dir));
            totalCleaned++;
        }
    }
    
    // Clean models directory (game code directories only)
    if (fs.existsSync(modelsDir)) {
        const modelDirs = fs.readdirSync(modelsDir, { withFileTypes: true })
            .filter(dirent => dirent.isDirectory())
            .map(dirent => dirent.name)
            .filter(name => 
                // Only remove directories that look like game codes (6 chars, alphanumeric)
                /^[A-Z0-9]{6}$/.test(name) && 
                !['__pycache__', 'model_cache', 's2v_old'].includes(name)
            );
        
        console.log(`Found ${modelDirs.length} game directories in models/`);
        for (const dir of modelDirs) {
            await removeDirectory(path.join(modelsDir, dir));
            totalCleaned++;
        }
    }
    
    console.log(`\n🎉 Cleanup complete! Removed ${totalCleaned} directories.`);
    console.log('💡 Future games will be automatically cleaned up when they end.');
}

// Run cleanup
cleanupOldGames().catch(console.error); 