const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { exec, spawn } = require("child_process");
const cors = require("cors");
const WebSocket = require('ws');

// file paths
const QUESTIONS_FILE = path.join(__dirname, "ml_models/models/questions.json");
const UPLOAD_DIR = path.join(__dirname, "ml_models/data_preprocessing/pdf_files");
const STATUS_FILE = path.join(__dirname, "ml_models/models/status.json");
const COMBINED_OUTPUT_FILE = path.join(__dirname, "ml_models/outputs/combined_output.txt");

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
            const isPrivate = req.body.isPrivate === 'true' || req.body.isPrivate === true; // Ensure isPrivate is a boolean

            // initialize game data with host player
            activeGames.set(gameCode, {
                players: [{ name: username, isHost: true }],
                status: 'processing',
                host: username, 
                isPrivate: isPrivate,
                questions: [],
                currentQuestion: 0,
                timer: null,
                timeLeft: 10,
            });

            // Clear combined_output.txt at the start of the upload process
            if (fs.existsSync(COMBINED_OUTPUT_FILE)) {
                fs.writeFileSync(COMBINED_OUTPUT_FILE, '');
                console.log("Cleared combined_output.txt at the start of the upload process.");
            }

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
                isHost: true, 
                isPrivate: isPrivate
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
const server = require('http').createServer(app);
const wss = new WebSocket.Server({ server });

// Store WebSocket connections with their game codes
const gameConnections = new Map(); // gameCode -> Set of WebSocket connections

wss.on('connection', (ws) => {
    let userGameCode = null;

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            console.log('Received WebSocket message:', data);
            
            switch (data.type) {
                case 'join_game':
                    userGameCode = data.gameCode;
                    if (!gameConnections.has(userGameCode)) {
                        gameConnections.set(userGameCode, new Set());
                    }
                    gameConnections.get(userGameCode).add(ws);
                    console.log(`Player joined game ${userGameCode}`);

                    // Broadcast updated player count
                    broadcastToGame(userGameCode, {
                        type: 'player_count',
                        playerCount: gameConnections.get(userGameCode).size,
                    });
                    break;

                case 'start_game':
                    console.log(`Starting game ${data.gameCode}`);
                    const game = activeGames.get(data.gameCode);
                    if (game) {
                        const questionsResponse = await fetch("http://localhost:5000/api/questions");
                        const questionsData = await questionsResponse.json();
                        game.questions = questionsData.questions;

                        game.currentQuestion = 0;
                        startGameTimer(data.gameCode);
                        // broadcast game started
                        broadcastToGame(data.gameCode, {
                            type: 'game_started',
                            questions: 'game.questions',
                        });
                    }
                    break;

                case 'submit_answer': {
                    const { playerName, gameCode, answer } = data;
                    const game = activeGames.get(gameCode);
                
                    if (!game) {
                        console.error(`Game not found for gameCode: ${gameCode}`);
                        return;
                    }
                
                    if (!game.answeredPlayers) {
                        game.answeredPlayers = new Map();
                    }
                
                    // Check if the player has already answered
                    if (game.answeredPlayers.has(playerName)) {
                        console.log(`Player ${playerName} has already answered`);
                        return;
                    }
                
                    // Record the player's answer and time left
                    game.answeredPlayers.set(playerName, game.timeLeft);
                
                    // Calculate the score for the player
                    const question = game.questions[game.currentQuestion];
                    const isCorrect = answer === question.correct_answer;
                
                    let points = 0;
                    if (isCorrect) {
                        const minPoints = 900;
                        const maxPoints = 1000;
                        const totalTime = 10; // Assuming a 10-second timer
                
                        points = Math.floor(minPoints + (maxPoints - minPoints) * (game.timeLeft / totalTime));
                    }
                
                    // Find the player and update their score
                    const player = game.players.find((p) => p.name === playerName);
                    if (player) {
                        player.score = (player.score || 0) + points;
                    }
                
                    console.log(`Player ${playerName} answered ${isCorrect ? "correctly" : "incorrectly"} with ${game.timeLeft}s left. Points: ${points}`);
                
                    // Broadcast the updated scores and answer state
                    broadcastToGame(gameCode, {
                        type: 'player_answered',
                        playersAnswered: game.answeredPlayers.size,
                        playerTimeLeft: game.timeLeft,
                        playerName,
                        isCorrect,
                        points,
                    });
                
                    if (game.answeredPlayers.size === game.players.length || game.timeLeft <= 0) {
                        clearInterval(game.timer);
                
                        broadcastToGame(gameCode, {
                            type: 'show_answer',
                            correctAnswer: question.correct_answer,
                            currentQuestion: game.currentQuestion,
                        });
                    }
                    break;
                }                                 
                
                case 'next_question': {
                    const currentGame = activeGames.get(data.gameCode);
                    if (currentGame) {
                        currentGame.currentQuestion = data.currentQuestion; // Update to next question
                        currentGame.answeredPlayers = new Map(); // Reset answered players
                        if (currentGame.currentQuestion >= currentGame.questions.length) {
                            console.log(`Game completed for gameCode: ${data.gameCode}`);
                            broadcastToGame(data.gameCode, {
                                type: 'game_completed',
                            });
                        } else {
                            const currentQuestionData = currentGame.questions[currentGame.currentQuestion]; // Get the current question object
                            broadcastToGame(data.gameCode, {
                                type: "next_question",
                                currentQuestion: currentGame.currentQuestion,
                                playersAnswered: 0,
                                playerCount: currentGame.players.length,
                                context: currentQuestionData.context || "",
                            });
                        }   
                        // Start the timer ONLY after the host triggers "Next Question"
                        startGameTimer(data.gameCode);
                    } else {
                        console.error(`Game not found for gameCode: ${data.gameCode}`);
                    }
                    break;
                }

                case 'show_leaderboard': {
                    const leaderboardGame = activeGames.get(data.gameCode);
                    if (leaderboardGame) {
                        broadcastToGame(data.gameCode, {
                            type: 'show_leaderboard',
                            gameCode: data.gameCode,
                            show: data.show, // Use the correct 'show' value from the client
                        });
                    }
                    break; // Add missing break statement
                }                

                case 'reset_game': {
                    const curGame = activeGames.get(data.gameCode);
                    if (curGame) {
                        curGame.answeredPlayers = new Map();
                        broadcastToGame(data.gameCode, {
                            type: "reset_game", 
                        })
                    }
                }

                case 'game_completed': {
                    const completeGame = activeGames.get(data.gameCode);
                    if (completeGame) {
                        broadcastToGame(data.gameCode, {
                            type: "game_completed",
                        })
                    }
                }

            }
        } catch (error) {
            console.error('WebSocket message error:', error);
        }
    });

    ws.on('close', () => {
        if (userGameCode && gameConnections.has(userGameCode)) {
            gameConnections.get(userGameCode).delete(ws);
            console.log(`Player left game ${userGameCode}`);
        }
    });
});

