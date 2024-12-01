import React, { useState } from "react";
import '../styles/GamePlay.css';

function GamePlay({ questions, onFinish }) {
    const [currentQuestion, setCurrentQuestion] = useState(0);
    const [score, setScore] = useState(0);
    const [showAnswer, setShowAnswer] = useState(false);
    const [gameCompleted, setGameCompleted] = useState(false);

    if (!questions || questions.length === 0) {
        return <div>No questions available</div>;
    }

    const handleAnswer = (selectedOption) => {
        setShowAnswer(true);
        if (selectedOption === questions[currentQuestion].correct_answer) {
            setScore((prev) => prev + 1);
        }
        
        setTimeout(() => {
            setShowAnswer(false);
            if (currentQuestion + 1 < questions.length) {
                setCurrentQuestion((prev) => prev + 1);
            } else {
                setGameCompleted(true);
            }
        }, 2000);
    };

    const handlePlayAgain = () => {
        onFinish();
    };

    if (gameCompleted) {
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

    const question = questions[currentQuestion];

    return (
        <div className="game-container">
            <div className="animated-background"></div>
            <div className="game-content">
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
