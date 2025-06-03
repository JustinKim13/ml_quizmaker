require('dotenv').config();
const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { exec, spawn } = require("child_process");
const cors = require("cors");
const WebSocket = require('ws');
const s3Utils = require('./utils/s3');
const { log, logLevels } = require('./utils/logger');

const app = express(); // create express app instance
app.use(cors({
    origin: process.env.CORS_ORIGIN,
    credentials: true
}));
app.use(express.json());

const activeGames = new Map(); // store active games and players

// Game state management with in-memory storage
const gameState = {
    async getGame(gameCode) {
        return activeGames.get(gameCode) || null;
    },

    async setGame(gameCode, game) {
        activeGames.set(gameCode, game);
    },

    async deleteGame(gameCode) {
        activeGames.delete(gameCode);
    },

    async getAllGames() {
        return Array.from(activeGames.values());
    }
};

// WebSocket connection management with Redis
const wsState = {
    async addConnection(gameCode, wsId) {
        await redis.sadd(`ws:${gameCode}`, wsId);
    },

    async removeConnection(gameCode, wsId) {
        await redis.srem(`ws:${gameCode}`, wsId);
    },

    async getConnections(gameCode) {
        return await redis.smembers(`ws:${gameCode}`);
    }
};

// Remove local file path constants and use S3 paths instead
function getS3Paths(gameCode) {
    return {
        QUESTIONS: `questions/${gameCode}/questions.json`,
        UPLOADS: `uploads/${gameCode}/`,
        STATUS: `status/${gameCode}/status.json`,
        COMBINED_OUTPUT: `outputs/${gameCode}/combined_output.txt`
    };
}

// Update storage configuration for multer to use memory storage
const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 100 * 1024 * 1024, // 100MB max file size
        files: 5 // max 5 files per upload
    }
});

// Update clear directory function to use S3
const clearDirectory = async (prefix) => {
    try {
        await s3Utils.clearDirectory(prefix);
    } catch (error) {
        log(logLevels.ERROR, 'Error clearing directory', { error: error.message, prefix });
        throw error;
    }
};

