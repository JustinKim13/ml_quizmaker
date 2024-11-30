const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { exec, spawn } = require("child_process");
const cors = require("cors");
const { rimraf } = require('rimraf');

// Define file paths at the top
const QUESTIONS_FILE = path.join(__dirname, "ml_models/models/questions.json");
const UPLOAD_DIR = path.join(__dirname, "ml_models/data_preprocessing/pdf_files");
const STATUS_FILE = path.join(__dirname, "ml_models/models/status.json");
const COMBINED_OUTPUT_FILE = path.join(__dirname, "ml_models/outputs/combined_output.txt");

let questionsGenerated = false;

const app = express();
app.use(cors());
app.use(express.json());

// Add at the top with other constants
const activeGames = new Map(); // Stores game data including players

// Storage configuration for multer
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        if (!fs.existsSync(UPLOAD_DIR)) {
            fs.mkdirSync(UPLOAD_DIR, { recursive: true });
        }
        cb(null, UPLOAD_DIR);
    },
    filename: (req, file, cb) => {
        cb(null, `${Date.now()}-${file.originalname}`);
    },
});

const upload = multer({ storage });

// Add this helper function
const clearDirectory = (directory) => {
    return new Promise((resolve, reject) => {
        fs.rm(directory, { recursive: true, force: true }, (err) => {
            if (err) {
                reject(err);
            } else {
                // Recreate the empty directory
                fs.mkdirSync(directory, { recursive: true });
                resolve();
            }
        });
    });
};

// Modify the upload endpoint
app.post("/api/upload", async (req, res) => {
    try {
        // Clear the PDF directory before processing new files
        await clearDirectory(UPLOAD_DIR);
        
        // Now proceed with the upload
        upload.array("files")(req, res, async (err) => {
            if (err) {
                console.error("Upload error:", err);
                return res.status(500).json({ error: "File upload failed" });
            }

            const gameCode = Math.random().toString(36).substr(2, 6).toUpperCase();
            const username = req.body.username;

            console.log("Creating new game with host:", username);
            console.log("Game code:", gameCode);

            // Initialize game data with host player
            activeGames.set(gameCode, {
                players: [{ name: username, isHost: true }],
                status: 'processing'
            });

            // First run the PDF text extraction script
            const extractScript = path.join(__dirname, 'ml_models/data_preprocessing/extract_text_pdf.py');
            const extractProcess = spawn('python3', [extractScript]);
            
            extractProcess.stdout.on('data', (data) => {
                console.log('PDF Extraction:', data.toString());
            });

            extractProcess.stderr.on('data', (data) => {
                console.error('PDF Extraction Error:', data.toString());
            });

            // After PDF extraction, run the question generation script
            extractProcess.on('close', (code) => {
                console.log(`PDF extraction completed with code ${code}`);
                
                // Now run the question generation script
                const questionScript = path.join(__dirname, 'ml_models/models/t5_model.py');
                const questionProcess = spawn('python3', [questionScript]);
                
                questionProcess.stdout.on('data', (data) => {
                    console.log('Question Generation:', data.toString());
                });

                questionProcess.stderr.on('data', (data) => {
                    console.error('Question Generation Error:', data.toString());
                });

                questionProcess.on('close', (code) => {
                    console.log(`Question generation completed with code ${code}`);
                });
            });

            console.log("Active games:", Array.from(activeGames.entries()));
            
            res.json({ 
                gameCode,
                players: activeGames.get(gameCode).players,
                isHost: true
            });
        });
    } catch (error) {
        console.error("Upload error:", error);
        res.status(500).json({ error: "Failed to process files" });
    }
});

app.get("/api/status", (req, res) => {
    try {
        if (fs.existsSync(STATUS_FILE)) {
            const status = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
            console.log("Current status:", status);
            
            // Only set questionsGenerated to true if status is 'completed' AND we have questions
            if (status.status === 'completed') {
                const questionsData = JSON.parse(fs.readFileSync(QUESTIONS_FILE, 'utf8'));
                const questionsGenerated = questionsData.questions && questionsData.questions.length > 0;
                res.status(200).json({ 
                    questionsGenerated,
                    status: questionsGenerated ? 'completed' : 'processing',
                    message: status.message,
                    timestamp: status.timestamp
                });
            } else {
                res.status(200).json({ 
                    questionsGenerated: false,
                    status: status.status,
                    message: status.message,
                    timestamp: status.timestamp
                });
            }
        } else {
            res.status(200).json({ 
                questionsGenerated: false,
                status: 'unknown',
                message: 'Starting...'
            });
        }
    } catch (error) {
        console.error("Error checking status:", error);
        res.status(500).json({ 
            questionsGenerated: false,
            status: 'error',
            message: error.message
        });
    }
});

