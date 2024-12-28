import React, { useState, useEffect } from "react";
import '../styles/GamePlay.css';

function GamePlay({ questions, onFinish, gameData }) {
    const [currentQuestion, setCurrentQuestion] = useState(0); // state for our current questions and answers to ask
    const [score, setScore] = useState(0); // state to manage users' scores
    const [showAnswer, setShowAnswer] = useState(false); // state to determine when and how long to show answer
    const [gameCompleted, setGameCompleted] = useState(false); // state to set if game completed or not
    const [ws, setWs] = useState(null);
    const [playerScores, setPlayerScores] = useState({});
    const [selectedAnswer, setSelectedAnswer] = useState(null); // Track current selection
    const [timeLeft, setTimeLeft] = useState(30); // 30 second timer
    const [timerActive, setTimerActive] = useState(true); // Control timer state

    useEffect(() => {
        const websocket = new WebSocket('ws://localhost:5000');
        
        websocket.onopen = () => {
            websocket.send(JSON.stringify({
                type: 'join_game',
                gameCode: gameData.gameCode,
                playerName: gameData.playerName
            }));
        };

        websocket.onmessage = (event) => {
            const data = JSON.parse(event.data);
            
            if (data.type === 'player_progress') {
                // Update other players' progress
                setPlayerScores(prev => ({
                    ...prev,
                    [data.playerName]: {
                        score: data.score,
                        currentQuestion: data.currentQuestion
                    }
                }));
            }
        };

        setWs(websocket);

        return () => {
            websocket.close();
        };
    }, [gameData.gameCode, gameData.playerName]);

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

    // Timer effect
    useEffect(() => {
        let timer;
        if (questions && questions[currentQuestion] && timerActive && timeLeft > 0) {
            timer = setInterval(() => {
                setTimeLeft((prev) => prev - 1);
            }, 1000);
        } else if (timeLeft === 0 && questions && questions[currentQuestion] && timerActive) {
            setShowAnswer(true);
            setTimerActive(false);
            
            if (selectedAnswer === questions[currentQuestion].correct_answer) {
                setScore((prev) => prev + 1);
            }

            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'answer_submitted',
                    gameCode: gameData.gameCode,
                    playerName: gameData.playerName,
                    score: score + (selectedAnswer === questions[currentQuestion].correct_answer ? 1 : 0),
                    currentQuestion: currentQuestion + 1
                }));
            }

            setTimeout(() => {
                setShowAnswer(false);
                if (currentQuestion + 1 < questions.length) {
                    setCurrentQuestion((prev) => prev + 1);
                    setSelectedAnswer(null);
                    setTimeLeft(30);
                    setTimerActive(true);
                } else {
                    setGameCompleted(true);
                }
            }, 2000);
        }

        return () => clearInterval(timer);
    }, [timeLeft, timerActive, currentQuestion, questions, selectedAnswer, ws, gameData.gameCode, gameData.playerName, score]);

    const handleAnswer = (option) => {
        if (!showAnswer) {
            setSelectedAnswer(option);
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

    const question = questions[currentQuestion];

    const handlePlayAgain = () => {
        onFinish(); // passed as a parameter so that it's implementation can be handled in App.js
    };

    if (gameCompleted) { // if gameCompleted state is true, show results page
        return (
            <div className="game-container">
                <div className="animated-background"></div>
                <div className="game-content">
                    <div className="final-score">
                        <h2>Game Complete!</h2>
                        <p>Final Score: {score} out of {questions.length}</p>
                        <p>Percentage: {((score / questions.length) * 100).toFixed(1)}%</p>
                        <button onClick={handlePlayAgain} className="play-again-button">
                            Play Again
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="game-container">
            <div className="animated-background"></div>
            <div className="game-content">
                <div className="scoreboard">
                    {Object.entries(playerScores).map(([player, data]) => (
                        <div key={player} className="player-score">
                            <span>{player}</span>
                            <span>Score: {data.score}</span>
                            <span>Question: {data.currentQuestion + 1}/{questions.length}</span>
                        </div>
                    ))}
                </div>
                <div className="score-display">Score: {score}</div>
                
                {/* Timer display */}
                <div className="timer" style={{ color: timeLeft <= 5 ? 'red' : 'inherit' }}>
                    Time Left: {timeLeft}s
                </div>

                <div className="question-container">
                    <h2 className="question">{question.question}</h2>
                    <div className="answers-grid">
                        {question.options.map((option, i) => (
                            <button 
                                key={i} 
                                className={`answer-button 
                                    ${selectedAnswer === option ? 'selected' : ''} 
                                    ${showAnswer 
                                        ? option === question.correct_answer 
                                            ? 'correct' 
                                            : 'incorrect'
                                        : ''
                                    }`}
                                onClick={() => handleAnswer(option)}
                                disabled={showAnswer}
                            >
                                {option}
                            </button>
                        ))}
                    </div>
                </div>
                <div className="progress">
                    Question {currentQuestion + 1} of {questions.length}
                </div>
            </div>
        </div>
    );
}

export default GamePlay;