// Update upload endpoint
app.post("/api/upload", async (req, res) => {
    try {
        // Remove any old games for this host
        const username = req.body.username;
        for (const [code, game] of activeGames.entries()) {
            if (game.host === username) {
                activeGames.delete(code);
            }
        }
        await clearDirectory(getS3Paths(req.body.gameCode).UPLOADS);
        
        // Clear all S3 files to ensure clean start
        await s3Utils.deleteFile(getS3Paths(req.body.gameCode).QUESTIONS);
        await s3Utils.deleteFile(getS3Paths(req.body.gameCode).COMBINED_OUTPUT);
        await s3Utils.deleteFile(getS3Paths(req.body.gameCode).STATUS);
        
        upload.array("files")(req, res, async (err) => {
            if (err) {
                log(logLevels.ERROR, 'Upload error', { error: err.message });
                return res.status(500).json({ error: "File upload failed" });
            }

            const gameCode = Math.random().toString(36).substr(2, 6).toUpperCase();
            const username = req.body.username;
            const isPrivate = req.body.isPrivate === 'true' || req.body.isPrivate === true;
            const timePerQuestion = parseInt(req.body.timePerQuestion) || 30;
            const numQuestions = parseInt(req.body.numQuestions) || 10;
            const videoUrl = req.body.videoUrl;

            // Create new game
            activeGames.set(gameCode, {
                players: [{ name: username, score: 0, isHost: true }],
                status: 'processing',
                host: username,
                isPrivate: isPrivate,
                questions: [],
                currentQuestion: 0,
                timer: null,
                timeLeft: timePerQuestion,
                timePerQuestion: timePerQuestion,
                numQuestions: numQuestions,
                lastActivity: Date.now()
            });

            // Set initial status
            const statusData = {
                status: 'processing',
                message: 'Starting processing...',
                progress: 0,  // Start at 0%
                total_questions: numQuestions,
                questions_generated: 0,
                timestamp: new Date().toISOString()
            };
            await s3Utils.uploadFile(
                { 
                    buffer: Buffer.from(JSON.stringify(statusData)), 
                    mimetype: 'application/json' 
                },
                getS3Paths(gameCode).STATUS
            );

            // Process files if any
            if (req.files && req.files.length > 0) {
                // Upload files to S3
                const uploadPromises = req.files.map(file => 
                    s3Utils.uploadFile(file, `${getS3Paths(gameCode).UPLOADS}${Date.now()}-${file.originalname}`)
                );
                await Promise.all(uploadPromises);

                // Run PDF extraction
                const extractScript = path.join(__dirname, 'ml_models/data_preprocessing/extract_text_pdf.py');
                const extractProcess = spawn('python3', [extractScript, '--game_code', gameCode]);
                
                extractProcess.stdout.on('data', (data) => {
                    console.log('PDF Extraction:', data.toString());
                }); 
                
                extractProcess.stderr.on('data', (data) => {
                    console.error('PDF Extraction Error:', data.toString());
                });

                extractProcess.on('close', async (code) => {
                    console.log(`PDF extraction completed with code ${code}`);
                    
                    if (code === 0) {
                        if (videoUrl) {
                            // Update status before starting video processing - increment by 10%
                            await s3Utils.uploadFile(
                                { 
                                    buffer: Buffer.from(JSON.stringify({
                                        status: 'processing',
                                        message: 'PDF processing completed. Starting video processing...',
                                        progress: 10,
                                        total_questions: numQuestions,
                                        questions_generated: 0,
                                        timestamp: new Date().toISOString()
                                    })), 
                                    mimetype: 'application/json' 
                                },
                                getS3Paths(gameCode).STATUS
                            );
                            
                            // If we have both PDF and video, process video and append to existing text
                            processVideo(videoUrl, gameCode, true);
                        } else {
                            const game = activeGames.get(gameCode);
                            if (game) {
                                game.status = 'Generating questions...';
                                runQuestionGeneration(gameCode);
                            }
                        }
                    } else {
                        console.error('PDF extraction failed with code:', code);
                        const game = activeGames.get(gameCode);
                        if (game) {
                            game.status = 'error';
                            await s3Utils.uploadFile(
                                { 
                                    buffer: Buffer.from(JSON.stringify({
                                        status: 'error',
                                        message: 'PDF extraction failed. Please try again.',
                                        total_questions: numQuestions,
                                        questions_generated: 0,
                                        timestamp: new Date().toISOString()
                                    })), 
                                    mimetype: 'application/json' 
                                },
                                getS3Paths(gameCode).STATUS
                            );
                        }
                    }
                });
            } else if (videoUrl) {
                // Update status before starting video processing - increment by 5%
                await s3Utils.uploadFile(
                    { 
                        buffer: Buffer.from(JSON.stringify({
                            status: 'processing',
                            message: 'Preparing video processing...',
                            progress: 5,
                            total_questions: numQuestions,
                            questions_generated: 0,
                            timestamp: new Date().toISOString()
                        })), 
                        mimetype: 'application/json' 
                    },
                    getS3Paths(gameCode).STATUS
                );
                
                // If no files but video URL provided, process video directly
                processVideo(videoUrl, gameCode, false);
            } else {
                // No files and no video URL
                const game = activeGames.get(gameCode);
                if (game) {
                    game.status = 'error';
                    await s3Utils.uploadFile(
                        { 
                            buffer: Buffer.from(JSON.stringify({
                                status: 'error',
                                message: 'Please provide either PDF files or a video URL.',
                                total_questions: numQuestions,
                                questions_generated: 0,
                                timestamp: new Date().toISOString()
                            })), 
                            mimetype: 'application/json' 
                        },
                        getS3Paths(gameCode).STATUS
                    );
                }
            }

            console.log("Active games:", Array.from(activeGames.entries()));
            
            res.json({ 
                gameCode,
                players: activeGames.get(gameCode).players,
                isHost: true, 
                isPrivate: isPrivate
            });
        });
    } catch (error) {
        log(logLevels.ERROR, 'Upload error', { error: error.message });
        res.status(500).json({ error: "Failed to process files" });
    }
});

// Update status endpoint
app.get("/api/status", async (req, res) => {
    try {
        let status = null;
        try {
            const statusFile = await s3Utils.getFile(getS3Paths(req.query.gameCode).STATUS);
            if (statusFile) {
                status = JSON.parse(statusFile);
            }
        } catch (err) {
            // If the file does not exist, treat as processing
            return res.status(200).json({
                questionsGenerated: false,
                status: 'processing',
                message: 'Processing has started...',
                progress: 0,
                total_questions: 0,
                questions_generated: 0,
                timestamp: new Date().toISOString()
            });
        }

        // Check if any game is ready (for this session, just check all active games)
        let gameReady = false;
        let questionsCount = 0;
        for (const game of activeGames.values()) {
            if (game.status === 'ready' && game.questions && game.questions.length > 0) {
                gameReady = true;
                questionsCount = game.questions.length;
                break;
            }
        }

        if (gameReady) {
            return res.status(200).json({
                questionsGenerated: true,
                status: 'ready',
                message: `Questions ready! (${questionsCount} questions generated)`,
                progress: 100,
                timestamp: status ? status.timestamp : new Date().toISOString()
            });
        }

        if (status) {
            return res.status(200).json({
                questionsGenerated: false,
                status: status.status,
                message: status.message,
                progress: status.progress || 0,
                total_questions: status.total_questions,
                questions_generated: status.questions_generated,
                timestamp: status.timestamp
            });
        } else {
            return res.status(200).json({
                questionsGenerated: false,
                status: 'unknown',
                message: 'Starting...',
                progress: 0
            });
        }
    } catch (error) {
        log(logLevels.ERROR, 'Error checking status', { error: error.message });
        res.status(500).json({ 
            questionsGenerated: false,
            status: 'error',
            message: error.message,
            progress: 0
        });
    }
});