app.get("/api/questions", (req, res) => {
    console.log("Reading questions from:", QUESTIONS_FILE);
    
    fs.readFile(QUESTIONS_FILE, "utf8", (err, data) => {
        if (err) {
            console.error("Error reading questions file:", err);
            return res.status(500).json({
                error: "Error reading questions file",
                details: err.message
            });
        }

        try {
            const questionsData = JSON.parse(data);
            console.log("Sending questions data:", questionsData);
            res.status(200).json(questionsData);
        } catch (parseError) {
            console.error("Error parsing questions:", parseError);
            res.status(500).json({
                error: "Error parsing questions",
                details: parseError.message
            });
        }
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Global error handler:', err);
    res.status(500).json({
        error: 'Server error',
        details: err.message
    });
});

// Start server
app.listen(5000, () => {
    console.log("Server running on port 5000");
});

// Modify the generateQuestions function
const generateQuestions = async () => {
    console.log("Starting generateQuestions function...");
    
    // Reset status at start
    fs.writeFileSync(STATUS_FILE, JSON.stringify({
        status: 'starting',
        timestamp: new Date().toISOString()
    }));

    return new Promise((resolve, reject) => {
        const pythonScript = path.join(__dirname, "ml_models/models/t5_model.py");
        console.log("Running Python script:", pythonScript);
        
        const pythonProcess = exec(`python3 ${pythonScript}`, (error, stdout, stderr) => {
            if (error) {
                console.error("Error executing Python script:", error);
                reject(error);
                return;
            }
            if (stderr) {
                console.log("Python stderr:", stderr);
            }
            console.log("Python stdout:", stdout);
            
            // Check final status
            try {
                const status = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
                questionsGenerated = status.status === 'completed';
                resolve(stdout);
            } catch (err) {
                console.error("Error reading final status:", err);
                reject(err);
            }
        });

        // Log real-time output
        pythonProcess.stdout.on('data', (data) => {
            console.log(`Python output: ${data}`);
        });

        pythonProcess.stderr.on('data', (data) => {
            console.log(`Python error: ${data}`);
        });
    });
};

// Helper function to process video URL
function processVideoUrl(videoUrl) {
    return new Promise((resolve, reject) => {
        const pythonScript = path.join(__dirname, "ml_models/data_preprocessing/extract_text_url.py");
        const pythonProcess = spawn('python3', [pythonScript]);

        // Write the URL to the Python script's stdin
        pythonProcess.stdin.write(videoUrl + '\n');
        pythonProcess.stdin.end();

        pythonProcess.stdout.on('data', (data) => {
            console.log('Video Processing output:', data.toString());
        });

        pythonProcess.stderr.on('data', (data) => {
            console.error('Video Processing error:', data.toString());
        });

        pythonProcess.on('close', (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`Video processing failed with code ${code}`));
            }
        });
    });
}

// Helper function to process PDF files
function processPdfFiles(pdfFiles) {
    return new Promise((resolve, reject) => {
        const pythonScript = path.join(__dirname, "ml_models/data_preprocessing/extract_text_pdf.py");
        const pdfFilesArg = pdfFiles.join(",");
        
        const pythonProcess = spawn('python3', [pythonScript, pdfFilesArg]);

        pythonProcess.stdout.on('data', (data) => {
            console.log('PDF Processing output:', data.toString());
        });

        pythonProcess.stderr.on('data', (data) => {
            console.error('PDF Processing error:', data.toString());
        });

        pythonProcess.on('close', (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`PDF processing failed with code ${code}`));
            }
        });
    });
}

// Add this endpoint to handle joining games
app.post("/api/join-game", (req, res) => {
    const { gameCode, username } = req.body;
    console.log("Join attempt:", { gameCode, username });
    
    if (!activeGames.has(gameCode)) {
        console.log("Game not found:", gameCode);
        return res.status(404).json({ error: "Game not found" });
    }

    const game = activeGames.get(gameCode);
    game.players.push({ name: username, isHost: false });
    
    console.log("Updated players for game:", gameCode, game.players);
    
    res.json({ 
        gameCode,
        players: game.players,
        isHost: false
    });
});

// Add an endpoint to get list of active games
app.get("/api/active-games", (req, res) => {
    const games = Array.from(activeGames.entries()).map(([code, game]) => ({
        gameCode: code,
        playerCount: game.players.length
    }));
    console.log("Active games:", games);
    res.json({ games });
});

// Add this endpoint to get players for a specific game
app.get("/api/game/:gameCode/players", (req, res) => {
    const { gameCode } = req.params;
    console.log("Getting players for game:", gameCode);
    
    const game = activeGames.get(gameCode);
    console.log("Game data found:", game);
    
    if (!game) {
        return res.status(404).json({ error: "Game not found" });
    }
    
    console.log("Sending players:", game.players);
    res.json({ players: game.players });
});

// Add this endpoint to start the game
app.post("/api/game/:gameCode/start", (req, res) => {
    const { gameCode } = req.params;
    const game = activeGames.get(gameCode);
    
    if (!game) {
        return res.status(404).json({ error: "Game not found" });
    }
    
    game.status = 'started';
    console.log(`Game ${gameCode} started`);
    
    res.json({ success: true });
});

// Modify the existing players endpoint to include game status
app.get("/api/game/:gameCode/players", (req, res) => {
    const { gameCode } = req.params;
    const game = activeGames.get(gameCode);
    
    if (!game) {
        return res.status(404).json({ error: "Game not found" });
    }
    
    res.json({ 
        players: game.players,
        status: game.status
    });
});
