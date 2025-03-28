import React, { useState, useEffect, useRef } from "react";
import '../styles/GamePlay.css';
import GameOver from './GameOver';

// how much time we give players to answer each question
const timePerQuestion = 30

function GamePlay({ questions, onFinish, gameData }) {
    const [currentQuestion, setCurrentQuestion] = useState(0); // state for our current questions and answers to ask
    const [score, setScore] = useState(0); // state to manage users' scores
    const [showAnswer, setShowAnswer] = useState(false); // state to determine when and how long to show answer
    const [gameCompleted, setGameCompleted] = useState(false); // state to set if game completed or not
    const [ws, setWs] = useState(null);
    const [playerScores, setPlayerScores] = useState({});
    const selectedAnswerRef = useRef(null);
    const [timeLeft, setTimeLeft] = useState(timePerQuestion);  // time per question
    const [uiSelectedAnswer, setUiSelectedAnswer] = useState(null); // allws us to immediately update the ui of selected answer instead of waiting to re-render state
    const [playerCount, setPlayerCount] = useState(0) ;
    const [playersAnswered, setPlayersAnswered] = useState(0);
    const [hasAnswered, setHasAnswered] = useState(false);
    const playerTimesRef = useRef({});
    const [showLeaderboard, setShowLeaderboard] = useState(false); // State to toggle leaderboard view
    const [currentContext, setCurrentContext] = useState(""); // State for question context

    useEffect(() => { // initialize our game websocket at localhost
        const websocket = new WebSocket('ws://localhost:5000');
        
        websocket.onopen = () => { // when we create it, we'll set some basic data, including allowing players to join
            websocket.send(JSON.stringify({
                type: 'join_game',
                gameCode: gameData.gameCode,
                playerName: gameData.playerName
            }));
        };

        websocket.onmessage = (event) => { // fired when data is received
            const data = JSON.parse(event.data); // get data as JSON object from response
            console.log("Received WebSocket message:", data);
            
            if (data.type === 'player_answered') {
                setPlayerScores((prevScores) => {
                    const currentScore = prevScores[data.playerName]?.score || 0; // Get current score or initialize to 0
                    const newScore = currentScore + (data.points || 0); // Add the new points
            
                    console.log(
                        `${data.playerName} scored ${data.points || 0}. Total score: ${newScore}`
                    );
            
                    return {
                        ...prevScores,
                        [data.playerName]: { ...prevScores[data.playerName], score: newScore },
                    };
                });
            }                     

            if (data.type === 'player_count') {
                setPlayerCount(data.playerCount);
            }                       

            if (data.type === 'timer_update') {
                setTimeLeft(data.timeLeft);
            }

            if (data.type === 'show_answer') {
                setShowAnswer(true);
                setTimeLeft(null); // Pause the timer after showing the answer
            
                if (selectedAnswerRef.current === data.correctAnswer) {
                    const minPoints = 900;
                    const maxPoints = 1000;
                    const totalTime = 10;
            
                    // Use player-specific recorded time
                    const remainingTime = Math.max(0, playerTimesRef.current[gameData.playerName] || 0);
            
                    // Calculate points
                    const points = minPoints + (maxPoints - minPoints) * (remainingTime / totalTime);
            
                    // Update the score
                    setScore((prevScore) => prevScore + Math.floor(points));
                    console.log(`Points Earned: ${Math.floor(points)} for Remaining Time: ${remainingTime}`);
                }
            }                         
                        
            if (data.type === "next_question") {
                setShowAnswer(false);
                setUiSelectedAnswer(null);
                setPlayersAnswered(0);
                setHasAnswered(false);
                playerTimesRef.current = {}; // Reset player times
            
                if (data.currentQuestion < questions.length) {
                    setCurrentQuestion(data.currentQuestion);
                    setCurrentContext(data.context || ""); // Set context
                    setTimeLeft(10); // Reset the timer
                } else {
                    console.log("setting game completed to true");
                    setGameCompleted(true);
                }
            }            
            
            if (data.type === "player_answered") {
                setPlayersAnswered(data.playersAnswered); // Update answer count
                playerTimesRef.current[data.playerName] = data.playerTimeLeft; // Update time left for the player
                console.log(`Player ${data.playerName} answered. Time left: ${data.playerTimeLeft}`);
            }
                     
            if (data.type === "reset_game") {
                onFinish();
            }

            if (data.type === 'show_leaderboard') {
                setShowLeaderboard(data.show);
            }

            if (data.type === 'game_completed') {
                setGameCompleted(true);
            }      
        };

        setWs(websocket);

        if (questions.length > 0) {
            setCurrentContext(questions[0]?.context || "");
        }

        return () => {
            websocket.close();
        };
    }, [gameData.gameCode, gameData.playerName, questions, onFinish]);

    // Handle page navigation and refresh
    useEffect(() => {
        const handleBeforeUnload = async (event) => {
            event.preventDefault();
            try {
                await fetch(`http://localhost:5000/api/game/${gameData.gameCode}/leave`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ username: gameData.playerName }),
                });
                console.log("User removed from game due to page reload or navigation.");
            } catch (error) {
                console.error("Error notifying server of user leaving:", error);
            }
            return (event.returnValue = "Are you sure you want to leave?");
        };

        const handlePopState = async () => {
            try {
                await fetch(`http://localhost:5000/api/game/${gameData.gameCode}/leave`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ username: gameData.playerName }),
                });
                console.log("User removed from game due to back navigation.");
                onFinish(); // Return to lobby
            } catch (error) {
                console.error("Error notifying server of user leaving on back:", error);
            }
        };

        // Add event listeners
        window.addEventListener("beforeunload", handleBeforeUnload);
        window.addEventListener("popstate", handlePopState);

        // Cleanup listeners on unmount
        return () => {
            window.removeEventListener("beforeunload", handleBeforeUnload);
            window.removeEventListener("popstate", handlePopState);
        };
    }, [gameData.gameCode, gameData.playerName, onFinish]);

    const handleAnswer = (option) => {
        if (!showAnswer) {
            selectedAnswerRef.current = option; // Store the selected answer in the ref
            setUiSelectedAnswer(option); // Update UI immediately
            setHasAnswered(true);

            if (ws) {
                ws.send(JSON.stringify({
                    type: 'submit_answer',
                    gameCode: gameData.gameCode,
                    playerName: gameData.playerName,
                    answer: option,
                }))
            }
        }
    };    

    if (!questions || !questions.length || !questions[currentQuestion]) {
        return <div className="game-container">
            <div className="animated-background"></div>
            <div className="game-content">
                <div>Loading questions...</div>
            </div>
        </div>;
    }

    const nextQuestion = () => {
        if (!showLeaderboard) {
            // First step: Show leaderboard
            setShowLeaderboard(true);
            if (ws && gameData.isHost) {
                ws.send(
                    JSON.stringify({
                        type: "show_leaderboard",
                        gameCode: gameData.gameCode,
                        show: true,
                    })
                );
            }
        } else {
            // Second step: Hide leaderboard and move to the next question
            setShowLeaderboard(false);
            if (ws && gameData.isHost) {
                ws.send(
                    JSON.stringify({
                        type: "show_leaderboard",
                        gameCode: gameData.gameCode,
                        show: false,
                    })
                );
    
                if (currentQuestion < questions.length - 1) {
                    ws.send(
                        JSON.stringify({
                            type: "next_question",
                            gameCode: gameData.gameCode,
                            currentQuestion: currentQuestion + 1,
                        })
                    );
                } else {
                    setGameCompleted(true);
                    ws.send(
                        JSON.stringify({
                            type: "game_completed",
                            gameCode: gameData.gameCode,
                        })
                    )
                }
            }
        }
    };    
    
    const question = questions[currentQuestion];

    const handlePlayAgain = () => {
        if (ws && gameData.isHost) {
            ws.send(JSON.stringify({
                type: 'reset_game',
                gameCode: gameData.gameCode,
            }))
        }
    };     

    const handleLobby = () => {
        onFinish();
    }

    if (showLeaderboard) {
        const sortedPlayers = Object.entries(playerScores)
            .sort(([, a], [, b]) => b.score - a.score)
            .slice(0, 5); // Top 5 players
    
        return (
            <div className="game-container">
                <div className="game-content">
                    <h2 className="leaderboard-title">Leaderboard</h2>
                    <div className="leaderboard">
                        {sortedPlayers.map(([playerName, data], index) => (
                            <div
                                key={playerName}
                                className={`leaderboard-item ${
                                    index === 0 ? "first-place" : "" // Highlight first place
                                }`}
                            >
                                <span className="rank">{index + 1}</span>
                                <span className="player-name">{playerName}</span>
                                <span className="player-score">{data.score} points</span>
                            </div>
                        ))}
                    </div>
                    <div 
                        className="question-context"
                        dangerouslySetInnerHTML={{ 
                            __html: currentContext 
                        }}
                    />
                    {gameData.isHost && (
                        <button onClick={nextQuestion} className="next-button">
                            Next
                        </button>
                    )}
                </div>
            </div>
        );
    }    

    if (gameCompleted) {
        return (
            <GameOver 
                playerScores={playerScores}
                questions={questions}
                onPlayAgain={handlePlayAgain}
                gameData={gameData}
                handleLobby={handleLobby}
            />
        );
    }    

    return (
        <div className="game-container">
            <div className="animated-background"></div>
            <div className="game-content">
                {/* Add the progress at the top-left */}
                <div className="progress-top-left">
                    Question {currentQuestion + 1} of {questions.length}
                </div>
                
                <div className="score-display">Score: {score}</div>
    
                {/* Timer display */}
                <div className="timer" style={{ color: timeLeft <= 5 ? 'red' : 'inherit' }}>
                    {timeLeft > 0 ? `Time Left: ${timeLeft}s` : "Time's Up!"}
                </div>
                
                <div className="question-container">
                    <h2 className="question">{question.question}</h2>
                    <div className="answers-grid">
                        {question.options.map((option, i) => (
                            <button 
                                key={i} 
                                className={`answer-button 
                                    ${uiSelectedAnswer === option ? 'selected' : ''}
                                    ${showAnswer 
                                        ? option === question.correct_answer 
                                            ? 'correct' 
                                            : 'incorrect'
                                        : ''
                                    }`}
                                onClick={() => handleAnswer(option)}
                                disabled={showAnswer || hasAnswered} // Disable if already answered or showing answers
                            >
                                {option}
                            </button>
                        ))}
                    </div>
                    {showAnswer && gameData.isHost && (
                        <button onClick={nextQuestion} className="next-button">
                            Next
                        </button>
                    )}
                </div>
                <div className="answerCount">
                    <div className="players-answered-text">
                        Players Answered: {playersAnswered} / {playerCount}
                    </div>
                    <div className="progress-bar">
                        <div
                            className="progress-bar-fill"
                            style={{
                                width: `${(playersAnswered / playerCount) * 100}%`,
                            }}
                        ></div>
                    </div>
                </div>
            </div>
        </div>
    );    
}

export default GamePlay;