// Update questions endpoint
app.get("/api/questions", async (req, res) => {
    try {
        log(logLevels.INFO, 'Reading questions from S3', { path: getS3Paths(req.query.gameCode).QUESTIONS });
        
        const questionsFile = await s3Utils.getFile(getS3Paths(req.query.gameCode).QUESTIONS);
        const questionsData = JSON.parse(questionsFile.toString());
        
        log(logLevels.INFO, 'Sending questions data', { questionCount: questionsData.questions?.length });
        res.status(200).json(questionsData);
    } catch (error) {
        log(logLevels.ERROR, 'Error reading questions', { error: error.message });
        res.status(500).json({
            error: "Error reading questions file",
            details: error.message
        });
    }
});

// Add error handling middleware
app.use((err, req, res, next) => {
    log(logLevels.ERROR, 'Unhandled error occurred', {
        error: err.message,
        stack: err.stack,
        path: req.path,
        method: req.method
    });
    
    res.status(500).json({
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'production' ? 'An unexpected error occurred' : err.message
    });
});

// Add request logging middleware
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        log(logLevels.INFO, 'Request completed', {
            method: req.method,
            path: req.path,
            status: res.statusCode,
            duration: `${duration}ms`
        });
    });
    next();
});

// Start server
const server = require('http').createServer(app);
const wss = new WebSocket.Server({ 
    server,
    clientTracking: true,
    perMessageDeflate: false,
    maxPayload: 50 * 1024 * 1024, // 50MB max payload
    handshakeTimeout: process.env.WS_TIMEOUT || 60000,
    heartbeatInterval: process.env.WS_HEARTBEAT_INTERVAL || 30000
});

// Store WebSocket connections with their game codes
const gameConnections = new Map(); // gameCode -> Set of WebSocket connections

