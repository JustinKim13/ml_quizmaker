const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { exec, spawn } = require("child_process");
const cors = require("cors");

// file paths
const QUESTIONS_FILE = path.join(__dirname, "ml_models/models/questions.json");
const UPLOAD_DIR = path.join(__dirname, "ml_models/data_preprocessing/pdf_files");
const STATUS_FILE = path.join(__dirname, "ml_models/models/status.json");

const app = express(); // create express app instance
app.use(cors()); // allow cors
app.use(express.json()); // parse json bodies

const activeGames = new Map(); // store active games and players

// storage configuration for multer
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        if (!fs.existsSync(UPLOAD_DIR)) { // check if upload directory exists
            fs.mkdirSync(UPLOAD_DIR, { recursive: true }); // create it if not
        }
        cb(null, UPLOAD_DIR); // set destination
    },
    filename: (req, file, cb) => {
        cb(null, `${Date.now()}-${file.originalname}`); // set unique filename
    },
});

const upload = multer({ storage }); // create multer instance with storage configuration

// clear directory
const clearDirectory = (directory) => {
    return new Promise((resolve, reject) => {
        fs.rm(directory, { recursive: true, force: true }, (err) => { // remove directory recursively
            if (err) {
                reject(err); // reject promise if error
            } else {
                // Recreate the empty directory
                fs.mkdirSync(directory, { recursive: true }); // create directory
                resolve(); // resolve promise
            }
        });
    });
};

// upload endpoint
app.post("/api/upload", async (req, res) => {
    try {
        await clearDirectory(UPLOAD_DIR);
        // Also clear old questions file
        if (fs.existsSync(QUESTIONS_FILE)) {
            fs.writeFileSync(QUESTIONS_FILE, JSON.stringify({ questions: [] }));
        }
        
        upload.array("files")(req, res, async (err) => {
            if (err) {
                console.error("Upload error:", err);
                return res.status(500).json({ error: "File upload failed" });
            }

            // create a random game code
            const gameCode = Math.random().toString(36).substr(2, 6).toUpperCase();
            const username = req.body.username; // get username from request body

            // initialize game data with host player
            activeGames.set(gameCode, {
                players: [{ name: username, isHost: true }],
                status: 'processing',
                host: username
            });

            // run pdf extraction script
            const extractScript = path.join(__dirname, 'ml_models/data_preprocessing/extract_text_pdf.py'); // get our script path
            const extractProcess = spawn('python3', [extractScript]); // spawn python process
            
            // check if pdf extraction is successful
            extractProcess.stdout.on('data', (data) => { // log stdout
                console.log('PDF Extraction:', data.toString()); 
            }); extractProcess.stderr.on('data', (data) => { // log stderr
                console.error('PDF Extraction Error:', data.toString());
            });

            // after pdf extraction, run question generation script
            extractProcess.on('close', (code) => { // event listener that triggers when extraction is complete
                console.log(`PDF extraction completed with code ${code}`);
                
                const videoUrl = req.body.videoUrl; // get video url from request body  
                if (videoUrl) { // if video url is provided
                    const videoProcess = spawn('python3', [path.join(__dirname, 'ml_models/data_preprocessing/extract_text_url.py')]); // spawn python process
                    
                    videoProcess.stdin.write(videoUrl + '\n'); // write video url to stdin
                    videoProcess.stdin.end(); // end stdin

                    videoProcess.stdout.on('data', (data) => { // log stdout
                        console.log('Video Processing:', data.toString());
                    }); videoProcess.stderr.on('data', (data) => { // log stderr
                        console.error('Video Processing Error:', data.toString());
                    });

                    // generate questions after video processing is complete
                    videoProcess.on('close', (code) => { // event listener that triggers when video processing is complete
                        console.log(`Video processing completed with code ${code}`);
                        // Update status to question generation
                        activeGames.get(gameCode).status = 'Generating questions...';
                        runQuestionGeneration();
                    });
                } else {
                    // If no video, generate questions right after PDF processing
                    // Update status to question generation
                    activeGames.get(gameCode).status = 'Generating questions...';
                    runQuestionGeneration();
                }
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
    const games = Array.from(activeGames.entries())
        .filter(([_, game]) => game.players.some(p => p.isHost))
        .map(([code, game]) => ({
            gameCode: code,
            playerCount: game.players.length
        }));
    console.log("Active games:", games);
    res.json({ games });
});

// Add this endpoint to get players for a specific game
app.get("/api/game/:gameCode/players", (req, res) => {
    const { gameCode } = req.params;
    const game = activeGames.get(gameCode);
    
    if (!game) {
        return res.status(404).json({ 
            error: "Game not found",
            hostLeft: true  // Indicate that the game no longer exists
        });
    }
    
    res.json({ 
        players: game.players,
        status: game.status,
        hostLeft: false
    });
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

// Helper function to run question generation
function runQuestionGeneration() {
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
}

// Add these new endpoints
app.post("/api/game/:gameCode/leave", (req, res) => {
    const { gameCode } = req.params;
    const { username } = req.body;
    
    const game = activeGames.get(gameCode);
    if (!game) {
        return res.status(404).json({ error: "Game not found" });
    }

    // If host is leaving, set players to empty array
    if (game.host === username) {
        console.log(`Host ${username} left game ${gameCode}. Setting players to empty.`);
        game.players = [];
        return res.json({ 
            message: "Host left",
            wasHost: true,
            hostLeft: true
        });
    }

    // Otherwise, just remove the player
    game.players = game.players.filter(player => player.name !== username);
    console.log(`Player ${username} left game ${gameCode}. Remaining players:`, game.players);
    
    res.json({ 
        message: "Successfully left the game",
        wasHost: false,
        hostLeft: false
    });
});