function broadcastToGame(gameCode, data) {
    console.log(`Broadcasting to game ${gameCode}:`, data);
    if (gameConnections.has(gameCode)) {
        gameConnections.get(gameCode).forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify(data));
            }
        });
    }
}

function startGameTimer(gameCode) {
    const game = activeGames.get(gameCode); // Retrieve the game from activeGames

    if (!game) return;

    if (game.timer) {
        clearInterval(game.timer); // Clear any existing timer
    }

    game.timeLeft = 10; // Initial time of 10 seconds

    // Start the game timer
    game.timer = setInterval(() => {
        const currentGame = activeGames.get(gameCode); // Access the latest game state
        if (!currentGame) {
            console.error(`Game not found for gameCode: ${gameCode}`);
            clearInterval(game.timer);
            return;
        }

        if (currentGame.timeLeft > 0) {
            currentGame.timeLeft -= 1; // Decrement time
            broadcastToGame(gameCode, {
                type: 'timer_update',
                timeLeft: currentGame.timeLeft,
                currentQuestion: currentGame.currentQuestion,
            });
        } else {
            clearInterval(currentGame.timer);

            const currentQuestion = currentGame.currentQuestion || 0;

            // Ensure the current question is within bounds
            if (currentQuestion >= currentGame.questions.length) {
                broadcastToGame(gameCode, {
                    type: 'game_completed',
                });
                return;
            }

            broadcastToGame(gameCode, {
                type: 'show_answer',
                correctAnswer: currentGame.questions[currentQuestion].correct_answer,
                currentQuestion,
            });

            // Update player progress
            currentGame.players.forEach((player) => {
                broadcastToGame(gameCode, {
                    type: 'player_progress',
                    playerName: player.name,
                    score: player.score || 0, 
                });
            });
        }
    }, 1000); // Run every second
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
        .filter(([_, game]) => game.players.length > 0) // Ensure the game has players
        .map(([code, game]) => ({
            gameCode: code,
            playerCount: game.players.length,
            isPrivate: game.isPrivate ?? false, // Default to false if undefined
        }))
        .filter((game) => !game.isPrivate); // Filter only public games

    console.log("Filtered active games:", games);

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
app.post("/api/game/:gameCode/start", async (req, res) => {
    // This endpoint includes questions in the broadcast
    const questionsResponse = await fetch("http://localhost:5000/api/questions");
    const questionsData = await questionsResponse.json();
    
    broadcastToGame(gameCode, {
        type: 'game_started',
        questions: questionsData.questions
    });
    
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

server.listen(5000, () => {
    console.log("Server running on port 5000");
});