wss.on('connection', (ws) => {
    let userGameCode = null;

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            log(logLevels.DEBUG, 'WebSocket message received', { 
                type: data.type,
                gameCode: data.gameCode 
            });
            
            switch (data.type) {
                case 'join_game':
                    userGameCode = data.gameCode;
                    if (!gameConnections.has(userGameCode)) {
                        gameConnections.set(userGameCode, new Set());
                    }
                    gameConnections.get(userGameCode).add(ws);
                    log(logLevels.INFO, 'Player joined game via WebSocket', {
                        gameCode: userGameCode,
                        playerName: data.playerName
                    });

                    broadcastToGame(userGameCode, {
                        type: 'player_count',
                        playerCount: gameConnections.get(userGameCode).size
                    });
                    break;

                case 'start_game':
                    console.log(`Starting game ${data.gameCode}`);
                    const game = activeGames.get(data.gameCode);
                    if (game) {
                        // Fetch questions with the correct gameCode
                        const questionsResponse = await fetch(`http://localhost:5000/api/questions?gameCode=${data.gameCode}`);
                        const questionsData = await questionsResponse.json();
                        game.questions = questionsData.questions;

                        game.currentQuestion = 0;
                        game.timeLeft = game.timePerQuestion; // Ensure timer uses user-selected value for first question
                        startGameTimer(data.gameCode);
                        // broadcast game started with proper JSON serialization
                        broadcastToGame(data.gameCode, {
                            type: 'game_started',
                            questions: game.questions,
                            timeLeft: game.timeLeft,
                            timePerQuestion: game.timePerQuestion
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
                        const totalTime = game.timePerQuestion || 10; // Use the user-selected time per question
                        const effectiveTimeLeft = Math.min(game.timeLeft, totalTime);
                        points = Math.floor(minPoints + (maxPoints - minPoints) * (effectiveTimeLeft / totalTime));
                    }
                
                    // Find the player and update their score (but don't broadcast it yet)
                    const player = game.players.find((p) => p.name === playerName);
                    if (player) {
                        player.score = (player.score || 0) + points;
                        // Track correct answers
                        if (isCorrect) {
                            player.correct = (player.correct || 0) + 1;
                        }
                    }
                
                    console.log(`Player ${playerName} answered ${isCorrect ? "correctly" : "incorrectly"} with ${game.timeLeft}s left. Points: ${points}`);
                
                    // Only broadcast the answer count, not the scores yet
                    broadcastToGame(gameCode, {
                        type: 'player_answered',
                        playersAnswered: game.answeredPlayers.size,
                        playerTimeLeft: game.timeLeft,
                        playerName,
                        // Remove immediate score broadcasting - scores will be shown when everyone answers or timer ends
                    });
                
                    // Check if everyone has answered or timer has ended
                    if (game.answeredPlayers.size === game.players.length || game.timeLeft <= 0) {
                        clearInterval(game.timer);
                
                        // Now broadcast all the scores when showing the answer
                        const scoreUpdates = {};
                        game.players.forEach((player) => {
                            scoreUpdates[player.name] = {
                                score: player.score || 0,
                                correct: player.correct || 0
                            };
                        });

                        broadcastToGame(gameCode, {
                            type: 'show_answer',
                            correctAnswer: question.correct_answer,
                            currentQuestion: game.currentQuestion,
                            scoreUpdates: scoreUpdates // Include all score updates here
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
                            // Reset timer before broadcasting
                            currentGame.timeLeft = currentGame.timePerQuestion;
                            broadcastToGame(data.gameCode, {
                                type: "next_question",
                                currentQuestion: currentGame.currentQuestion,
                                playersAnswered: 0,
                                playerCount: currentGame.players.length,
                                context: currentQuestionData.context || "",
                                timePerQuestion: currentGame.timePerQuestion,
                                timeLeft: currentGame.timeLeft // Include the initial timer value
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
                        // Reset all game state
                        curGame.currentQuestion = 0;
                        curGame.timeLeft = curGame.timePerQuestion;
                        curGame.answeredPlayers = new Map();
                        
                        // Clear existing timer
                        if (curGame.timer) {
                            clearInterval(curGame.timer);
                            curGame.timer = null;
                        }
                        
                        // Reset all player scores
                        curGame.players.forEach((player) => {
                            player.score = 0;
                            player.correct = 0;
                        });
                        
                        broadcastToGame(data.gameCode, {
                            type: "reset_game", 
                        });
                    }
                    break;
                }

                case 'game_completed': {
                    const completeGame = activeGames.get(data.gameCode);
                    if (completeGame) {
                        broadcastToGame(data.gameCode, {
                            type: "game_completed",
                        });
                    }
                    break;
                }

            }
        } catch (error) {
            log(logLevels.ERROR, 'WebSocket message error', {
                error: error.message,
                stack: error.stack,
                gameCode: userGameCode
            });
        }
    });

    ws.on('close', () => {
        if (userGameCode && gameConnections.has(userGameCode)) {
            gameConnections.get(userGameCode).delete(ws);
            log(logLevels.INFO, 'Player left game via WebSocket', { gameCode: userGameCode });
        }
    });
});

function broadcastToGame(gameCode, data) {
    console.log(`Broadcasting to game ${gameCode}:`, data);
    if (gameConnections.has(gameCode)) {
        const message = JSON.stringify(data);
        gameConnections.get(gameCode).forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                try {
                    client.send(message);
                } catch (error) {
                    log(logLevels.ERROR, 'Error sending WebSocket message', {
                        error: error.message,
                        gameCode,
                        messageType: data.type
                    });
                }
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

    game.timeLeft = game.timePerQuestion; // Use stored timePerQuestion

    // Start the game timer with a small delay to ensure all setup messages are processed first
    setTimeout(() => {
        // Immediately broadcast the initial timer value to ensure all clients start with correct time
        broadcastToGame(gameCode, {
            type: 'timer_update',
            timeLeft: game.timeLeft,
            currentQuestion: game.currentQuestion,
        });

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

                // Collect all score updates when time runs out
                const scoreUpdates = {};
                currentGame.players.forEach((player) => {
                    scoreUpdates[player.name] = {
                        score: player.score || 0,
                        correct: player.correct || 0
                    };
                });

                broadcastToGame(gameCode, {
                    type: 'show_answer',
                    correctAnswer: currentGame.questions[currentQuestion].correct_answer,
                    currentQuestion,
                    scoreUpdates: scoreUpdates // Include all score updates here
                });
            }
        }, 1000); // Run every second
    }, 100); // 100ms delay to ensure question setup messages are processed first
}

