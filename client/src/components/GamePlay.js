import React, { useState, useEffect } from "react";
import '../styles/GamePlay.css';

function GamePlay({ questions, onFinish, gameData }) {
    const [currentQuestion, setCurrentQuestion] = useState(0); // state for our current questions and answers to ask
    const [score, setScore] = useState(0); // state to manage users' scores
    const [showAnswer, setShowAnswer] = useState(false); // state to determine when and how long to show answer
    const [gameCompleted, setGameCompleted] = useState(false); // state to set if game completed or not
    const [ws, setWs] = useState(null);
    const [playerScores, setPlayerScores] = useState({});

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

    if (!questions || questions.length === 0) { // if there's no questions, return descriptive text div
        return <div>No questions available</div>;
    }

    const handleAnswer = (selectedOption) => { // function to handle how user's answer questions
        setShowAnswer(true); // immediately show the user if they were correct or not
        if (selectedOption === questions[currentQuestion].correct_answer) { // if user gets correct, update their score
            setScore((prev) => prev + 1); // update score state by incrementing prev score by 1
        }
        
        setTimeout(() => { // set timeout for 2 seconds
            setShowAnswer(false); // stop showing answer after 2 seconds
            if (currentQuestion + 1 < questions.length) { // if there's another quefstion, set it to that by incrementing question state by 1
                setCurrentQuestion((prev) => prev + 1);
            } else {
                setGameCompleted(true); // if no more questions to ask, set gameCompleted state to true
            }
        }, 2000);

        // Broadcast progress to other players
        ws.send(JSON.stringify({
            type: 'answer_submitted',
            gameCode: gameData.gameCode,
            playerName: gameData.playerName,
            score: score + (selectedOption === questions[currentQuestion].correct_answer ? 1 : 0),
            currentQuestion: currentQuestion + 1
        }));
    };

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

    const question = questions[currentQuestion]; // get currentQuestion from array

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
                <div className="question-container">
                    <h2 className="question">{question.question}</h2>
                    <div className="answers-grid">
                        {question.options.map((option, i) => (
                            <button 
                                key={i} 
                                className={`answer-button ${
                                    showAnswer 
                                        ? option === question.correct_answer 
                                            ? 'correct' 
                                            : 'incorrect'
                                        : ''
                                }`}
                                onClick={() => !showAnswer && handleAnswer(option)}
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
