import React, { useState, useEffect, useRef } from "react";
import '../styles/GamePlay.css';

function GamePlay({ questions, onFinish, gameData }) {
    const [currentQuestion, setCurrentQuestion] = useState(0); // state for our current questions and answers to ask
    const [score, setScore] = useState(0); // state to manage users' scores
    const [showAnswer, setShowAnswer] = useState(false); // state to determine when and how long to show answer
    const [gameCompleted, setGameCompleted] = useState(false); // state to set if game completed or not
    const [ws, setWs] = useState(null);
    const [playerScores, setPlayerScores] = useState({});
    const selectedAnswerRef = useRef(null);
    const [timeLeft, setTimeLeft] = useState(10); // 30 second timer
    const [uiSelectedAnswer, setUiSelectedAnswer] = useState(null); // allws us to immediately update the ui of selected answer instead of waiting to re-render state


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

            if (data.type === 'timer_update') {
                setTimeLeft(data.timeLeft);
            }

            if (data.type === 'show_answer') {
                setShowAnswer(true);

                if (selectedAnswerRef.current === data.correctAnswer) {
                    setScore((prevScore) => prevScore + 1);
                }                


                console.log("correctAnswer: " + data.correctAnswer); // debugging
                console.log("selectedAnswerRef: " + selectedAnswerRef.current);                

                setTimeout(() => {
                    setShowAnswer(false);
                    setUiSelectedAnswer(null); // Reset for the next question
                    if (data.currentQuestion + 1 < questions.length) {
                        setCurrentQuestion(data.currentQuestion + 1);
                        setTimeLeft(10);
                    } else {
                        setGameCompleted(true);
                    }
                }, 2000);
            }

            if (data.type === 'game_completed') {
                setGameCompleted(true);
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

    const handleAnswer = (option) => {
        if (!showAnswer) {
            selectedAnswerRef.current = option; // Store the selected answer in the ref
            setUiSelectedAnswer(option); // Update UI immediately
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

    const handleLobby = () => {
        onFinish();
    }

    if (gameCompleted) { // if gameCompleted state is true, show results page
        return (
            <div className="game-container">
                <div className="animated-background"></div>
                <div className="game-content">
                    <div className="final-score">
                        <h2>Game Complete!</h2>
                        <p>Final Score: {score} out of {questions.length}</p>
                        <p>Percentage: {((score / questions.length) * 100).toFixed(1)}%</p>
                        {gameData.isHost && ( 
                            <button onClick={handlePlayAgain} className="play-again-button">
                                Play Again
                            </button>
                        )}
                        {!gameData.isHost && (
                            <button onClick={handleLobby} className="play-again-button">
                                Return to Lobby
                            </button>
                        )}
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