// Add this endpoint to handle joining games
app.post("/api/join-game", (req, res) => {
    const { gameCode, username } = req.body;
    log(logLevels.INFO, 'Join game attempt', { gameCode, username });
    
    if (!activeGames.has(gameCode)) {
        log(logLevels.WARN, 'Game not found', { gameCode });
        return res.status(404).json({ error: "Game not found" });
    }

    const game = activeGames.get(gameCode);
    
    // Check if game is full
    const maxPlayers = parseInt(process.env.MAX_PLAYERS_PER_GAME) || 50;
    if (game.players.length >= maxPlayers) {
        log(logLevels.WARN, 'Game is full', { gameCode, currentPlayers: game.players.length, maxPlayers });
        return res.status(400).json({ error: "Game is full" });
    }

    // Check if username is already taken in this game
    if (game.players.some(player => player.name === username)) {
        log(logLevels.WARN, 'Username already taken', { gameCode, username });
        return res.status(400).json({ error: "Username already taken in this game" });
    }

    // Update last activity timestamp
    game.lastActivity = Date.now();
    
    game.players.push({ name: username, isHost: false });
    
    log(logLevels.INFO, 'Player joined game', { 
        gameCode, 
        username, 
        playerCount: game.players.length 
    });
    
    res.json({ 
        gameCode,
        players: game.players,
        isHost: false
    });
});

// Add an endpoint to get list of active games
app.get("/api/active-games", (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    // Filter games that are:
    // 1. Not private
    // 2. Have players
    // 3. Remove the status filtering so public games show up immediately
    const games = Array.from(activeGames.entries())
        .filter(([_, game]) => {
            return !game.isPrivate && 
                   game.players.length > 0;
                   // Removed: game.status !== 'processing' &&
                   // Removed: game.questions && game.questions.length > 0;
        })
        .map(([code, game]) => ({
            gameCode: code,
            playerCount: game.players.length,
            maxPlayers: process.env.MAX_PLAYERS_PER_GAME || 50,
            timePerQuestion: game.timePerQuestion,
            numQuestions: game.numQuestions,
            currentQuestion: game.currentQuestion,
            status: game.status
        }))
        .sort((a, b) => b.playerCount - a.playerCount); // Sort by player count

    const totalGames = games.length;
    const paginatedGames = games.slice(skip, skip + limit);

    console.log("Filtered active games:", {
        total: totalGames,
        page,
        limit,
        games: paginatedGames
    });

    res.json({ 
        games: paginatedGames,
        pagination: {
            total: totalGames,
            page,
            limit,
            totalPages: Math.ceil(totalGames / limit)
        }
    });
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
    const { gameCode } = req.params;
    // Fetch questions with the correct gameCode
    const questionsResponse = await fetch(`http://localhost:5000/api/questions?gameCode=${gameCode}`);
    const questionsData = await questionsResponse.json();
    
    broadcastToGame(gameCode, {
        type: 'game_started',
        questions: questionsData.questions
    });
    
    res.json({ success: true });
});

// Helper function to run question generation
function runQuestionGeneration(gameCode) {
    const questionScript = path.join(__dirname, 'ml_models/models/t5_model.py');
    const game = activeGames.get(gameCode); // Get the correct game
    if (!game) {
        console.error(`No game found for gameCode: ${gameCode}`);
        return;
    }

    console.log(`Starting question generation for game ${gameCode} with ${game.numQuestions} questions`);
    
    // Get current status to preserve progress - don't reset it!
    s3Utils.getFile(getS3Paths(gameCode).STATUS)
        .then(existingStatusFile => {
            let currentProgress = 0;
            try {
                if (existingStatusFile) {
                    const existingStatus = JSON.parse(existingStatusFile);
                    currentProgress = existingStatus.progress || 0;
                }
            } catch (e) {
                console.log('No existing status found, starting from 0%');
                currentProgress = 0;
            }

            // Set status preserving the current progress
            const status = {
                status: 'processing',
                message: 'Starting question generation...',
                progress: currentProgress,  // PRESERVE EXISTING PROGRESS!
                total_questions: game.numQuestions,
                questions_generated: 0,
                timestamp: new Date().toISOString()
            };

            // Write status and wait for it to complete
            return s3Utils.uploadFile(
                { buffer: Buffer.from(JSON.stringify(status)), mimetype: 'application/json' },
                getS3Paths(gameCode).STATUS
            );
        })
        .catch(error => {
            // If we can't get existing status, start from 0
            console.log('Could not get existing status, starting from 0%:', error.message);
            const status = {
                status: 'processing',
                message: 'Starting question generation...',
                progress: 0,  // Start from 0 if no existing status
                total_questions: game.numQuestions,
                questions_generated: 0,
                timestamp: new Date().toISOString()
            };

            return s3Utils.uploadFile(
                { buffer: Buffer.from(JSON.stringify(status)), mimetype: 'application/json' },
                getS3Paths(gameCode).STATUS
            );
        })
        .then(() => {
            // Add a longer delay to ensure S3 consistency
            return new Promise(resolve => setTimeout(resolve, 2000));
        })
        .then(() => {
            // Check if game is still active before starting question generation
            const currentGame = activeGames.get(gameCode);
            if (!currentGame) {
                console.log(`Game ${gameCode} no longer exists, stopping question generation`);
                return;
            }

            const questionProcess = spawn('python3', [questionScript, '--num_questions', game.numQuestions.toString(), '--game_code', gameCode]);
            
            let stdoutData = '';
            let stderrData = '';
            
            questionProcess.stdout.on('data', (data) => {
                const output = data.toString();
                stdoutData += output;
                console.log('Question Generation:', output);
            });

            questionProcess.stderr.on('data', (data) => {
                const error = data.toString();
                stderrData += error;
                console.error('Question Generation Error:', error);
            });

            questionProcess.on('close', async (code) => {
                console.log(`Question generation completed with code ${code}`);
                const game = activeGames.get(gameCode);
                if (!game) {
                    console.log(`Game ${gameCode} no longer exists, skipping question processing`);
                    return;
                }

                if (code === 0) {
                    console.log('Question generation successful');
                    // Add a delay before trying to read the questions
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    
                    // Try to load questions from S3
                    try {
                        const questionsFile = await s3Utils.getFile(getS3Paths(gameCode).QUESTIONS);
                        const questionsData = JSON.parse(questionsFile);
                        if (questionsData.questions && questionsData.questions.length > 0) {
                            game.questions = questionsData.questions;
                            game.status = 'ready';
                            broadcastToGame(gameCode, {
                                type: 'game_ready',
                                questionsCount: questionsData.questions.length
                            });
                        } else {
                            game.status = 'error';
                            broadcastToGame(gameCode, {
                                type: 'game_error',
                                message: 'No questions were generated. Please try again with a different file.'
                            });
                            console.error('No questions generated');
                        }
                    } catch (err) {
                        console.error('Failed to load questions after generation:', err);
                        // Add a retry with delay
                        await new Promise(resolve => setTimeout(resolve, 2000));
                        try {
                            const questionsFile = await s3Utils.getFile(getS3Paths(gameCode).QUESTIONS);
                            const questionsData = JSON.parse(questionsFile);
                            if (questionsData.questions && questionsData.questions.length > 0) {
                                game.questions = questionsData.questions;
                                game.status = 'ready';
                                broadcastToGame(gameCode, {
                                    type: 'game_ready',
                                    questionsCount: questionsData.questions.length
                                });
                            } else {
                                game.status = 'error';
                                broadcastToGame(gameCode, {
                                    type: 'game_error',
                                    message: 'No questions were generated. Please try again with a different file.'
                                });
                            }
                        } catch (retryErr) {
                            game.status = 'error';
                            broadcastToGame(gameCode, {
                                type: 'game_error',
                                message: 'Failed to load questions after generation. Please try again.'
                            });
                            console.error('Failed to load questions after retry:', retryErr);
                        }
                    }
                } else {
                    console.error('Question generation failed:', stderrData);
                    if (game) {
                        game.status = 'error';
                        broadcastToGame(gameCode, {
                            type: 'game_error',
                            message: 'Question generation failed. Please try again.'
                        });
                    }
                }
            });

            questionProcess.on('error', (error) => {
                console.error('Failed to start question generation:', error);
                const game = activeGames.get(gameCode);
                if (game) {
                    game.status = 'error';
                }
            });
        })
        .catch(error => {
            console.error('Failed to write initial status:', error);
            const game = activeGames.get(gameCode);
            if (game) {
                game.status = 'error';
                broadcastToGame(gameCode, {
                    type: 'game_error',
                    message: 'Failed to start question generation. Please try again.'
                });
            }
        });
}

// Add these new endpoints
app.post("/api/game/:gameCode/leave", async (req, res) => {
    try {
        const { gameCode } = req.params;
        const { username } = req.body;
        
        const game = activeGames.get(gameCode);
        if (!game) {
            return res.status(404).json({ error: "Game not found" });
        }

        // Remove player from game
        game.players = game.players.filter(p => p.name !== username);
        
        // If host left or no players left, clean up the game completely
        if (game.host === username || game.players.length === 0) {
            // Remove game from memory
            activeGames.delete(gameCode);
            if (gameConnections.has(gameCode)) {
                gameConnections.delete(gameCode);
            }
            
            // Notify remaining players that host left
            if (game.host === username) {
                broadcastToGame(gameCode, {
                    type: 'host_left'
                });
            }
            
            // Clean up all files (S3 and local) - don't await to avoid blocking response
            cleanupGameFiles(gameCode).catch(error => {
                log(logLevels.ERROR, 'Failed to cleanup files when leaving game', { 
                    gameCode, 
                    error: error.message 
                });
            });
        } else {
            // Update game state
            await gameState.setGame(gameCode, game);
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Error leaving game:', error);
        res.status(500).json({ error: "Failed to leave game" });
    }
});

// Add game cleanup function to cleanup inactive games
function cleanupInactiveGames() {
    const now = Date.now();
    const INACTIVE_TIMEOUT = 30 * 60 * 1000; // 30 minutes
    const MAX_ACTIVE_GAMES = 100; // Maximum number of active games

    for (const [gameCode, game] of activeGames.entries()) {
        if (now - game.lastActivity > INACTIVE_TIMEOUT) {
            log(logLevels.INFO, 'Cleaning up inactive game', { 
                gameCode,
                lastActivity: new Date(game.lastActivity).toISOString()
            });
            
            // Remove from memory
            activeGames.delete(gameCode);
            if (gameConnections.has(gameCode)) {
                gameConnections.delete(gameCode);
            }
            
            // Clean up all files (S3 and local) - don't await to avoid blocking
            cleanupGameFiles(gameCode).catch(error => {
                log(logLevels.ERROR, 'Failed to cleanup files for inactive game', { 
                    gameCode, 
                    error: error.message 
                });
            });
        }
    }

    if (activeGames.size > MAX_ACTIVE_GAMES) {
        const gamesToRemove = Array.from(activeGames.entries())
            .sort((a, b) => a[1].lastActivity - b[1].lastActivity)
            .slice(0, activeGames.size - MAX_ACTIVE_GAMES);

        for (const [gameCode, _] of gamesToRemove) {
            log(logLevels.INFO, 'Removing excess game', { 
                gameCode,
                totalGames: activeGames.size,
                maxGames: MAX_ACTIVE_GAMES
            });
            
            // Remove from memory
            activeGames.delete(gameCode);
            if (gameConnections.has(gameCode)) {
                gameConnections.delete(gameCode);
            }
            
            // Clean up all files (S3 and local) - don't await to avoid blocking
            cleanupGameFiles(gameCode).catch(error => {
                log(logLevels.ERROR, 'Failed to cleanup files for excess game', { 
                    gameCode, 
                    error: error.message 
                });
            });
        }
    }
}

// Run cleanup every 5 minutes
setInterval(cleanupInactiveGames, 5 * 60 * 1000);

app.get("/api/game/:gameCode/status", async (req, res) => {
    try {
        const { gameCode } = req.params;
        const game = activeGames.get(gameCode);
        
        if (!game) {
            return res.status(404).json({ 
                status: 'error',
                message: 'Game not found'
            });
        }
        
        res.json({
            status: game.status,
            message: game.status === 'processing' ? 'Question generation in progress' : 'Game is active'
        });
    } catch (error) {
        console.error('Error checking game status:', error);
        res.status(500).json({ error: "Failed to check game status" });
    }
});

// Add this helper function for video processing
async function processVideo(videoUrl, gameCode, isAppending = false) {
    console.log(`Starting video processing for URL: ${videoUrl}`);
    
    try {
        // Only clear files if we're not appending
        if (!isAppending) {
            await clearDirectory(getS3Paths(gameCode).UPLOADS);
            await s3Utils.deleteFile(getS3Paths(gameCode).QUESTIONS);
            await s3Utils.deleteFile(getS3Paths(gameCode).COMBINED_OUTPUT);
        }
        
        // Get the full path to Python
        const pythonPath = process.platform === 'win32' ? 'python' : 'python3';
        console.log(`Using Python path: ${pythonPath}`);
        
        const scriptPath = path.join(__dirname, 'ml_models/data_preprocessing/extract_text_url.py');
        console.log(`Script path: ${scriptPath}`);
        
        // Pass --game_code and --append flag to the script
        const videoProcess = spawn(pythonPath, [scriptPath, '--game_code', gameCode, '--append', isAppending.toString()]);
        
        let stdoutData = '';
        let stderrData = '';
        
        videoProcess.stdout.on('data', (data) => {
            const output = data.toString();
            stdoutData += output;
            console.log('Video Processing:', output);
        }); 
        
        videoProcess.stderr.on('data', (data) => {
            const error = data.toString();
            stderrData += error;
            // Only log, do not treat as fatal error here!
            // Many Python libs log to stderr even for non-fatal info
            console.error('Video Processing Log:', error);
        });

        videoProcess.on('error', (error) => {
            console.error('Failed to start video processing:', error);
            const game = activeGames.get(gameCode);
            if (game) {
                game.status = 'error';
                s3Utils.uploadFile(
                    { 
                        buffer: Buffer.from(JSON.stringify({
                            status: 'error',
                            message: `Failed to start video processing: ${error.message}. Please try again.`,
                            total_questions: game.numQuestions,
                            questions_generated: 0,
                            timestamp: new Date().toISOString()
                        })), 
                        mimetype: 'application/json' 
                    },
                    getS3Paths(gameCode).STATUS
                );
            }
        });

        videoProcess.on('close', async (videoCode) => {
            console.log(`Video processing completed with code ${videoCode}`);
            console.log('Video processing stdout:', stdoutData);
            console.log('Video processing stderr:', stderrData);
            
            if (videoCode === 0) {
                // Success: continue to question generation
                const game = activeGames.get(gameCode);
                if (game) {
                    game.status = 'Generating questions...';
                    runQuestionGeneration(gameCode);
                }
            } else {
                // Only here, treat as error
                const game = activeGames.get(gameCode);
                if (game) {
                    game.status = 'error';
                    await s3Utils.uploadFile(
                        { 
                            buffer: Buffer.from(JSON.stringify({
                                status: 'error',
                                message: `Video processing failed: ${stderrData || 'Unknown error'}. Please try again.`,
                                total_questions: game.numQuestions,
                                questions_generated: 0,
                                timestamp: new Date().toISOString()
                            })), 
                            mimetype: 'application/json' 
                        },
                        getS3Paths(gameCode).STATUS
                    );
                }
            }
        });

        // Write the video URL to the process's stdin
        videoProcess.stdin.write(videoUrl + '\n');
        videoProcess.stdin.end();
    } catch (error) {
        console.error('Error in video processing:', error);
        const game = activeGames.get(gameCode);
        if (game) {
            game.status = 'error';
            await s3Utils.uploadFile(
                { 
                    buffer: Buffer.from(JSON.stringify({
                        status: 'error',
                        message: `Error in video processing: ${error.message}. Please try again.`,
                        total_questions: game.numQuestions,
                        questions_generated: 0,
                        timestamp: new Date().toISOString()
                    })), 
                    mimetype: 'application/json' 
                },
                getS3Paths(gameCode).STATUS
            );
        }
    }
}

// Add game cleanup function to handle both S3 and local cleanup
async function cleanupGameFiles(gameCode) {
    try {
        log(logLevels.INFO, 'Starting complete cleanup for game', { gameCode });
        
        // Clean up S3 files
        const s3Paths = getS3Paths(gameCode);
        await Promise.all([
            s3Utils.deleteFile(s3Paths.QUESTIONS),
            s3Utils.deleteFile(s3Paths.STATUS),
            s3Utils.deleteFile(s3Paths.COMBINED_OUTPUT),
            s3Utils.clearDirectory(s3Paths.UPLOADS)
        ]);
        
        // Clean up local directories (if they exist)
        const localPaths = [
            path.join(__dirname, 'ml_models', 'outputs', gameCode),
            path.join(__dirname, 'ml_models', 'models', gameCode)
        ];
        
        for (const localPath of localPaths) {
            try {
                if (fs.existsSync(localPath)) {
                    const { spawn } = require('child_process');
                    await new Promise((resolve, reject) => {
                        const rmProcess = spawn('rm', ['-rf', localPath]);
                        rmProcess.on('close', (code) => {
                            if (code === 0) {
                                log(logLevels.INFO, 'Removed local directory', { path: localPath });
                                resolve();
                            } else {
                                log(logLevels.WARN, 'Failed to remove local directory', { path: localPath, code });
                                resolve(); // Don't fail cleanup for local directory issues
                            }
                        });
                        rmProcess.on('error', (error) => {
                            log(logLevels.WARN, 'Error removing local directory', { path: localPath, error: error.message });
                            resolve(); // Don't fail cleanup for local directory issues
                        });
                    });
                }
            } catch (error) {
                log(logLevels.WARN, 'Error checking/removing local directory', { 
                    path: localPath, 
                    error: error.message 
                });
            }
        }
        
        log(logLevels.INFO, 'Complete cleanup finished for game', { gameCode });
    } catch (error) {
        log(logLevels.ERROR, 'Error during game cleanup', { 
            gameCode, 
            error: error.message 
        });
    }
}

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT} in ${process.env.NODE_ENV} mode`);
});